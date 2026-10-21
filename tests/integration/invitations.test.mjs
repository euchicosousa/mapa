import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { readTarget,createRun,cleanupRun } from '../../scripts/validation-run.mjs';
const options={auth:{persistSession:false,autoRefreshToken:false}};
let target,run,admin,clients,iid;
before(async()=>{
 target=readTarget();run=await createRun(target);admin=createClient(target.url,target.secretKey,options);clients={};
 for(const a of run.accounts){const client=createClient(target.url,target.publicKey,options);const result=await client.auth.signInWithPassword({email:a.email,password:a.password});assert.ifError(result.error);clients[a.key]=client;}
});
after(async()=>{if(run)await cleanupRun(target,run.runId);});
const reserve=(action,id,email=null,actor=run.accounts[0].id)=>admin.rpc('reserve_workspace_invitation',{p_actor:actor,p_action:action,p_workspace:run.workspaces.X.id,p_id:id,p_email:email});
test('non-admins and outsiders cannot invoke management or service-only RPCs',async()=>{
 for(const key of ['B','C','D']){
  for(const action of ['create','revoke']){
   const result=await clients[key].functions.invoke('manage-invitation',{body:{action,workspaceId:run.workspaces.X.id,invitationId:randomUUID(),email:run.accounts[3].email,redirectTo:'http://127.0.0.1:4174/auth/callback'}});
   assert.ok(result.error);assert.equal(result.error.context.status,403);
  }
  const rpc=await clients[key].rpc('reserve_workspace_invitation',{p_actor:run.accounts[0].id,p_action:'create',p_workspace:run.workspaces.X.id,p_id:randomUUID(),p_email:run.accounts[3].email});assert.ok(rpc.error);
 }
});
test('an existing account invitation is private and has no false email success',async()=>{
 iid=randomUUID();const first=await reserve('create',iid,run.accounts[3].email);assert.ifError(first.error);assert.equal(first.data.deliveryState,'existing');
 for(const key of ['B','C','D']){const result=await clients[key].from('workspace_invitations').select('id');assert.ifError(result.error);assert.equal(result.data.length,0);}
 const pending=await clients.D.rpc('pending_workspace_invitations');assert.ifError(pending.error);assert.equal(pending.data[0].id,iid);
 const wrong=await clients.C.rpc('accept_workspace_invitation',{p_id:iid});assert.equal(wrong.error.message,'INVITE_UNAVAILABLE');
});
test('cooldown and retry preserve a single invitation',async()=>{
 const retry=await reserve('retry',iid);assert.equal(retry.error.message,'COOLDOWN');
 const aged=await admin.from('workspace_invitations').update({last_attempt_at:new Date(Date.now()-61000).toISOString(),delivery_state:'failed',delivery_error:'SEND_FAILED'}).eq('id',iid);assert.ifError(aged.error);
 const repeated=await reserve('retry',iid);assert.ifError(repeated.error);assert.equal(repeated.data.id,iid);assert.equal(repeated.data.deliveryState,'existing');
});
test('expired/revoked invitations never create a membership',async()=>{
 const aged=await admin.from('workspace_invitations').update({expires_at:new Date(Date.now()-1000).toISOString()}).eq('id',iid);assert.ifError(aged.error);
 assert.equal((await clients.D.rpc('accept_workspace_invitation',{p_id:iid})).error.message,'INVITE_UNAVAILABLE');
 assert.ifError((await reserve('revoke',iid)).error);
 assert.equal((await clients.D.rpc('accept_workspace_invitation',{p_id:iid})).error.message,'INVITE_UNAVAILABLE');
});
test('two concurrent acceptances produce one active member, never an admin',async()=>{
 iid=randomUUID();assert.ifError((await reserve('create',iid,run.accounts[3].email)).error);
 const results=await Promise.all([clients.D.rpc('accept_workspace_invitation',{p_id:iid}),clients.D.rpc('accept_workspace_invitation',{p_id:iid})]);
 results.forEach(r=>{assert.ifError(r.error);assert.equal(r.data,run.workspaces.X.id);});
 const members=await admin.from('workspace_members').select('role,status').eq('workspace_id',run.workspaces.X.id).eq('user_id',run.accounts[3].id);assert.ifError(members.error);assert.deepEqual(members.data,[{role:'member',status:'active'}]);
});

test('acceptance racing revocation has one winner without deadlock or resurrection',async()=>{
 for(let attempt=0;attempt<3;attempt++){
  assert.ifError((await admin.from('workspace_members').update({status:'inactive'}).eq('workspace_id',run.workspaces.X.id).eq('user_id',run.accounts[3].id)).error);
  assert.equal((await clients.D.rpc('accept_workspace_invitation',{p_id:iid})).error.message,'INVITE_UNAVAILABLE');
  iid=randomUUID();assert.ifError((await reserve('create',iid,run.accounts[3].email)).error);
  const [accepted,revoked]=await Promise.all([clients.D.rpc('accept_workspace_invitation',{p_id:iid}),reserve('revoke',iid)]);
  const invitation=await admin.from('workspace_invitations').select('status').eq('id',iid).single();assert.ifError(invitation.error);
  if(invitation.data.status==='accepted'){assert.ifError(accepted.error);assert.equal(revoked.error.message,'INVITE_CLOSED');}
  else {assert.equal(invitation.data.status,'revoked');assert.ifError(revoked.error);assert.equal(accepted.error.message,'INVITE_UNAVAILABLE');}
  const membership=await admin.from('workspace_members').select('status').eq('workspace_id',run.workspaces.X.id).eq('user_id',run.accounts[3].id).single();assert.ifError(membership.error);
  assert.equal(membership.data.status,invitation.data.status==='accepted'?'active':'inactive');
 }
});
