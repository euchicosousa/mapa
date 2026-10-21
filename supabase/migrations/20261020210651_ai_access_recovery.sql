begin;
create or replace function private.get_ai_generation(p_map_id uuid,p_generation_id uuid,p_editor_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.ai_generations;
begin
  if auth.uid() is null then raise exception using message='UNAUTHENTICATED'; end if;
  perform private.assert_map_not_deleted(p_map_id);
  if not private.can_read_map(p_map_id) then raise exception using message='NOT_FOUND'; end if;
  update public.ai_generations set state='failed',error_code='EXPIRED',finished_at=clock_timestamp()
    where map_id=p_map_id and requested_by=auth.uid() and state in ('pending','running') and expires_at<=clock_timestamp();
  -- A new tab has a new session id: its user's active job still needs to resume.
  -- Completed history stays scoped to its originating session unless an exact id
  -- is requested. No other member's job or result is exposed.
  select * into j from public.ai_generations where map_id=p_map_id and requested_by=auth.uid()
    and (case when p_generation_id is not null then id=p_generation_id
      else editor_session_id=p_editor_session_id or state in ('pending','running') end)
    order by case when state in ('pending','running') then 0 else 1 end,created_at desc limit 1;
  return case when j.id is null then null else private.ai_job_json(j) end;
end; $$;
create or replace function private.cancel_ai_generation(p_map_id uuid,p_generation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); j public.ai_generations; m public.maps;
begin
  if actor is null then raise exception using message='UNAUTHENTICATED'; end if;
  if p_map_id is null or p_generation_id is null then raise exception using message='VALIDATION'; end if;
  perform private.assert_map_not_deleted(p_map_id);
  if not private.can_read_map(p_map_id) then raise exception using message='NOT_FOUND'; end if;
  select * into j from public.ai_generations where id=p_generation_id and map_id=p_map_id and requested_by=actor for update;
  if not found then raise exception using message='NOT_FOUND'; end if;
  select * into m from public.maps where id=p_map_id and deleted_at is null for share;
  if not found then perform private.assert_map_not_deleted(p_map_id); raise exception using message='NOT_FOUND'; end if;
  perform 1 from public.workspace_members where workspace_id=m.workspace_id and user_id=actor and status='active' for share;
  if not found then raise exception using message='NOT_FOUND'; end if;
  if j.state in ('pending','running') then
    update public.ai_generations set
      state=case when expires_at<=clock_timestamp() then 'failed' else 'cancelled' end,
      error_code=case when expires_at<=clock_timestamp() then 'EXPIRED' else null end,
      finished_at=clock_timestamp()
    where id=j.id returning * into j;
  end if;
  return private.ai_job_json(j);
end; $$;
revoke all on function private.cancel_ai_generation(uuid,uuid) from public,anon,authenticated;
grant execute on function private.cancel_ai_generation(uuid,uuid) to authenticated;

commit;
