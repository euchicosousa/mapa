-- Validate the full tree at the shared insertion boundary, including remote snapshots.
begin;
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
  if jsonb_typeof(p_nodes) is distinct from 'array' then raise exception using message='VALIDATION'; end if;
  total:=jsonb_array_length(p_nodes);
  if total<1 then raise exception using message='VALIDATION'; end if;
  if total>500 then raise exception using message='LIMIT_EXCEEDED'; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_nodes))<>total
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
commit;
