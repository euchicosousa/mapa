import {expect,test,type Page} from '@playwright/test';
import type {Run} from '../../scripts/validation-run.mjs';
const run=JSON.parse(process.env.MAPA_VALIDATION_RUN??'null') as Run|null;
if(!run)throw Error('Execução de validação ausente');
const [a,b,c]=run.accounts;
const button=(page:Page,name:string)=>page.getByRole('button',{name,exact:true});
async function login(page:Page,account:typeof a){await page.goto('/login');await page.getByLabel('E-mail',{exact:true}).fill(account.email);await page.getByLabel('Senha',{exact:true}).fill(account.password);await button(page,'Entrar').click();await expect(page.getByRole('heading',{name:'Seus mapas'})).toBeVisible();}
async function fixture(page:Page){
  const pending=page.waitForRequest(r=>r.url().includes('/rpc/list_map_library'));await login(page,a);const request=await pending,headers=await request.allHeaders();
  const auth={authorization:headers.authorization,apikey:headers.apikey},base=new URL('/rest/v1/rpc/',request.url()).href;
  const rpc=async(name:string,data:object)=>{const response=await page.request.post(base+name,{headers:auth,data});expect(response.status()).toBe(200);return response.json();};
  const made=await rpc('create_map',{p_workspace_id:run!.workspaces.X.id,p_operation_id:crypto.randomUUID(),p_editor_session_id:crypto.randomUUID(),p_title:`IA validação ${crypto.randomUUID().slice(0,8)}`});
  await page.goto(`/mapas/${made.mapId}`);await expect(page.locator('.react-flow__node')).toHaveCount(1);await expect(button(page,'Gerar caminhos com IA')).toBeVisible();
  const doc=await rpc('get_map_document',{p_map_id:made.mapId});
  return {mapId:made.mapId as string,root:doc.nodes[0].id as string,rpc,auth,base};
}
test.skip(process.env.MAPA_AI_VALIDATION!=='1','IA real requer liberação explícita das identidades temporárias.');
test('real AI inserts four children once after a lost response, batch undo/redo and colleague authorship',async({page},info)=>{
  test.setTimeout(150_000);const f=await fixture(page);let originalRequest:Record<string,unknown>|null=null;
  await page.route('**/functions/v1/generate-children',async route=>{
    const body=route.request().postDataJSON();
    if(body.action==='availability'){await route.continue();return;}
    originalRequest=body;
    // Both duplicate HTTP requests reach the real Edge Function concurrently.
    const results=await Promise.all([route.fetch(),route.fetch()]);expect(results.every(r=>r.status()===200)).toBe(true);
    await route.abort('timedout');
  });
  await page.getByLabel('Orientação para a IA (opcional)',{exact:true}).fill('Sugira quatro etapas curtas para organizar um projeto.');
  await button(page,'Gerar caminhos com IA').click();
  await expect(page.getByText('Quatro caminhos gerados com IA e salvos no mapa.',{exact:true})).toBeVisible({timeout:65_000});
  await expect(page.locator('.react-flow__node')).toHaveCount(5);const applied=await f.rpc('get_map_document',{p_map_id:f.mapId});expect(applied.map.revision).toBe(2);
  const children=applied.nodes.filter((n:{source:string})=>n.source==='ai');expect(children).toHaveLength(4);
  expect(new Set(children.map((n:{text:string})=>n.text.toLowerCase().trim())).size).toBe(4);
  for(const node of children){expect(node.createdBy).toBe(a.id);expect(node.updatedBy).toBe(a.id);expect(node.parentId).toBe(f.root);expect(node.aiGenerationId).toBe(originalRequest!.generationId);}
  await button(page,'Enquadrar').click();await page.screenshot({path:info.outputPath('ai-applied.png'),fullPage:true});
  await button(page,'Desfazer').click();await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await button(page,'Refazer').click();await expect(page.locator('.react-flow__node')).toHaveCount(5);
  const redone=await f.rpc('get_map_document',{p_map_id:f.mapId});expect(redone.nodes).toEqual(applied.nodes);
  await page.reload();await expect(page.locator('.react-flow__node')).toHaveCount(5);await expect(button(page,'Desfazer')).toBeDisabled();
  await button(page,'Sair').click();await expect(page.getByLabel('E-mail',{exact:true})).toBeVisible();await login(page,b);await page.goto(`/mapas/${f.mapId}`);await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await page.locator('.react-flow__node').filter({has:page.getByText(children[0].text,{exact:true})}).click();await expect(page.getByText(`Gerado com IA por ${a.name}`,{exact:false})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('ai-colleague-authorship.png'),fullPage:true});
  if(info.project.name==='mobile'){
    await page.setViewportSize({width:360,height:844});await button(page,'Enquadrar').click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('ai-360.png'),fullPage:true});
  }
});
test('typing during a real generation is preserved through conflict recovery',async({page},info)=>{
  test.setTimeout(150_000);const f=await fixture(page);
  // Delay status delivery, not the provider or database: the response is real.
  let hold=false;await page.route('**/rpc/get_ai_generation',async route=>{
    const response=await route.fetch();const job=await response.json();
    if(hold&&job?.state==='applied')await new Promise(resolve=>setTimeout(resolve,1800));
    await route.fulfill({response});
  });
  await page.getByLabel('Orientação para a IA (opcional)',{exact:true}).fill('Crie quatro perguntas sobre planejamento.');
  hold=true;await button(page,'Gerar caminhos com IA').click();
  // Keep an invalid draft in the text field, so it remains uncommitted and is
  // guaranteed to coexist with the result, even on a very fast provider response.
  await button(page,'Editar texto').click();await page.getByLabel('Texto do nó',{exact:true}).fill('  ');
  await expect(page.getByRole('heading',{name:'Duas versões foram preservadas'})).toBeVisible({timeout:65_000});
  await expect(page.getByLabel('Texto do nó',{exact:true})).toHaveValue('  ');
  const remote=await f.rpc('get_map_document',{p_map_id:f.mapId});expect(remote.nodes).toHaveLength(5);expect(remote.nodes.find((n:{id:string})=>n.id===f.root).text).not.toBe('  ');
  await page.screenshot({path:info.outputPath('ai-preserved-draft.png'),fullPage:true});
});
test('ordinary clients cannot forge AI batches, call worker RPCs or read another workspace job',async({page})=>{
  test.setTimeout(75_000);const f=await fixture(page);
  for(const [kind,payload] of [['ai_children',{}],['add_child',{nodeId:crypto.randomUUID(),parentId:f.root,text:'Forjado',source:'ai'}]]){
    const response=await page.request.post(f.base+'apply_map_command',{headers:f.auth,data:{p_map_id:f.mapId,p_operation_id:crypto.randomUUID(),p_editor_session_id:crypto.randomUUID(),p_expected_revision:1,p_kind:kind,p_payload:payload}});expect(response.status()).toBe(400);
  }
  const finish=await page.request.post(f.base+'finish_ai_generation',{headers:f.auth,data:{p_generation_id:crypto.randomUUID(),p_children:[],p_usage:null,p_error:null}});expect([401,403,404]).toContain(finish.status());
  await button(page,'Sair').click();await expect(page.getByLabel('E-mail',{exact:true})).toBeVisible();const pending=page.waitForRequest(r=>r.url().includes('/rpc/list_map_library'));await login(page,c);const otherHeaders=await (await pending).allHeaders();
  const denied=await page.request.post(f.base+'get_ai_generation',{headers:{authorization:otherHeaders.authorization,apikey:otherHeaders.apikey},data:{p_map_id:f.mapId,p_generation_id:null,p_editor_session_id:crypto.randomUUID()}});expect(denied.status()).toBe(400);expect((await denied.json()).message).toBe('NOT_FOUND');
  const before=await f.rpc('get_map_document',{p_map_id:f.mapId});expect(before.map.revision).toBe(1);expect(before.nodes).toHaveLength(1);
});
