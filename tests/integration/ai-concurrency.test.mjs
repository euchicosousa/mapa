import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { setTimeout } from 'node:timers';
import { readFile } from 'node:fs/promises';
import { loadEnv, transformWithEsbuild } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { cleanupRun, createRun, readTarget } from '../../scripts/validation-run.mjs';

// Real provider output, obtained once with the production adapter, is reused as
// trusted worker input for concurrency tests in this run's disposable maps.
// No fake adapter or public test endpoint is deployed to the final project.
process.env.MAPA_AI_VALIDATION='1';
const target=readTarget(),run=await createRun(target);
let cleaned=false;
const cleanup=async()=>{if(!cleaned){await cleanupRun(target,run.runId);cleaned=true;}};
after(cleanup);
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(target.url,target.secretKey,options),clients=[];
const env=loadEnv('development',process.cwd(),'');
let generated;
try{
  for(const account of run.accounts){const client=createClient(target.url,target.publicKey,options);const login=await client.auth.signInWithPassword({email:account.email,password:account.password});assert.equal(login.error,null);clients.push(client);}
  const source=await readFile('supabase/functions/generate-children/provider.ts','utf8');
  const compiled=await transformWithEsbuild(source,'provider.ts',{loader:'ts',target:'es2022'});
  const {generateChildren}=await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
  assert.ok(env.OPENAI_API_KEY&&env.AI_MODEL,'Configuração local de IA obrigatória');
  generated=await generateChildren({title:'Planejamento de validação',path:[{id:randomUUID(),text:'Organizar um projeto'}],children:[]},'Quatro próximos passos curtos.',env.OPENAI_API_KEY,env.AI_MODEL);
}catch(error){await cleanup();throw error;}
const [a,b,c]=clients;
const accounts=run.accounts;
const rpc=async(client,name,args)=>{const response=await client.rpc(name,args);assert.equal(response.error,null,`${name}: ${response.error?.message}`);return response.data;};
const jobs=new Set();
afterEach(async()=>{for(const id of jobs)await rpc(admin,'finish_ai_generation',{p_generation_id:id,p_children:null,p_usage:generated.usage,p_error:'TEST_CLEANUP'});jobs.clear();});
async function fixture(actor=0){
  const session=randomUUID(),made=await rpc(a,'create_map',{p_workspace_id:run.workspaces.X.id,p_operation_id:randomUUID(),p_editor_session_id:session,p_title:`IA concorrência ${randomUUID().slice(0,8)}`});
  const doc=await rpc(a,'get_map_document',{p_map_id:made.mapId});
  return {map:made.mapId,root:doc.nodes[0].id,session,actor,client:clients[actor],revision:1};
}
async function command(f,kind,payload){const result=await rpc(f.client,'apply_map_command',{p_map_id:f.map,p_operation_id:randomUUID(),p_editor_session_id:f.session,p_expected_revision:f.revision,p_kind:kind,p_payload:payload});f.revision=result.revision;return result;}
async function reserve(f,parent=f.root){
  // Respect the production ten-per-minute quota instead of bypassing limits.
  const recent=await admin.from('ai_generations').select('created_at').eq('requested_by',accounts[f.actor].id).gte('created_at',new Date(Date.now()-60000).toISOString()).order('created_at');
  assert.equal(recent.error,null);
  if(recent.data.length>=9)await new Promise(resolve=>setTimeout(resolve,Math.max(1,Math.min(60000,60500-(Date.now()-Date.parse(recent.data[0].created_at))))));
  const id=randomUUID();const job=await rpc(admin,'reserve_ai_generation',{p_actor:accounts[f.actor].id,p_map_id:f.map,p_parent_node_id:parent,p_generation_id:id,p_editor_session_id:f.session,p_guidance:'',p_model:env.AI_MODEL,p_daily_budget:50000});jobs.add(id);assert.equal(job.claimed,true);return id;}
const finish=id=>rpc(admin,'finish_ai_generation',{p_generation_id:id,p_children:generated.children,p_usage:generated.usage,p_error:null});
const cancel=(f,id,client=f.client)=>rpc(client,'cancel_ai_generation',{p_map_id:f.map,p_generation_id:id});
const nodes=f=>rpc(a,'get_map_document',{p_map_id:f.map});

