-- Ticket 20: server-owned generation jobs. Product access stays closed until 22.
begin;
create table private.ai_validation_access (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  expires_at timestamptz not null
);
alter table private.ai_validation_access enable row level security;
revoke all on private.ai_validation_access from public, anon, authenticated;
grant all on private.ai_validation_access to service_role;

create table public.ai_generations (
  id uuid primary key,
  map_id uuid not null references public.maps(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  parent_node_id uuid not null,
  requested_by uuid not null references public.profiles(id),
  editor_session_id uuid not null,
  request_hash text not null,
  context_fingerprint text not null,
  state text not null check(state in ('pending','running','applied','failed','cancelled','stale')),
  model text not null,
  usage jsonb,
  reserved_tokens integer not null check(reserved_tokens > 0),
  error_code text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz not null default now()+interval '2 minutes',
  applied_operation_id uuid,
  result jsonb
);
create index ai_generations_map_idx on public.ai_generations(map_id,created_at desc);
create index ai_generations_workspace_usage_idx on public.ai_generations(workspace_id,created_at);
create unique index ai_generations_one_active_user on public.ai_generations(requested_by) where state in ('pending','running');
alter table public.ai_generations enable row level security;
revoke all on public.ai_generations from public,anon,authenticated;
grant select(id,map_id,parent_node_id,requested_by,editor_session_id,state,created_at,finished_at,error_code,applied_operation_id) on public.ai_generations to authenticated;
grant all on public.ai_generations to service_role;
create policy ai_generation_read on public.ai_generations for select to authenticated
  using(requested_by=(select auth.uid()) and private.can_read_map(map_id));

create function private.ai_generation_available(p_actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.ai_validation_access where user_id=p_actor and expires_at>now());
$$;
revoke all on function private.ai_generation_available(uuid) from public,anon,authenticated;
grant execute on function private.ai_generation_available(uuid) to service_role;
create function public.ai_generation_available(p_actor uuid) returns boolean language sql security invoker set search_path='' as $$ select private.ai_generation_available(p_actor); $$;
revoke all on function public.ai_generation_available(uuid) from public,anon,authenticated;
grant execute on function public.ai_generation_available(uuid) to service_role;

create function private.ai_context(p_map uuid,p_parent uuid) returns jsonb
language sql stable set search_path='' as $$
  with recursive path as (
    select id,parent_id,text,0 depth from public.nodes where map_id=p_map and id=p_parent
    union all
    select n.id,n.parent_id,n.text,p.depth+1 from public.nodes n join path p on p.parent_id=n.id where n.map_id=p_map and p.depth<31
  ) select jsonb_build_object('title',(select title from public.maps where id=p_map),
    'path',coalesce((select jsonb_agg(jsonb_build_object('id',id,'text',text) order by depth desc) from path),'[]'),
    'children',coalesce((select jsonb_agg(jsonb_build_object('id',id,'text',text) order by sort_order,id) from public.nodes where map_id=p_map and parent_id=p_parent),'[]'));
$$;
revoke all on function private.ai_context(uuid,uuid) from public,anon,authenticated;

create function private.ai_job_json(j public.ai_generations) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',j.id,'mapId',j.map_id,'parentNodeId',j.parent_node_id,'editorSessionId',j.editor_session_id,
    'state',j.state,'errorCode',j.error_code,'result',j.result);
$$;
revoke all on function private.ai_job_json(public.ai_generations) from public,anon,authenticated;

