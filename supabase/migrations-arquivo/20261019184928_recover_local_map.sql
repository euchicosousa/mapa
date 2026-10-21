-- Ticket 08: copy a validated local tree without overwriting the source map.
begin;
create function private.create_map_copy(p_source_map_id uuid, p_operation_id uuid,
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
  select m.* into source_map from public.maps m where m.id = p_source_map_id and m.deleted_at is null
    and private.is_active_member(m.workspace_id) for update of m;
  if not found then raise exception using message = 'NOT_FOUND'; end if;
  select * into previous from public.map_operations where id = p_operation_id;
  if found then
    if previous.actor_id <> actor or previous.request_hash <> hash then raise exception using message = 'CONFLICT'; end if;
    return previous.after_data;
  end if;

  select jsonb_object_agg((value->>'id')::uuid::text, gen_random_uuid()) into ids from jsonb_array_elements(p_nodes);
  insert into public.maps(workspace_id,title,owner_id,created_by,updated_by)
    values(source_map.workspace_id,p_title,actor,actor,actor) returning id into new_map;
  insert into public.nodes(id,map_id,parent_id,text,sort_order,created_by,updated_by,source)
    select (ids->>((value->>'id')::uuid::text))::uuid, new_map, (ids->>((value->>'parentId')::uuid::text))::uuid, value->>'text',
      (row_number() over (partition by value->>'parentId' order by (value->>'sortOrder')::integer, value->>'id') - 1)::integer,
      actor, actor, 'manual' from jsonb_array_elements(p_nodes);
  result := jsonb_build_object('operationId',p_operation_id,'mapId',new_map,'revision',1);
  insert into public.map_operations(id,map_id,workspace_id,actor_id,editor_session_id,kind,base_revision,result_revision,request_hash,after_data)
    values(p_operation_id,new_map,source_map.workspace_id,actor,p_editor_session_id,'create_map_copy',null,1,hash,result);
  return result;
end;
$$;
revoke all on function private.create_map_copy(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.create_map_copy(uuid,uuid,uuid,text,jsonb) to authenticated;
create function public.create_map_copy(p_source_map_id uuid, p_operation_id uuid,
  p_editor_session_id uuid, p_title text, p_nodes jsonb)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.create_map_copy(p_source_map_id,p_operation_id,p_editor_session_id,p_title,p_nodes); $$;
revoke all on function public.create_map_copy(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_map_copy(uuid,uuid,uuid,text,jsonb) to authenticated;
commit;
