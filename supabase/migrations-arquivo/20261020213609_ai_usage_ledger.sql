begin;
create table private.ai_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  requests_per_minute integer not null check(requests_per_minute between 1 and 10),
  generations_per_day integer not null check(generations_per_day between 1 and 100),
  daily_token_cap integer not null check(daily_token_cap between 17000 and 50000)
);
-- The approved ceiling stays 50,000. Rollout remains closed while verifying 22.
insert into private.ai_settings values(true,false,10,100,50000);
create table private.ai_usage_days (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  usage_day date not null,
  generation_count integer not null default 0 check(generation_count>=0),
  accounted_tokens bigint not null default 0 check(accounted_tokens>=0),
  primary key(workspace_id,usage_day)
);
create table private.ai_usage_events (
  id bigint generated always as identity primary key,
  generation_id uuid not null references public.ai_generations(id) on delete cascade,
  event text not null check(event in ('reserved','usage_reconciled')),
  state text not null,
  accounted_tokens bigint not null check(accounted_tokens>=0),
  duration_ms bigint not null check(duration_ms>=0),
  created_at timestamptz not null default clock_timestamp()
);
create index ai_usage_events_generation_idx on private.ai_usage_events(generation_id);
create index ai_generations_user_time_idx on public.ai_generations(requested_by,created_at);
alter table private.ai_settings enable row level security;
alter table private.ai_usage_days enable row level security;
alter table private.ai_usage_events enable row level security;
revoke all on private.ai_settings,private.ai_usage_days,private.ai_usage_events from public,anon,authenticated;
grant all on private.ai_settings,private.ai_usage_days,private.ai_usage_events to service_role;
grant usage,select on sequence private.ai_usage_events_id_seq to service_role;

create function private.ai_utc_day(p_time timestamptz) returns date language sql immutable set search_path='' as $$ select (p_time at time zone 'UTC')::date; $$;
revoke all on function private.ai_utc_day(timestamptz) from public,anon,authenticated;
alter table public.ai_generations add column usage_day date,add column accounted_tokens bigint;
update public.ai_generations set usage_day=private.ai_utc_day(created_at),accounted_tokens=coalesce((usage->>'total_tokens')::bigint,reserved_tokens);
alter table public.ai_generations alter column usage_day set not null,alter column accounted_tokens set not null;
alter table public.ai_generations add constraint ai_accounted_tokens_nonnegative check(accounted_tokens>=0);
insert into private.ai_usage_days(workspace_id,usage_day,generation_count,accounted_tokens)
  select workspace_id,usage_day,count(*),sum(accounted_tokens) from public.ai_generations group by workspace_id,usage_day;

create or replace function private.ai_generation_available(p_actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.workspace_members where user_id=p_actor and status='active') and exists(
   select 1 from private.ai_settings where singleton and (enabled or exists(select 1 from private.ai_validation_access where user_id=p_actor and expires_at>now())));
$$;

