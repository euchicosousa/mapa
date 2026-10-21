begin;
create or replace function private.ai_job_json(j public.ai_generations) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',j.id,'mapId',j.map_id,'parentNodeId',j.parent_node_id,'editorSessionId',j.editor_session_id,
    'state',j.state,'errorCode',j.error_code,'result',(select after_data from public.map_operations where id=j.applied_operation_id));
$$;
revoke all on function private.ai_job_json(public.ai_generations) from public,anon,authenticated;


create or replace function private.finish_ai_generation(p_generation_id uuid,p_children jsonb,p_usage jsonb,p_error text)
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
  update public.ai_generations set state='applied',finished_at=now(),applied_operation_id=id,result=null,usage=p_usage where id=j.id returning * into j;
  return private.ai_job_json(j);
end; $$;
revoke all on function private.finish_ai_generation(uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function private.finish_ai_generation(uuid,jsonb,jsonb,text) to service_role;

commit;
