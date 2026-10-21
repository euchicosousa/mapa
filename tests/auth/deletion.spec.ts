import { expect,test,type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import type { Run } from '../../scripts/validation-run.mjs';
const run=JSON.parse(process.env.MAPA_VALIDATION_RUN??'null') as Run|null;
if(!run)throw Error('Execução de validação ausente');
const [a,b,c]=run.accounts;
function membership(status:'active'|'inactive'){
  const result=spawnSync(process.execPath,['scripts/validation-run.mjs','membership-status',run!.runId,b.id,status],{encoding:'utf8'});
  expect(result.status,'Vínculo temporário da execução').toBe(0);
}
const button=(page:Page,name:string)=>page.getByRole('button',{name,exact:true});
async function login(page:Page,account:typeof a,url='/mapas'){
  await page.goto(url);await page.getByLabel('E-mail',{exact:true}).fill(account.email);await page.getByLabel('Senha',{exact:true}).fill(account.password);await button(page,'Entrar').click();
}
async function fixture(page:Page){
  const initial=page.waitForRequest(r=>r.url().includes('/rpc/list_map_library'));await login(page,b);await expect(page.getByRole('heading',{name:'Seus mapas'})).toBeVisible();
  const req=await initial,headers=await req.allHeaders(),auth={authorization:headers.authorization,apikey:headers.apikey},base=new URL('/rest/v1/rpc/',req.url()).href;
  const rpc=async(name:string,data:object)=>page.request.post(base+name,{headers:auth,data});
  const title=`Excluir ${crypto.randomUUID().slice(0,8)}`,made=await rpc('create_map',{p_workspace_id:run!.workspaces.X.id,p_operation_id:crypto.randomUUID(),p_editor_session_id:crypto.randomUUID(),p_title:title});expect(made.status()).toBe(200);const mapId=(await made.json()).mapId as string;
  await page.goto(`/mapas/${mapId}`);await expect(page.locator('.react-flow__node')).toHaveCount(1);await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  return {title,mapId,rpc,base,auth};
}
async function confirm(page:Page,title:string){
  await button(page,'Detalhes do mapa').click();await button(page,'Excluir mapa').click();const dialog=page.getByRole('dialog',{name:'Excluir este mapa?'});await expect(dialog.getByText(title,{exact:true})).toBeVisible();return dialog;
}
test('owner confirms or cancels soft deletion, library and direct URL reveal no retained content',async({page},info)=>{
  test.setTimeout(90_000);const f=await fixture(page);let deletes=0;page.on('request',r=>{if(r.url().includes('/rpc/apply_map_command')&&r.postDataJSON().p_kind==='delete_map')deletes++;});
  await confirm(page,f.title);await button(page,'Cancelar exclusão').click();expect(deletes).toBe(0);await button(page,'Fechar detalhes').click();
  const before=await f.rpc('get_map_document',{p_map_id:f.mapId});expect((await before.json()).map.revision).toBe(1);
  const dialog=await confirm(page,f.title);await page.screenshot({path:info.outputPath('delete-confirmation.png'),fullPage:true});await dialog.getByRole('button',{name:'Confirmar exclusão',exact:true}).click();await expect(page).toHaveURL(/\/mapas$/);expect(deletes).toBe(1);
  await page.getByLabel('Buscar pelo título').fill(f.title);await expect(page.locator('.library-map-link:visible')).toHaveCount(0);await expect(page.getByText(/Nenhum mapa (ainda|com esses filtros)/)).toBeVisible();await page.screenshot({path:info.outputPath('deleted-not-in-library.png'),fullPage:true});
  const hidden=await f.rpc('get_map_document',{p_map_id:f.mapId});expect((await hidden.json()).details).toBe('MAP_DELETED');
  const nodes=await page.request.get(new URL(`/rest/v1/nodes?map_id=eq.${f.mapId}&select=id,text`,f.base).href,{headers:f.auth});expect(nodes.status()).toBe(200);expect(await nodes.json()).toEqual([]);
  await page.goto(`/mapas/${f.mapId}`);await expect(page.getByRole('heading',{name:'Mapa indisponível',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Este mapa foi excluído'})).toBeVisible();await expect(page.locator('.react-flow__node')).toHaveCount(0);await expect(button(page,'Exportar rascunho local')).toHaveCount(0);await expect(page.getByText(f.title,{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('deleted-direct-url.png'),fullPage:true});
});
test('admin deletes while colleague has a pending edit; local draft survives without restoring server data',async({page,browser},info)=>{
  test.setTimeout(120_000);page.on('dialog',d=>void d.accept());const f=await fixture(page),mobile=info.project.name==='mobile';
  const other=await browser.newContext({viewport:page.viewportSize(),isMobile:mobile,hasTouch:mobile});let release:()=>void=()=>{};let reached:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{reached=resolve;});
  try{
    const adminPage=await other.newPage();await login(adminPage,a,`${new URL(page.url()).origin}/login?next=/mapas/${f.mapId}`);await expect(adminPage.locator('.react-flow__node')).toHaveCount(1);
    await page.bringToFront();await page.route('**/rpc/apply_map_command',async route=>{if(route.request().postDataJSON().p_kind==='edit_text'){reached();await gate;}await route.continue();});
    await button(page,'Editar texto').click();await page.getByLabel('Texto do nó',{exact:true}).fill('Rascunho local anterior à exclusão');await button(page,'Concluir edição').click();await ready;
    await adminPage.bringToFront();const dialog=await confirm(adminPage,f.title);await dialog.getByRole('button',{name:'Confirmar exclusão',exact:true}).click();await expect(adminPage).toHaveURL(/\/mapas$/);release();await page.bringToFront();
    await expect(page.getByRole('heading',{name:'Este mapa foi excluído'})).toBeVisible();await expect(button(page,'Exportar rascunho local')).toBeVisible();await expect(page.locator('.react-flow__node')).toHaveCount(0);await expect(button(page,'Salvar minha versão como cópia')).toHaveCount(0);
    await page.reload();await expect(button(page,'Exportar rascunho local')).toBeVisible();const downloading=page.waitForEvent('download');await button(page,'Exportar rascunho local').click();const download=await downloading,path=info.outputPath('draft-emergency.json');await download.saveAs(path);expect(await readFile(path,'utf8')).toContain('Rascunho local anterior à exclusão');
    await page.screenshot({path:info.outputPath('deleted-colleague-draft.png'),fullPage:true});
    const doc=await f.rpc('get_map_document',{p_map_id:f.mapId});expect((await doc.json()).details).toBe('MAP_DELETED');
    // Leaving the screen while a real access check is in flight cannot download later.
    let lateDownloads=0;page.on('download',()=>{lateDownloads++;});
    let accessRelease:()=>void=()=>{},accessSeen=false;const accessGate=new Promise<void>(resolve=>{accessRelease=resolve;});
    await page.route('**/rpc/get_map_document',async route=>{const response=await route.fetch();accessSeen=true;await accessGate;await route.fulfill({response});});
    await button(page,'Exportar rascunho local').click();await expect.poll(()=>accessSeen).toBe(true);
    await page.getByRole('link',{name:'Mapas',exact:true}).click();await expect(page).toHaveURL(/\/mapas$/);accessRelease();await page.unroute('**/rpc/get_map_document');
    await page.goto(`/mapas/${f.mapId}`);await expect(button(page,'Exportar rascunho local')).toBeVisible();expect(lateDownloads).toBe(0);
    // Export checks current membership again, rather than trusting a stale page.
    let unauthorizedDownloads=0;page.on('download',()=>{unauthorizedDownloads++;});membership('inactive');
    await button(page,'Exportar rascunho local').click();await expect(page).toHaveURL(/\/sem-acesso$/);expect(unauthorizedDownloads).toBe(0);
    await expect(button(page,'Exportar rascunho local')).toHaveCount(0);
    expect(await page.evaluate(async(userId)=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('mapa.drafts.v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise<number>((resolve,reject)=>{const r=db.transaction('drafts','readonly').objectStore('drafts').getAll();r.onsuccess=()=>resolve(r.result.filter((record:{userId:string})=>record.userId===userId).length);r.onerror=()=>reject(r.error);});}finally{db.close();}},b.id)).toBe(0);
    membership('active');
    const foreign=await page.request.post(new URL('/auth/v1/token?grant_type=password',f.base).href,{headers:{apikey:f.auth.apikey},data:{email:c.email,password:c.password}});expect(foreign.status()).toBe(200);const foreignDoc=await page.request.post(f.base+'get_map_document',{headers:{...f.auth,authorization:`Bearer ${(await foreign.json()).access_token}`},data:{p_map_id:f.mapId}});expect(await foreignDoc.json()).toBeNull();
  }finally{release();membership('active');await other.close();}
});
test('a committed deletion with a lost response can be confirmed after reload with the identical request',async({page},info)=>{
  test.setTimeout(90_000);page.on('dialog',d=>void d.accept());const f=await fixture(page),requests:unknown[]=[];
  await page.route('**/rpc/apply_map_command',async route=>{if(route.request().postDataJSON().p_kind!=='delete_map'){await route.continue();return;}requests.push(route.request().postDataJSON());if(requests.length===1){const actual=await route.fetch();expect(actual.status()).toBe(200);await route.abort('timedout');}else await route.continue();});
  const dialog=await confirm(page,f.title);await dialog.getByRole('button',{name:'Confirmar exclusão',exact:true}).click();await expect(page.getByText('Não foi possível confirmar a exclusão. Tente novamente; a mesma solicitação será repetida.')).toBeVisible();await page.reload();await expect(button(page,'Confirmar exclusão pendente')).toBeVisible();await page.screenshot({path:info.outputPath('delete-pending-recovery.png'),fullPage:true});
  await button(page,'Confirmar exclusão pendente').click();await expect(page).toHaveURL(/\/mapas$/);expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);await page.goto(`/mapas/${f.mapId}`);await expect(page.getByRole('heading',{name:'Este mapa foi excluído'})).toBeVisible();await expect(button(page,'Confirmar exclusão pendente')).toHaveCount(0);
});
