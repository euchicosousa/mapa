// Scoped fixture changes for invitation tests, never exposed by the app.
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';
import { readTarget,trackUser } from './validation-run.mjs';
import { randomBytes,randomUUID } from 'node:crypto';
const chunks=[];for await(const c of process.stdin)chunks.push(c);
const input=JSON.parse(Buffer.concat(chunks).toString());
const target=readTarget();const record=JSON.parse(await readFile(`.validation-runs/${input.runId}.json`,'utf8'));
if(record.ref!==target.ref||!record.workspaces.includes(input.workspaceId))throw Error('Fixture is not owned by validation run');
const client=createClient(target.url,target.secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
if(input.action==='create-recipient'){
 const email=`mapa-invite-${input.runId}-${randomUUID()}@example.com`,password=randomBytes(24).toString('base64url'),name=`Validação Convite ${randomUUID().slice(0,8)}`;
 const made=await client.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:name}});
 if(made.error||!made.data.user)throw Error('Could not create scoped recipient');
 await trackUser(input.runId,made.data.user.id);
 process.stdout.write(JSON.stringify({key:'D',workspace:null,role:null,id:made.data.user.id,email,password,name}));
}else{
const patch=input.action==='fail'?{delivery_state:'failed',delivery_error:'SEND_FAILED'}:input.action==='cooldown'?{last_attempt_at:new Date(Date.now()-61000).toISOString()}:input.action==='expire'?{expires_at:new Date(Date.now()-1000).toISOString()}:null;
if(!patch)throw Error('Invalid fixture action');
const result=await client.from('workspace_invitations').update(patch).eq('id',input.id).eq('workspace_id',input.workspaceId).select('id');
if(result.error||result.data.length!==1)throw Error('Scoped fixture update failed');

}
