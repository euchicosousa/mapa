-- Synthetic provider output exists only inside a rolled-back transaction.
-- No provider call, permanent fixture, existing identity or real map is used.
begin;
do $$
declare actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); workspace uuid:=gen_random_uuid(); session uuid:=gen_random_uuid();
  made jsonb; root uuid; v_map uuid; v_gen uuid; first jsonb; next jsonb; finished jsonb; result jsonb; texts jsonb;
  revision bigint; saved_nodes jsonb;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(actor,'sql-ai-validation-'||actor::text||'@example.com','{"display_name":"AI transaction validation"}');
  insert into auth.users(id,email,raw_user_meta_data) values(outsider,'sql-ai-outsider-'||outsider::text||'@example.com','{}');
  insert into public.workspaces(id,name) values(workspace,'Temporary SQL AI transaction');
  insert into public.workspace_members(workspace_id,user_id,role,status) values(workspace,actor,'admin','active');
  insert into private.ai_validation_access(user_id,expires_at) values(actor,now()+interval '1 hour');
  perform set_config('request.jwt.claim.sub',actor::text,true);
  made:=public.create_map(workspace,gen_random_uuid(),session,'AI transaction test'); v_map:=(made->>'mapId')::uuid;
  select id into root from public.nodes where public.nodes.map_id=v_map and parent_id is null;
  v_gen:=gen_random_uuid();
  first:=private.reserve_ai_generation(actor,v_map,root,v_gen,session,'','test-only',50000);
  next:=private.reserve_ai_generation(actor,v_map,root,v_gen,session,'','test-only',50000);
  if first->>'claimed'<>'true' or next->>'claimed'<>'false' then raise exception 'Duplicate claim'; end if;
  begin
    perform private.reserve_ai_generation(actor,v_map,root,gen_random_uuid(),session,'','test-only',50000);
    raise exception 'Active-user limit missing';
  exception when others then if sqlerrm<>'AI_BUSY' then raise;end if;end;
  texts:='[{"text":"Planejar"},{"text":"Executar"},{"text":"Medir"},{"text":"Ajustar"}]';
  finished:=private.finish_ai_generation(v_gen,texts,'{"input_tokens":100,"output_tokens":50,"total_tokens":150}',null);
  if finished->>'state'<>'applied' or (select count(*) from public.nodes n where n.map_id=v_map)<>5 then raise exception 'Invalid batch';end if;
  if exists(select 1 from public.nodes n where n.map_id=v_map and n.parent_id=root and (source<>'ai' or created_by<>actor or ai_generation_id<>v_gen)) then raise exception 'Forged provenance';end if;
  next:=private.finish_ai_generation(v_gen,texts,null,null);
  if next<>finished then raise exception 'Non-idempotent finalization';end if;
  select jsonb_agg(private.node_json(n) order by n.id) into saved_nodes from public.nodes n where n.map_id=v_map;
  result:=public.apply_map_history(v_map,gen_random_uuid(),session,2,'undo',v_gen);
  if (select count(*) from public.nodes n where n.map_id=v_map)<>1 then raise exception 'Undo must remove batch';end if;
  result:=public.apply_map_history(v_map,gen_random_uuid(),session,3,'redo',v_gen);
  if (select jsonb_agg(private.node_json(n) order by n.id) from public.nodes n where n.map_id=v_map)<>saved_nodes then raise exception 'Redo changed provenance';end if;
  -- Synthetic known usage releases each fixture reservation within the approved cap.
  -- Changed relevant context becomes stale, with zero insertion.
  v_gen:=gen_random_uuid();first:=private.reserve_ai_generation(actor,v_map,root,v_gen,session,'','test-only',50000);
  perform public.apply_map_command(v_map,gen_random_uuid(),session,4,'edit_text',jsonb_build_object('nodeId',root,'text','Changed context'));
  finished:=private.finish_ai_generation(v_gen,texts,'{"input_tokens":100,"output_tokens":50,"total_tokens":150}',null);
  if finished->>'state'<>'stale' or (select count(*) from public.nodes n where n.map_id=v_map)<>5 then raise exception 'Stale context applied';end if;
  -- Failed output cannot leave any partial insertions.
  v_gen:=gen_random_uuid();first:=private.reserve_ai_generation(actor,v_map,root,v_gen,session,'','test-only',50000);
  begin
    perform private.finish_ai_generation(v_gen,'[{"text":"A"},{"text":" a "},{"text":"C"},{"text":"D"}]',null,null);
    raise exception 'Invalid duplicate output accepted';
  exception when others then if sqlerrm<>'VALIDATION' then raise;end if;end;
  finished:=private.finish_ai_generation(v_gen,null,'{"input_tokens":100,"output_tokens":50,"total_tokens":150}','INVALID_OUTPUT');
  if finished->>'state'<>'failed' or (select count(*) from public.nodes n where n.map_id=v_map)<>5 then raise exception 'Failed job inserted nodes';end if;
  -- Revocation is checked again immediately before commit.
  v_gen:=gen_random_uuid();first:=private.reserve_ai_generation(actor,v_map,root,v_gen,session,'','test-only',50000);
  update public.workspace_members set status='inactive' where workspace_id=workspace and user_id=actor;
  finished:=private.finish_ai_generation(v_gen,texts,'{"input_tokens":100,"output_tokens":50,"total_tokens":150}',null);
  if finished->>'state'<>'stale' then raise exception 'Revoked user applied nodes';end if;
  update public.workspace_members set status='active' where workspace_id=workspace and user_id=actor;
  -- Work in another branch does not invalidate the relevant fingerprint.
  declare parent uuid; sibling uuid; before_revision bigint;
  begin
    select n.id into parent from public.nodes n where n.map_id=v_map and n.parent_id=root order by sort_order limit 1;
    select n.id into sibling from public.nodes n where n.map_id=v_map and n.parent_id=root and n.id<>parent order by sort_order limit 1;
    v_gen:=gen_random_uuid();first:=private.reserve_ai_generation(actor,v_map,parent,v_gen,session,'','test-only',50000);
    select m.revision into before_revision from public.maps m where m.id=v_map;
    perform public.apply_map_command(v_map,gen_random_uuid(),session,before_revision,'edit_text',jsonb_build_object('nodeId',sibling,'text','Other branch changed'));
    finished:=private.finish_ai_generation(v_gen,texts,'{"input_tokens":100,"output_tokens":50,"total_tokens":150}',null);
    if finished->>'state'<>'applied' or (select count(*) from public.nodes n where n.map_id=v_map)<>9 then raise exception 'Unrelated branch blocked safe commit';end if;
  end;
  -- Identical caller id with a different payload never starts another provider call.
  begin
    perform private.reserve_ai_generation(actor,v_map,root,v_gen,session,'Different request','test-only',50000);
    raise exception 'Generation request hash not enforced';
  exception when others then if sqlerrm<>'CONFLICT' then raise;end if;end;
  -- Expired workers cannot commit late output.
  v_gen:=gen_random_uuid();first:=private.reserve_ai_generation(actor,v_map,root,v_gen,session,'','test-only',50000);
  update public.ai_generations set expires_at=now()-interval '1 second' where id=v_gen;
  finished:=private.finish_ai_generation(v_gen,texts,'{"input_tokens":100,"output_tokens":50,"total_tokens":150}',null);
  if finished->>'state'<>'failed' or finished->>'errorCode'<>'EXPIRED' then raise exception 'Expired worker committed';end if;
  -- Conservative reservations bound daily use even when provider usage is unknown.
  begin
    perform private.reserve_ai_generation(actor,v_map,root,gen_random_uuid(),session,'','test-only',17000);
    raise exception 'Daily token budget not enforced';
  exception when others then if sqlerrm<>'AI_BUDGET_LIMIT' then raise;end if;end;
  -- A nearly full map must reject the request before a provider claim.
  insert into public.nodes(map_id,parent_id,text,sort_order,created_by,updated_by,source)
    select v_map,root,'Capacity fixture '||i::text,100+i,actor,actor,'manual' from generate_series(1,488) i;
  begin
    perform private.reserve_ai_generation(actor,v_map,root,gen_random_uuid(),session,'','test-only',50000);
    raise exception 'Capacity reserve not enforced';
  exception when others then if sqlerrm<>'LIMIT_EXCEEDED' then raise;end if;end;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  begin
    perform public.get_ai_generation(v_map,v_gen,session);raise exception 'Outside user read job';
  exception when others then if sqlerrm<>'NOT_FOUND' then raise;end if;end;
end;$$;
rollback;
