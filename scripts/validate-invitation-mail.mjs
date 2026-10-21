// Explicitly authorized inbox smoke; only newly created identities are tracked.
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { readFile,writeFile,rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { readTarget,createRun,trackUser,cleanupRun } from './validation-run.mjs';
const inboxFile='/private/tmp/mapa-invitation-mail-link.json';
const ticket=process.env.MAPA_EVIDENCE_TICKET??'04';
if(!/^(04|26)$/.test(ticket))throw Error('Unsupported evidence destination');
const evidence=`.scratch/mapa-mental/evidence/${ticket}`;
const target=readTarget();
const authorizedRecipient=ticket==='26'?'and3rsonsousa@outlook.com':'ochicosousa@gmail.com';
if(target.ref!=='bodxafqkqlyfoyfgahyj'||process.env.MAPA_INVITATION_EMAIL!==authorizedRecipient)throw Error('Authorized recipient and project required');
await rm(inboxFile,{force:true});
const run=await createRun(target);
const proof={runId:run.runId,startedAt:new Date().toISOString(),recipient:process.env.MAPA_INVITATION_EMAIL,cleaned:false,step:'admin-login'};
let browser;
try{
 const admin=createClient(target.url,target.secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
 browser=await chromium.launch();
 const adminContext=await browser.newContext({viewport:{width:1440,height:900}});const page=await adminContext.newPage();page.setDefaultTimeout(15000);
 const inviter=run.accounts.find(a=>a.key==='A');await page.goto('http://127.0.0.1:4174/login');
 await page.getByLabel('E-mail',{exact:true}).fill(inviter.email);await page.getByLabel('Senha',{exact:true}).fill(inviter.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL('**/mapas');
 await page.getByRole('link',{name:'Equipe',exact:true}).click();await page.getByLabel('E-mail da pessoa').fill(proof.recipient);await page.getByRole('button',{name:'Enviar convite',exact:true}).click();
 await page.getByRole('status').filter({hasText:'envio confirmado'}).waitFor();
 const saved=await admin.from('workspace_invitations').select('id,auth_user_id,delivery_state').eq('workspace_id',run.workspaces.X.id).eq('email',proof.recipient).single();
 if(saved.error||saved.data.delivery_state!=='sent'||!saved.data.auth_user_id)throw Error('Invitation delivery not confirmed');
 const created=await admin.auth.admin.getUserById(saved.data.auth_user_id);
 if(created.error||!created.data.user||Date.parse(created.data.user.created_at)<Date.parse(proof.startedAt))throw Error('Recipient is not a new identity from this run');
 await trackUser(run.runId,created.data.user.id);
 proof.newIdentity=true;proof.invitationId=saved.data.id;proof.requestedAt=new Date().toISOString();proof.step='waiting-inbox';
 await page.screenshot({path:`${evidence}/desktop-real-invitation-sent.png`,fullPage:true});
 console.log(JSON.stringify({phase:'waiting-inbox',requestedAt:proof.requestedAt,runId:run.runId}));
 let inbox;const deadline=Date.now()+900000;
 while(Date.now()<deadline){try{inbox=JSON.parse(await readFile(inboxFile,'utf8'));break;}catch{await delay(1000);}}
 if(!inbox)throw Error('Inbox receipt unavailable');
 const url=new URL(inbox.link);
 if(url.hostname!==`${target.ref}.supabase.co`||url.pathname!=='/auth/v1/verify'||url.searchParams.get('type')!=='invite'||url.searchParams.get('redirect_to')!=='http://127.0.0.1:4174/auth/callback')throw Error('Unexpected invitation URL');
 proof.step='password-form';
 const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const mobile=await mobileContext.newPage();mobile.setDefaultTimeout(15000);
 await mobile.goto(inbox.link);await mobile.getByRole('heading',{name:'Definir nova senha',exact:true}).waitFor();
 if(new URL(mobile.url()).hash||new URL(mobile.url()).search)throw Error('Token remained in address');
 const password=randomBytes(24).toString('base64url');await mobile.getByLabel('Nova senha',{exact:true}).fill(password);await mobile.getByLabel('Confirmar nova senha',{exact:true}).fill(password);await mobile.getByRole('button',{name:'Salvar nova senha'}).click();await mobile.getByText('Senha salva. Entre com sua nova senha.').waitFor();proof.passwordDefined=true;
 await mobile.getByLabel('E-mail',{exact:true}).fill(proof.recipient);await mobile.getByLabel('Senha',{exact:true}).fill(password);await mobile.getByRole('button',{name:'Entrar',exact:true}).click();await mobile.getByRole('button',{name:'Aceitar convite'}).waitFor();
 await mobile.screenshot({path:`${evidence}/mobile-real-pending.png`,fullPage:true});
 proof.step='accepting';await mobile.getByRole('button',{name:'Aceitar convite'}).click();await mobile.waitForURL('**/mapas');await mobile.getByRole('link',{name:'Equipe',exact:true}).click();await mobile.getByText('Pessoa da equipe (você)',{exact:true}).waitFor();
 if(await mobile.getByRole('button',{name:'Enviar convite',exact:true}).count())throw Error('Invited member sees admin controls');
 if(!await mobile.evaluate('document.documentElement.scrollWidth<=innerWidth'))throw Error('Mobile overflow');
 await mobile.screenshot({path:`${evidence}/mobile-real-member.png`,fullPage:true});
 await page.reload();await page.getByRole('listitem').filter({hasText:proof.recipient}).filter({hasText:'Aceito'}).waitFor();
 const membership=await admin.from('workspace_members').select('role,status').eq('workspace_id',run.workspaces.X.id).eq('user_id',created.data.user.id);
 if(membership.error||membership.data.length!==1||membership.data[0].role!=='member'||membership.data[0].status!=='active')throw Error('Invalid membership');
 proof.accepted=true;proof.singleMember=true;proof.crossBrowser=true;proof.tokensRemoved=true;proof.receivedMessageId=inbox.messageId;proof.step='complete';
 await mobile.getByRole('button',{name:'Sair',exact:true}).click();await mobile.waitForURL('**/login');
 await page.getByRole('button',{name:'Sair',exact:true}).click();await page.waitForURL('**/login');
}catch{proof.failed=true;process.exitCode=1;}
finally{
 await browser?.close();
 try{
  // Also capture a newly created identity if SMTP or browser validation failed
  // before the success-path registration. Never track a preexisting account.
  const admin=createClient(target.url,target.secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const invitation=await admin.from('workspace_invitations').select('auth_user_id').eq('workspace_id',run.workspaces.X.id).eq('email',proof.recipient).maybeSingle();
  if(invitation.data?.auth_user_id){const found=await admin.auth.admin.getUserById(invitation.data.auth_user_id);if(found.data.user&&found.data.user.email===proof.recipient&&Date.parse(found.data.user.created_at)>=Date.parse(proof.startedAt))await trackUser(run.runId,found.data.user.id);}
  await cleanupRun(target,run.runId);proof.cleaned=true;
 }catch{proof.cleanupFailed=true;process.exitCode=1;}
 await rm(inboxFile,{force:true});await writeFile(`${evidence}/real-email.json`,JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
}
