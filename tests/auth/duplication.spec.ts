import { expect,test,type Page } from '@playwright/test';
import type { Run } from '../../scripts/validation-run.mjs';
const run=JSON.parse(process.env.MAPA_VALIDATION_RUN??'null') as Run|null;
if(!run)throw Error('Execução de validação ausente');
const [a,b]=run.accounts;
const button=(page:Page,name:string)=>page.getByRole('button',{name,exact:true});
const saved=(page:Page)=>expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
async function login(page:Page,account:typeof a,url='/mapas'){
  await page.goto(url);await page.getByLabel('E-mail',{exact:true}).fill(account.email);await page.getByLabel('Senha',{exact:true}).fill(account.password);await button(page,'Entrar').click();
}
async function fixture(page:Page){
  const requested=page.waitForRequest(r=>r.url().includes('/rpc/list_map_library'));await login(page,a);await expect(page.getByRole('heading',{name:'Seus mapas'})).toBeVisible();
  const req=await requested,headers=await req.allHeaders(),auth={authorization:headers.authorization,apikey:headers.apikey},base=new URL('/rest/v1/rpc/',req.url()).href;
  const rpc=async(name:string,data:object)=>{const response=await page.request.post(base+name,{headers:auth,data});expect(response.status()).toBe(200);return await response.json();};
  const title=`Duplicação ${crypto.randomUUID().slice(0,8)}`,session=crypto.randomUUID();
  const made=await rpc('create_map',{p_workspace_id:run!.workspaces.X.id,p_operation_id:crypto.randomUUID(),p_editor_session_id:session,p_title:title});const mapId=made.mapId as string;
  const initial=await rpc('get_map_document',{p_map_id:mapId}),root=initial.nodes[0].id as string,branch=crypto.randomUUID(),leaf=crypto.randomUUID();let revision=1;
  for(const [nodeId,parentId,text] of [[branch,root,'Outra direção'],[leaf,branch,'Aprofundar ideia']])await rpc('apply_map_command',{p_map_id:mapId,p_operation_id:crypto.randomUUID(),p_editor_session_id:session,p_expected_revision:revision++,p_kind:'add_child',p_payload:{nodeId,parentId,text}});
  const project=await rpc('create_project',{p_project_id:crypto.randomUUID(),p_workspace_id:run!.workspaces.X.id,p_name:title,p_client_name:'Cliente da cópia'});
  await rpc('apply_map_command',{p_map_id:mapId,p_operation_id:crypto.randomUUID(),p_editor_session_id:session,p_expected_revision:revision,p_kind:'set_project',p_payload:{projectId:project.id}});
  const original=await rpc('get_map_document',{p_map_id:mapId});
  await button(page,'Sair').click();await expect(page.getByLabel('E-mail',{exact:true})).toBeVisible();await login(page,b,`/login?next=/mapas/${mapId}`);await expect(page.locator('.react-flow__node')).toHaveCount(3);await saved(page);
  return {mapId,title,rpc,original};
}
async function confirm(page:Page){await button(page,'Detalhes do mapa').click();await button(page,'Duplicar mapa').click();return page.getByRole('dialog',{name:'Duplicar este mapa?'});}
test('a colleague duplicates the saved map into a new URL, owns the copy and can edit/delete without touching the original',async({page},info)=>{
  test.setTimeout(100_000);const f=await fixture(page),dialog=await confirm(page);await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Voltar ao original'}).click();await expect(page).toHaveURL(new RegExp(`/mapas/${f.mapId}$`));await button(page,'Duplicar mapa').click();
  await page.screenshot({path:info.outputPath('duplicate-confirmation.png'),fullPage:true});let requests=0;page.on('request',r=>{if(r.url().includes('/rpc/duplicate_map'))requests++;});
  await button(page,'Confirmar duplicação').click();await expect(page).not.toHaveURL(new RegExp(`/mapas/${f.mapId}$`));await expect(page.locator('.react-flow__node')).toHaveCount(3);await saved(page);expect(requests).toBe(1);
  const copyId=new URL(page.url()).pathname.split('/').pop()!,copy=await f.rpc('get_map_document',{p_map_id:copyId});expect(copy.map.title).toBe(f.title+' — cópia');expect(copy.map.projectId).toBe(f.original.map.projectId);expect(copy.map.ownerId).toBe(b.id);expect(copy.map.revision).toBe(1);
  expect(copy.nodes.map((n:{text:string})=>n.text).sort()).toEqual(f.original.nodes.map((n:{text:string})=>n.text).sort());for(const node of copy.nodes){expect(f.original.nodes.some((old:{id:string})=>old.id===node.id)).toBe(false);expect(node.createdBy).toBe(b.id);expect(node.source).toBe('manual');}
  await button(page,'Detalhes do mapa').click();await expect(page.getByLabel('Título do mapa',{exact:true})).toHaveValue(f.title+' — cópia');await expect(page.getByLabel('Projeto do mapa',{exact:true})).toHaveValue(f.original.map.projectId);await expect(page.getByText(`Responsável atual: ${b.name}`,{exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('duplicate-details.png'),fullPage:true});await button(page,'Fechar detalhes').click();
  await expect(button(page,'Desfazer')).toBeDisabled();await button(page,'Editar texto').click();await page.getByLabel('Texto do nó',{exact:true}).fill('Nova direção da cópia');await button(page,'Concluir edição').click();await expect(page.locator('.node-panel .node-text')).toHaveText('Nova direção da cópia');await saved(page);
  const branch=copy.nodes.find((n:{text:string})=>n.text==='Outra direção');await page.locator(`.react-flow__node[data-id="${branch.id}"]`).click();await expect(page.locator('.node-panel .node-text')).toHaveText('Outra direção');await button(page,'Excluir ramo').click();await page.getByRole('dialog').getByRole('button',{name:'Confirmar exclusão',exact:true}).click();await expect(page.locator('.react-flow__node')).toHaveCount(1);await saved(page);
  expect(await f.rpc('get_map_document',{p_map_id:f.mapId})).toEqual(f.original);await page.screenshot({path:info.outputPath('duplicate-independent.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('link',{name:'Mapas',exact:true}).click();await page.getByLabel('Buscar pelo título').fill(f.title);await expect(page.locator('.library-map-link:visible')).toHaveCount(2);
  if(info.project.name==='mobile'){await page.setViewportSize({width:360,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
});
test('a lost committed response keeps the original and retries the same operation after reload despite source changes',async({page},info)=>{
  test.setTimeout(100_000);const f=await fixture(page),requests:unknown[]=[];
  await page.route('**/rpc/duplicate_map',async route=>{requests.push(route.request().postDataJSON());if(requests.length===1){const committed=await route.fetch();expect(committed.status()).toBe(200);await route.abort('timedout');}else await route.continue();});
  await confirm(page);await button(page,'Confirmar duplicação').click();await expect(page.getByText('Não foi possível confirmar a cópia. Tente novamente; a mesma solicitação será repetida.')).toBeVisible();await expect(page).toHaveURL(new RegExp(`/mapas/${f.mapId}$`));
  await page.screenshot({path:info.outputPath('duplicate-lost-response.png'),fullPage:true});
  await f.rpc('apply_map_command',{p_map_id:f.mapId,p_operation_id:crypto.randomUUID(),p_editor_session_id:crypto.randomUUID(),p_expected_revision:f.original.map.revision,p_kind:'rename_map',p_payload:{title:f.title+' alterado'}});
  await page.reload();await expect(page.locator('.react-flow__node')).toHaveCount(3);await saved(page);await confirm(page);await expect(page.getByText('Há uma cópia aguardando confirmação. A nova tentativa retoma a primeira solicitação, mesmo que o original tenha mudado depois.')).toBeVisible();await button(page,'Tentar confirmar cópia').click();await expect(page).not.toHaveURL(new RegExp(`/mapas/${f.mapId}$`));await saved(page);
  expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);const copyId=new URL(page.url()).pathname.split('/').pop()!,copy=await f.rpc('get_map_document',{p_map_id:copyId});expect(copy.map.title).toBe(f.title+' — cópia');
  const library=await f.rpc('list_map_library',{p_workspace_id:run!.workspaces.X.id,p_query:f.title});expect(library.total).toBe(2);
  await page.screenshot({path:info.outputPath('duplicate-retried-once.png'),fullPage:true});
});
test('storage failure prevents the request and double click stays disabled until the real server confirmation',async({page},info)=>{
  test.setTimeout(100_000);const f=await fixture(page);let requests=0;
  await f.rpc('apply_map_command',{p_map_id:f.mapId,p_operation_id:crypto.randomUUID(),p_editor_session_id:crypto.randomUUID(),p_expected_revision:f.original.map.revision,p_kind:'rename_map',p_payload:{title:'W'.repeat(120)}});
  await page.reload();await expect(page.locator('.react-flow__node')).toHaveCount(3);await saved(page);
  page.on('request',request=>{if(request.url().includes('/rpc/duplicate_map'))requests++;});
  await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('mapa.duplicate.v1:'))throw new DOMException('Controlled storage denial','QuotaExceededError');return original.call(this,key,value);};});
  await confirm(page);await button(page,'Confirmar duplicação').click();await expect(page.getByText('Não foi possível guardar a solicitação neste navegador. Libere o armazenamento e tente novamente.')).toBeVisible();expect(requests).toBe(0);await expect(page).toHaveURL(new RegExp(`/mapas/${f.mapId}$`));
  await page.reload();await expect(page.locator('.react-flow__node')).toHaveCount(3);await saved(page);
  let release:()=>void=()=>{},reached:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{reached=resolve;});
  await page.route('**/rpc/duplicate_map',async route=>{const response=await route.fetch();expect(response.status()).toBe(200);reached();await gate;await route.fulfill({response});});
  try{
    await confirm(page);expect(await page.locator('.draft-dialog').evaluateAll(dialogs=>dialogs.every(dialog=>dialog.scrollWidth<=dialog.clientWidth+1))).toBe(true);await button(page,'Confirmar duplicação').dblclick();await ready;expect(requests).toBe(1);await expect(button(page,'Duplicando…')).toBeDisabled();await expect(button(page,'Voltar ao original')).toBeDisabled();
    await page.screenshot({path:info.outputPath('duplicate-waiting-confirmation.png'),fullPage:true});release();await expect(page).not.toHaveURL(new RegExp(`/mapas/${f.mapId}$`));await expect(page.locator('.react-flow__node')).toHaveCount(3);await saved(page);expect(requests).toBe(1);
  }finally{release();}
});
