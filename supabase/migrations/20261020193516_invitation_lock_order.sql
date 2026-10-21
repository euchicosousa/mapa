-- Serialize invitation management without blocking membership FK key-share locks.
-- A concurrent acceptance may hold the invitation row before inserting membership.
begin;
create or replace function private.reserve_workspace_invitation(p_actor uuid,p_action text,p_workspace uuid,p_id uuid,p_email text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare inv public.workspace_invitations; recipient auth.users; normalized text:=lower(btrim(p_email)); claim uuid;
begin
 if p_actor is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor and role='admin' and status='active') then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.workspaces where id=p_workspace for no key update;
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

commit;
