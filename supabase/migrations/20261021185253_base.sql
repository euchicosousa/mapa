-- Base consolidada do Mapa (ticket 30, 21/10/2026).
--
-- Substitui as 33 migrações de 19–20/10/2026, guardadas em supabase/migrations-arquivo/
-- apenas como histórico. O conteúdo abaixo é o schema de produção (public e private)
-- gerado com o mesmo script de `supabase db dump`, mais os objetos que o dump por
-- schema não inclui: a extensão pg_trgm, o trigger em auth.users e a configuração
-- inicial da IA. Preenchimentos de dados das migrações antigas (perfis de usuários já
-- existentes e o livro de uso da IA) não entram: um banco novo não tem esses dados.
--
-- Nunca editar este arquivo depois de aplicado. Mudanças novas vão em migrações novas.

create extension if not exists "pg_trgm" with schema "extensions";




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "private"."accept_workspace_invitation"("p_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare actor uuid:=auth.uid(); recipient_email text; inv public.workspace_invitations;
begin
 if actor is null then raise exception 'UNAUTHENTICATED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,4));
 select lower(email) into recipient_email from auth.users where id=actor and email_confirmed_at is not null;
 if recipient_email is null then raise exception 'INVITE_UNAVAILABLE'; end if;
 select * into inv from public.workspace_invitations where id=p_id for update;
 if inv.id is null or inv.email<>recipient_email or (inv.auth_user_id is not null and inv.auth_user_id<>actor) then raise exception 'INVITE_UNAVAILABLE'; end if;
 if inv.status='accepted' and inv.accepted_by=actor and exists(select 1 from public.workspace_members where workspace_id=inv.workspace_id and user_id=actor and status='active') then return inv.workspace_id; end if;
 if inv.status<>'pending' or inv.expires_at<=now() then raise exception 'INVITE_UNAVAILABLE'; end if;
 if exists(select 1 from public.workspace_members where user_id=actor and status='active' and workspace_id<>inv.workspace_id) then raise exception 'ALREADY_MEMBER'; end if;
 insert into public.workspace_members(workspace_id,user_id,role,status) values(inv.workspace_id,actor,'member','active')
 on conflict(workspace_id,user_id) do update set status='active',role=case when workspace_members.status='active' then workspace_members.role else 'member' end;
 update public.workspace_invitations set status='accepted',accepted_by=actor,auth_user_id=actor,accepted_at=now(),updated_at=now() where id=inv.id;
 return inv.workspace_id;
end;$$;


ALTER FUNCTION "private"."accept_workspace_invitation"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_context"("p_map" "uuid", "p_parent" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  with recursive path as (
    select id,parent_id,text,0 depth from public.nodes where map_id=p_map and id=p_parent
    union all
    select n.id,n.parent_id,n.text,p.depth+1 from public.nodes n join path p on p.parent_id=n.id where n.map_id=p_map and p.depth<31
  ) select jsonb_build_object('title',(select title from public.maps where id=p_map),
    'path',coalesce((select jsonb_agg(jsonb_build_object('id',id,'text',text) order by depth desc) from path),'[]'),
    'children',coalesce((select jsonb_agg(jsonb_build_object('id',id,'text',text) order by sort_order,id) from public.nodes where map_id=p_map and parent_id=p_parent),'[]'));
$$;


