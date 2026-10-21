begin;
create table public.workspace_invitations (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 email text not null check(email=lower(btrim(email)) and char_length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 invited_by uuid not null references public.profiles(id) on delete restrict,
 auth_user_id uuid references auth.users(id) on delete set null,
 status text not null default 'pending' check(status in ('pending','accepted','revoked')),
 expires_at timestamptz not null default now()+interval '7 days',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 last_attempt_at timestamptz, attempt_id uuid,
 delivery_state text not null default 'sending' check(delivery_state in ('sending','sent','existing','failed')),
 delivery_error text check(delivery_error in ('SEND_FAILED','DELIVERY_UNKNOWN')),
 accepted_by uuid references public.profiles(id) on delete set null, accepted_at timestamptz
);
create unique index invitation_pending_email on public.workspace_invitations(workspace_id,email) where status='pending';
create index invitation_workspace_created on public.workspace_invitations(workspace_id,created_at desc);
create index invitation_pending_recipient on public.workspace_invitations(email,expires_at) where status='pending';
create index invitation_inviter on public.workspace_invitations(invited_by);
create index invitation_auth_user on public.workspace_invitations(auth_user_id) where auth_user_id is not null;
create index invitation_accepted_by on public.workspace_invitations(accepted_by) where accepted_by is not null;
alter table public.workspace_invitations enable row level security;
revoke all on public.workspace_invitations from public,anon,authenticated;
grant select on public.workspace_invitations to authenticated;
grant all on public.workspace_invitations to service_role;

create function private.is_workspace_admin(p_workspace uuid)
returns boolean language sql stable security definer set search_path=''
as $$select auth.uid() is not null and exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid() and role='admin' and status='active')$$;
revoke all on function private.is_workspace_admin(uuid) from public,anon,authenticated;
grant execute on function private.is_workspace_admin(uuid) to authenticated;
create policy invitation_admin_read on public.workspace_invitations for select to authenticated using((select private.is_workspace_admin(workspace_id)));

-- Only the authenticated Edge handler may supply p_actor, derived from getUser(token).
create function private.reserve_workspace_invitation(p_actor uuid,p_action text,p_workspace uuid,p_id uuid,p_email text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare inv public.workspace_invitations; recipient auth.users; normalized text:=lower(btrim(p_email)); claim uuid;
begin
 if p_actor is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor and role='admin' and status='active') then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor and role='admin' and status='active') then raise exception 'FORBIDDEN'; end if;
 if p_action not in ('create','retry','revoke') or p_id is null then raise exception 'VALIDATION'; end if;
 if p_action='create' then
  if normalized is null or char_length(normalized)>254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'VALIDATION'; end if;
  select * into inv from public.workspace_invitations where id=p_id;
  if found and (inv.workspace_id<>p_workspace or inv.email<>normalized) then raise exception 'CONFLICT'; end if;
  if inv.id is null then
   select * into inv from public.workspace_invitations where workspace_id=p_workspace and email=normalized and status='pending' for update;
  end if;
  if inv.id is not null then
   if inv.status<>'pending' then raise exception 'INVITE_CLOSED'; end if;
   return jsonb_build_object('id',inv.id,'claimed',false,'deliveryState',inv.delivery_state);
  end if;
  select * into recipient from auth.users where lower(email)=normalized limit 1;
  if exists(select 1 from public.workspace_members where user_id=recipient.id and status='active') then raise exception 'ALREADY_MEMBER'; end if;
  insert into public.workspace_invitations(id,workspace_id,email,invited_by,auth_user_id)
  values(p_id,p_workspace,normalized,p_actor,recipient.id) returning * into inv;
 else
  select * into inv from public.workspace_invitations where id=p_id and workspace_id=p_workspace for update;
  if inv.id is null then raise exception 'NOT_FOUND'; end if;
  if p_action='revoke' then
   if inv.status='accepted' then raise exception 'INVITE_CLOSED'; end if;
   update public.workspace_invitations set status='revoked',updated_at=now() where id=inv.id;
   return jsonb_build_object('id',inv.id,'claimed',false,'deliveryState',inv.delivery_state);
  end if;
  if inv.status<>'pending' then raise exception 'INVITE_CLOSED'; end if;
  if inv.last_attempt_at>now()-interval '60 seconds' then raise exception 'COOLDOWN'; end if;
  select * into recipient from auth.users where lower(email)=inv.email limit 1;
 end if;
 -- Existing confirmed accounts receive no new Auth email; the pending invitation
 -- is accepted after their ordinary login. Unconfirmed invited identities can be resent.
 if recipient.id is not null and (recipient.email_confirmed_at is not null or recipient.invited_at is null) then
  update public.workspace_invitations set auth_user_id=recipient.id,delivery_state='existing',delivery_error=null,last_attempt_at=now(),expires_at=now()+interval '7 days',updated_at=now() where id=inv.id;
  return jsonb_build_object('id',inv.id,'claimed',false,'deliveryState','existing');
 end if;
 claim:=gen_random_uuid();
 update public.workspace_invitations set attempt_id=claim,delivery_state='sending',delivery_error=null,last_attempt_at=now(),expires_at=now()+interval '7 days',updated_at=now() where id=inv.id;
 return jsonb_build_object('id',inv.id,'claimed',true,'attemptId',claim,'email',inv.email,'deliveryState','sending');
