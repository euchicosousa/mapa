-- One insertion primitive for validated local recovery and locked remote snapshots.
begin;
create function private.insert_map_copy(p_source public.maps,p_operation_id uuid,p_editor_session_id uuid,
  p_title text,p_nodes jsonb,p_hash text,p_kind text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  ids jsonb;
  new_map uuid;
  result jsonb;
begin
  -- Internal only: callers authorize/lock, validate the tree and enforce idempotency.
  if actor is null then raise exception using message='UNAUTHENTICATED'; end if;
  select jsonb_object_agg((value->>'id')::uuid::text,gen_random_uuid()) into ids from jsonb_array_elements(p_nodes);
  insert into public.maps(workspace_id,project_id,title,owner_id,created_by,updated_by)
  values(p_source.workspace_id,case when p_kind='duplicate_map' then p_source.project_id else null end,p_title,actor,actor,actor)
  returning id into new_map;
  insert into public.nodes(id,map_id,parent_id,text,sort_order,created_by,updated_by,source)
  select (ids->>((value->>'id')::uuid::text))::uuid,new_map,(ids->>((value->>'parentId')::uuid::text))::uuid,value->>'text',
    case when p_kind='duplicate_map' then (value->>'sortOrder')::integer else
      (row_number() over(partition by value->>'parentId' order by (value->>'sortOrder')::integer,value->>'id')-1)::integer end,
    actor,actor,'manual' from jsonb_array_elements(p_nodes);
  result:=jsonb_build_object('operationId',p_operation_id,'mapId',new_map,'revision',1);
  -- Informational provenance only; never used to authorize access to the new map.
  insert into public.map_operations(id,map_id,workspace_id,actor_id,editor_session_id,kind,base_revision,result_revision,request_hash,before_data,after_data)
  values(p_operation_id,new_map,p_source.workspace_id,actor,p_editor_session_id,p_kind,null,1,p_hash,
    jsonb_build_object('sourceMapId',p_source.id,'sourceRevision',p_source.revision),result);
  return result;
end;
$$;
revoke all on function private.insert_map_copy(public.maps,uuid,uuid,text,jsonb,text,text) from public,anon,authenticated;

create or replace function private.create_map_copy(p_source_map_id uuid, p_operation_id uuid,
  p_editor_session_id uuid, p_title text, p_nodes jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
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
$$;

create function private.duplicate_map(p_source_map_id uuid,p_operation_id uuid,p_editor_session_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
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
revoke all on function private.duplicate_map(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.duplicate_map(uuid,uuid,uuid) to authenticated;
create function public.duplicate_map(p_source_map_id uuid,p_operation_id uuid,p_editor_session_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.duplicate_map(p_source_map_id,p_operation_id,p_editor_session_id); $$;
revoke all on function public.duplicate_map(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.duplicate_map(uuid,uuid,uuid) to authenticated;
commit;
