-- Ticket 06. The common document mutation (add_child, edit_text) and author names in
-- the document read. One transaction per command: access → map lock → replay →
-- expectedRevision → validation → apply → one revision bump → log. Authorship and
-- source always come from the session and the server, never from the payload.
begin;

create function private.try_uuid(value jsonb)
returns uuid language sql immutable set search_path = ''
as $$
  select case when jsonb_typeof(value) = 'string'
    and (value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (value #>> '{}')::uuid end;
$$;
revoke all on function private.try_uuid(jsonb) from public, anon, authenticated;
grant execute on function private.try_uuid(jsonb) to authenticated;

-- Plain text, 1–500 characters, not blank. Never truncated.
create function private.valid_node_text(value jsonb)
returns text language sql immutable set search_path = ''
as $$
  select case when jsonb_typeof(value) = 'string'
    and char_length(value #>> '{}') between 1 and 500 and btrim(value #>> '{}') <> ''
    then value #>> '{}' end;
$$;
revoke all on function private.valid_node_text(jsonb) from public, anon, authenticated;
grant execute on function private.valid_node_text(jsonb) to authenticated;

create function private.node_json(n public.nodes)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object('id', n.id, 'parentId', n.parent_id, 'text', n.text, 'sortOrder', n.sort_order,
    'createdBy', n.created_by, 'updatedBy', n.updated_by, 'source', n.source);
$$;
revoke all on function private.node_json(public.nodes) from public, anon, authenticated;
grant execute on function private.node_json(public.nodes) to authenticated;

create function private.apply_map_command(p_map_id uuid, p_operation_id uuid, p_editor_session_id uuid,
  p_expected_revision bigint, p_kind text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
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
begin
  if actor is null then raise exception using message = 'UNAUTHENTICATED'; end if;
  if p_map_id is null or p_operation_id is null or p_editor_session_id is null or p_expected_revision is null
     or p_kind is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using message = 'VALIDATION';
  end if;
  -- Unknown commands and unknown fields (created_by, source, sortOrder…) are rejected.
  allowed := case p_kind when 'add_child' then array['nodeId', 'parentId', 'text']
                         when 'edit_text' then array['nodeId', 'text'] end;
  if allowed is null or exists (select 1 from jsonb_object_keys(p_payload) k where k <> all (allowed))
     or (select count(*) from jsonb_object_keys(p_payload)) <> cardinality(allowed) then
    raise exception using message = 'VALIDATION';
  end if;
  hash := md5(jsonb_build_object('kind', p_kind, 'map_id', p_map_id, 'expected_revision', p_expected_revision, 'payload', p_payload)::text);

  -- Same order as create_map: operation id first, then the map row.
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  -- Someone else's map and a missing one are indistinguishable.
  select m.* into target from public.maps m
  where m.id = p_map_id and m.deleted_at is null and private.is_active_member(m.workspace_id)
  for update of m;
  if not found then raise exception using message = 'NOT_FOUND'; end if;

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
  v_text := private.valid_node_text(p_payload -> 'text');
  if v_node_id is null or v_text is null then raise exception using message = 'VALIDATION'; end if;

  if p_kind = 'add_child' then
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
    'changedNodes', jsonb_build_array(private.node_json(changed)), 'deletedNodeIds', '[]'::jsonb,
    'mapPatch', jsonb_build_object('revision', target.revision, 'updatedBy', actor, 'updatedAt', target.updated_at));
  insert into public.map_operations (id, map_id, workspace_id, actor_id, editor_session_id, kind, base_revision, result_revision, request_hash, before_data, after_data)
  values (p_operation_id, p_map_id, target.workspace_id, actor, p_editor_session_id, p_kind, p_expected_revision, target.revision, hash,
    case when before_node.id is null then null else jsonb_build_object('nodes', jsonb_build_array(private.node_json(before_node))) end,
    result);
  return result;
end;
$$;
revoke all on function private.apply_map_command(uuid, uuid, uuid, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function private.apply_map_command(uuid, uuid, uuid, bigint, text, jsonb) to authenticated;

create function public.apply_map_command(p_map_id uuid, p_operation_id uuid, p_editor_session_id uuid,
  p_expected_revision bigint, p_kind text, p_payload jsonb)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.apply_map_command(p_map_id, p_operation_id, p_editor_session_id, p_expected_revision, p_kind, p_payload); $$;
revoke all on function public.apply_map_command(uuid, uuid, uuid, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_map_command(uuid, uuid, uuid, bigint, text, jsonb) to authenticated;

-- Document read now also names the people shown as creator/last editor (RLS keeps
-- inactive colleagues identifiable to active members).
create or replace function public.get_map_document(p_map_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'map', jsonb_build_object('id', m.id, 'workspaceId', m.workspace_id, 'title', m.title, 'ownerId', m.owner_id,
      'ownerName', p.display_name, 'revision', m.revision, 'createdAt', m.created_at, 'updatedAt', m.updated_at),
    'nodes', coalesce((
      select jsonb_agg(private.node_json(n) order by n.sort_order, n.created_at)
      from public.nodes n where n.map_id = m.id), '[]'::jsonb),
    'people', coalesce((
      select jsonb_object_agg(pp.id, pp.display_name) from public.profiles pp
      where pp.id = m.owner_id or pp.id in (select created_by from public.nodes where map_id = m.id union select updated_by from public.nodes where map_id = m.id)),
      '{}'::jsonb))
  from public.maps m left join public.profiles p on p.id = m.owner_id
  where m.id = p_map_id and m.deleted_at is null;
$$;
revoke all on function public.get_map_document(uuid) from public, anon, authenticated;
grant execute on function public.get_map_document(uuid) to authenticated;
commit;
