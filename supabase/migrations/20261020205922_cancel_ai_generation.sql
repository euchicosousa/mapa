begin;
-- Same order as finalization: job, map, active membership. Terminal states never
-- move back to running and cancellation does not mutate document/history rows.
create function private.cancel_ai_generation(p_map_id uuid,p_generation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); j public.ai_generations; m public.maps;
begin
  if actor is null then raise exception using message='UNAUTHENTICATED'; end if;
  if p_map_id is null or p_generation_id is null then raise exception using message='VALIDATION'; end if;
  if not private.can_read_map(p_map_id) then raise exception using message='NOT_FOUND'; end if;
  select * into j from public.ai_generations where id=p_generation_id and map_id=p_map_id and requested_by=actor for update;
  if not found then raise exception using message='NOT_FOUND'; end if;
  select * into m from public.maps where id=p_map_id and deleted_at is null for share;
  if not found then raise exception using message='NOT_FOUND'; end if;
  perform 1 from public.workspace_members where workspace_id=m.workspace_id and user_id=actor and status='active' for share;
  if not found then raise exception using message='NOT_FOUND'; end if;
  if j.state in ('pending','running') then
    update public.ai_generations set
      state=case when expires_at<=clock_timestamp() then 'failed' else 'cancelled' end,
      error_code=case when expires_at<=clock_timestamp() then 'EXPIRED' else null end,
      finished_at=clock_timestamp()
    where id=j.id returning * into j;
  end if;
  return private.ai_job_json(j);
end; $$;
revoke all on function private.cancel_ai_generation(uuid,uuid) from public,anon,authenticated;
grant execute on function private.cancel_ai_generation(uuid,uuid) to authenticated;
create function public.cancel_ai_generation(p_map_id uuid,p_generation_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.cancel_ai_generation(p_map_id,p_generation_id); $$;
revoke all on function public.cancel_ai_generation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancel_ai_generation(uuid,uuid) to authenticated;

create or replace function private.finish_ai_generation(p_generation_id uuid,p_children jsonb,p_usage jsonb,p_error text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.ai_generations; m public.maps; item jsonb; n public.nodes; context jsonb; affected jsonb:='[]';
  texts text[]; sibling_texts text[]; pos integer; base bigint; depth integer;
begin
  select * into j from public.ai_generations where id=p_generation_id for update;
  if not found then raise exception using message='NOT_FOUND'; end if;
  if j.state not in ('pending','running') then
    -- A late worker may reconcile billed usage, but cannot revive a terminal job.
    if j.usage is null and p_usage is not null then
      update public.ai_generations set usage=p_usage where id=j.id returning * into j;
    end if;
    return private.ai_job_json(j);
  end if;
  select * into m from public.maps where id=j.map_id for update;
  if p_error is not null or j.expires_at<=clock_timestamp() then
    update public.ai_generations set state='failed',finished_at=now(),error_code=case when expires_at<=clock_timestamp() then 'EXPIRED' else p_error end,usage=p_usage where id=j.id returning * into j;
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
  update public.ai_generations set state='applied',finished_at=now(),applied_operation_id=id,result=null,usage=p_usage where id=j.id returning * into j;
  return private.ai_job_json(j);
end; $$;
revoke all on function private.finish_ai_generation(uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function private.finish_ai_generation(uuid,jsonb,jsonb,text) to service_role;

create or replace function private.reserve_ai_generation(p_actor uuid,p_map_id uuid,p_parent_node_id uuid,p_generation_id uuid,
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
    where requested_by=p_actor and state in ('pending','running') and expires_at<=clock_timestamp();
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

create or replace function private.get_ai_generation(p_map_id uuid,p_generation_id uuid,p_editor_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.ai_generations;
begin
  if auth.uid() is null then raise exception using message='UNAUTHENTICATED'; end if;
  if not private.can_read_map(p_map_id) then raise exception using message='NOT_FOUND'; end if;
  update public.ai_generations set state='failed',error_code='EXPIRED',finished_at=now()
    where map_id=p_map_id and requested_by=auth.uid() and state in ('pending','running') and expires_at<=clock_timestamp();
  select * into j from public.ai_generations where map_id=p_map_id and requested_by=auth.uid()
    and (case when p_generation_id is not null then id=p_generation_id else editor_session_id=p_editor_session_id end)
    order by created_at desc limit 1;
  return case when j.id is null then null else private.ai_job_json(j) end;
end; $$;
revoke all on function private.get_ai_generation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.get_ai_generation(uuid,uuid,uuid) to authenticated;

commit;
