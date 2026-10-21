-- Ticket 02. Privileged helpers deliberately live in an unexposed schema.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now()
);
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null check (role in ('admin', 'member')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_id_idx on public.workspace_members(user_id, workspace_id);

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
revoke all on table public.profiles, public.workspaces, public.workspace_members from public, anon, authenticated;
grant select on table public.profiles, public.workspaces, public.workspace_members to authenticated;
-- Only administrative server tooling may provision membership in this ticket.
grant all on table public.profiles, public.workspaces, public.workspace_members to service_role;

create function private.is_active_member(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace_id and m.user_id = auth.uid() and m.status = 'active'
  );
$$;
create function private.shares_workspace(target_user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.workspace_members viewer
    join public.workspace_members colleague on colleague.workspace_id = viewer.workspace_id
    where viewer.user_id = auth.uid() and viewer.status = 'active' and colleague.user_id = target_user_id
  );
$$;
revoke all on function private.is_active_member(uuid), private.shares_workspace(uuid) from public, anon, authenticated;
grant execute on function private.is_active_member(uuid), private.shares_workspace(uuid) to authenticated;

create policy workspace_read on public.workspaces for select to authenticated
  using ((select private.is_active_member(id)));
create policy member_read on public.workspace_members for select to authenticated
  using ((select private.is_active_member(workspace_id)));
create policy profile_read on public.profiles for select to authenticated
  using ((select private.shares_workspace(id)));

create function private.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  -- display_name is presentation only. No authorization is read from metadata.
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(nullif(left(btrim(new.raw_user_meta_data ->> 'display_name'), 120), ''), 'Pessoa da equipe'));
  return new;
end;
$$;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- Existing identities get profiles, never automatic workspace membership.
insert into public.profiles(id, display_name)
select id, coalesce(nullif(left(btrim(raw_user_meta_data ->> 'display_name'), 120), ''), 'Pessoa da equipe')
from auth.users on conflict (id) do nothing;
commit;