test('cancel wins before finalization; retries and late real output remain cancelled with zero new nodes',async()=>{
  const f=await fixture(),id=await reserve(f),before=await nodes(f);
  assert.equal((await cancel(f,id)).state,'cancelled');assert.equal((await cancel(f,id)).state,'cancelled');assert.equal((await finish(id)).state,'cancelled');
  assert.deepEqual(await nodes(f),before);
  const stored=await admin.from('ai_generations').select('usage,state').eq('id',id).single();assert.equal(stored.data.state,'cancelled');assert.deepEqual(stored.data.usage,generated.usage);
});
test('finalize wins; late cancellation reports applied and preserves a later content edit',async()=>{
  const f=await fixture(),id=await reserve(f);const applied=await finish(id);assert.equal(applied.state,'applied');f.revision=2;
  await command(f,'edit_text',{nodeId:f.root,text:'Edição posterior preservada'});const before=await nodes(f);
  assert.equal((await cancel(f,id)).state,'applied');assert.deepEqual(await nodes(f),before);
});
test('concurrent cancel × finalize has exactly one terminal outcome and at most one four-node batch',async()=>{
  for(let attempt=0;attempt<4;attempt++){
    const f=await fixture(),id=await reserve(f);
    const results=await Promise.all([cancel(f,id),finish(id)]);const doc=await nodes(f);
    assert.equal(results[0].state,results[1].state);assert.ok(['cancelled','applied'].includes(results[0].state));
    assert.equal(doc.nodes.length,results[0].state==='applied'?5:1);assert.equal(doc.map.revision,results[0].state==='applied'?2:1);
    if(results[0].state==='applied')assert.equal(new Set(doc.nodes.filter(n=>n.source==='ai').map(n=>n.aiGenerationId)).size,1);
  }
});
test('foreign users, colleagues and anonymous callers cannot cancel someone else’s job',async()=>{
  const f=await fixture(),id=await reserve(f);
  const anonymous=createClient(target.url,target.publicKey,options);
  for(const client of [b,c,anonymous]){const result=await client.rpc('cancel_ai_generation',{p_map_id:f.map,p_generation_id:id});assert.ok(result.error);}
  const job=await rpc(f.client,'get_ai_generation',{p_map_id:f.map,p_generation_id:id,p_editor_session_id:f.session});assert.equal(job.state,'running');await cancel(f,id);
});
test('ancestor, title, direct children and moving the parent invalidate context, but unrelated branch edits can apply',async()=>{
  for(const mutation of ['ancestor','title','children','edit-child','move','unrelated']){
    const f=await fixture(),parent=randomUUID(),sibling=randomUUID();
    await command(f,'add_child',{nodeId:parent,parentId:f.root,text:'Ramo alvo'});await command(f,'add_child',{nodeId:sibling,parentId:f.root,text:'Outro ramo'});
    const child=randomUUID();if(mutation==='edit-child')await command(f,'add_child',{nodeId:child,parentId:parent,text:'Filho existente'});
    const id=await reserve(f,parent);
    if(mutation==='ancestor')await command(f,'edit_text',{nodeId:f.root,text:'Ancestral alterado'});
    if(mutation==='title')await command(f,'rename_map',{title:'Título alterado'});
    if(mutation==='children')await command(f,'add_child',{nodeId:randomUUID(),parentId:parent,text:'Novo filho'});
    if(mutation==='edit-child')await command(f,'edit_text',{nodeId:child,text:'Filho alterado'});
    if(mutation==='move')await command(f,'move_subtree',{nodeId:parent,newParentId:sibling,targetIndex:0});
    if(mutation==='unrelated')await command(f,'edit_text',{nodeId:sibling,text:'Só outro ramo'});
    const before=await nodes(f),done=await finish(id);assert.equal(done.state,mutation==='unrelated'?'applied':'stale');
    const after=await nodes(f);assert.equal(after.nodes.length,before.nodes.length+(mutation==='unrelated'?4:0));
    if(mutation!=='unrelated')assert.deepEqual(after,before);
  }
});
test('parent deletion and map deletion prevent late finalization; concurrent delete × finalize keeps a coherent tree',async()=>{
  for(const concurrent of [false,true]){
    const f=await fixture(),parent=randomUUID();await command(f,'add_child',{nodeId:parent,parentId:f.root,text:'Pai descartável'});const id=await reserve(f,parent);
    const remove=()=>command(f,'delete_subtree',{nodeId:parent});
    if(concurrent){
      const results=await Promise.all([f.client.rpc('apply_map_command',{p_map_id:f.map,p_operation_id:randomUUID(),p_editor_session_id:f.session,p_expected_revision:f.revision,p_kind:'delete_subtree',p_payload:{nodeId:parent}}),finish(id)]);
      if(results[0].error){assert.equal(results[0].error.message,'CONFLICT');f.revision=(await nodes(f)).map.revision;await remove();}
    }else{await remove();assert.equal((await finish(id)).state,'stale');}
    assert.equal((await nodes(f)).nodes.length,1);
  }
  for(const concurrent of [false,true]){
    const f=await fixture(),id=await reserve(f);
    if(concurrent){
      const results=await Promise.all([f.client.rpc('apply_map_command',{p_map_id:f.map,p_operation_id:randomUUID(),p_editor_session_id:f.session,p_expected_revision:1,p_kind:'delete_map',p_payload:{}}),finish(id)]);
      if(results[0].error){assert.equal(results[0].error.message,'CONFLICT');f.revision=2;await command(f,'delete_map',{});}
      assert.ok(['stale','applied'].includes(results[1].state));
    }else{await command(f,'delete_map',{});assert.equal((await finish(id)).state,'stale');}
    const denied=await f.client.rpc('get_map_document',{p_map_id:f.map});assert.ok(denied.error);
  }
});
test('revoked membership blocks finalization and status/cancel reads',async()=>{
  const f=await fixture(1),id=await reserve(f);const changed=await admin.from('workspace_members').update({status:'inactive'}).eq('workspace_id',run.workspaces.X.id).eq('user_id',accounts[1].id);assert.equal(changed.error,null);
  try{
    assert.equal((await finish(id)).state,'stale');assert.equal((await nodes(f)).nodes.length,1);
    for(const name of ['cancel_ai_generation','get_ai_generation']){const denied=await b.rpc(name,{p_map_id:f.map,p_generation_id:id,...(name==='get_ai_generation'?{p_editor_session_id:f.session}:{})});assert.ok(denied.error);}
  }finally{const restored=await admin.from('workspace_members').update({status:'active'}).eq('workspace_id',run.workspaces.X.id).eq('user_id',accounts[1].id);assert.equal(restored.error,null);}
});
test('expired jobs fail on status, cancel and a new reservation; late finalization cannot revive them',async()=>{
  const f=await fixture();
  for(const action of ['status','cancel','reserve']){
    const id=await reserve(f);const expiry=await admin.from('ai_generations').update({expires_at:new Date(Date.now()-1000).toISOString()}).eq('id',id);assert.equal(expiry.error,null);
    if(action==='status')assert.equal((await rpc(f.client,'get_ai_generation',{p_map_id:f.map,p_generation_id:id,p_editor_session_id:f.session})).state,'failed');
    if(action==='cancel')assert.equal((await cancel(f,id)).state,'failed');
    if(action==='reserve'){const next=await reserve(f);await cancel(f,next);await finish(next);}
    const done=await finish(id);assert.equal(done.state,'failed');assert.equal(done.errorCode,'EXPIRED');
  }
  assert.equal((await nodes(f)).nodes.length,1);
});
test('a new tab resumes the same user’s active job without starting another provider call',async()=>{
  const f=await fixture(),id=await reserve(f);
  const restored=await rpc(f.client,'get_ai_generation',{p_map_id:f.map,p_editor_session_id:randomUUID()});assert.equal(restored.id,id);assert.equal(restored.state,'running');await cancel(f,id);
});

test('transferring responsibility changes the revision but leaves valid context usable',async()=>{
  const f=await fixture(),id=await reserve(f);await command(f,'transfer_owner',{ownerId:accounts[1].id});
  const result=await finish(id);assert.equal(result.state,'applied');const doc=await nodes(f);assert.equal(doc.map.ownerId,accounts[1].id);assert.equal(doc.map.revision,3);assert.equal(doc.nodes.length,5);
});
