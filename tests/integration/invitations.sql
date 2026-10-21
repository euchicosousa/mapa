begin;
do $$
declare admin_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); target_id uuid:=gen_random_uuid(); unconfirmed uuid:=gen_random_uuid(); workspace uuid:=gen_random_uuid(); iid uuid:=gen_random_uuid(); first jsonb; repeated jsonb; email text;
begin
 email:='invite-sql-'||target_id||'@example.com';
 insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 (admin_id,'invite-admin-'||admin_id||'@example.com',now(),'{}'),(member_id,'invite-member-'||member_id||'@example.com',now(),'{}'),
 (outsider,'invite-outside-'||outsider||'@example.com',now(),'{}'),(target_id,email,now(),'{}'),(unconfirmed,'invite-unconfirmed-'||unconfirmed||'@example.com',null,'{}');
 insert into public.workspaces(id,name) values(workspace,'Temporary SQL invitation validation');
 insert into public.workspace_members values(workspace,admin_id,'admin','active'),(workspace,member_id,'member','active');
 foreach outsider in array array[member_id,outsider] loop
  begin perform private.reserve_workspace_invitation(outsider,'create',workspace,iid,email);raise exception 'Unauthorized invite';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 end loop;
 first:=private.reserve_workspace_invitation(admin_id,'create',workspace,iid,'  '||upper(email)||'  ');
 if first->>'deliveryState'<>'existing' then raise exception 'Existing account must not send Auth mail';end if;
 repeated:=private.reserve_workspace_invitation(admin_id,'create',workspace,gen_random_uuid(),email);
 if repeated->>'id'<>iid::text then raise exception 'Duplicate pending invitation';end if;
 begin perform private.reserve_workspace_invitation(admin_id,'retry',workspace,iid,null);raise exception 'Missing cooldown';exception when others then if sqlerrm<>'COOLDOWN' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',member_id::text,true);
 begin perform public.accept_workspace_invitation(iid);raise exception 'Wrong email accepted';exception when others then if sqlerrm<>'INVITE_UNAVAILABLE' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',target_id::text,true);
 if (select count(*) from public.pending_workspace_invitations())<>1 then raise exception 'Own invitation absent';end if;
 perform private.reserve_workspace_invitation(admin_id,'revoke',workspace,iid,null);
 perform private.finish_workspace_invitation(iid,gen_random_uuid(),'sent');
 begin perform public.accept_workspace_invitation(iid);raise exception 'Revoked invitation accepted';exception when others then if sqlerrm<>'INVITE_UNAVAILABLE' then raise;end if;end;
 iid:=gen_random_uuid();first:=private.reserve_workspace_invitation(admin_id,'create',workspace,iid,email);
 update public.workspace_invitations set expires_at=now()-interval '1 second' where id=iid;
 begin perform public.accept_workspace_invitation(iid);raise exception 'Expired invitation accepted';exception when others then if sqlerrm<>'INVITE_UNAVAILABLE' then raise;end if;end;
 update public.workspace_invitations set last_attempt_at=now()-interval '61 seconds' where id=iid;
 first:=private.reserve_workspace_invitation(admin_id,'retry',workspace,iid,null);
 if (select expires_at from public.workspace_invitations where id=iid)<now()+interval '6 days' then raise exception 'Renewal missing';end if;
 perform public.accept_workspace_invitation(iid);perform public.accept_workspace_invitation(iid);
 if (select count(*) from public.workspace_members where workspace_id=workspace and user_id=target_id)<>1 then raise exception 'Acceptance duplicated membership';end if;
 if (select role from public.workspace_members where workspace_id=workspace and user_id=target_id)<>'member' then raise exception 'Invited role escalation';end if;
 iid:=gen_random_uuid();email:='invite-unconfirmed-'||unconfirmed||'@example.com';first:=private.reserve_workspace_invitation(admin_id,'create',workspace,iid,email);
 perform set_config('request.jwt.claim.sub',unconfirmed::text,true);
 begin perform public.accept_workspace_invitation(iid);raise exception 'Unconfirmed email accepted';exception when others then if sqlerrm<>'INVITE_UNAVAILABLE' then raise;end if;end;
 -- A failed delivery can claim a new attempt after cooldown, but late finish never revives a revoked invitation.
 iid:=gen_random_uuid();email:='invite-claim-'||iid||'@example.com';
 first:=private.reserve_workspace_invitation(admin_id,'create',workspace,iid,email);
 if first->>'claimed'<>'true' then raise exception 'Missing initial delivery claim';end if;
 perform private.finish_workspace_invitation(iid,(first->>'attemptId')::uuid,'failed');
 if (select delivery_state from public.workspace_invitations where id=iid)<>'failed' then raise exception 'Failed delivery not recorded';end if;
 update public.workspace_invitations set last_attempt_at=now()-interval '61 seconds' where id=iid;
 repeated:=private.reserve_workspace_invitation(admin_id,'retry',workspace,iid,null);
 if repeated->>'claimed'<>'true' or repeated->>'attemptId'=first->>'attemptId' then raise exception 'Delivery retry claim not renewed';end if;
 perform private.reserve_workspace_invitation(admin_id,'revoke',workspace,iid,null);
 perform private.finish_workspace_invitation(iid,(repeated->>'attemptId')::uuid,'sent');
 if (select status from public.workspace_invitations where id=iid)<>'revoked' then raise exception 'Late delivery revived revoked invitation';end if;
 if has_function_privilege('authenticated','public.reserve_workspace_invitation(uuid,text,uuid,uuid,text)','EXECUTE') or has_function_privilege('anon','public.accept_workspace_invitation(uuid)','EXECUTE') then raise exception 'Privilege leak';end if;
end;$$;
rollback;
