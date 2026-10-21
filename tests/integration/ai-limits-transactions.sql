-- All counter/boundary fixtures exist only in this rolled-back transaction.
begin;
do $$
declare actor uuid:=gen_random_uuid(); colleague uuid:=gen_random_uuid(); workspace uuid:=gen_random_uuid(); session uuid:=gen_random_uuid();
  made jsonb; target_map uuid; root uuid; id uuid; other_id uuid; claimed jsonb; snapshot private.ai_usage_days;
  today date:=private.ai_utc_day(clock_timestamp()); yesterday date; before_count integer; before_tokens bigint; item integer;
begin
  if private.ai_utc_day('2026-10-20 23:59:59.999999+00')<>'2026-10-20'::date or private.ai_utc_day('2026-10-21 00:00:00+00')<>'2026-10-21'::date
    or private.ai_utc_day('2026-10-20 21:00:00-03')<>'2026-10-21'::date then raise exception 'UTC boundary incorrect'; end if;
  insert into auth.users(id,email,raw_user_meta_data) values(actor,'sql-limits-'||actor::text||'@example.com','{}'),(colleague,'sql-limits-'||colleague::text||'@example.com','{}');
  insert into public.workspaces(id,name) values(workspace,'Temporary AI quota transaction');
  insert into public.workspace_members(workspace_id,user_id,role,status) values(workspace,actor,'admin','active'),(workspace,colleague,'member','active');
  insert into private.ai_validation_access(user_id,expires_at) values(actor,clock_timestamp()+interval '1 hour'),(colleague,clock_timestamp()+interval '1 hour');
  perform set_config('request.jwt.claim.sub',actor::text,true);
  made:=public.create_map(workspace,gen_random_uuid(),session,'Quota transaction');target_map:=(made->>'mapId')::uuid;
  select n.id into root from public.nodes n where n.map_id=target_map and parent_id is null;
  id:=gen_random_uuid();
  claimed:=private.reserve_ai_generation(actor,target_map,root,id,session,'','test-only',50000);
  if claimed->>'claimed'<>'true' then raise exception 'Claim missing'; end if;
  select * into snapshot from private.ai_usage_days where workspace_id=workspace and usage_day=today;
  if snapshot.generation_count<>1 or snapshot.accounted_tokens<>17000 then raise exception 'Initial reserve incorrect'; end if;
  perform private.reserve_ai_generation(actor,target_map,root,id,session,'','test-only',50000);
  if (select generation_count from private.ai_usage_days where workspace_id=workspace and usage_day=today)<>1 then raise exception 'Replay debited twice'; end if;
  perform public.cancel_ai_generation(target_map,id);
  if (select accounted_tokens from private.ai_usage_days where workspace_id=workspace and usage_day=today)<>17000 then raise exception 'Cancellation refunded unknown usage'; end if;
  perform private.finish_ai_generation(id,null,null,'TIMEOUT');
  if (select accounted_tokens from private.ai_usage_days where workspace_id=workspace and usage_day=today)<>17000 then raise exception 'Timeout refunded unknown usage'; end if;
  perform private.finish_ai_generation(id,null,'{"input_tokens":100,"output_tokens":20,"total_tokens":120}',null);
  perform private.finish_ai_generation(id,null,'{"input_tokens":100,"output_tokens":20,"total_tokens":120}',null);
  if (select accounted_tokens from private.ai_usage_days where workspace_id=workspace and usage_day=today)<>120 then raise exception 'Usage reconciliation not exactly once'; end if;
  -- Invalid usage cannot manufacture a refund.
  other_id:=gen_random_uuid();perform private.reserve_ai_generation(actor,target_map,root,other_id,session,'','test-only',50000);
  perform private.finish_ai_generation(other_id,null,'{"input_tokens":100,"output_tokens":20,"total_tokens":0}','INVALID_OUTPUT');
  if (select accounted_tokens from private.ai_usage_days where workspace_id=workspace and usage_day=today)<>17120 then raise exception 'Invalid usage refunded reserve'; end if;
  -- Reconciliation after midnight is charged to the original reservation day.
  yesterday:=today-1;
  insert into private.ai_usage_days(workspace_id,usage_day,generation_count,accounted_tokens) values(workspace,yesterday,1,17000);
  update public.ai_generations set usage_day=yesterday where public.ai_generations.id=other_id;
  update private.ai_usage_days set accounted_tokens=120,generation_count=1 where workspace_id=workspace and usage_day=today;
  perform private.finish_ai_generation(other_id,null,'{"input_tokens":80,"output_tokens":20,"total_tokens":100}',null);
  if (select accounted_tokens from private.ai_usage_days where workspace_id=workspace and usage_day=yesterday)<>100
    or (select accounted_tokens from private.ai_usage_days where workspace_id=workspace and usage_day=today)<>120 then raise exception 'Late usage crossed UTC day'; end if;
  -- A different user's request sees one remaining generation in the same ledger.
  update private.ai_usage_days set generation_count=99,accounted_tokens=0 where workspace_id=workspace and usage_day=today;
  id:=gen_random_uuid();perform private.reserve_ai_generation(actor,target_map,root,id,session,'','test-only',50000);
  begin
    perform private.reserve_ai_generation(colleague,target_map,root,gen_random_uuid(),session,'','test-only',50000);raise exception 'Daily quota missing';
  exception when others then if sqlerrm<>'AI_DAILY_LIMIT' then raise;end if;end;
  perform private.finish_ai_generation(id,null,'{"input_tokens":10,"output_tokens":0,"total_tokens":10}','PROVIDER_FAILED');
  -- No model request can be claimed at an insufficient token balance.
  update private.ai_usage_days set generation_count=0,accounted_tokens=33001 where workspace_id=workspace and usage_day=today;
  select count(*) into before_count from public.ai_generations where workspace_id=workspace;
  begin
    perform private.reserve_ai_generation(colleague,target_map,root,gen_random_uuid(),session,'','test-only',50000);raise exception 'Budget quota missing';
  exception when others then if sqlerrm<>'AI_BUDGET_LIMIT' then raise;end if;end;
  if (select count(*) from public.ai_generations where workspace_id=workspace)<>before_count then raise exception 'Limit created a job'; end if;
  -- Rolling per-user minute limit is checked independently of the workspace day.
  update private.ai_usage_days set accounted_tokens=0 where workspace_id=workspace and usage_day=today;
  update public.ai_generations set created_at=clock_timestamp()-interval '2 minutes' where requested_by=actor;
  for item in 1..10 loop
    id:=gen_random_uuid();perform private.reserve_ai_generation(actor,target_map,root,id,session,'','test-only',50000);
    perform private.finish_ai_generation(id,null,'{"input_tokens":1,"output_tokens":0,"total_tokens":1}','PROVIDER_FAILED');
  end loop;
  begin
    perform private.reserve_ai_generation(actor,target_map,root,gen_random_uuid(),session,'','test-only',50000);raise exception 'Minute quota missing';
  exception when others then if sqlerrm<>'AI_RATE_LIMIT' then raise;end if;end;
  if has_table_privilege('authenticated','private.ai_usage_days','select') or has_table_privilege('anon','private.ai_settings','update') then raise exception 'Private quota settings exposed'; end if;
end;$$;
rollback;