-- Only the Edge Function's service credential can reserve/claim a paid call.
create function private.reserve_ai_generation(p_actor uuid,p_map_id uuid,p_parent_node_id uuid,p_generation_id uuid,
  p_editor_session_id uuid,p_guidance text,p_model text,p_daily_budget integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.maps; j public.ai_generations; context jsonb; hash text; depth integer;
begin
  if p_actor is null or p_map_id is null or p_parent_node_id is null or p_generation_id is null or p_editor_session_id is null
    or p_guidance is null or char_length(p_guidance)>1000 or p_model is null or btrim(p_model)=''
    or p_daily_budget is null or p_daily_budget<17000 then raise exception using message='VALIDATION'; end if;
  if not exists(select 1 from private.ai_validation_access where user_id=p_actor and expires_at>now()) then
    raise exception using message='AI_DISABLED'; end if;
  -- Serialize user claims, then workspace quotas, then map mutations.
  perform pg_advisory_xact_lock(hashtextextended('ai-user:'||p_actor::text,0));
  perform pg_advisory_xact_lock(hashtextextended('ai-job:'||p_generation_id::text,0));
  select * into m from public.maps where id=p_map_id and deleted_at is null;
  if not found or not exists(select 1 from public.workspace_members where workspace_id=m.workspace_id and user_id=p_actor and status='active') then
    raise exception using message='NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-workspace:'||m.workspace_id::text,0));
  update public.ai_generations set state='failed',error_code='EXPIRED',finished_at=now()
    where requested_by=p_actor and state in ('pending','running') and expires_at<=now();
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
  if exists(select 1 from public.ai_generations where requested_by=p_actor and state in ('pending','running')) then
    raise exception using message='AI_BUSY'; end if;
  if (select count(*) from public.ai_generations where requested_by=p_actor and created_at>now()-interval '1 minute')>=10
    or (select count(*) from public.ai_generations where workspace_id=m.workspace_id and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=100
    or (select coalesce(sum(coalesce((usage->>'total_tokens')::bigint,reserved_tokens)),0) from public.ai_generations
      where workspace_id=m.workspace_id and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')+17000>p_daily_budget then
    raise exception using message='AI_LIMIT'; end if;
  if not exists(select 1 from public.nodes where map_id=p_map_id and id=p_parent_node_id) then raise exception using message='VALIDATION'; end if;
  if (select count(*) from public.nodes where map_id=p_map_id)>496 then raise exception using message='LIMIT_EXCEEDED'; end if;
  with recursive path as (
    select id,parent_id,1 d from public.nodes where map_id=p_map_id and id=p_parent_node_id
    union all select n.id,n.parent_id,p.d+1 from public.nodes n join path p on n.id=p.parent_id where n.map_id=p_map_id and p.d<=31
  ) select max(d) into depth from path;
  if depth>30 then raise exception using message='LIMIT_EXCEEDED'; end if;
  context:=private.ai_context(p_map_id,p_parent_node_id);
  if char_length(context::text)>12000 then raise exception using message='AI_CONTEXT_TOO_LONG'; end if;
  insert into public.ai_generations(id,map_id,workspace_id,parent_node_id,requested_by,editor_session_id,request_hash,context_fingerprint,state,model,reserved_tokens)
    values(p_generation_id,p_map_id,m.workspace_id,p_parent_node_id,p_actor,p_editor_session_id,hash,md5(context::text),'running',p_model,17000) returning * into j;
  return private.ai_job_json(j)||jsonb_build_object('claimed',true,'context',context);
end; $$;
revoke all on function private.reserve_ai_generation(uuid,uuid,uuid,uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function private.reserve_ai_generation(uuid,uuid,uuid,uuid,uuid,text,text,integer) to service_role;
create function public.reserve_ai_generation(p_actor uuid,p_map_id uuid,p_parent_node_id uuid,p_generation_id uuid,p_editor_session_id uuid,p_guidance text,p_model text,p_daily_budget integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.reserve_ai_generation(p_actor,p_map_id,p_parent_node_id,p_generation_id,p_editor_session_id,p_guidance,p_model,p_daily_budget); $$;
revoke all on function public.reserve_ai_generation(uuid,uuid,uuid,uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.reserve_ai_generation(uuid,uuid,uuid,uuid,uuid,text,text,integer) to service_role;

create function private.finish_ai_generation(p_generation_id uuid,p_children jsonb,p_usage jsonb,p_error text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.ai_generations; m public.maps; item jsonb; n public.nodes; context jsonb; affected jsonb:='[]';
  texts text[]; sibling_texts text[]; pos integer; base bigint; depth integer;
begin
  select * into j from public.ai_generations where id=p_generation_id for update;
  if not found then raise exception using message='NOT_FOUND'; end if;
  if j.state not in ('pending','running') then return private.ai_job_json(j); end if;
  select * into m from public.maps where id=j.map_id for update;
  if p_error is not null or j.expires_at<=now() then
    update public.ai_generations set state='failed',finished_at=now(),error_code=case when expires_at<=now() then 'EXPIRED' else p_error end,usage=p_usage where id=j.id returning * into j;
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
  update public.ai_generations set state='applied',finished_at=now(),applied_operation_id=id,result=j.result,usage=p_usage where id=j.id returning * into j;
  return private.ai_job_json(j);
end; $$;
revoke all on function private.finish_ai_generation(uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function private.finish_ai_generation(uuid,jsonb,jsonb,text) to service_role;
create function public.finish_ai_generation(p_generation_id uuid,p_children jsonb,p_usage jsonb,p_error text)
returns jsonb language sql security invoker set search_path='' as $$ select private.finish_ai_generation(p_generation_id,p_children,p_usage,p_error); $$;
revoke all on function public.finish_ai_generation(uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_ai_generation(uuid,jsonb,jsonb,text) to service_role;

create function private.get_ai_generation(p_map_id uuid,p_generation_id uuid,p_editor_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.ai_generations;
begin
  if auth.uid() is null then raise exception using message='UNAUTHENTICATED'; end if;
  if not private.can_read_map(p_map_id) then raise exception using message='NOT_FOUND'; end if;
  update public.ai_generations set state='failed',error_code='EXPIRED',finished_at=now()
    where map_id=p_map_id and requested_by=auth.uid() and state in ('pending','running') and expires_at<=now();
  select * into j from public.ai_generations where map_id=p_map_id and requested_by=auth.uid()
    and (case when p_generation_id is not null then id=p_generation_id else editor_session_id=p_editor_session_id end)
    order by created_at desc limit 1;
  return case when j.id is null then null else private.ai_job_json(j) end;
end; $$;
revoke all on function private.get_ai_generation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.get_ai_generation(uuid,uuid,uuid) to authenticated;
create function public.get_ai_generation(p_map_id uuid,p_generation_id uuid,p_editor_session_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.get_ai_generation(p_map_id,p_generation_id,p_editor_session_id); $$;
revoke all on function public.get_ai_generation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_ai_generation(uuid,uuid,uuid) to authenticated;

create or replace function private.node_json(n public.nodes) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',n.id,'parentId',n.parent_id,'text',n.text,'sortOrder',n.sort_order,'createdBy',n.created_by,
 'updatedBy',n.updated_by,'source',n.source,'aiGenerationId',n.ai_generation_id);
$$;

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



commit;
