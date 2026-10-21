-- Recheck deletion after a concurrent lock wait, retaining the active-member reason.
begin;
create or replace function private.apply_map_history(p_map_id uuid, p_operation_id uuid, p_editor_session_id uuid,
  p_expected_revision bigint, p_mode text, p_target_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
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
  if not found then perform private.assert_map_not_deleted(p_map_id); raise exception using message = 'NOT_FOUND'; end if;

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
    or original.kind not in ('add_child','edit_text','delete_subtree','move_subtree','reorder_siblings','rename_map','set_project') then
    raise exception using message = 'CONFLICT';
  end if;

  select coalesce(max(o.result_revision), 0) into barrier from public.map_operations o
  where o.map_id = p_map_id and (o.actor_id <> actor or o.editor_session_id <> p_editor_session_id
    or o.kind not in ('add_child','edit_text','delete_subtree','move_subtree','reorder_siblings','rename_map','set_project','undo','redo'));
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

  if original.kind in ('rename_map','set_project') then
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
      insert into public.nodes(id,map_id,parent_id,text,sort_order,created_by,updated_by,source)
      values((item->>'id')::uuid,p_map_id,(item->>'parentId')::uuid,item->>'text',(item->>'sortOrder')::integer,
        (item->>'createdBy')::uuid,(item->>'updatedBy')::uuid,item->>'source');
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
      insert into public.nodes(id,map_id,parent_id,text,sort_order,created_by,updated_by,source)
      values((item->>'id')::uuid,p_map_id,(item->>'parentId')::uuid,item->>'text',(item->>'sortOrder')::integer,
        (item->>'createdBy')::uuid,(item->>'updatedBy')::uuid,item->>'source');
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


commit;
