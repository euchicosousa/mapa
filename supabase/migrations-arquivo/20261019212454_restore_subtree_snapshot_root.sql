begin;

create or replace function private.apply_map_history(p_map_id uuid, p_operation_id uuid, p_editor_session_id uuid,
  p_expected_revision bigint, p_mode text, p_target_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target_map public.maps;
  original public.map_operations;
  latest public.map_operations;
  previous public.map_operations;
  hash text;
  item jsonb;
  affected jsonb := '[]'::jsonb;
  removed uuid[] := '{}'::uuid[];
  result jsonb;
  operation_kind text;
begin
  if actor is null then raise exception using message = 'UNAUTHENTICATED'; end if;
  if p_map_id is null or p_operation_id is null or p_editor_session_id is null or p_target_operation_id is null
    or p_expected_revision is null or p_mode not in ('undo','redo') then
    raise exception using message = 'VALIDATION';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into previous from public.map_operations where id = p_operation_id;
  hash := md5(jsonb_build_object('kind',p_mode,'mapId',p_map_id,'targetOperationId',p_target_operation_id)::text);
  if found then
    if previous.actor_id <> actor or previous.editor_session_id <> p_editor_session_id
      or previous.request_hash <> hash then raise exception using message = 'CONFLICT'; end if;
    return previous.after_data;
  end if;

  select * into target_map from public.maps m where m.id = p_map_id and m.deleted_at is null
    and private.is_active_member(m.workspace_id) for update;
  if not found then raise exception using message = 'NOT_FOUND'; end if;
  if target_map.revision <> p_expected_revision then raise exception using message = 'CONFLICT'; end if;
  select * into original from public.map_operations where id = p_target_operation_id and map_id = p_map_id;
  if not found or original.actor_id <> actor or original.editor_session_id <> p_editor_session_id
    or original.kind not in ('add_child','edit_text','delete_subtree') then
    raise exception using message = 'CONFLICT';
  end if;
  select * into latest from public.map_operations where map_id = p_map_id
    order by result_revision desc, created_at desc limit 1;
  if p_mode = 'undo' then
    if latest.id <> original.id and not (latest.kind = 'redo' and latest.undone_operation_id = original.id) then
      raise exception using message = 'CONFLICT';
    end if;
  elsif latest.kind <> 'undo' or latest.undone_operation_id <> original.id then
    raise exception using message = 'CONFLICT';
  end if;

  -- before_data/after_data are server-created. Only restore node rows from that log.
  if (p_mode = 'undo' and original.kind = 'add_child') or (p_mode = 'redo' and original.kind = 'delete_subtree') then
    if original.kind = 'add_child' then
      removed := array[(original.after_data #>> '{changedNodes,0,id}')::uuid];
    else
      select coalesce(array_agg((value->>'id')::uuid), '{}'::uuid[]) into removed
      from jsonb_array_elements(original.before_data->'nodes');
    end if;
    delete from public.nodes where map_id = p_map_id and id = any(removed);
  elsif (p_mode = 'undo' and original.kind = 'edit_text') or (p_mode = 'redo' and original.kind = 'add_child') or (p_mode = 'redo' and original.kind = 'edit_text') then
    item := case when p_mode = 'undo' then original.before_data->'nodes'->0 else original.after_data->'changedNodes'->0 end;
    if item is null then raise exception using message = 'CONFLICT'; end if;
    if p_mode = 'redo' and original.kind = 'add_child' then
      insert into public.nodes(id,map_id,parent_id,text,sort_order,created_by,updated_by,source)
      values((item->>'id')::uuid,p_map_id,(item->>'parentId')::uuid,item->>'text',(item->>'sortOrder')::integer,
        (item->>'createdBy')::uuid,(item->>'updatedBy')::uuid,item->>'source');
    else
      update public.nodes set text=item->>'text', sort_order=(item->>'sortOrder')::integer,
        created_by=(item->>'createdBy')::uuid, updated_by=(item->>'updatedBy')::uuid, source=item->>'source', updated_at=now()
      where id=(item->>'id')::uuid and map_id=p_map_id;
      if not found then raise exception using message = 'CONFLICT'; end if;
    end if;
    affected := jsonb_build_array(private.node_json((select n from public.nodes n where n.map_id=p_map_id and n.id=(item->>'id')::uuid)));
  elsif (p_mode = 'undo' and original.kind = 'delete_subtree') then
    for item in
      with recursive saved as (
        select candidate.value, (candidate.value->>'id')::uuid id, (candidate.value->>'parentId')::uuid parent_id, 0 depth
        from jsonb_array_elements(original.before_data->'nodes') candidate(value)
        where not exists (select 1 from jsonb_array_elements(original.before_data->'nodes') saved(value)
          where saved.value->>'id' = candidate.value->>'parentId')
        union all
        select child.value, (child.value->>'id')::uuid, (child.value->>'parentId')::uuid, parent.depth+1
        from saved parent join lateral jsonb_array_elements(original.before_data->'nodes') child(value)
          on (child.value->>'parentId')::uuid=parent.id
      ) select value from saved order by depth
    loop
      insert into public.nodes(id,map_id,parent_id,text,sort_order,created_by,updated_by,source)
      values((item->>'id')::uuid,p_map_id,(item->>'parentId')::uuid,item->>'text',(item->>'sortOrder')::integer,
        (item->>'createdBy')::uuid,(item->>'updatedBy')::uuid,item->>'source');
      affected := affected || jsonb_build_array(private.node_json((select n from public.nodes n where n.map_id=p_map_id and n.id=(item->>'id')::uuid)));
    end loop;
    if jsonb_array_length(affected) <> jsonb_array_length(original.before_data->'nodes') then
      raise exception using message = 'CONFLICT';
    end if;
  else
    raise exception using message = 'VALIDATION';
  end if;

  update public.maps set revision=revision+1,updated_by=actor,updated_at=now() where id=p_map_id returning * into target_map;
  operation_kind := p_mode;
  result := jsonb_build_object('operationId',p_operation_id,'revision',target_map.revision,
    'changedNodes',affected,'deletedNodeIds',to_jsonb(removed),
    'mapPatch',jsonb_build_object('revision',target_map.revision,'updatedBy',actor,'updatedAt',target_map.updated_at));
  insert into public.map_operations(id,map_id,workspace_id,actor_id,editor_session_id,kind,base_revision,result_revision,
    request_hash,before_data,after_data,undone_operation_id)
  values(p_operation_id,p_map_id,target_map.workspace_id,actor,p_editor_session_id,operation_kind,p_expected_revision,
    target_map.revision,hash,null,result,p_target_operation_id);
  return result;
end;
$$;
revoke all on function private.apply_map_history(uuid,uuid,uuid,bigint,text,uuid) from public,anon,authenticated;
grant execute on function private.apply_map_history(uuid,uuid,uuid,bigint,text,uuid) to authenticated;

create or replace function public.apply_map_history(p_map_id uuid, p_operation_id uuid, p_editor_session_id uuid,
  p_expected_revision bigint, p_mode text, p_target_operation_id uuid)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.apply_map_history(p_map_id,p_operation_id,p_editor_session_id,p_expected_revision,p_mode,p_target_operation_id); $$;
revoke all on function public.apply_map_history(uuid,uuid,uuid,bigint,text,uuid) from public,anon,authenticated;
grant execute on function public.apply_map_history(uuid,uuid,uuid,bigint,text,uuid) to authenticated;

commit;
