-- Qualify the CTE column against the existing PL/pgSQL depth variable.
-- Ticket 11. Structural commands use the existing authorized, revisioned transaction.
begin;

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
                         when 'reorder_siblings' then array['nodeId','targetIndex'] end;
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
  if v_node_id is null then raise exception using message = 'VALIDATION'; end if;
  if p_kind in ('add_child','edit_text') then
    v_text := private.valid_node_text(p_payload -> 'text');
    if v_text is null then raise exception using message = 'VALIDATION'; end if;
  end if;

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
    'changedNodes', case when p_kind = 'delete_subtree' then '[]'::jsonb when p_kind in ('move_subtree','reorder_siblings') then affected else jsonb_build_array(private.node_json(changed)) end,
    'deletedNodeIds', coalesce(deleted_ids, '[]'::jsonb),
    'mapPatch', jsonb_build_object('revision', target.revision, 'updatedBy', actor, 'updatedAt', target.updated_at));
  insert into public.map_operations (id, map_id, workspace_id, actor_id, editor_session_id, kind, base_revision, result_revision, request_hash, before_data, after_data)
  values (p_operation_id, p_map_id, target.workspace_id, actor, p_editor_session_id, p_kind, p_expected_revision, target.revision, hash,
    case when p_kind in ('delete_subtree','move_subtree','reorder_siblings') then jsonb_build_object('nodes', before_snapshot)
         when before_node.id is null then null else jsonb_build_object('nodes', jsonb_build_array(private.node_json(before_node))) end,
    result);
  return result;
end;
$$;


commit;