ALTER FUNCTION "private"."ai_context"("p_map" "uuid", "p_parent" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_generation_available"("p_actor" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
 select exists(select 1 from public.workspace_members where user_id=p_actor and status='active') and exists(
   select 1 from private.ai_settings where singleton and (enabled or exists(select 1 from private.ai_validation_access where user_id=p_actor and expires_at>now())));
$$;


ALTER FUNCTION "private"."ai_generation_available"("p_actor" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."ai_generations" (
    "id" "uuid" NOT NULL,
    "map_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "parent_node_id" "uuid" NOT NULL,
    "requested_by" "uuid" NOT NULL,
    "editor_session_id" "uuid" NOT NULL,
    "request_hash" "text" NOT NULL,
    "context_fingerprint" "text" NOT NULL,
    "state" "text" NOT NULL,
    "model" "text" NOT NULL,
    "usage" "jsonb",
    "reserved_tokens" integer NOT NULL,
    "error_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:02:00'::interval) NOT NULL,
    "applied_operation_id" "uuid",
    "result" "jsonb",
    "usage_day" "date" NOT NULL,
    "accounted_tokens" bigint NOT NULL,
    CONSTRAINT "ai_accounted_tokens_nonnegative" CHECK (("accounted_tokens" >= 0)),
    CONSTRAINT "ai_generations_reserved_tokens_check" CHECK (("reserved_tokens" > 0)),
    CONSTRAINT "ai_generations_state_check" CHECK (("state" = ANY (ARRAY['pending'::"text", 'running'::"text", 'applied'::"text", 'failed'::"text", 'cancelled'::"text", 'stale'::"text"])))
);


ALTER TABLE "public"."ai_generations" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_job_json"("j" "public"."ai_generations") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object('id',j.id,'mapId',j.map_id,'parentNodeId',j.parent_node_id,'editorSessionId',j.editor_session_id,
    'state',j.state,'errorCode',j.error_code,'result',(select after_data from public.map_operations where id=j.applied_operation_id));
$$;


ALTER FUNCTION "private"."ai_job_json"("j" "public"."ai_generations") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_utc_day"("p_time" timestamp with time zone) RETURNS "date"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$ select (p_time at time zone 'UTC')::date; $$;


ALTER FUNCTION "private"."ai_utc_day"("p_time" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_valid_usage"("p_usage" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
declare a bigint; b bigint; total bigint;
begin
  if jsonb_typeof(p_usage) is distinct from 'object' then return null; end if;
  if coalesce(p_usage->>'input_tokens','')!~'^[0-9]{1,9}$' or coalesce(p_usage->>'output_tokens','')!~'^[0-9]{1,9}$' or coalesce(p_usage->>'total_tokens','')!~'^[0-9]{1,9}$' then return null; end if;
  a:=(p_usage->>'input_tokens')::bigint;b:=(p_usage->>'output_tokens')::bigint;total:=(p_usage->>'total_tokens')::bigint;
  if a+b<>total then return null; end if;
  return jsonb_build_object('input_tokens',a,'output_tokens',b,'total_tokens',total);
end; $_$;


ALTER FUNCTION "private"."ai_valid_usage"("p_usage" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."apply_map_command"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_kind" "text", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  actor uuid := auth.uid();
  max_nodes constant integer := 500;
  -- Edges from the root; the root itself is depth 0.
  max_depth constant integer := 30;
  target public.maps;
  hash text;
  previous public.map_operations;
  allowed text[];
  v_node_id uuid;
  v_parent_id uuid;
  v_text text;
  depth integer;
  before_node public.nodes;
  changed public.nodes;
  result jsonb;
  before_snapshot jsonb;
  deleted_ids jsonb;
  affected jsonb;
  old_parent uuid;
  sibling_ids uuid[];
  sibling_id uuid;
  target_index integer;
  position integer;
  total integer;
  reached integer;
  deepest integer;
  v_project_id uuid;
  v_owner_id uuid;
  actor_role text;
begin
  if actor is null then raise exception using message = 'UNAUTHENTICATED'; end if;
  if p_map_id is null or p_operation_id is null or p_editor_session_id is null or p_expected_revision is null
     or p_kind is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using message = 'VALIDATION';
  end if;
  -- Unknown commands and unknown fields (created_by, source, sortOrder…) are rejected.
  allowed := case p_kind when 'add_child' then array['nodeId', 'parentId', 'text']
                         when 'edit_text' then array['nodeId', 'text']
                         when 'delete_subtree' then array['nodeId']
                         when 'move_subtree' then array['nodeId','newParentId','targetIndex']
                         when 'reorder_siblings' then array['nodeId','targetIndex']
                         when 'rename_map' then array['title']
                         when 'set_project' then array['projectId']
                         when 'transfer_owner' then array['ownerId']
                         when 'delete_map' then array[]::text[] end;
  if allowed is null or exists (select 1 from jsonb_object_keys(p_payload) k where k <> all (allowed))
     or (select count(*) from jsonb_object_keys(p_payload)) <> cardinality(allowed) then
    raise exception using message = 'VALIDATION';
  end if;
  hash := md5(jsonb_build_object('kind', p_kind, 'map_id', p_map_id, 'expected_revision', p_expected_revision, 'payload', p_payload)::text);

  -- Same order as create_map: operation id first, then the map row.
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  -- Someone else's map and a missing one are indistinguishable.
  select m.* into target from public.maps m
  where m.id = p_map_id and private.is_active_member(m.workspace_id)
  for update of m;
  if not found then raise exception using message = 'NOT_FOUND'; end if;

  if target.deleted_at is not null then
    -- Only a matching, previously committed deletion can be replayed. No old
    -- node/history response is returned after deletion, even to an active member.
    if p_kind='delete_map' then
      select * into previous from public.map_operations where id=p_operation_id;
      if found and previous.kind='delete_map' and previous.actor_id=actor
        and previous.map_id=p_map_id and previous.request_hash=hash then return previous.after_data; end if;
    end if;
    raise exception using message='NOT_FOUND',detail='MAP_DELETED';
  end if;

  select * into previous from public.map_operations where id = p_operation_id;
  if found then
    if previous.actor_id <> actor or previous.map_id <> p_map_id or previous.request_hash <> hash then
      raise exception using message = 'CONFLICT';
    end if;
    -- A retry after a timeout returns the first result, possibly with an old revision.
    return previous.after_data;
  end if;

  if target.revision <> p_expected_revision then raise exception using message = 'CONFLICT'; end if;

  v_node_id := private.try_uuid(p_payload -> 'nodeId');
  if p_kind not in ('rename_map','set_project','transfer_owner','delete_map') and v_node_id is null then raise exception using message = 'VALIDATION'; end if;
  if p_kind in ('add_child','edit_text') then
    v_text := private.valid_node_text(p_payload -> 'text');
    if v_text is null then raise exception using message = 'VALIDATION'; end if;
  end if;

  if p_kind='delete_map' then
    select role into actor_role from public.workspace_members
      where workspace_id=target.workspace_id and user_id=actor and status='active' for share;
    if not found or (target.owner_id<>actor and actor_role<>'admin') then raise exception using message='FORBIDDEN'; end if;
    before_snapshot:=jsonb_build_object('deletedAt',null);
    update public.maps set deleted_at=now() where id=p_map_id;
  elsif p_kind='transfer_owner' then
    -- The map lock serializes transfers and content revisions. Membership locks
    -- keep the authorized actor and destination active through this commit.
    select role into actor_role from public.workspace_members
      where workspace_id=target.workspace_id and user_id=actor and status='active' for share;
    if not found or (target.owner_id<>actor and actor_role<>'admin') then
      raise exception using message='FORBIDDEN';
    end if;
    v_owner_id:=private.try_uuid(p_payload->'ownerId');
    if v_owner_id is null or v_owner_id=target.owner_id then raise exception using message='VALIDATION'; end if;
    perform 1 from public.workspace_members where workspace_id=target.workspace_id
      and user_id=v_owner_id and status='active' for share;
    if not found then raise exception using message='VALIDATION'; end if;
    before_snapshot:=jsonb_build_object('ownerId',target.owner_id);
    update public.maps set owner_id=v_owner_id where id=p_map_id;
  elsif p_kind='rename_map' then
    v_text:=private.valid_entity_name(p_payload->'title');
    if v_text is null then raise exception using message='VALIDATION'; end if;
    before_snapshot:=jsonb_build_object('title',target.title,'projectId',target.project_id,'ownerId',target.owner_id,
      'ownerName',(select display_name from public.profiles where id=target.owner_id));
    update public.maps set title=v_text where id=p_map_id;
  elsif p_kind='set_project' then
    v_project_id:=private.try_uuid(p_payload->'projectId');
    if jsonb_typeof(p_payload->'projectId') is distinct from 'null' and (v_project_id is null or not exists(
      select 1 from public.projects where id=v_project_id and workspace_id=target.workspace_id)) then raise exception using message='VALIDATION'; end if;
    before_snapshot:=jsonb_build_object('title',target.title,'projectId',target.project_id,'ownerId',target.owner_id,
      'ownerName',(select display_name from public.profiles where id=target.owner_id));
    update public.maps set project_id=v_project_id where id=p_map_id;
  elsif p_kind = 'add_child' then
    v_parent_id := private.try_uuid(p_payload -> 'parentId');
    if v_parent_id is null or not exists (select 1 from public.nodes where map_id = p_map_id and id = v_parent_id) then
      raise exception using message = 'VALIDATION';
    end if;
    -- Client-generated ids are unique across all maps; a reused id is never an upsert.
    if exists (select 1 from public.nodes where id = v_node_id) then raise exception using message = 'VALIDATION'; end if;
    if (select count(*) from public.nodes where map_id = p_map_id) >= max_nodes then
      raise exception using message = 'LIMIT_EXCEEDED';
    end if;
    with recursive path(id, parent_id, depth) as (
      select id, parent_id, 1 from public.nodes where map_id = p_map_id and id = v_parent_id
      union all
      select n.id, n.parent_id, path.depth + 1 from public.nodes n join path on n.id = path.parent_id
      where n.map_id = p_map_id and path.depth <= max_depth + 1
    ) select max(path.depth) into depth from path;
    -- depth counts the parent chain including the root, i.e. the new node's depth.
    if depth > max_depth then raise exception using message = 'LIMIT_EXCEEDED'; end if;

    insert into public.nodes (id, map_id, parent_id, text, sort_order, created_by, updated_by, source)
    values (v_node_id, p_map_id, v_parent_id, v_text,
      coalesce((select max(sort_order) + 1 from public.nodes where map_id = p_map_id and parent_id = v_parent_id), 0),
      actor, actor, 'manual')
    returning * into changed;
  elsif p_kind in ('move_subtree','reorder_siblings') then
    select * into before_node from public.nodes where map_id=p_map_id and id=v_node_id for update;
    if not found or before_node.parent_id is null then raise exception using message='VALIDATION'; end if;
    old_parent := before_node.parent_id;
    v_parent_id := case when p_kind='move_subtree' then private.try_uuid(p_payload->'newParentId') else old_parent end;
    if v_parent_id is null or not exists(select 1 from public.nodes where map_id=p_map_id and id=v_parent_id) then
      raise exception using message='VALIDATION';
    end if;
    if jsonb_typeof(p_payload->'targetIndex') is distinct from 'number'
      or (p_payload->>'targetIndex') !~ '^[0-9]{1,3}$' then raise exception using message='VALIDATION'; end if;
    target_index := (p_payload->>'targetIndex')::integer;
    -- Reject own subtree as destination before changing any row.
    if exists(with recursive branch as (
      select id from public.nodes where map_id=p_map_id and id=v_node_id
      union all select n.id from public.nodes n join branch b on n.parent_id=b.id where n.map_id=p_map_id
    ) select 1 from branch where id=v_parent_id) then raise exception using message='VALIDATION'; end if;

    -- targetIndex is zero-based in the FINAL destination list, excluding the moving node.
    select coalesce(array_agg(id order by sort_order,id),'{}') into sibling_ids
      from public.nodes where map_id=p_map_id and parent_id=v_parent_id and id<>v_node_id;
    if target_index>cardinality(sibling_ids) then raise exception using message='VALIDATION'; end if;
    select jsonb_agg(private.node_json(n) order by n.id) into before_snapshot
      from public.nodes n where n.map_id=p_map_id and n.parent_id in (old_parent,v_parent_id);
    sibling_ids := sibling_ids[1:target_index] || array[v_node_id] || sibling_ids[target_index+1:cardinality(sibling_ids)];
    position := 0;
    foreach sibling_id in array sibling_ids loop
      update public.nodes set parent_id=v_parent_id,sort_order=position,updated_by=actor,updated_at=now()
        where map_id=p_map_id and id=sibling_id and (parent_id is distinct from v_parent_id or sort_order<>position);
      position := position+1;
    end loop;
    if old_parent<>v_parent_id then
      position := 0;
      for sibling_id in select id from public.nodes where map_id=p_map_id and parent_id=old_parent order by sort_order,id loop
        update public.nodes set sort_order=position,updated_by=actor,updated_at=now()
          where map_id=p_map_id and id=sibling_id and sort_order<>position;
        position := position+1;
      end loop;
    end if;
    -- Validate depth/connectivity with the entire branch in its new position. Errors roll back both groups.
    select count(*) into total from public.nodes where map_id=p_map_id;
    with recursive walk as (
      select id,0 depth from public.nodes where map_id=p_map_id and parent_id is null
      union all select n.id,w.depth+1 from public.nodes n join walk w on n.parent_id=w.id where n.map_id=p_map_id and w.depth<=30
    ) select count(*),max(walk.depth) into reached,deepest from walk;
    if deepest>30 then raise exception using message='LIMIT_EXCEEDED'; end if;
    if reached<>total then raise exception using message='VALIDATION'; end if;
    select jsonb_agg(private.node_json(n) order by n.id) into affected
      from public.nodes n where n.map_id=p_map_id and n.parent_id in (old_parent,v_parent_id);
  elsif p_kind = 'delete_subtree' then
    -- The root is permanent. Missing and cross-map node ids are rejected identically.
    select * into before_node from public.nodes where map_id = p_map_id and id = v_node_id for update;
    if not found or before_node.parent_id is null then raise exception using message = 'VALIDATION'; end if;

    with recursive subtree(id, parent_id, depth) as (
      select n.id, n.parent_id, 0 from public.nodes n where n.map_id = p_map_id and n.id = v_node_id
      union all
      select n.id, n.parent_id, s.depth + 1 from public.nodes n join subtree s on n.parent_id = s.id
      where n.map_id = p_map_id
    )
    select coalesce(jsonb_agg(private.node_json(n) order by s.depth, s.id), '[]'::jsonb)
      into before_snapshot
    from subtree s join public.nodes n on n.id = s.id and n.map_id = p_map_id;

    with recursive subtree(id, parent_id, depth) as (
      select n.id, n.parent_id, 0 from public.nodes n where n.map_id = p_map_id and n.id = v_node_id
      union all
      select n.id, n.parent_id, s.depth + 1 from public.nodes n join subtree s on n.parent_id = s.id
      where n.map_id = p_map_id
    ), removed as (
      delete from public.nodes n using subtree s where n.map_id = p_map_id and n.id = s.id returning n.id
    )
    select coalesce(jsonb_agg(r.id order by r.id), '[]'::jsonb) into deleted_ids from removed r;
  else
    select * into before_node from public.nodes where map_id = p_map_id and id = v_node_id for update;
    if not found then raise exception using message = 'VALIDATION'; end if;
    -- created_by and source never change on edit.
    update public.nodes set text = v_text, updated_by = actor, updated_at = now()
    where id = v_node_id returning * into changed;
  end if;

  update public.maps set revision = revision + 1, updated_by = actor, updated_at = now()
  where id = p_map_id returning * into target;

  result := jsonb_build_object('operationId', p_operation_id, 'revision', target.revision,
    'changedNodes', case when p_kind in ('delete_subtree','rename_map','set_project','transfer_owner','delete_map') then '[]'::jsonb when p_kind in ('move_subtree','reorder_siblings') then affected else jsonb_build_array(private.node_json(changed)) end,
    'deletedNodeIds', coalesce(deleted_ids, '[]'::jsonb),
    'mapPatch', case when p_kind='delete_map' then jsonb_build_object('revision',target.revision,'updatedBy',actor,'updatedAt',target.updated_at,'deletedAt',target.deleted_at)
      else jsonb_build_object('revision', target.revision, 'updatedBy', actor, 'updatedAt', target.updated_at,'title',target.title,'projectId',target.project_id,'ownerId',target.owner_id,
      'ownerName',(select display_name from public.profiles where id=target.owner_id)) end);
  insert into public.map_operations (id, map_id, workspace_id, actor_id, editor_session_id, kind, base_revision, result_revision, request_hash, before_data, after_data)
  values (p_operation_id, p_map_id, target.workspace_id, actor, p_editor_session_id, p_kind, p_expected_revision, target.revision, hash,
    case when p_kind in ('rename_map','set_project','transfer_owner','delete_map') then jsonb_build_object('map',before_snapshot)
         when p_kind in ('delete_subtree','move_subtree','reorder_siblings') then jsonb_build_object('nodes', before_snapshot)
         when before_node.id is null then null else jsonb_build_object('nodes', jsonb_build_array(private.node_json(before_node))) end,
    result);
  return result;
end;
$_$;


ALTER FUNCTION "private"."apply_map_command"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_kind" "text", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."apply_map_history"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_mode" "text", "p_target_operation_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor uuid := auth.uid();
  target_map public.maps;
  original public.map_operations;
  previous public.map_operations;
  event_row public.map_operations;
  undo_ids uuid[] := '{}';
  redo_ids uuid[] := '{}';
  barrier bigint;
  hash text;
  item jsonb;
  affected jsonb := '[]';
  removed uuid[] := '{}';
  total integer;
  reached integer;
  deepest integer;
  result jsonb;
begin
  if actor is null then raise exception using message = 'UNAUTHENTICATED'; end if;
  if p_map_id is null or p_operation_id is null or p_editor_session_id is null or p_target_operation_id is null
    or p_expected_revision is null or p_expected_revision < 1 or p_mode is null or p_mode not in ('undo','redo') then
    raise exception using message = 'VALIDATION';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  perform private.assert_map_not_deleted(p_map_id);
  select m.* into target_map from public.maps m where m.id = p_map_id and m.deleted_at is null
    and private.is_active_member(m.workspace_id) for update of m;
  if not found then raise exception using message = 'NOT_FOUND'; end if;

  -- Authorization precedes replay too: revoked users cannot read old results.
  hash := md5(jsonb_build_object('kind',p_mode,'mapId',p_map_id,'targetOperationId',p_target_operation_id)::text);
  select * into previous from public.map_operations where id = p_operation_id;
  if found then
    if previous.actor_id <> actor or previous.editor_session_id <> p_editor_session_id
      or previous.request_hash <> hash then raise exception using message = 'CONFLICT'; end if;
    return previous.after_data;
  end if;
  if target_map.revision <> p_expected_revision then raise exception using message = 'CONFLICT'; end if;
  select * into original from public.map_operations where id = p_target_operation_id and map_id = p_map_id;
  if not found or original.actor_id <> actor or original.editor_session_id <> p_editor_session_id
    or original.kind not in ('add_child','edit_text','delete_subtree','move_subtree','reorder_siblings','rename_map','set_project','ai_children') then
    raise exception using message = 'CONFLICT';
  end if;

  select coalesce(max(o.result_revision), 0) into barrier from public.map_operations o
  where o.map_id = p_map_id and (o.actor_id <> actor or o.editor_session_id <> p_editor_session_id
    or o.kind not in ('add_child','edit_text','delete_subtree','move_subtree','reorder_siblings','rename_map','set_project','ai_children','undo','redo'));
  for event_row in select o.* from public.map_operations o
    where o.map_id = p_map_id and o.result_revision > barrier order by o.result_revision
  loop
    if event_row.kind = 'undo' then
      if undo_ids[cardinality(undo_ids)] is distinct from event_row.undone_operation_id then raise exception using message = 'CONFLICT'; end if;
      undo_ids := undo_ids[1:cardinality(undo_ids)-1];
      redo_ids := array_append(redo_ids,event_row.undone_operation_id);
    elsif event_row.kind = 'redo' then
      if redo_ids[cardinality(redo_ids)] is distinct from event_row.undone_operation_id then raise exception using message = 'CONFLICT'; end if;
      redo_ids := redo_ids[1:cardinality(redo_ids)-1];
      undo_ids := array_append(undo_ids,event_row.undone_operation_id);
    else
      undo_ids := array_append(undo_ids,event_row.id);
      redo_ids := '{}';
    end if;
  end loop;
  if (p_mode = 'undo' and undo_ids[cardinality(undo_ids)] is distinct from original.id)
    or (p_mode = 'redo' and redo_ids[cardinality(redo_ids)] is distinct from original.id) then
    raise exception using message = 'CONFLICT';
  end if;

  if original.kind='ai_children' then
    if p_mode='undo' then
      select array_agg((value->>'id')::uuid) into removed from jsonb_array_elements(original.after_data->'changedNodes');
      delete from public.nodes where map_id=p_map_id and id=any(removed);
    else
      for item in select value from jsonb_array_elements(original.after_data->'changedNodes') loop
        insert into public.nodes(id,map_id,parent_id,text,sort_order,created_by,updated_by,source,ai_generation_id)
          values((item->>'id')::uuid,p_map_id,(item->>'parentId')::uuid,item->>'text',(item->>'sortOrder')::integer,
            (item->>'createdBy')::uuid,(item->>'updatedBy')::uuid,'ai',(item->>'aiGenerationId')::uuid);
        select affected||jsonb_build_array(private.node_json(n)) into affected from public.nodes n where n.id=(item->>'id')::uuid and n.map_id=p_map_id;
      end loop;
    end if;
  elsif original.kind in ('rename_map','set_project') then
    item:=case when p_mode='undo' then original.before_data->'map' else original.after_data->'mapPatch' end;
    if item is null then raise exception using message='CONFLICT'; end if;
    if original.kind='rename_map' then
      update public.maps set title=item->>'title' where id=p_map_id;
    else
      update public.maps set project_id=(item->>'projectId')::uuid where id=p_map_id;
    end if;
  elsif (p_mode = 'undo' and original.kind = 'add_child') or (p_mode = 'redo' and original.kind = 'delete_subtree') then
    if original.kind = 'add_child' then
      removed := array[(original.after_data #>> '{changedNodes,0,id}')::uuid];
    else
      select array_agg((value->>'id')::uuid) into removed from jsonb_array_elements(original.before_data->'nodes');
    end if;
    delete from public.nodes where map_id = p_map_id and id = any(removed);
  elsif original.kind in ('move_subtree','reorder_siblings') then
    -- Only trusted structural fields are restored; descendants and immutable creators stay untouched.
    for item in select value from jsonb_array_elements(case when p_mode='undo' then original.before_data->'nodes' else original.after_data->'changedNodes' end)
    loop
      update public.nodes set parent_id=(item->>'parentId')::uuid,sort_order=(item->>'sortOrder')::integer,
        updated_by=(item->>'updatedBy')::uuid,updated_at=now() where map_id=p_map_id and id=(item->>'id')::uuid;
      if not found then raise exception using message='CONFLICT'; end if;
      select affected || jsonb_build_array(private.node_json(n)) into affected from public.nodes n where n.map_id=p_map_id and n.id=(item->>'id')::uuid;
    end loop;
  elsif original.kind = 'edit_text' or (p_mode = 'redo' and original.kind = 'add_child') then
    item := case when p_mode = 'undo' then original.before_data->'nodes'->0 else original.after_data->'changedNodes'->0 end;
    if item is null then raise exception using message = 'CONFLICT'; end if;
    if original.kind = 'add_child' then
      insert into public.nodes(id,map_id,parent_id,text,sort_order,created_by,updated_by,source,ai_generation_id)
      values((item->>'id')::uuid,p_map_id,(item->>'parentId')::uuid,item->>'text',(item->>'sortOrder')::integer,
        (item->>'createdBy')::uuid,(item->>'updatedBy')::uuid,item->>'source',(item->>'aiGenerationId')::uuid);
    else
      update public.nodes set text=item->>'text',updated_by=(item->>'updatedBy')::uuid,updated_at=now()
      where id=(item->>'id')::uuid and map_id=p_map_id;
      if not found then raise exception using message = 'CONFLICT'; end if;
    end if;
    select jsonb_build_array(private.node_json(n)) into affected from public.nodes n where n.map_id=p_map_id and n.id=(item->>'id')::uuid;
  else
    -- The saved branch root has a parent outside the snapshot. Insert parents first.
    for item in
      with recursive saved as (
        select r.value, (r.value->>'id')::uuid id, 0 depth
        from jsonb_array_elements(original.before_data->'nodes') r(value)
        where not exists (select 1 from jsonb_array_elements(original.before_data->'nodes') s(value) where s.value->>'id'=r.value->>'parentId')
        union all
        select c.value,(c.value->>'id')::uuid,parent.depth+1
        from saved parent join lateral jsonb_array_elements(original.before_data->'nodes') c(value) on (c.value->>'parentId')::uuid=parent.id
      ) select value from saved order by depth
    loop
      insert into public.nodes(id,map_id,parent_id,text,sort_order,created_by,updated_by,source,ai_generation_id)
      values((item->>'id')::uuid,p_map_id,(item->>'parentId')::uuid,item->>'text',(item->>'sortOrder')::integer,
        (item->>'createdBy')::uuid,(item->>'updatedBy')::uuid,item->>'source',(item->>'aiGenerationId')::uuid);
      select affected || jsonb_build_array(private.node_json(n)) into affected from public.nodes n where n.map_id=p_map_id and n.id=(item->>'id')::uuid;
    end loop;
    if jsonb_array_length(affected) <> jsonb_array_length(original.before_data->'nodes') then raise exception using message = 'CONFLICT'; end if;
  end if;

  select count(*) into total from public.nodes where map_id=p_map_id;
  if total > 500 then raise exception using message = 'LIMIT_EXCEEDED'; end if;
  if (select count(*) from public.nodes where map_id=p_map_id and parent_id is null) <> 1 then raise exception using message = 'VALIDATION'; end if;
  with recursive walk as (
    select id,0 depth from public.nodes where map_id=p_map_id and parent_id is null
    union all
    select n.id,w.depth+1 from public.nodes n join walk w on n.parent_id=w.id where n.map_id=p_map_id and w.depth<=30
  ) select count(*),max(depth) into reached,deepest from walk;
  if deepest > 30 then raise exception using message = 'LIMIT_EXCEEDED'; end if;
  if reached <> total then raise exception using message = 'VALIDATION'; end if;

  update public.maps set revision=revision+1,updated_by=actor,updated_at=now() where id=p_map_id returning * into target_map;
  result := jsonb_build_object('operationId',p_operation_id,'revision',target_map.revision,'changedNodes',affected,'deletedNodeIds',to_jsonb(removed),
    'mapPatch',jsonb_build_object('revision',target_map.revision,'updatedBy',actor,'updatedAt',target_map.updated_at,'title',target_map.title,'projectId',target_map.project_id,'ownerId',target_map.owner_id,
      'ownerName',(select display_name from public.profiles where id=target_map.owner_id)));
  insert into public.map_operations(id,map_id,workspace_id,actor_id,editor_session_id,kind,base_revision,result_revision,request_hash,after_data,undone_operation_id)
  values(p_operation_id,p_map_id,target_map.workspace_id,actor,p_editor_session_id,p_mode,p_expected_revision,target_map.revision,hash,result,p_target_operation_id);
  return result;
end;
$$;


ALTER FUNCTION "private"."apply_map_history"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_mode" "text", "p_target_operation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."assert_map_has_root"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare target uuid;
begin
  if tg_table_name = 'maps' then target := new.id; else target := old.map_id; end if;
  if exists (select 1 from public.maps where id = target)
     and not exists (select 1 from public.nodes where map_id = target and parent_id is null) then
    raise exception using message = 'VALIDATION', detail = 'Map without root node.';
  end if;
  return null;
end;
$$;


ALTER FUNCTION "private"."assert_map_has_root"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."assert_map_not_deleted"("p_map_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if auth.uid() is null then raise exception using message='UNAUTHENTICATED'; end if;
  if exists(select 1 from public.maps m where m.id=p_map_id and m.deleted_at is not null and private.is_active_member(m.workspace_id)) then
    -- This reason contains no map content and is visible only to active colleagues.
    raise exception using message='NOT_FOUND',detail='MAP_DELETED';
  end if;
end;
$$;


ALTER FUNCTION "private"."assert_map_not_deleted"("p_map_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_read_map"("target_map_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select auth.uid() is not null and exists (
    select 1 from public.maps m
    join public.workspace_members wm on wm.workspace_id = m.workspace_id
    where m.id = target_map_id and m.deleted_at is null and wm.user_id = auth.uid() and wm.status = 'active'
  );
$$;


ALTER FUNCTION "private"."can_read_map"("target_map_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."cancel_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare actor uuid:=auth.uid(); j public.ai_generations; m public.maps; expired boolean;
begin
  if actor is null then raise exception using message='UNAUTHENTICATED'; end if;
  if p_map_id is null or p_generation_id is null then raise exception using message='VALIDATION'; end if;
  perform private.assert_map_not_deleted(p_map_id);
  if not private.can_read_map(p_map_id) then raise exception using message='NOT_FOUND'; end if;
  select * into j from public.ai_generations where id=p_generation_id and map_id=p_map_id and requested_by=actor for update;
  if not found then raise exception using message='NOT_FOUND'; end if;
  select * into m from public.maps where id=p_map_id and deleted_at is null for share;
  if not found then perform private.assert_map_not_deleted(p_map_id); raise exception using message='NOT_FOUND'; end if;
  perform 1 from public.workspace_members where workspace_id=m.workspace_id and user_id=actor and status='active' for share;
  if not found then raise exception using message='NOT_FOUND'; end if;
  if j.state in ('pending','running') then
    expired:=j.expires_at<=clock_timestamp();
    update public.ai_generations set
      state=case when expired then 'failed' else 'cancelled' end,
      error_code=case when expired then 'EXPIRED' else null end,
      finished_at=clock_timestamp()
    where id=j.id returning * into j;
  end if;
  return private.ai_job_json(j);
end; $$;


ALTER FUNCTION "private"."cancel_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."create_map"("p_workspace_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor uuid := auth.uid();
  v_title text := coalesce(p_title, 'Novo mapa');
  hash text;
  previous public.map_operations;
  new_map_id uuid;
  root public.nodes;
begin
  if actor is null then raise exception using message = 'UNAUTHENTICATED'; end if;
  if p_workspace_id is null or p_operation_id is null or p_editor_session_id is null then
    raise exception using message = 'VALIDATION';
  end if;
  if not private.is_active_member(p_workspace_id) then raise exception using message = 'FORBIDDEN'; end if;
  if char_length(v_title) not between 1 and 120 or btrim(v_title) = '' then raise exception using message = 'VALIDATION'; end if;
  hash := md5(jsonb_build_object('kind', 'create_map', 'workspace_id', p_workspace_id, 'title', v_title)::text);

  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into previous from public.map_operations where id = p_operation_id;
  if found then
    if previous.actor_id <> actor or previous.request_hash <> hash then raise exception using message = 'CONFLICT'; end if;
    return jsonb_build_object('operationId', previous.id, 'mapId', previous.map_id, 'revision', previous.result_revision);
  end if;

  insert into public.maps (workspace_id, title, owner_id, created_by, updated_by)
  values (p_workspace_id, v_title, actor, actor, actor) returning id into new_map_id;
  insert into public.nodes (map_id, parent_id, text, sort_order, created_by, updated_by)
  values (new_map_id, null, 'Ideia central', 0, actor, actor) returning * into root;
  insert into public.map_operations (id, map_id, workspace_id, actor_id, editor_session_id, kind, base_revision, result_revision, request_hash, after_data)
  values (p_operation_id, new_map_id, p_workspace_id, actor, p_editor_session_id, 'create_map', null, 1, hash,
    jsonb_build_object('mapId', new_map_id, 'title', v_title, 'ownerId', actor, 'rootNodeId', root.id));
  return jsonb_build_object('operationId', p_operation_id, 'mapId', new_map_id, 'revision', 1);
end;
$$;


ALTER FUNCTION "private"."create_map"("p_workspace_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."create_map_copy"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text", "p_nodes" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  actor uuid := auth.uid();
  source_map public.maps;
  previous public.map_operations;
  hash text;
  item jsonb;
  total integer;
  reached integer;
  deepest integer;
  ids jsonb;
  new_map uuid;
  result jsonb;
begin
  if actor is null then raise exception using message = 'UNAUTHENTICATED'; end if;
  if p_source_map_id is null or p_operation_id is null or p_editor_session_id is null
    or p_title is null or char_length(p_title) not between 1 and 120 or btrim(p_title) = ''
    or jsonb_typeof(p_nodes) is distinct from 'array' then raise exception using message = 'VALIDATION'; end if;
  total := jsonb_array_length(p_nodes);
  if total < 1 then raise exception using message = 'VALIDATION'; end if;
  if total > 500 then raise exception using message = 'LIMIT_EXCEEDED'; end if;
  -- This endpoint intentionally accepts text/structure only. Authorship is never imported.
  for item in select value from jsonb_array_elements(p_nodes) loop
    if jsonb_typeof(item) is distinct from 'object' then raise exception using message = 'VALIDATION'; end if;
    if (select count(*) from jsonb_object_keys(item)) <> 4
      or exists (select 1 from jsonb_object_keys(item) k where k <> all(array['id','parentId','text','sortOrder']))
      or private.try_uuid(item->'id') is null or private.valid_node_text(item->'text') is null
      or (item->'parentId' is distinct from 'null'::jsonb and private.try_uuid(item->'parentId') is null)
      or jsonb_typeof(item->'sortOrder') is distinct from 'number'
      or (item->>'sortOrder') !~ '^[0-9]{1,9}$' then raise exception using message = 'VALIDATION'; end if;
  end loop;
  if (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(p_nodes)) <> total
    or (select count(*) from jsonb_array_elements(p_nodes) where value->'parentId' = 'null'::jsonb) <> 1 then
    raise exception using message = 'VALIDATION';
  end if;
  with recursive input as (
    select (value->>'id')::uuid id, (value->>'parentId')::uuid parent_id from jsonb_array_elements(p_nodes)
  ), walk as (
    select id, 0 depth, array[id] path from input where parent_id is null
    union all
    select n.id, w.depth + 1, w.path || n.id from input n join walk w on n.parent_id = w.id
    where not n.id = any(w.path) and w.depth <= 30
  ) select count(*), max(depth) into reached, deepest from walk;
  if deepest > 30 then raise exception using message = 'LIMIT_EXCEEDED'; end if;
  if reached <> total then raise exception using message = 'VALIDATION'; end if;

  hash := md5(jsonb_build_object('kind','create_map_copy','sourceMapId',p_source_map_id,'title',p_title,'nodes',p_nodes)::text);
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  perform private.assert_map_not_deleted(p_source_map_id);
  select m.* into source_map from public.maps m where m.id = p_source_map_id and m.deleted_at is null
    and private.is_active_member(m.workspace_id) for update of m;
  if not found then perform private.assert_map_not_deleted(p_source_map_id); raise exception using message = 'NOT_FOUND'; end if;
  select * into previous from public.map_operations where id = p_operation_id;
  if found then
    if previous.actor_id <> actor or previous.request_hash <> hash then raise exception using message = 'CONFLICT'; end if;
    return previous.after_data;
  end if;

  return private.insert_map_copy(source_map,p_operation_id,p_editor_session_id,p_title,p_nodes,hash,'create_map_copy');
end;
$_$;


ALTER FUNCTION "private"."create_map_copy"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text", "p_nodes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."create_project"("p_project_id" "uuid", "p_workspace_id" "uuid", "p_name" "text", "p_client_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare actor uuid:=auth.uid(); item public.projects; hash text;
begin
  if actor is null then raise exception using message='UNAUTHENTICATED'; end if;
  if p_project_id is null or p_workspace_id is null or private.valid_entity_name(to_jsonb(p_name)) is null
    or (p_client_name is not null and private.valid_entity_name(to_jsonb(p_client_name)) is null) then raise exception using message='VALIDATION'; end if;
  if not private.is_active_member(p_workspace_id) then raise exception using message='FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text,0));
  hash:=md5(jsonb_build_object('name',p_name,'client',p_client_name)::text);
  select * into item from public.projects where id=p_project_id;
  if found then
    if item.workspace_id<>p_workspace_id or item.created_by<>actor or item.creation_hash<>hash then raise exception using message='CONFLICT'; end if;
  else
    insert into public.projects(id,workspace_id,name,client_name,created_by,creation_hash)
      values(p_project_id,p_workspace_id,p_name,p_client_name,actor,hash) returning * into item;
  end if;
  return jsonb_build_object('id',item.id,'name',item.name,'clientName',item.client_name);
end;
$$;


ALTER FUNCTION "private"."create_project"("p_project_id" "uuid", "p_workspace_id" "uuid", "p_name" "text", "p_client_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."duplicate_map"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor uuid := auth.uid();
  source_map public.maps;
  previous public.map_operations;
  hash text;
  snapshot jsonb;
begin
  if actor is null then raise exception using message='UNAUTHENTICATED'; end if;
  if p_source_map_id is null or p_operation_id is null or p_editor_session_id is null then
    raise exception using message='VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  perform private.assert_map_not_deleted(p_source_map_id);
  -- All node commands take this same lock. Metadata and nodes form one coherent version.
  select m.* into source_map from public.maps m where m.id=p_source_map_id and m.deleted_at is null
    and private.is_active_member(m.workspace_id) for update of m;
  if not found then perform private.assert_map_not_deleted(p_source_map_id); raise exception using message='NOT_FOUND'; end if;
  hash:=md5(jsonb_build_object('kind','duplicate_map','sourceMapId',p_source_map_id)::text);
  select * into previous from public.map_operations where id=p_operation_id;
  if found then
    if previous.actor_id<>actor or previous.editor_session_id<>p_editor_session_id or previous.request_hash<>hash then
      raise exception using message='CONFLICT'; end if;
    return previous.after_data;
  end if;
  select jsonb_agg(jsonb_build_object('id',n.id,'parentId',n.parent_id,'text',n.text,'sortOrder',n.sort_order) order by n.id)
    into snapshot from public.nodes n where n.map_id=p_source_map_id;
  return private.insert_map_copy(source_map,p_operation_id,p_editor_session_id,left(source_map.title,112)||' — cópia',snapshot,hash,'duplicate_map');
end;
$$;


ALTER FUNCTION "private"."duplicate_map"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finish_ai_generation"("p_generation_id" "uuid", "p_children" "jsonb", "p_usage" "jsonb", "p_error" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare before_job public.ai_generations; after_job public.ai_generations; result jsonb; valid_usage jsonb; charged bigint;
begin
  select * into before_job from public.ai_generations where id=p_generation_id for update;
  if not found then raise exception using message='NOT_FOUND'; end if;
  valid_usage:=private.ai_valid_usage(p_usage);
  result:=private.finish_ai_generation_document(p_generation_id,p_children,valid_usage,p_error);
  select * into after_job from public.ai_generations where id=p_generation_id;
  valid_usage:=private.ai_valid_usage(after_job.usage);
  charged:=case when valid_usage is null then after_job.reserved_tokens else (valid_usage->>'total_tokens')::bigint end;
  if charged<>before_job.accounted_tokens then
    update private.ai_usage_days set accounted_tokens=accounted_tokens-before_job.accounted_tokens+charged
      where workspace_id=before_job.workspace_id and usage_day=before_job.usage_day;
    if not found then raise exception using message='AI_ACCOUNTING_UNAVAILABLE'; end if;
    update public.ai_generations set accounted_tokens=charged where id=p_generation_id;
    insert into private.ai_usage_events(generation_id,event,state,accounted_tokens,duration_ms)
      values(p_generation_id,'usage_reconciled',after_job.state,charged,greatest(0,(extract(epoch from clock_timestamp()-after_job.created_at)*1000)::bigint));
  end if;
  return result;
end; $$;


ALTER FUNCTION "private"."finish_ai_generation"("p_generation_id" "uuid", "p_children" "jsonb", "p_usage" "jsonb", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finish_ai_generation_document"("p_generation_id" "uuid", "p_children" "jsonb", "p_usage" "jsonb", "p_error" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare j public.ai_generations; m public.maps; item jsonb; n public.nodes; context jsonb; affected jsonb:='[]';
  texts text[]; sibling_texts text[]; pos integer; base bigint; depth integer;
begin
  select * into j from public.ai_generations where id=p_generation_id for update;
  if not found then raise exception using message='NOT_FOUND'; end if;
  if j.state not in ('pending','running') then
    -- A late worker may reconcile billed usage, but cannot revive a terminal job.
    if j.usage is null and p_usage is not null then
      update public.ai_generations set usage=p_usage where id=j.id returning * into j;
    end if;
    return private.ai_job_json(j);
  end if;
  select * into m from public.maps where id=j.map_id for update;
  if p_error is not null or j.expires_at<=clock_timestamp() then
    update public.ai_generations set state='failed',finished_at=now(),error_code=case when expires_at<=clock_timestamp() then 'EXPIRED' else p_error end,usage=p_usage where id=j.id returning * into j;
    return private.ai_job_json(j);
  end if;
  perform 1 from public.workspace_members where workspace_id=j.workspace_id and user_id=j.requested_by and status='active' for share;
  if not found or m.deleted_at is not null or not exists(select 1 from public.nodes where map_id=j.map_id and id=j.parent_node_id) then
    update public.ai_generations set state='stale',error_code='CONTEXT_CHANGED',finished_at=now(),usage=p_usage where id=j.id returning * into j;
    return private.ai_job_json(j);
  end if;
  context:=private.ai_context(j.map_id,j.parent_node_id);
  with recursive path as (
    select id,parent_id,1 d from public.nodes where map_id=j.map_id and id=j.parent_node_id
    union all select nn.id,nn.parent_id,p.d+1 from public.nodes nn join path p on nn.id=p.parent_id where nn.map_id=j.map_id and p.d<=31
  ) select max(d) into depth from path;
  if md5(context::text)<>j.context_fingerprint or (select count(*) from public.nodes where map_id=j.map_id)>496 or depth>30 then
    update public.ai_generations set state='stale',error_code='CONTEXT_CHANGED',finished_at=now(),usage=p_usage where id=j.id returning * into j;
    return private.ai_job_json(j);
  end if;
  if jsonb_typeof(p_children) is distinct from 'array' then raise exception using message='VALIDATION'; end if;
  if jsonb_array_length(p_children)<>4 or exists(select 1 from jsonb_array_elements(p_children) v where jsonb_typeof(v) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(v))<>1 or jsonb_typeof(v->'text') is distinct from 'string'
    or char_length(v->>'text') not between 1 and 120 or btrim(regexp_replace(v->>'text','\s+',' ','g'))='') then raise exception using message='VALIDATION'; end if;
  select array_agg(lower(btrim(regexp_replace(value->>'text','\s+',' ','g')))) into texts from jsonb_array_elements(p_children);
  select array_agg(lower(btrim(regexp_replace(text,'\s+',' ','g')))) into sibling_texts from public.nodes where map_id=j.map_id and parent_id=j.parent_node_id;
  if (select count(distinct t) from unnest(texts) t)<>4 or texts && coalesce(sibling_texts,'{}') then raise exception using message='VALIDATION'; end if;
  select coalesce(max(sort_order)+1,0) into pos from public.nodes where map_id=j.map_id and parent_id=j.parent_node_id;
  for item in select value from jsonb_array_elements(p_children) loop
    insert into public.nodes(map_id,parent_id,text,sort_order,created_by,updated_by,source,ai_generation_id)
      values(j.map_id,j.parent_node_id,item->>'text',pos,j.requested_by,j.requested_by,'ai',j.id) returning * into n;
    affected:=affected||jsonb_build_array(private.node_json(n)); pos:=pos+1;
  end loop;
  base:=m.revision;
  update public.maps set revision=revision+1,updated_by=j.requested_by,updated_at=now() where id=m.id returning * into m;
  j.result:=jsonb_build_object('operationId',j.id,'revision',m.revision,'changedNodes',affected,'deletedNodeIds','[]'::jsonb,
    'mapPatch',jsonb_build_object('revision',m.revision,'updatedBy',j.requested_by,'updatedAt',m.updated_at));
  insert into public.map_operations(id,map_id,workspace_id,actor_id,editor_session_id,kind,base_revision,result_revision,request_hash,after_data)
    values(j.id,j.map_id,j.workspace_id,j.requested_by,j.editor_session_id,'ai_children',base,m.revision,j.request_hash,j.result);
  update public.ai_generations set state='applied',finished_at=now(),applied_operation_id=id,result=null,usage=p_usage where id=j.id returning * into j;
  return private.ai_job_json(j);
end; $$;


ALTER FUNCTION "private"."finish_ai_generation_document"("p_generation_id" "uuid", "p_children" "jsonb", "p_usage" "jsonb", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finish_workspace_invitation"("p_id" "uuid", "p_attempt" "uuid", "p_outcome" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$begin
 if p_outcome not in ('sent','failed','existing') then raise exception 'VALIDATION'; end if;
 update public.workspace_invitations i set delivery_state=p_outcome,delivery_error=case when p_outcome='failed' then 'SEND_FAILED' else null end,
 auth_user_id=(select u.id from auth.users u where lower(u.email)=i.email limit 1),updated_at=now()
 where i.id=p_id and i.attempt_id=p_attempt;
 -- Deliberately never changes status: revoke/accept wins over a late email response.
end;$$;


ALTER FUNCTION "private"."finish_workspace_invitation"("p_id" "uuid", "p_attempt" "uuid", "p_outcome" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."get_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid", "p_editor_session_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare j public.ai_generations;
begin
  if auth.uid() is null then raise exception using message='UNAUTHENTICATED'; end if;
  perform private.assert_map_not_deleted(p_map_id);
  if not private.can_read_map(p_map_id) then raise exception using message='NOT_FOUND'; end if;
  update public.ai_generations set state='failed',error_code='EXPIRED',finished_at=clock_timestamp()
    where map_id=p_map_id and requested_by=auth.uid() and state in ('pending','running') and expires_at<=clock_timestamp();
  -- A new tab has a new session id: its user's active job still needs to resume.
  -- Completed history stays scoped to its originating session unless an exact id
  -- is requested. No other member's job or result is exposed.
  select * into j from public.ai_generations where map_id=p_map_id and requested_by=auth.uid()
    and (case when p_generation_id is not null then id=p_generation_id
      else editor_session_id=p_editor_session_id or state in ('pending','running') end)
    order by case when state in ('pending','running') then 0 else 1 end,created_at desc limit 1;
  return case when j.id is null then null else private.ai_job_json(j) end;
end; $$;


ALTER FUNCTION "private"."get_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid", "p_editor_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."handle_new_auth_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  -- display_name is presentation only. No authorization is read from metadata.
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(nullif(left(btrim(new.raw_user_meta_data ->> 'display_name'), 120), ''), 'Pessoa da equipe'));
  return new;
end;
$$;


ALTER FUNCTION "private"."handle_new_auth_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."import_map_backup"("p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_backup" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  actor uuid:=auth.uid();
  scopes uuid[];
  destination public.maps;
  previous public.map_operations;
  hash text;
  exported timestamptz;
  normalized jsonb;
begin
  if actor is null then raise exception using message='UNAUTHENTICATED'; end if;
  if p_operation_id is null or p_editor_session_id is null or jsonb_typeof(p_backup) is distinct from 'object' then
    raise exception using message='VALIDATION'; end if;
  if octet_length(p_backup::text)>2097152 then raise exception using message='LIMIT_EXCEEDED'; end if;
  if (select count(*) from jsonb_object_keys(p_backup))<>6
    or not p_backup ?& array['format','version','exportedAt','hasPendingChanges','map','nodes']
    or p_backup->>'format' is distinct from 'mapa-mental' or p_backup->'version' is distinct from '1'::jsonb
    or jsonb_typeof(p_backup->'exportedAt') is distinct from 'string'
    or jsonb_typeof(p_backup->'hasPendingChanges') is distinct from 'boolean'
    or jsonb_typeof(p_backup->'map') is distinct from 'object' then raise exception using message='VALIDATION'; end if;
  if (select count(*) from jsonb_object_keys(p_backup->'map'))<>1
    or jsonb_typeof(p_backup#>'{map,title}') is distinct from 'string'
    or char_length(p_backup#>>'{map,title}') not between 1 and 120
    or (p_backup#>>'{map,title}') !~ '[^[:space:]]' then raise exception using message='VALIDATION'; end if;
  if (p_backup->>'exportedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then raise exception using message='VALIDATION'; end if;
  begin exported:=(p_backup->>'exportedAt')::timestamptz;
    exception when others then raise exception using message='VALIDATION'; end;
  perform private.validate_copy_nodes(p_backup->'nodes');
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  -- The file and API cannot choose a workspace or owner. UI supports one active membership.
  select array_agg(m.workspace_id) into scopes from public.workspace_members m where m.user_id=actor and m.status='active';
  if coalesce(cardinality(scopes),0)<>1 then raise exception using message='FORBIDDEN'; end if;
  perform 1 from public.workspace_members m where m.user_id=actor and m.workspace_id=scopes[1] and m.status='active' for share;
  if not found then raise exception using message='FORBIDDEN'; end if;
  destination.workspace_id:=scopes[1];
  hash:=md5(jsonb_build_object('kind','import_map','workspaceId',destination.workspace_id,'backup',p_backup)::text);
  select * into previous from public.map_operations where id=p_operation_id;
  if found then
    if previous.actor_id<>actor or previous.editor_session_id<>p_editor_session_id or previous.request_hash<>hash then
      raise exception using message='CONFLICT'; end if;
    return previous.after_data;
  end if;
  -- Preserve sibling order while preventing imported sparse/max-int indices from
  -- overflowing a later add_child (which appends max(sort_order)+1).
  select jsonb_agg(r.value||jsonb_build_object('sortOrder',r.sibling_order) order by r.ordinality) into normalized
  from (select value,ordinality,
    (row_number() over(partition by (value->>'parentId')::uuid order by (value->>'sortOrder')::integer,(value->>'id')::uuid)-1)::integer as sibling_order
    from jsonb_array_elements(p_backup->'nodes') with ordinality) r;
  return private.insert_map_copy(destination,p_operation_id,p_editor_session_id,p_backup#>>'{map,title}',normalized,hash,'import_map');
end;
$_$;


ALTER FUNCTION "private"."import_map_backup"("p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_backup" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "updated_by" "uuid" NOT NULL,
    "revision" bigint DEFAULT 1 NOT NULL,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "project_id" "uuid",
    CONSTRAINT "maps_revision_check" CHECK (("revision" >= 1)),
    CONSTRAINT "maps_title_check" CHECK (((("char_length"("title") >= 1) AND ("char_length"("title") <= 120)) AND ("btrim"("title") <> ''::"text")))
);


ALTER TABLE "public"."maps" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."insert_map_copy"("p_source" "public"."maps", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text", "p_nodes" "jsonb", "p_hash" "text", "p_kind" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor uuid := auth.uid();
  ids jsonb;
  new_map uuid;
  result jsonb;
  total integer;
  reached integer;
  deepest integer;
begin
  -- Internal only: callers authorize/lock, validate the tree and enforce idempotency.
  if actor is null then raise exception using message='UNAUTHENTICATED'; end if;
  perform private.validate_copy_nodes(p_nodes);
  select jsonb_object_agg((value->>'id')::uuid::text,gen_random_uuid()) into ids from jsonb_array_elements(p_nodes);
  insert into public.maps(workspace_id,project_id,title,owner_id,created_by,updated_by)
  values(p_source.workspace_id,case when p_kind='duplicate_map' then p_source.project_id else null end,p_title,actor,actor,actor)
  returning id into new_map;
  insert into public.nodes(id,map_id,parent_id,text,sort_order,created_by,updated_by,source)
  select (ids->>((value->>'id')::uuid::text))::uuid,new_map,(ids->>((value->>'parentId')::uuid::text))::uuid,value->>'text',
    case when p_kind in ('duplicate_map','import_map') then (value->>'sortOrder')::integer else
      (row_number() over(partition by value->>'parentId' order by (value->>'sortOrder')::integer,value->>'id')-1)::integer end,
    actor,actor,'manual' from jsonb_array_elements(p_nodes);
  result:=jsonb_build_object('operationId',p_operation_id,'mapId',new_map,'revision',1);
  -- Informational provenance only; never used to authorize access to the new map.
  insert into public.map_operations(id,map_id,workspace_id,actor_id,editor_session_id,kind,base_revision,result_revision,request_hash,before_data,after_data)
  values(p_operation_id,new_map,p_source.workspace_id,actor,p_editor_session_id,p_kind,null,1,p_hash,
    case when p_kind='import_map' then null else jsonb_build_object('sourceMapId',p_source.id,'sourceRevision',p_source.revision) end,result);
  return result;
end;
$$;


ALTER FUNCTION "private"."insert_map_copy"("p_source" "public"."maps", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text", "p_nodes" "jsonb", "p_hash" "text", "p_kind" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_active_member"("target_workspace_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select auth.uid() is not null and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace_id and m.user_id = auth.uid() and m.status = 'active'
  );
$$;


ALTER FUNCTION "private"."is_active_member"("target_workspace_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_workspace_admin"("p_workspace" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$select auth.uid() is not null and exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid() and role='admin' and status='active')$$;


ALTER FUNCTION "private"."is_workspace_admin"("p_workspace" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nodes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "map_id" "uuid" NOT NULL,
    "parent_id" "uuid",
    "text" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid" NOT NULL,
    "updated_by" "uuid" NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "ai_generation_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "nodes_check" CHECK ((("parent_id" IS NULL) OR ("parent_id" <> "id"))),
    CONSTRAINT "nodes_sort_order_check" CHECK (("sort_order" >= 0)),
    CONSTRAINT "nodes_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'ai'::"text"]))),
    CONSTRAINT "nodes_text_check" CHECK (((("char_length"("text") >= 1) AND ("char_length"("text") <= 500)) AND ("btrim"("text") <> ''::"text")))
);


ALTER TABLE "public"."nodes" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."node_json"("n" "public"."nodes") RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
 select jsonb_build_object('id',n.id,'parentId',n.parent_id,'text',n.text,'sortOrder',n.sort_order,'createdBy',n.created_by,
 'updatedBy',n.updated_by,'source',n.source)||case when n.ai_generation_id is null then '{}'::jsonb else jsonb_build_object('aiGenerationId',n.ai_generation_id) end;
$$;


ALTER FUNCTION "private"."node_json"("n" "public"."nodes") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."pending_workspace_invitations"() RETURNS TABLE("id" "uuid", "workspace_name" "text", "email" "text", "expires_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$ select i.id,w.name,i.email,i.expires_at from public.workspace_invitations i join public.workspaces w on w.id=i.workspace_id
 join auth.users u on u.id=auth.uid() and u.email_confirmed_at is not null and lower(u.email)=i.email
 where i.status='pending' and i.expires_at>now() and (i.auth_user_id is null or i.auth_user_id=u.id)
 and not exists(select 1 from public.workspace_members m where m.user_id=u.id and m.status='active') order by i.created_at; $$;


ALTER FUNCTION "private"."pending_workspace_invitations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."rename_project"("p_project_id" "uuid", "p_name" "text", "p_client_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare actor uuid:=auth.uid(); item public.projects;
begin
  if actor is null then raise exception using message='UNAUTHENTICATED'; end if;
  if private.valid_entity_name(to_jsonb(p_name)) is null or (p_client_name is not null and private.valid_entity_name(to_jsonb(p_client_name)) is null) then raise exception using message='VALIDATION'; end if;
  select * into item from public.projects where id=p_project_id and private.is_active_member(workspace_id) for update;
  if not found then raise exception using message='NOT_FOUND'; end if;
  update public.projects set name=p_name,client_name=p_client_name,updated_at=now() where id=p_project_id returning * into item;
  return jsonb_build_object('id',item.id,'name',item.name,'clientName',item.client_name);
end;
$$;


ALTER FUNCTION "private"."rename_project"("p_project_id" "uuid", "p_name" "text", "p_client_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."require_active_map_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$begin
 if new.deleted_at is null then
  perform 1 from public.workspace_members where workspace_id=new.workspace_id and user_id=new.owner_id and status='active' for share;
  if not found then raise exception 'VALIDATION'; end if;
 end if;
 return new;
end;$$;


ALTER FUNCTION "private"."require_active_map_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."reserve_ai_generation"("p_actor" "uuid", "p_map_id" "uuid", "p_parent_node_id" "uuid", "p_generation_id" "uuid", "p_editor_session_id" "uuid", "p_guidance" "text", "p_model" "text", "p_daily_budget" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare m public.maps; j public.ai_generations; settings private.ai_settings; ledger private.ai_usage_days;
  context jsonb; hash text; depth integer; moment timestamptz; today date; budget integer; recent_count integer; oldest timestamptz; wait_seconds integer;
begin
  if p_actor is null or p_map_id is null or p_parent_node_id is null or p_generation_id is null or p_editor_session_id is null
    or p_guidance is null or char_length(p_guidance)>1000 then raise exception using message='VALIDATION'; end if;
  if p_model is null or btrim(p_model)='' or p_daily_budget is null or p_daily_budget<17000 then raise exception using message='AI_CONFIG_MISSING'; end if;
  select * into settings from private.ai_settings where singleton;
  if not found then raise exception using message='AI_CONFIG_MISSING'; end if;
  if not private.ai_generation_available(p_actor) then raise exception using message='AI_DISABLED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-user:'||p_actor::text,0));
  perform pg_advisory_xact_lock(hashtextextended('ai-job:'||p_generation_id::text,0));
  select * into m from public.maps where id=p_map_id and deleted_at is null;
  if not found or not exists(select 1 from public.workspace_members where workspace_id=m.workspace_id and user_id=p_actor and status='active') then raise exception using message='NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-workspace:'||m.workspace_id::text,0));
  update public.ai_generations set state='failed',error_code='EXPIRED',finished_at=clock_timestamp()
    where requested_by=p_actor and state in ('pending','running') and expires_at<=clock_timestamp();
  select * into m from public.maps where id=p_map_id and deleted_at is null for update;
  if not found then raise exception using message='NOT_FOUND'; end if;
  perform 1 from public.workspace_members where workspace_id=m.workspace_id and user_id=p_actor and status='active' for share;
  if not found then raise exception using message='NOT_FOUND'; end if;
  hash:=md5(jsonb_build_object('map',p_map_id,'parent',p_parent_node_id,'guidance',p_guidance,'session',p_editor_session_id)::text);
  select * into j from public.ai_generations where id=p_generation_id;
  if found then
    if j.requested_by<>p_actor or j.request_hash<>hash then raise exception using message='CONFLICT'; end if;
    return private.ai_job_json(j)||jsonb_build_object('claimed',false);
  end if;
  if exists(select 1 from public.ai_generations where requested_by=p_actor and state in ('pending','running')) then raise exception using message='AI_BUSY'; end if;
  moment:=clock_timestamp();today:=private.ai_utc_day(moment);budget:=least(p_daily_budget,settings.daily_token_cap);
  select count(*),min(created_at) into recent_count,oldest from public.ai_generations where requested_by=p_actor and created_at>moment-interval '1 minute';
  if recent_count>=settings.requests_per_minute then
    wait_seconds:=greatest(1,ceil(extract(epoch from oldest+interval '1 minute'-moment))::integer);
    raise exception using message='AI_RATE_LIMIT',detail=wait_seconds::text;
  end if;
  insert into private.ai_usage_days(workspace_id,usage_day) values(m.workspace_id,today) on conflict do nothing;
  select * into ledger from private.ai_usage_days where workspace_id=m.workspace_id and usage_day=today for update;
  wait_seconds:=greatest(1,ceil(extract(epoch from ((today+1)::timestamp at time zone 'UTC'))-extract(epoch from moment))::integer);
  if ledger.generation_count>=settings.generations_per_day then raise exception using message='AI_DAILY_LIMIT',detail=wait_seconds::text; end if;
  if ledger.accounted_tokens+17000>budget then raise exception using message='AI_BUDGET_LIMIT',detail=wait_seconds::text; end if;
  if not exists(select 1 from public.nodes where map_id=p_map_id and id=p_parent_node_id) then raise exception using message='VALIDATION'; end if;
  if (select count(*) from public.nodes where map_id=p_map_id)>496 then raise exception using message='LIMIT_EXCEEDED'; end if;
  with recursive path as (
    select id,parent_id,1 d from public.nodes where map_id=p_map_id and id=p_parent_node_id
    union all select n.id,n.parent_id,p.d+1 from public.nodes n join path p on n.id=p.parent_id where n.map_id=p_map_id and p.d<=31
  ) select max(d) into depth from path;
  if depth>30 then raise exception using message='LIMIT_EXCEEDED'; end if;
  context:=private.ai_context(p_map_id,p_parent_node_id);
  if char_length(context::text)>12000 then raise exception using message='AI_CONTEXT_TOO_LONG'; end if;
  update private.ai_usage_days set generation_count=generation_count+1,accounted_tokens=accounted_tokens+17000 where workspace_id=m.workspace_id and usage_day=today;
  insert into public.ai_generations(id,map_id,workspace_id,parent_node_id,requested_by,editor_session_id,request_hash,context_fingerprint,state,model,reserved_tokens,usage_day,accounted_tokens,created_at,expires_at)
    values(p_generation_id,p_map_id,m.workspace_id,p_parent_node_id,p_actor,p_editor_session_id,hash,md5(context::text),'running',p_model,17000,today,17000,moment,moment+interval '2 minutes') returning * into j;
  insert into private.ai_usage_events(generation_id,event,state,accounted_tokens,duration_ms) values(j.id,'reserved',j.state,17000,0);
  return private.ai_job_json(j)||jsonb_build_object('claimed',true,'context',context);
end; $$;


ALTER FUNCTION "private"."reserve_ai_generation"("p_actor" "uuid", "p_map_id" "uuid", "p_parent_node_id" "uuid", "p_generation_id" "uuid", "p_editor_session_id" "uuid", "p_guidance" "text", "p_model" "text", "p_daily_budget" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."reserve_workspace_invitation"("p_actor" "uuid", "p_action" "text", "p_workspace" "uuid", "p_id" "uuid", "p_email" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare inv public.workspace_invitations; recipient auth.users; normalized text:=lower(btrim(p_email)); claim uuid;
begin
 if p_actor is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor and role='admin' and status='active') then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.workspaces where id=p_workspace for no key update;
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor and role='admin' and status='active') then raise exception 'FORBIDDEN'; end if;
 if p_action not in ('create','retry','revoke') or p_id is null then raise exception 'VALIDATION'; end if;
 if p_action='create' then
  if normalized is null or char_length(normalized)>254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'VALIDATION'; end if;
  select * into inv from public.workspace_invitations where id=p_id;
  if found and (inv.workspace_id<>p_workspace or inv.email<>normalized) then raise exception 'CONFLICT'; end if;
  if inv.id is null then
   select * into inv from public.workspace_invitations where workspace_id=p_workspace and email=normalized and status='pending' for update;
  end if;
  if inv.id is not null then
   if inv.status<>'pending' then raise exception 'INVITE_CLOSED'; end if;
   return jsonb_build_object('id',inv.id,'claimed',false,'deliveryState',inv.delivery_state);
  end if;
  select * into recipient from auth.users where lower(email)=normalized limit 1;
  if exists(select 1 from public.workspace_members where user_id=recipient.id and status='active') then raise exception 'ALREADY_MEMBER'; end if;
  insert into public.workspace_invitations(id,workspace_id,email,invited_by,auth_user_id)
  values(p_id,p_workspace,normalized,p_actor,recipient.id) returning * into inv;
 else
  select * into inv from public.workspace_invitations where id=p_id and workspace_id=p_workspace for update;
  if inv.id is null then raise exception 'NOT_FOUND'; end if;
  if p_action='revoke' then
   if inv.status='accepted' then raise exception 'INVITE_CLOSED'; end if;
   update public.workspace_invitations set status='revoked',updated_at=now() where id=inv.id;
   return jsonb_build_object('id',inv.id,'claimed',false,'deliveryState',inv.delivery_state);
  end if;
  if inv.status<>'pending' then raise exception 'INVITE_CLOSED'; end if;
  if inv.last_attempt_at>now()-interval '60 seconds' then raise exception 'COOLDOWN'; end if;
  select * into recipient from auth.users where lower(email)=inv.email limit 1;
 end if;
 -- Existing confirmed accounts receive no new Auth email; the pending invitation
 -- is accepted after their ordinary login. Unconfirmed invited identities can be resent.
 if recipient.id is not null and (recipient.email_confirmed_at is not null or recipient.invited_at is null) then
  update public.workspace_invitations set auth_user_id=recipient.id,delivery_state='existing',delivery_error=null,last_attempt_at=now(),expires_at=now()+interval '7 days',updated_at=now() where id=inv.id;
  return jsonb_build_object('id',inv.id,'claimed',false,'deliveryState','existing');
 end if;
 claim:=gen_random_uuid();
 update public.workspace_invitations set attempt_id=claim,delivery_state='sending',delivery_error=null,last_attempt_at=now(),expires_at=now()+interval '7 days',updated_at=now() where id=inv.id;
 return jsonb_build_object('id',inv.id,'claimed',true,'attemptId',claim,'email',inv.email,'deliveryState','sending');
end;$_$;


ALTER FUNCTION "private"."reserve_workspace_invitation"("p_actor" "uuid", "p_action" "text", "p_workspace" "uuid", "p_id" "uuid", "p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."set_ai_validation_access"("p_user_id" "uuid", "p_enabled" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
begin
  if not exists(select 1 from auth.users where id=p_user_id and email ~ '^mapa-validacao-[0-9]{8}-[a-f0-9]{6}-[a-d]@example[.]com$') then
    raise exception using message='VALIDATION'; end if;
  if p_enabled then
    insert into private.ai_validation_access(user_id,expires_at) values(p_user_id,now()+interval '1 hour')
      on conflict(user_id) do update set expires_at=excluded.expires_at;
  else delete from private.ai_validation_access where user_id=p_user_id; end if;
end; $_$;


ALTER FUNCTION "private"."set_ai_validation_access"("p_user_id" "uuid", "p_enabled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."set_member_access"("p_workspace" "uuid", "p_user" "uuid", "p_status" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare actor uuid:=auth.uid(); member public.workspace_members; owned jsonb;
begin
 if actor is null then raise exception 'UNAUTHENTICATED'; end if;
 if p_workspace is null or p_user is null or p_status is null or p_status not in ('active','inactive') then raise exception 'VALIDATION'; end if;
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=actor and role='admin' and status='active') then raise exception 'FORBIDDEN'; end if;
 -- Serializes last-admin decisions for this workspace. NO KEY UPDATE is
 -- compatible with the FK key-share locks used when inserting memberships.
 perform 1 from public.workspaces where id=p_workspace for no key update;
 -- Same identity lock as invitation acceptance: cannot reactivate into two teams.
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,4));
 perform 1 from public.workspace_members where workspace_id=p_workspace and user_id=actor and role='admin' and status='active' for share;
 if not found then raise exception 'FORBIDDEN'; end if;
 select * into member from public.workspace_members where workspace_id=p_workspace and user_id=p_user for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if member.status=p_status then return jsonb_build_object('status',p_status,'maps','[]'::jsonb); end if;
 if p_status='inactive' then
  if member.role='admin' and (select count(*) from public.workspace_members where workspace_id=p_workspace and role='admin' and status='active')<=1 then
   return jsonb_build_object('error','LAST_ADMIN','maps','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'title',m.title) order by m.title,m.id),'[]'::jsonb) into owned from public.maps m
  where m.workspace_id=p_workspace and m.owner_id=p_user and m.deleted_at is null;
  if jsonb_array_length(owned)>0 then return jsonb_build_object('error','OWNED_MAPS','maps',owned); end if;
 else
  if exists(select 1 from public.workspace_members where user_id=p_user and workspace_id<>p_workspace and status='active') then
   return jsonb_build_object('error','ALREADY_MEMBER','maps','[]'::jsonb);
  end if;
 end if;
 update public.workspace_members set status=p_status where workspace_id=p_workspace and user_id=p_user;
 -- No identity, profile, role, document, node, author or history row is deleted.
 return jsonb_build_object('status',p_status,'maps','[]'::jsonb);
end;$$;


ALTER FUNCTION "private"."set_member_access"("p_workspace" "uuid", "p_user" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."shares_workspace"("target_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select auth.uid() is not null and exists (
    select 1 from public.workspace_members viewer
    join public.workspace_members colleague on colleague.workspace_id = viewer.workspace_id
    where viewer.user_id = auth.uid() and viewer.status = 'active' and colleague.user_id = target_user_id
  );
$$;


ALTER FUNCTION "private"."shares_workspace"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."try_uuid"("value" "jsonb") RETURNS "uuid"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
  select case when jsonb_typeof(value) = 'string'
    and (value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (value #>> '{}')::uuid end;
$_$;


ALTER FUNCTION "private"."try_uuid"("value" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."valid_entity_name"("value" "jsonb") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$ select case when jsonb_typeof(value)='string' and char_length(value#>>'{}') between 1 and 120 and btrim(value#>>'{}')<>'' then value#>>'{}' else null end; $$;


ALTER FUNCTION "private"."valid_entity_name"("value" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."valid_map_viewport"("value" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case when jsonb_typeof(value)='object' and value ?& array['x','y','zoom']
    and (select count(*) from jsonb_object_keys(value))=3
    and jsonb_typeof(value->'x')='number' and jsonb_typeof(value->'y')='number' and jsonb_typeof(value->'zoom')='number'
  then abs((value->>'x')::numeric)<=1000000000 and abs((value->>'y')::numeric)<=1000000000
    and (value->>'zoom')::numeric between 0.001 and 2 else false end;
$$;


ALTER FUNCTION "private"."valid_map_viewport"("value" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."valid_node_text"("value" "jsonb") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case when jsonb_typeof(value) = 'string'
    and char_length(value #>> '{}') between 1 and 500 and btrim(value #>> '{}') <> ''
    then value #>> '{}' end;
$$;


ALTER FUNCTION "private"."valid_node_text"("value" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."validate_copy_nodes"("p_nodes" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
declare item jsonb; total integer; reached integer; deepest integer;
begin
  if jsonb_typeof(p_nodes) is distinct from 'array' then raise exception using message='VALIDATION'; end if;
  total:=jsonb_array_length(p_nodes);
  if total<1 then raise exception using message='VALIDATION'; end if;
  if total>500 then raise exception using message='LIMIT_EXCEEDED'; end if;
  for item in select value from jsonb_array_elements(p_nodes) loop
    if jsonb_typeof(item) is distinct from 'object' then raise exception using message='VALIDATION'; end if;
    if (select count(*) from jsonb_object_keys(item))<>4
      or exists(select 1 from jsonb_object_keys(item) k where k<>all(array['id','parentId','text','sortOrder']))
      or private.try_uuid(item->'id') is null or private.valid_node_text(item->'text') is null or (item->>'text') !~ '[^[:space:]]'
      or (item->'parentId' is distinct from 'null'::jsonb and private.try_uuid(item->'parentId') is null)
      or jsonb_typeof(item->'sortOrder') is distinct from 'number' then raise exception using message='VALIDATION'; end if;
    if (item->>'sortOrder') !~ '^[0-9]{1,10}$' then raise exception using message='VALIDATION'; end if;
    if (item->>'sortOrder')::bigint>2147483647 then raise exception using message='VALIDATION'; end if;
  end loop;
  if (select count(distinct (value->>'id')::uuid) from jsonb_array_elements(p_nodes))<>total
    or (select count(*) from jsonb_array_elements(p_nodes) where value->'parentId'='null'::jsonb)<>1 then
    raise exception using message='VALIDATION'; end if;
  with recursive input as (
    select (value->>'id')::uuid id,(value->>'parentId')::uuid parent_id from jsonb_array_elements(p_nodes)
  ), walk as (
    select id,0 depth,array[id] path from input where parent_id is null
    union all
    select n.id,w.depth+1,w.path||n.id from input n join walk w on n.parent_id=w.id
    where not n.id=any(w.path) and w.depth<=30
  ) select count(*),max(depth) into reached,deepest from walk;
  if deepest>30 then raise exception using message='LIMIT_EXCEEDED'; end if;
  if reached<>total then raise exception using message='VALIDATION'; end if;
end;
$_$;


ALTER FUNCTION "private"."validate_copy_nodes"("p_nodes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_workspace_invitation"("p_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$select private.accept_workspace_invitation(p_id)$$;


ALTER FUNCTION "public"."accept_workspace_invitation"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_generation_available"("p_actor" "uuid") RETURNS boolean
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select private.ai_generation_available(p_actor); $$;


ALTER FUNCTION "public"."ai_generation_available"("p_actor" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_map_command"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_kind" "text", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select private.apply_map_command(p_map_id, p_operation_id, p_editor_session_id, p_expected_revision, p_kind, p_payload); $$;


ALTER FUNCTION "public"."apply_map_command"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_kind" "text", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_map_history"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_mode" "text", "p_target_operation_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select private.apply_map_history(p_map_id,p_operation_id,p_editor_session_id,p_expected_revision,p_mode,p_target_operation_id); $$;


ALTER FUNCTION "public"."apply_map_history"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_mode" "text", "p_target_operation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select private.cancel_ai_generation(p_map_id,p_generation_id); $$;


ALTER FUNCTION "public"."cancel_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_map"("p_workspace_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select private.create_map(p_workspace_id, p_operation_id, p_editor_session_id, p_title); $$;


ALTER FUNCTION "public"."create_map"("p_workspace_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_map_copy"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text", "p_nodes" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select private.create_map_copy(p_source_map_id,p_operation_id,p_editor_session_id,p_title,p_nodes); $$;


ALTER FUNCTION "public"."create_map_copy"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text", "p_nodes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_project"("p_project_id" "uuid", "p_workspace_id" "uuid", "p_name" "text", "p_client_name" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select private.create_project(p_project_id,p_workspace_id,p_name,p_client_name); $$;


ALTER FUNCTION "public"."create_project"("p_project_id" "uuid", "p_workspace_id" "uuid", "p_name" "text", "p_client_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."duplicate_map"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select private.duplicate_map(p_source_map_id,p_operation_id,p_editor_session_id); $$;


ALTER FUNCTION "public"."duplicate_map"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finish_ai_generation"("p_generation_id" "uuid", "p_children" "jsonb", "p_usage" "jsonb", "p_error" "text") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select private.finish_ai_generation(p_generation_id,p_children,p_usage,p_error); $$;


ALTER FUNCTION "public"."finish_ai_generation"("p_generation_id" "uuid", "p_children" "jsonb", "p_usage" "jsonb", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finish_workspace_invitation"("p_id" "uuid", "p_attempt" "uuid", "p_outcome" "text") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$select private.finish_workspace_invitation(p_id,p_attempt,p_outcome)$$;


ALTER FUNCTION "public"."finish_workspace_invitation"("p_id" "uuid", "p_attempt" "uuid", "p_outcome" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid" DEFAULT NULL::"uuid", "p_editor_session_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select private.get_ai_generation(p_map_id,p_generation_id,p_editor_session_id); $$;


ALTER FUNCTION "public"."get_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid", "p_editor_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_map_document"("p_map_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
begin
  perform private.assert_map_not_deleted(p_map_id);
  return (select jsonb_build_object(
    'map', jsonb_build_object('id', m.id, 'workspaceId', m.workspace_id, 'title', m.title,'projectId',m.project_id, 'ownerId', m.owner_id,
      'ownerName', p.display_name, 'revision', m.revision, 'createdAt', m.created_at, 'updatedAt', m.updated_at),
    'nodes', coalesce((
      select jsonb_agg(private.node_json(n) order by n.sort_order, n.created_at)
      from public.nodes n where n.map_id = m.id), '[]'::jsonb),
    'people', coalesce((
      select jsonb_object_agg(pp.id, pp.display_name) from public.profiles pp
      where pp.id = m.owner_id or pp.id in (select created_by from public.nodes where map_id = m.id union select updated_by from public.nodes where map_id = m.id)),
      '{}'::jsonb))
  from public.maps m left join public.profiles p on p.id = m.owner_id
  where m.id = p_map_id and m.deleted_at is null);
end;
$$;


ALTER FUNCTION "public"."get_map_document"("p_map_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_map_backup"("p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_backup" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select private.import_map_backup(p_operation_id,p_editor_session_id,p_backup); $$;


ALTER FUNCTION "public"."import_map_backup"("p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_backup" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_map_library"("p_workspace_id" "uuid", "p_query" "text" DEFAULT ''::"text", "p_project_id" "uuid" DEFAULT NULL::"uuid", "p_owner_id" "uuid" DEFAULT NULL::"uuid", "p_page" integer DEFAULT 1, "p_without_project" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare pattern text; result jsonb;
begin
  if auth.uid() is null then raise exception using message='UNAUTHENTICATED'; end if;
  if not private.is_active_member(p_workspace_id) then raise exception using message='FORBIDDEN'; end if;
  if p_query is null or char_length(p_query)>120 or p_page is null or p_page<1 or p_without_project is null
    or (p_project_id is not null and p_without_project) then raise exception using message='VALIDATION'; end if;
  pattern:='%'||replace(replace(replace(p_query,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  with filtered as materialized (
    select m.id,m.title,m.project_id,m.owner_id,m.updated_at,m.revision
    from public.maps m where m.workspace_id=p_workspace_id and m.deleted_at is null
      and (p_query='' or m.title ilike pattern escape E'\\')
      and (p_project_id is null or m.project_id=p_project_id)
      and (not p_without_project or m.project_id is null)
      and (p_owner_id is null or m.owner_id=p_owner_id)
  ), totals as (
    select count(*) total,greatest(1,ceil(count(*)/20.0)::integer) pages from filtered
  ), paging as (select total,pages,least(p_page,pages) current_page from totals), page_rows as (
    select f.* from filtered f order by f.updated_at desc,f.id desc
      limit 20 offset (select (current_page::bigint-1)*20 from paging)
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',r.id,'title',r.title,'projectId',r.project_id,'projectName',p.name,'clientName',p.client_name,
    'ownerId',r.owner_id,'ownerName',coalesce(o.display_name,'Membro da equipe'),'updatedAt',r.updated_at,'revision',r.revision)
    order by r.updated_at desc,r.id desc) from page_rows r left join public.projects p on p.id=r.project_id
    left join public.profiles o on o.id=r.owner_id),'[]'::jsonb),
    'total',paging.total,'unfilteredTotal',(select count(*) from public.maps m where m.workspace_id=p_workspace_id and m.deleted_at is null),
    'page',paging.current_page,'pageSize',20,'totalPages',paging.pages) into result from paging;
  return result;
end;
$$;


ALTER FUNCTION "public"."list_map_library"("p_workspace_id" "uuid", "p_query" "text", "p_project_id" "uuid", "p_owner_id" "uuid", "p_page" integer, "p_without_project" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pending_workspace_invitations"() RETURNS TABLE("id" "uuid", "workspace_name" "text", "email" "text", "expires_at" timestamp with time zone)
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$select * from private.pending_workspace_invitations()$$;


ALTER FUNCTION "public"."pending_workspace_invitations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rename_project"("p_project_id" "uuid", "p_name" "text", "p_client_name" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select private.rename_project(p_project_id,p_name,p_client_name); $$;


ALTER FUNCTION "public"."rename_project"("p_project_id" "uuid", "p_name" "text", "p_client_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_ai_generation"("p_actor" "uuid", "p_map_id" "uuid", "p_parent_node_id" "uuid", "p_generation_id" "uuid", "p_editor_session_id" "uuid", "p_guidance" "text", "p_model" "text", "p_daily_budget" integer) RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select private.reserve_ai_generation(p_actor,p_map_id,p_parent_node_id,p_generation_id,p_editor_session_id,p_guidance,p_model,p_daily_budget); $$;


ALTER FUNCTION "public"."reserve_ai_generation"("p_actor" "uuid", "p_map_id" "uuid", "p_parent_node_id" "uuid", "p_generation_id" "uuid", "p_editor_session_id" "uuid", "p_guidance" "text", "p_model" "text", "p_daily_budget" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_workspace_invitation"("p_actor" "uuid", "p_action" "text", "p_workspace" "uuid", "p_id" "uuid", "p_email" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$select private.reserve_workspace_invitation(p_actor,p_action,p_workspace,p_id,p_email)$$;


ALTER FUNCTION "public"."reserve_workspace_invitation"("p_actor" "uuid", "p_action" "text", "p_workspace" "uuid", "p_id" "uuid", "p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_ai_validation_access"("p_user_id" "uuid", "p_enabled" boolean) RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$ select private.set_ai_validation_access(p_user_id,p_enabled); $$;


ALTER FUNCTION "public"."set_ai_validation_access"("p_user_id" "uuid", "p_enabled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_member_access"("p_workspace" "uuid", "p_user" "uuid", "p_status" "text") RETURNS "jsonb"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$select private.set_member_access(p_workspace,p_user,p_status)$$;


ALTER FUNCTION "public"."set_member_access"("p_workspace" "uuid", "p_user" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "private"."ai_settings" (
    "singleton" boolean DEFAULT true NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "requests_per_minute" integer NOT NULL,
    "generations_per_day" integer NOT NULL,
    "daily_token_cap" integer NOT NULL,
    CONSTRAINT "ai_settings_daily_token_cap_check" CHECK ((("daily_token_cap" >= 17000) AND ("daily_token_cap" <= 50000))),
    CONSTRAINT "ai_settings_generations_per_day_check" CHECK ((("generations_per_day" >= 1) AND ("generations_per_day" <= 100))),
    CONSTRAINT "ai_settings_requests_per_minute_check" CHECK ((("requests_per_minute" >= 1) AND ("requests_per_minute" <= 10))),
    CONSTRAINT "ai_settings_singleton_check" CHECK ("singleton")
);


ALTER TABLE "private"."ai_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "private"."ai_usage_days" (
    "workspace_id" "uuid" NOT NULL,
    "usage_day" "date" NOT NULL,
    "generation_count" integer DEFAULT 0 NOT NULL,
    "accounted_tokens" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT "ai_usage_days_accounted_tokens_check" CHECK (("accounted_tokens" >= 0)),
    CONSTRAINT "ai_usage_days_generation_count_check" CHECK (("generation_count" >= 0))
);


ALTER TABLE "private"."ai_usage_days" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "private"."ai_usage_events" (
    "id" bigint NOT NULL,
    "generation_id" "uuid" NOT NULL,
    "event" "text" NOT NULL,
    "state" "text" NOT NULL,
    "accounted_tokens" bigint NOT NULL,
    "duration_ms" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "ai_usage_events_accounted_tokens_check" CHECK (("accounted_tokens" >= 0)),
    CONSTRAINT "ai_usage_events_duration_ms_check" CHECK (("duration_ms" >= 0)),
    CONSTRAINT "ai_usage_events_event_check" CHECK (("event" = ANY (ARRAY['reserved'::"text", 'usage_reconciled'::"text"])))
);


ALTER TABLE "private"."ai_usage_events" OWNER TO "postgres";


ALTER TABLE "private"."ai_usage_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "private"."ai_usage_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "private"."ai_validation_access" (
    "user_id" "uuid" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL
);


ALTER TABLE "private"."ai_validation_access" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."map_operations" (
    "id" "uuid" NOT NULL,
    "map_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "editor_session_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "base_revision" bigint,
    "result_revision" bigint NOT NULL,
    "request_hash" "text" NOT NULL,
    "before_data" "jsonb",
    "after_data" "jsonb" NOT NULL,
    "undone_operation_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "map_operations_kind_check" CHECK ((("char_length"("kind") >= 1) AND ("char_length"("kind") <= 40)))
);


ALTER TABLE "public"."map_operations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."map_user_preferences" (
    "map_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "viewport" "jsonb" NOT NULL,
    "collapsed_node_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    CONSTRAINT "map_user_preferences_collapsed_node_ids_check" CHECK ((("cardinality"("collapsed_node_ids") <= 500) AND ("array_position"("collapsed_node_ids", NULL::"uuid") IS NULL) AND (("cardinality"("collapsed_node_ids") = 0) OR ("array_ndims"("collapsed_node_ids") = 1)))),
    CONSTRAINT "map_user_preferences_viewport_check" CHECK ("private"."valid_map_viewport"("viewport"))
);


ALTER TABLE "public"."map_user_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_display_name_check" CHECK ((("char_length"("display_name") >= 1) AND ("char_length"("display_name") <= 120)))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "client_name" "text",
    "created_by" "uuid" NOT NULL,
    "creation_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "projects_client_name_check" CHECK ((("client_name" IS NULL) OR ((("char_length"("client_name") >= 1) AND ("char_length"("client_name") <= 120)) AND ("btrim"("client_name") <> ''::"text")))),
    CONSTRAINT "projects_name_check" CHECK (((("char_length"("name") >= 1) AND ("char_length"("name") <= 120)) AND ("btrim"("name") <> ''::"text")))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspace_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "auth_user_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_attempt_at" timestamp with time zone,
    "attempt_id" "uuid",
    "delivery_state" "text" DEFAULT 'sending'::"text" NOT NULL,
    "delivery_error" "text",
    "accepted_by" "uuid",
    "accepted_at" timestamp with time zone,
    CONSTRAINT "workspace_invitations_delivery_error_check" CHECK (("delivery_error" = ANY (ARRAY['SEND_FAILED'::"text", 'DELIVERY_UNKNOWN'::"text"]))),
    CONSTRAINT "workspace_invitations_delivery_state_check" CHECK (("delivery_state" = ANY (ARRAY['sending'::"text", 'sent'::"text", 'existing'::"text", 'failed'::"text"]))),
    CONSTRAINT "workspace_invitations_email_check" CHECK ((("email" = "lower"("btrim"("email"))) AND (("char_length"("email") >= 3) AND ("char_length"("email") <= 254)) AND ("email" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'::"text"))),
    CONSTRAINT "workspace_invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."workspace_invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspace_members" (
    "workspace_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    CONSTRAINT "workspace_members_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'member'::"text"]))),
    CONSTRAINT "workspace_members_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."workspace_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workspaces_name_check" CHECK ((("char_length"("btrim"("name")) >= 1) AND ("char_length"("btrim"("name")) <= 120)))
);


ALTER TABLE "public"."workspaces" OWNER TO "postgres";


ALTER TABLE ONLY "private"."ai_settings"
    ADD CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("singleton");



ALTER TABLE ONLY "private"."ai_usage_days"
    ADD CONSTRAINT "ai_usage_days_pkey" PRIMARY KEY ("workspace_id", "usage_day");



ALTER TABLE ONLY "private"."ai_usage_events"
    ADD CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "private"."ai_validation_access"
    ADD CONSTRAINT "ai_validation_access_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."ai_generations"
    ADD CONSTRAINT "ai_generations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."map_operations"
    ADD CONSTRAINT "map_operations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."map_user_preferences"
    ADD CONSTRAINT "map_user_preferences_pkey" PRIMARY KEY ("map_id", "user_id");



ALTER TABLE ONLY "public"."maps"
    ADD CONSTRAINT "maps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nodes"
    ADD CONSTRAINT "nodes_map_id_id_key" UNIQUE ("map_id", "id");



ALTER TABLE ONLY "public"."nodes"
    ADD CONSTRAINT "nodes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_workspace_id_id_key" UNIQUE ("workspace_id", "id");



ALTER TABLE ONLY "public"."workspace_invitations"
    ADD CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("workspace_id", "user_id");



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id");



CREATE INDEX "ai_usage_events_generation_idx" ON "private"."ai_usage_events" USING "btree" ("generation_id");



CREATE INDEX "ai_generations_map_idx" ON "public"."ai_generations" USING "btree" ("map_id", "created_at" DESC);



CREATE UNIQUE INDEX "ai_generations_one_active_user" ON "public"."ai_generations" USING "btree" ("requested_by") WHERE ("state" = ANY (ARRAY['pending'::"text", 'running'::"text"]));



CREATE INDEX "ai_generations_user_time_idx" ON "public"."ai_generations" USING "btree" ("requested_by", "created_at");



CREATE INDEX "ai_generations_workspace_usage_idx" ON "public"."ai_generations" USING "btree" ("workspace_id", "created_at");



CREATE INDEX "invitation_accepted_by" ON "public"."workspace_invitations" USING "btree" ("accepted_by") WHERE ("accepted_by" IS NOT NULL);



CREATE INDEX "invitation_auth_user" ON "public"."workspace_invitations" USING "btree" ("auth_user_id") WHERE ("auth_user_id" IS NOT NULL);



CREATE INDEX "invitation_inviter" ON "public"."workspace_invitations" USING "btree" ("invited_by");



CREATE UNIQUE INDEX "invitation_pending_email" ON "public"."workspace_invitations" USING "btree" ("workspace_id", "email") WHERE ("status" = 'pending'::"text");



CREATE INDEX "invitation_pending_recipient" ON "public"."workspace_invitations" USING "btree" ("email", "expires_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "invitation_workspace_created" ON "public"."workspace_invitations" USING "btree" ("workspace_id", "created_at" DESC);



CREATE INDEX "map_operations_map_idx" ON "public"."map_operations" USING "btree" ("map_id", "created_at");



CREATE INDEX "map_operations_revision_idx" ON "public"."map_operations" USING "btree" ("map_id", "result_revision");



CREATE INDEX "map_operations_undone_idx" ON "public"."map_operations" USING "btree" ("undone_operation_id");



CREATE INDEX "map_user_preferences_user_idx" ON "public"."map_user_preferences" USING "btree" ("user_id");



CREATE INDEX "maps_owner_order_idx" ON "public"."maps" USING "btree" ("workspace_id", "owner_id", "updated_at" DESC, "id" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "maps_project_order_idx" ON "public"."maps" USING "btree" ("workspace_id", "project_id", "updated_at" DESC, "id" DESC);



CREATE INDEX "maps_title_search_idx" ON "public"."maps" USING "gin" ("title" "extensions"."gin_trgm_ops") WHERE ("deleted_at" IS NULL);



CREATE INDEX "maps_workspace_order_idx" ON "public"."maps" USING "btree" ("workspace_id", "updated_at" DESC, "id" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "nodes_children_idx" ON "public"."nodes" USING "btree" ("map_id", "parent_id", "sort_order");



CREATE UNIQUE INDEX "nodes_one_root_per_map" ON "public"."nodes" USING "btree" ("map_id") WHERE ("parent_id" IS NULL);



CREATE INDEX "projects_created_by_idx" ON "public"."projects" USING "btree" ("created_by");



CREATE INDEX "projects_workspace_name_idx" ON "public"."projects" USING "btree" ("workspace_id", "name", "id");



CREATE INDEX "workspace_members_user_id_idx" ON "public"."workspace_members" USING "btree" ("user_id", "workspace_id");



CREATE OR REPLACE TRIGGER "maps_active_owner" BEFORE INSERT OR UPDATE OF "owner_id", "workspace_id", "deleted_at" ON "public"."maps" FOR EACH ROW EXECUTE FUNCTION "private"."require_active_map_owner"();



CREATE CONSTRAINT TRIGGER "maps_require_root" AFTER INSERT ON "public"."maps" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "private"."assert_map_has_root"();



CREATE CONSTRAINT TRIGGER "nodes_keep_root" AFTER DELETE OR UPDATE OF "parent_id", "map_id" ON "public"."nodes" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "private"."assert_map_has_root"();



ALTER TABLE ONLY "private"."ai_usage_days"
    ADD CONSTRAINT "ai_usage_days_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "private"."ai_usage_events"
    ADD CONSTRAINT "ai_usage_events_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "public"."ai_generations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "private"."ai_validation_access"
    ADD CONSTRAINT "ai_validation_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_generations"
    ADD CONSTRAINT "ai_generations_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_generations"
    ADD CONSTRAINT "ai_generations_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."ai_generations"
    ADD CONSTRAINT "ai_generations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id");



ALTER TABLE ONLY "public"."map_operations"
    ADD CONSTRAINT "map_operations_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."map_operations"
    ADD CONSTRAINT "map_operations_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."map_operations"
    ADD CONSTRAINT "map_operations_undone_operation_id_fkey" FOREIGN KEY ("undone_operation_id") REFERENCES "public"."map_operations"("id");



ALTER TABLE ONLY "public"."map_operations"
    ADD CONSTRAINT "map_operations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."map_user_preferences"
    ADD CONSTRAINT "map_user_preferences_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."map_user_preferences"
    ADD CONSTRAINT "map_user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."maps"
    ADD CONSTRAINT "maps_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."maps"
    ADD CONSTRAINT "maps_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."maps"
    ADD CONSTRAINT "maps_project_workspace_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "public"."projects"("workspace_id", "id");



ALTER TABLE ONLY "public"."maps"
    ADD CONSTRAINT "maps_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."maps"
    ADD CONSTRAINT "maps_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."nodes"
    ADD CONSTRAINT "nodes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."nodes"
    ADD CONSTRAINT "nodes_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nodes"
    ADD CONSTRAINT "nodes_map_id_parent_id_fkey" FOREIGN KEY ("map_id", "parent_id") REFERENCES "public"."nodes"("map_id", "id");



ALTER TABLE ONLY "public"."nodes"
    ADD CONSTRAINT "nodes_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."workspace_invitations"
    ADD CONSTRAINT "workspace_invitations_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workspace_invitations"
    ADD CONSTRAINT "workspace_invitations_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workspace_invitations"
    ADD CONSTRAINT "workspace_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."workspace_invitations"
    ADD CONSTRAINT "workspace_invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT;



ALTER TABLE "private"."ai_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "private"."ai_usage_days" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "private"."ai_usage_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "private"."ai_validation_access" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_generation_read" ON "public"."ai_generations" FOR SELECT TO "authenticated" USING ((("requested_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."can_read_map"("map_id")));



ALTER TABLE "public"."ai_generations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invitation_admin_read" ON "public"."workspace_invitations" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_workspace_admin"("workspace_invitations"."workspace_id") AS "is_workspace_admin"));



ALTER TABLE "public"."map_operations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "map_read" ON "public"."maps" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "private"."is_active_member"("workspace_id")));



ALTER TABLE "public"."map_user_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."maps" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "member_read" ON "public"."workspace_members" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_member"("workspace_members"."workspace_id") AS "is_active_member"));



CREATE POLICY "node_read" ON "public"."nodes" FOR SELECT TO "authenticated" USING ("private"."can_read_map"("map_id"));



ALTER TABLE "public"."nodes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "personal_map_view" ON "public"."map_user_preferences" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."maps" "m"
  WHERE (("m"."id" = "map_user_preferences"."map_id") AND ("m"."deleted_at" IS NULL) AND "private"."is_active_member"("m"."workspace_id")))))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."maps" "m"
  WHERE (("m"."id" = "map_user_preferences"."map_id") AND ("m"."deleted_at" IS NULL) AND "private"."is_active_member"("m"."workspace_id"))))));



CREATE POLICY "profile_read" ON "public"."profiles" FOR SELECT TO "authenticated" USING (( SELECT "private"."shares_workspace"("profiles"."id") AS "shares_workspace"));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_read" ON "public"."projects" FOR SELECT TO "authenticated" USING ("private"."is_active_member"("workspace_id"));



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workspace_read" ON "public"."workspaces" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_active_member"("workspaces"."id") AS "is_active_member"));



ALTER TABLE "public"."workspaces" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "private" TO "authenticated";
GRANT USAGE ON SCHEMA "private" TO "service_role";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "private"."accept_workspace_invitation"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."accept_workspace_invitation"("p_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."ai_context"("p_map" "uuid", "p_parent" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_generation_available"("p_actor" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."ai_generation_available"("p_actor" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."ai_generations" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."ai_generations" TO "authenticated";



GRANT SELECT("map_id") ON TABLE "public"."ai_generations" TO "authenticated";



GRANT SELECT("parent_node_id") ON TABLE "public"."ai_generations" TO "authenticated";



GRANT SELECT("requested_by") ON TABLE "public"."ai_generations" TO "authenticated";



GRANT SELECT("editor_session_id") ON TABLE "public"."ai_generations" TO "authenticated";



GRANT SELECT("state") ON TABLE "public"."ai_generations" TO "authenticated";



GRANT SELECT("error_code") ON TABLE "public"."ai_generations" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."ai_generations" TO "authenticated";



GRANT SELECT("finished_at") ON TABLE "public"."ai_generations" TO "authenticated";



GRANT SELECT("applied_operation_id") ON TABLE "public"."ai_generations" TO "authenticated";



REVOKE ALL ON FUNCTION "private"."ai_job_json"("j" "public"."ai_generations") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_utc_day"("p_time" timestamp with time zone) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_valid_usage"("p_usage" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."apply_map_command"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_kind" "text", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."apply_map_command"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_kind" "text", "p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."apply_map_history"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_mode" "text", "p_target_operation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."apply_map_history"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_mode" "text", "p_target_operation_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."assert_map_has_root"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."assert_map_not_deleted"("p_map_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."assert_map_not_deleted"("p_map_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."can_read_map"("target_map_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_read_map"("target_map_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."cancel_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."cancel_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."create_map"("p_workspace_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."create_map"("p_workspace_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."create_map_copy"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text", "p_nodes" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."create_map_copy"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text", "p_nodes" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."create_project"("p_project_id" "uuid", "p_workspace_id" "uuid", "p_name" "text", "p_client_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."create_project"("p_project_id" "uuid", "p_workspace_id" "uuid", "p_name" "text", "p_client_name" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."duplicate_map"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."duplicate_map"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."finish_ai_generation"("p_generation_id" "uuid", "p_children" "jsonb", "p_usage" "jsonb", "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."finish_ai_generation"("p_generation_id" "uuid", "p_children" "jsonb", "p_usage" "jsonb", "p_error" "text") TO "service_role";



REVOKE ALL ON FUNCTION "private"."finish_ai_generation_document"("p_generation_id" "uuid", "p_children" "jsonb", "p_usage" "jsonb", "p_error" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finish_workspace_invitation"("p_id" "uuid", "p_attempt" "uuid", "p_outcome" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."finish_workspace_invitation"("p_id" "uuid", "p_attempt" "uuid", "p_outcome" "text") TO "service_role";



REVOKE ALL ON FUNCTION "private"."get_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid", "p_editor_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."get_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid", "p_editor_session_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."handle_new_auth_user"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."import_map_backup"("p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_backup" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."import_map_backup"("p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_backup" "jsonb") TO "authenticated";



GRANT ALL ON TABLE "public"."maps" TO "service_role";
GRANT SELECT ON TABLE "public"."maps" TO "authenticated";



REVOKE ALL ON FUNCTION "private"."insert_map_copy"("p_source" "public"."maps", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text", "p_nodes" "jsonb", "p_hash" "text", "p_kind" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."is_active_member"("target_workspace_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_active_member"("target_workspace_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."is_workspace_admin"("p_workspace" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_workspace_admin"("p_workspace" "uuid") TO "authenticated";



GRANT ALL ON TABLE "public"."nodes" TO "service_role";
GRANT SELECT ON TABLE "public"."nodes" TO "authenticated";



REVOKE ALL ON FUNCTION "private"."node_json"("n" "public"."nodes") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."node_json"("n" "public"."nodes") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."pending_workspace_invitations"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."pending_workspace_invitations"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."rename_project"("p_project_id" "uuid", "p_name" "text", "p_client_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."rename_project"("p_project_id" "uuid", "p_name" "text", "p_client_name" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."require_active_map_owner"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."reserve_ai_generation"("p_actor" "uuid", "p_map_id" "uuid", "p_parent_node_id" "uuid", "p_generation_id" "uuid", "p_editor_session_id" "uuid", "p_guidance" "text", "p_model" "text", "p_daily_budget" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."reserve_ai_generation"("p_actor" "uuid", "p_map_id" "uuid", "p_parent_node_id" "uuid", "p_generation_id" "uuid", "p_editor_session_id" "uuid", "p_guidance" "text", "p_model" "text", "p_daily_budget" integer) TO "service_role";



REVOKE ALL ON FUNCTION "private"."reserve_workspace_invitation"("p_actor" "uuid", "p_action" "text", "p_workspace" "uuid", "p_id" "uuid", "p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."reserve_workspace_invitation"("p_actor" "uuid", "p_action" "text", "p_workspace" "uuid", "p_id" "uuid", "p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "private"."set_ai_validation_access"("p_user_id" "uuid", "p_enabled" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."set_ai_validation_access"("p_user_id" "uuid", "p_enabled" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "private"."set_member_access"("p_workspace" "uuid", "p_user" "uuid", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."set_member_access"("p_workspace" "uuid", "p_user" "uuid", "p_status" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."shares_workspace"("target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."shares_workspace"("target_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."try_uuid"("value" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."try_uuid"("value" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."valid_entity_name"("value" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."valid_map_viewport"("value" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."valid_map_viewport"("value" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "private"."valid_map_viewport"("value" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "private"."valid_node_text"("value" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."valid_node_text"("value" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."validate_copy_nodes"("p_nodes" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."accept_workspace_invitation"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_workspace_invitation"("p_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."accept_workspace_invitation"("p_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."ai_generation_available"("p_actor" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_generation_available"("p_actor" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_map_command"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_kind" "text", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_map_command"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_kind" "text", "p_payload" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."apply_map_command"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_kind" "text", "p_payload" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."apply_map_history"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_mode" "text", "p_target_operation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_map_history"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_mode" "text", "p_target_operation_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."apply_map_history"("p_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_expected_revision" bigint, "p_mode" "text", "p_target_operation_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."cancel_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."cancel_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_map"("p_workspace_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_map"("p_workspace_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."create_map"("p_workspace_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_map_copy"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text", "p_nodes" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_map_copy"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text", "p_nodes" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."create_map_copy"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_title" "text", "p_nodes" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_project"("p_project_id" "uuid", "p_workspace_id" "uuid", "p_name" "text", "p_client_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_project"("p_project_id" "uuid", "p_workspace_id" "uuid", "p_name" "text", "p_client_name" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."create_project"("p_project_id" "uuid", "p_workspace_id" "uuid", "p_name" "text", "p_client_name" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."duplicate_map"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."duplicate_map"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."duplicate_map"("p_source_map_id" "uuid", "p_operation_id" "uuid", "p_editor_session_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."finish_ai_generation"("p_generation_id" "uuid", "p_children" "jsonb", "p_usage" "jsonb", "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finish_ai_generation"("p_generation_id" "uuid", "p_children" "jsonb", "p_usage" "jsonb", "p_error" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finish_workspace_invitation"("p_id" "uuid", "p_attempt" "uuid", "p_outcome" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finish_workspace_invitation"("p_id" "uuid", "p_attempt" "uuid", "p_outcome" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid", "p_editor_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid", "p_editor_session_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_ai_generation"("p_map_id" "uuid", "p_generation_id" "uuid", "p_editor_session_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_map_document"("p_map_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_map_document"("p_map_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_map_document"("p_map_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."import_map_backup"("p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_backup" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_map_backup"("p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_backup" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."import_map_backup"("p_operation_id" "uuid", "p_editor_session_id" "uuid", "p_backup" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."list_map_library"("p_workspace_id" "uuid", "p_query" "text", "p_project_id" "uuid", "p_owner_id" "uuid", "p_page" integer, "p_without_project" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_map_library"("p_workspace_id" "uuid", "p_query" "text", "p_project_id" "uuid", "p_owner_id" "uuid", "p_page" integer, "p_without_project" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."list_map_library"("p_workspace_id" "uuid", "p_query" "text", "p_project_id" "uuid", "p_owner_id" "uuid", "p_page" integer, "p_without_project" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."pending_workspace_invitations"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pending_workspace_invitations"() TO "service_role";
GRANT ALL ON FUNCTION "public"."pending_workspace_invitations"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."rename_project"("p_project_id" "uuid", "p_name" "text", "p_client_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rename_project"("p_project_id" "uuid", "p_name" "text", "p_client_name" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."rename_project"("p_project_id" "uuid", "p_name" "text", "p_client_name" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reserve_ai_generation"("p_actor" "uuid", "p_map_id" "uuid", "p_parent_node_id" "uuid", "p_generation_id" "uuid", "p_editor_session_id" "uuid", "p_guidance" "text", "p_model" "text", "p_daily_budget" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_ai_generation"("p_actor" "uuid", "p_map_id" "uuid", "p_parent_node_id" "uuid", "p_generation_id" "uuid", "p_editor_session_id" "uuid", "p_guidance" "text", "p_model" "text", "p_daily_budget" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reserve_workspace_invitation"("p_actor" "uuid", "p_action" "text", "p_workspace" "uuid", "p_id" "uuid", "p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_workspace_invitation"("p_actor" "uuid", "p_action" "text", "p_workspace" "uuid", "p_id" "uuid", "p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_ai_validation_access"("p_user_id" "uuid", "p_enabled" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_ai_validation_access"("p_user_id" "uuid", "p_enabled" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_member_access"("p_workspace" "uuid", "p_user" "uuid", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_member_access"("p_workspace" "uuid", "p_user" "uuid", "p_status" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."set_member_access"("p_workspace" "uuid", "p_user" "uuid", "p_status" "text") TO "authenticated";



GRANT ALL ON TABLE "private"."ai_settings" TO "service_role";



GRANT ALL ON TABLE "private"."ai_usage_days" TO "service_role";



GRANT ALL ON TABLE "private"."ai_usage_events" TO "service_role";



GRANT SELECT,USAGE ON SEQUENCE "private"."ai_usage_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "private"."ai_validation_access" TO "service_role";



GRANT ALL ON TABLE "public"."map_operations" TO "service_role";



GRANT ALL ON TABLE "public"."map_user_preferences" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."map_user_preferences" TO "authenticated";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."projects" TO "service_role";
GRANT SELECT ON TABLE "public"."projects" TO "authenticated";



GRANT ALL ON TABLE "public"."workspace_invitations" TO "service_role";
GRANT SELECT ON TABLE "public"."workspace_invitations" TO "authenticated";



GRANT ALL ON TABLE "public"."workspace_members" TO "service_role";
GRANT SELECT ON TABLE "public"."workspace_members" TO "authenticated";



GRANT ALL ON TABLE "public"."workspaces" TO "service_role";
GRANT SELECT ON TABLE "public"."workspaces" TO "authenticated";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";








-- Fora dos schemas public/private: perfil criado a cada nova identidade do Auth.
create or replace trigger "on_auth_user_created" after insert on "auth"."users"
  for each row execute function "private"."handle_new_auth_user"();

-- Configuração inicial da IA: desligada por padrão, como na migração original
-- 20261020213609_ai_usage_ledger. Em produção ela foi ligada depois (ticket 22).
insert into "private"."ai_settings" ("singleton", "enabled", "requests_per_minute", "generations_per_day", "daily_token_cap")
values (true, false, 10, 100, 50000)
on conflict do nothing;
