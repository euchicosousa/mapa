begin;
-- Closed validation gate: service credential only, expiring access, disposable
-- identities created by this project's recorded validation runs only.
create function private.set_ai_validation_access(p_user_id uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from auth.users where id=p_user_id and email ~ '^mapa-validacao-[0-9]{8}-[a-f0-9]{6}-[a-d]@example[.]com$') then
    raise exception using message='VALIDATION'; end if;
  if p_enabled then
    insert into private.ai_validation_access(user_id,expires_at) values(p_user_id,now()+interval '1 hour')
      on conflict(user_id) do update set expires_at=excluded.expires_at;
  else delete from private.ai_validation_access where user_id=p_user_id; end if;
end; $$;
revoke all on function private.set_ai_validation_access(uuid,boolean) from public,anon,authenticated;
grant execute on function private.set_ai_validation_access(uuid,boolean) to service_role;
create function public.set_ai_validation_access(p_user_id uuid,p_enabled boolean)
returns void language sql security invoker set search_path='' as $$ select private.set_ai_validation_access(p_user_id,p_enabled); $$;
revoke all on function public.set_ai_validation_access(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_ai_validation_access(uuid,boolean) to service_role;
create or replace function public.get_ai_generation(p_map_id uuid,p_generation_id uuid default null,p_editor_session_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.get_ai_generation(p_map_id,p_generation_id,p_editor_session_id); $$;
commit;
