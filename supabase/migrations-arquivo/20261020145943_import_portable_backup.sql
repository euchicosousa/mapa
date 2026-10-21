-- Ticket 19: portable import shares the validated, atomic copy primitive.
begin;
create function private.validate_copy_nodes(p_nodes jsonb)
returns void language plpgsql security invoker set search_path = ''
as $$
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
$$;
revoke all on function private.validate_copy_nodes(jsonb) from public,anon,authenticated;

create or replace function private.insert_map_copy(p_source public.maps,p_operation_id uuid,p_editor_session_id uuid,
  p_title text,p_nodes jsonb,p_hash text,p_kind text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
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
create function private.import_map_backup(p_operation_id uuid,p_editor_session_id uuid,p_backup jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid:=auth.uid();
  scopes uuid[];
  destination public.maps;
  previous public.map_operations;
  hash text;
  exported timestamptz;
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
  return private.insert_map_copy(destination,p_operation_id,p_editor_session_id,p_backup#>>'{map,title}',p_backup->'nodes',hash,'import_map');
end;
$$;
revoke all on function private.import_map_backup(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.import_map_backup(uuid,uuid,jsonb) to authenticated;
create function public.import_map_backup(p_operation_id uuid,p_editor_session_id uuid,p_backup jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.import_map_backup(p_operation_id,p_editor_session_id,p_backup); $$;
revoke all on function public.import_map_backup(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.import_map_backup(uuid,uuid,jsonb) to authenticated;
commit;
