-- Ticket 12. Personal view state has no content revision or operation log entry.
begin;
create function private.valid_map_viewport(value jsonb)
returns boolean language sql immutable security invoker set search_path = ''
as $$
  select case when jsonb_typeof(value)='object' and value ?& array['x','y','zoom']
    and (select count(*) from jsonb_object_keys(value))=3
    and jsonb_typeof(value->'x')='number' and jsonb_typeof(value->'y')='number' and jsonb_typeof(value->'zoom')='number'
  then abs((value->>'x')::numeric)<=1000000000 and abs((value->>'y')::numeric)<=1000000000
    and (value->>'zoom')::numeric between 0.001 and 2 else false end;
$$;
revoke all on function private.valid_map_viewport(jsonb) from public,anon,authenticated;
grant execute on function private.valid_map_viewport(jsonb) to authenticated,service_role;

create table public.map_user_preferences (
  map_id uuid not null references public.maps(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  viewport jsonb not null check (private.valid_map_viewport(viewport)),
  collapsed_node_ids uuid[] not null default '{}' check (
    cardinality(collapsed_node_ids)<=500 and array_position(collapsed_node_ids,null) is null
    and (cardinality(collapsed_node_ids)=0 or array_ndims(collapsed_node_ids)=1)),
  primary key(map_id,user_id)
);
create index map_user_preferences_user_idx on public.map_user_preferences(user_id);
alter table public.map_user_preferences enable row level security;
revoke all on table public.map_user_preferences from public,anon,authenticated;
grant select,insert,update,delete on public.map_user_preferences to authenticated;
grant all on public.map_user_preferences to service_role;
create policy personal_map_view on public.map_user_preferences for all to authenticated
  using (user_id=(select auth.uid()) and exists (
    select 1 from public.maps m where m.id=map_id and m.deleted_at is null and private.is_active_member(m.workspace_id)))
  with check (user_id=(select auth.uid()) and exists (
    select 1 from public.maps m where m.id=map_id and m.deleted_at is null and private.is_active_member(m.workspace_id)));
commit;
