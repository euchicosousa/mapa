begin;
create or replace function private.cancel_ai_generation(p_map_id uuid,p_generation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); j public.ai_generations; m public.maps; expired boolean;
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
    expired:=j.expires_at<=clock_timestamp();
    update public.ai_generations set
      state=case when expired then 'failed' else 'cancelled' end,
      error_code=case when expired then 'EXPIRED' else null end,
      finished_at=clock_timestamp()
    where id=j.id returning * into j;
  end if;
  return private.ai_job_json(j);
end; $$;
revoke all on function private.cancel_ai_generation(uuid,uuid) from public,anon,authenticated;
grant execute on function private.cancel_ai_generation(uuid,uuid) to authenticated;


commit;