-- Same signature: quota values come only from private server configuration, and
-- the Edge Function must also supply the mandatory environment token budget.
create or replace function private.reserve_ai_generation(p_actor uuid,p_map_id uuid,p_parent_node_id uuid,p_generation_id uuid,
  p_editor_session_id uuid,p_guidance text,p_model text,p_daily_budget integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.maps; j public.ai_generations; settings private.ai_settings; ledger private.ai_usage_days;
  context jsonb; hash text; depth integer; moment timestamptz; today date; budget integer; recent_count integer; oldest timestamptz; wait_seconds integer;
begin
  if p_actor is null or p_map_id is null or p_parent_node_id is null or p_generation_id is null or p_editor_session_id is null
    or p_guidance is null or char_length(p_guidance)>1000 then raise exception using message='VALIDATION'; end if;
  if p_model is null or btrim(p_model)='' or p_daily_budget is null or p_daily_budget<17000 then raise exception using message='AI_CONFIG_MISSING'; end if;
  select * into settings from private.ai_settings where singleton;
  if not found then raise exception using message='AI_CONFIG_MISSING'; end if;
  if not private.ai_generation_available(p_actor) then raise exception using message='AI_DISABLED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-user:'||p_actor::text,0));
  perform pg_advisory_xact_lock(hashtextextended('ai-job:'||p_generation_id::text,0));
  select * into m from public.maps where id=p_map_id and deleted_at is null;
  if not found or not exists(select 1 from public.workspace_members where workspace_id=m.workspace_id and user_id=p_actor and status='active') then raise exception using message='NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-workspace:'||m.workspace_id::text,0));
  update public.ai_generations set state='failed',error_code='EXPIRED',finished_at=clock_timestamp()
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
  if exists(select 1 from public.ai_generations where requested_by=p_actor and state in ('pending','running')) then raise exception using message='AI_BUSY'; end if;
  moment:=clock_timestamp();today:=private.ai_utc_day(moment);budget:=least(p_daily_budget,settings.daily_token_cap);
  select count(*),min(created_at) into recent_count,oldest from public.ai_generations where requested_by=p_actor and created_at>moment-interval '1 minute';
  if recent_count>=settings.requests_per_minute then
    wait_seconds:=greatest(1,ceil(extract(epoch from oldest+interval '1 minute'-moment))::integer);
    raise exception using message='AI_RATE_LIMIT',detail=wait_seconds::text;
  end if;
  insert into private.ai_usage_days(workspace_id,usage_day) values(m.workspace_id,today) on conflict do nothing;
  select * into ledger from private.ai_usage_days where workspace_id=m.workspace_id and usage_day=today for update;
  wait_seconds:=greatest(1,ceil(extract(epoch from ((today+1)::timestamp at time zone 'UTC'))-extract(epoch from moment))::integer);
  if ledger.generation_count>=settings.generations_per_day then raise exception using message='AI_DAILY_LIMIT',detail=wait_seconds::text; end if;
  if ledger.accounted_tokens+17000>budget then raise exception using message='AI_BUDGET_LIMIT',detail=wait_seconds::text; end if;
  if not exists(select 1 from public.nodes where map_id=p_map_id and id=p_parent_node_id) then raise exception using message='VALIDATION'; end if;
  if (select count(*) from public.nodes where map_id=p_map_id)>496 then raise exception using message='LIMIT_EXCEEDED'; end if;
  with recursive path as (
    select id,parent_id,1 d from public.nodes where map_id=p_map_id and id=p_parent_node_id
    union all select n.id,n.parent_id,p.d+1 from public.nodes n join path p on n.id=p.parent_id where n.map_id=p_map_id and p.d<=31
  ) select max(d) into depth from path;
  if depth>30 then raise exception using message='LIMIT_EXCEEDED'; end if;
  context:=private.ai_context(p_map_id,p_parent_node_id);
  if char_length(context::text)>12000 then raise exception using message='AI_CONTEXT_TOO_LONG'; end if;
  update private.ai_usage_days set generation_count=generation_count+1,accounted_tokens=accounted_tokens+17000 where workspace_id=m.workspace_id and usage_day=today;
  insert into public.ai_generations(id,map_id,workspace_id,parent_node_id,requested_by,editor_session_id,request_hash,context_fingerprint,state,model,reserved_tokens,usage_day,accounted_tokens,created_at,expires_at)
    values(p_generation_id,p_map_id,m.workspace_id,p_parent_node_id,p_actor,p_editor_session_id,hash,md5(context::text),'running',p_model,17000,today,17000,moment,moment+interval '2 minutes') returning * into j;
  insert into private.ai_usage_events(generation_id,event,state,accounted_tokens,duration_ms) values(j.id,'reserved',j.state,17000,0);
  return private.ai_job_json(j)||jsonb_build_object('claimed',true,'context',context);
end; $$;

create function private.ai_valid_usage(p_usage jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare a bigint; b bigint; total bigint;
begin
  if jsonb_typeof(p_usage) is distinct from 'object' then return null; end if;
  if coalesce(p_usage->>'input_tokens','')!~'^[0-9]{1,9}$' or coalesce(p_usage->>'output_tokens','')!~'^[0-9]{1,9}$' or coalesce(p_usage->>'total_tokens','')!~'^[0-9]{1,9}$' then return null; end if;
  a:=(p_usage->>'input_tokens')::bigint;b:=(p_usage->>'output_tokens')::bigint;total:=(p_usage->>'total_tokens')::bigint;
  if a+b<>total then return null; end if;
  return jsonb_build_object('input_tokens',a,'output_tokens',b,'total_tokens',total);
end; $$;
revoke all on function private.ai_valid_usage(jsonb) from public,anon,authenticated;

-- Keep the proven document transaction, with a service-only accounting wrapper.
alter function private.finish_ai_generation(uuid,jsonb,jsonb,text) rename to finish_ai_generation_document;
revoke all on function private.finish_ai_generation_document(uuid,jsonb,jsonb,text) from public,anon,authenticated,service_role;
create function private.finish_ai_generation(p_generation_id uuid,p_children jsonb,p_usage jsonb,p_error text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare before_job public.ai_generations; after_job public.ai_generations; result jsonb; valid_usage jsonb; charged bigint;
begin
  select * into before_job from public.ai_generations where id=p_generation_id for update;
  if not found then raise exception using message='NOT_FOUND'; end if;
  valid_usage:=private.ai_valid_usage(p_usage);
  result:=private.finish_ai_generation_document(p_generation_id,p_children,valid_usage,p_error);
  select * into after_job from public.ai_generations where id=p_generation_id;
  valid_usage:=private.ai_valid_usage(after_job.usage);
  charged:=case when valid_usage is null then after_job.reserved_tokens else (valid_usage->>'total_tokens')::bigint end;
  if charged<>before_job.accounted_tokens then
    update private.ai_usage_days set accounted_tokens=accounted_tokens-before_job.accounted_tokens+charged
      where workspace_id=before_job.workspace_id and usage_day=before_job.usage_day;
    if not found then raise exception using message='AI_ACCOUNTING_UNAVAILABLE'; end if;
    update public.ai_generations set accounted_tokens=charged where id=p_generation_id;
    insert into private.ai_usage_events(generation_id,event,state,accounted_tokens,duration_ms)
      values(p_generation_id,'usage_reconciled',after_job.state,charged,greatest(0,(extract(epoch from clock_timestamp()-after_job.created_at)*1000)::bigint));
  end if;
  return result;
end; $$;
revoke all on function private.finish_ai_generation(uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function private.finish_ai_generation(uuid,jsonb,jsonb,text) to service_role;
commit;
