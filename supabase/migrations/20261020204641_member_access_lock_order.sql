-- Acquire the invitation identity lock before any membership row lock.
-- This also covers accepting an older pending invite after administrative reactivation.
begin;
create or replace function private.set_member_access(p_workspace uuid,p_user uuid,p_status text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=auth.uid(); member public.workspace_members; owned jsonb;
begin
 if actor is null then raise exception 'UNAUTHENTICATED'; end if;
 if p_workspace is null or p_user is null or p_status is null or p_status not in ('active','inactive') then raise exception 'VALIDATION'; end if;
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=actor and role='admin' and status='active') then raise exception 'FORBIDDEN'; end if;
 -- Serializes last-admin decisions for this workspace. NO KEY UPDATE is
 -- compatible with the FK key-share locks used when inserting memberships.
 perform 1 from public.workspaces where id=p_workspace for no key update;
 -- Same identity lock as invitation acceptance: cannot reactivate into two teams.
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,4));
 perform 1 from public.workspace_members where workspace_id=p_workspace and user_id=actor and role='admin' and status='active' for share;
 if not found then raise exception 'FORBIDDEN'; end if;
 select * into member from public.workspace_members where workspace_id=p_workspace and user_id=p_user for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if member.status=p_status then return jsonb_build_object('status',p_status,'maps','[]'::jsonb); end if;
 if p_status='inactive' then
  if member.role='admin' and (select count(*) from public.workspace_members where workspace_id=p_workspace and role='admin' and status='active')<=1 then
   return jsonb_build_object('error','LAST_ADMIN','maps','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'title',m.title) order by m.title,m.id),'[]'::jsonb) into owned from public.maps m
  where m.workspace_id=p_workspace and m.owner_id=p_user and m.deleted_at is null;
  if jsonb_array_length(owned)>0 then return jsonb_build_object('error','OWNED_MAPS','maps',owned); end if;
 else
  if exists(select 1 from public.workspace_members where user_id=p_user and workspace_id<>p_workspace and status='active') then
   return jsonb_build_object('error','ALREADY_MEMBER','maps','[]'::jsonb);
  end if;
 end if;
 update public.workspace_members set status=p_status where workspace_id=p_workspace and user_id=p_user;
 -- No identity, profile, role, document, node, author or history row is deleted.
 return jsonb_build_object('status',p_status,'maps','[]'::jsonb);
end;$$;
commit;
