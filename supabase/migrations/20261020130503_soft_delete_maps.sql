-- Ticket 17: versioned soft deletion, restricted replay and local-draft reason.
begin;
create function private.assert_map_not_deleted(p_map_id uuid)
returns void language plpgsql stable security definer set search_path=''
as $$
begin
  if auth.uid() is null then raise exception using message='UNAUTHENTICATED'; end if;
  if exists(select 1 from public.maps m where m.id=p_map_id and m.deleted_at is not null and private.is_active_member(m.workspace_id)) then
    -- This reason contains no map content and is visible only to active colleagues.
    raise exception using message='NOT_FOUND',detail='MAP_DELETED';
  end if;
end;
$$;
revoke all on function private.assert_map_not_deleted(uuid) from public,anon,authenticated;
grant execute on function private.assert_map_not_deleted(uuid) to authenticated;

create or replace function private.apply_map_command(p_map_id uuid, p_operation_id uuid, p_editor_session_id uuid,
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
$$;



-- Transfer is an authorization boundary, not a reversible content edit.
-- Rebuild the session's stacks from the immutable log, after its latest external
-- change. A new action clears redo; no browser snapshot is accepted.
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


create or replace function public.get_map_document(p_map_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
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
revoke all on function public.get_map_document(uuid) from public, anon, authenticated;
grant execute on function public.get_map_document(uuid) to authenticated;

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

commit;