end;$$;

create function private.finish_workspace_invitation(p_id uuid,p_attempt uuid,p_outcome text)
returns void language plpgsql security definer set search_path=''
as $$begin
 if p_outcome not in ('sent','failed','existing') then raise exception 'VALIDATION'; end if;
 update public.workspace_invitations i set delivery_state=p_outcome,delivery_error=case when p_outcome='failed' then 'SEND_FAILED' else null end,
 auth_user_id=(select u.id from auth.users u where lower(u.email)=i.email limit 1),updated_at=now()
 where i.id=p_id and i.attempt_id=p_attempt;
 -- Deliberately never changes status: revoke/accept wins over a late email response.
end;$$;
revoke all on function private.reserve_workspace_invitation(uuid,text,uuid,uuid,text),private.finish_workspace_invitation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.reserve_workspace_invitation(uuid,text,uuid,uuid,text),private.finish_workspace_invitation(uuid,uuid,text) to service_role;
grant usage on schema private to service_role;
create function public.reserve_workspace_invitation(p_actor uuid,p_action text,p_workspace uuid,p_id uuid,p_email text default null)
returns jsonb language sql security invoker set search_path='' as $$select private.reserve_workspace_invitation(p_actor,p_action,p_workspace,p_id,p_email)$$;
create function public.finish_workspace_invitation(p_id uuid,p_attempt uuid,p_outcome text)
returns void language sql security invoker set search_path='' as $$select private.finish_workspace_invitation(p_id,p_attempt,p_outcome)$$;
revoke all on function public.reserve_workspace_invitation(uuid,text,uuid,uuid,text),public.finish_workspace_invitation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_workspace_invitation(uuid,text,uuid,uuid,text),public.finish_workspace_invitation(uuid,uuid,text) to service_role;

create function private.pending_workspace_invitations()
returns table(id uuid,workspace_name text,email text,expires_at timestamptz) language sql stable security definer set search_path=''
as $$ select i.id,w.name,i.email,i.expires_at from public.workspace_invitations i join public.workspaces w on w.id=i.workspace_id
 join auth.users u on u.id=auth.uid() and u.email_confirmed_at is not null and lower(u.email)=i.email
 where i.status='pending' and i.expires_at>now() and (i.auth_user_id is null or i.auth_user_id=u.id)
 and not exists(select 1 from public.workspace_members m where m.user_id=u.id and m.status='active') order by i.created_at; $$;
create function private.accept_workspace_invitation(p_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare actor uuid:=auth.uid(); recipient_email text; inv public.workspace_invitations;
begin
 if actor is null then raise exception 'UNAUTHENTICATED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,4));
 select lower(email) into recipient_email from auth.users where id=actor and email_confirmed_at is not null;
 if recipient_email is null then raise exception 'INVITE_UNAVAILABLE'; end if;
 select * into inv from public.workspace_invitations where id=p_id for update;
 if inv.id is null or inv.email<>recipient_email or (inv.auth_user_id is not null and inv.auth_user_id<>actor) then raise exception 'INVITE_UNAVAILABLE'; end if;
 if inv.status='accepted' and inv.accepted_by=actor and exists(select 1 from public.workspace_members where workspace_id=inv.workspace_id and user_id=actor and status='active') then return inv.workspace_id; end if;
 if inv.status<>'pending' or inv.expires_at<=now() then raise exception 'INVITE_UNAVAILABLE'; end if;
 if exists(select 1 from public.workspace_members where user_id=actor and status='active' and workspace_id<>inv.workspace_id) then raise exception 'ALREADY_MEMBER'; end if;
 insert into public.workspace_members(workspace_id,user_id,role,status) values(inv.workspace_id,actor,'member','active')
 on conflict(workspace_id,user_id) do update set status='active',role=case when workspace_members.status='active' then workspace_members.role else 'member' end;
 update public.workspace_invitations set status='accepted',accepted_by=actor,auth_user_id=actor,accepted_at=now(),updated_at=now() where id=inv.id;
 return inv.workspace_id;
end;$$;
revoke all on function private.pending_workspace_invitations(),private.accept_workspace_invitation(uuid) from public,anon,authenticated;
grant execute on function private.pending_workspace_invitations(),private.accept_workspace_invitation(uuid) to authenticated;
create function public.pending_workspace_invitations()
returns table(id uuid,workspace_name text,email text,expires_at timestamptz) language sql security invoker set search_path='' as $$select * from private.pending_workspace_invitations()$$;
create function public.accept_workspace_invitation(p_id uuid)
returns uuid language sql security invoker set search_path='' as $$select private.accept_workspace_invitation(p_id)$$;
revoke all on function public.pending_workspace_invitations(),public.accept_workspace_invitation(uuid) from public,anon,authenticated;
grant execute on function public.pending_workspace_invitations(),public.accept_workspace_invitation(uuid) to authenticated;
commit;
