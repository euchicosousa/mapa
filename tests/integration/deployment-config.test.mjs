import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {readTarget,createRun,cleanupRun} from '../../scripts/validation-run.mjs';
let target,run,token;
const observations=[];
before(async()=>{
 target=readTarget();run=await createRun(target);
 const client=createClient(target.url,target.publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const login=await client.auth.signInWithPassword({email:run.accounts[1].email,password:run.accounts[1].password});assert.equal(login.error,null);token=login.data.session.access_token;
});
after(async()=>{try{await writeFile('.scratch/mapa-mental/evidence/26/live-cors.json',JSON.stringify(observations,null,2)+'\n');}finally{if(run)await cleanupRun(target,run.runId);}});
test('public Auth has signup disabled while password email sign-in remains available',async()=>{
 const response=await globalThis.fetch(target.url+'/auth/v1/settings',{headers:{apikey:target.publicKey}});assert.equal(response.status,200);const settings=await response.json();
 assert.equal(settings.disable_signup,true);assert.equal(settings.external.email,true);assert.equal(settings.external.anonymous_users,false);
 observations.push({auth:{disableSignup:true,emailProvider:true,anonymousUsers:false}});
});
for(const name of ['generate-children','manage-invitation'])test(`${name}: exact production/local CORS and independent JWT authorization`,async()=>{
 const url=`${target.url}/functions/v1/${name}`;
 for(const origin of ['https://mapa.cnvt.com.br','http://127.0.0.1:4174']){
  const response=await globalThis.fetch(url,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,apikey,content-type,traceparent'}});
  assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);assert.match(response.headers.get('Access-Control-Allow-Headers'),/traceparent/);assert.match(response.headers.get('Vary'),/Origin/);observations.push({name,origin,preflight:response.status});
 }
 const headers={apikey:target.publicKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 const foreign=await globalThis.fetch(url,{method:'POST',headers:{...headers,Origin:'https://mapa.cnvt.com.br.evil.test'},body:JSON.stringify({action:'availability'})});assert.equal(foreign.status,403);assert.equal(foreign.headers.get('Access-Control-Allow-Origin'),null);
 const denied=await globalThis.fetch(url,{method:'POST',headers:{apikey:target.publicKey,Origin:'https://mapa.cnvt.com.br','Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,401);
 if(name==='generate-children')for(const origin of [null,'https://mapa.cnvt.com.br']){
  const response=await globalThis.fetch(url,{method:'POST',headers:{...headers,...(origin?{Origin:origin}:{})},body:JSON.stringify({action:'availability'})});assert.equal(response.status,200);assert.equal((await response.json()).enabled,true);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
 }
 observations.push({name,foreignOrigin:403,missingJwt:401});
});
