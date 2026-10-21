import { expect,test,type Page } from '@playwright/test';
import type { Run } from '../../scripts/validation-run.mjs';
const run=JSON.parse(process.env.MAPA_VALIDATION_RUN??'null') as Run|null;
if(!run)throw Error('Execução de validação ausente');
const [a,b,c]=run.accounts;
const links=(page:Page)=>page.locator('.library-map-link:visible');
const titles=(page:Page)=>page.locator('.library-table .library-map-link:visible,.library-cards .library-map-link:visible strong');
const button=(page:Page,name:string)=>page.getByRole('button',{name,exact:true});
test('projects, 45-map pagination, URL filters and late searches work against Primary',async({page},info)=>{
  test.setTimeout(180_000);
  const prefix=`Biblioteca ${info.project.name} ${crypto.randomUUID().slice(0,8)}`;
  const initial=page.waitForRequest(r=>r.url().includes('/rpc/list_map_library'));
  await page.goto('/mapas');await page.getByLabel('E-mail',{exact:true}).fill(b.email);await page.getByLabel('Senha',{exact:true}).fill(b.password);await button(page,'Entrar').click();
  await expect(page.getByRole('heading',{name:'Seus mapas'})).toBeVisible();
  const request=await initial,headers=await request.allHeaders(),auth={authorization:headers.authorization,apikey:headers.apikey},base=new URL('/rest/v1/rpc/',request.url()).href;
  const rpc=async(name:string,data:object,token=auth)=>{const r=await page.request.post(base+name,{headers:token,data});expect(r.status()).toBe(200);return await r.json();};
  const accountAuth=async(account:typeof a)=>{const r=await page.request.post(new URL('/auth/v1/token?grant_type=password',base).href,{headers:{apikey:auth.apikey},data:{email:account.email,password:account.password}});expect(r.status()).toBe(200);return {...auth,authorization:`Bearer ${(await r.json()).access_token}`};};
  const aAuth=await accountAuth(a),cAuth=await accountAuth(c);
  const maps:string[]=[];
  for(let start=0;start<45;start+=5)await Promise.all(Array.from({length:Math.min(5,45-start)},async(_,offset)=>{const i=start+offset;const made=await rpc('create_map',{p_workspace_id:run!.workspaces.X.id,p_operation_id:crypto.randomUUID(),p_editor_session_id:crypto.randomUUID(),p_title:`${prefix} ${String(i).padStart(2,'0')}`},i%2?aAuth:auth);maps[i]=made.mapId;}));
  const foreign=await rpc('create_map',{p_workspace_id:run!.workspaces.Y.id,p_operation_id:crypto.randomUUID(),p_editor_session_id:crypto.randomUUID(),p_title:prefix},cAuth);
  const payloads:unknown[]=[];let documentRequests=0;
  page.on('response',response=>{if(response.url().includes('/rpc/list_map_library')&&response.ok())void response.json().then(body=>payloads.push(body)).catch(()=>{});});
  page.on('request',r=>{if(r.url().includes('/rpc/get_map_document'))documentRequests++;});
  await page.getByLabel('Buscar pelo título').fill(prefix);await expect(links(page)).toHaveCount(20);await expect(page.getByText('45 mapas encontrados',{exact:true})).toBeVisible();
  const seen=await links(page).evaluateAll(elements=>elements.map(e=>e.getAttribute('href')));
  await button(page,'Próxima página').click();await expect(page.getByText('Página 2 de 3',{exact:true})).toBeVisible();await expect(links(page)).toHaveCount(20);seen.push(...await links(page).evaluateAll(elements=>elements.map(e=>e.getAttribute('href'))));
  await button(page,'Próxima página').click();await expect(page.getByText('Página 3 de 3',{exact:true})).toBeVisible();await expect(links(page)).toHaveCount(5);seen.push(...await links(page).evaluateAll(elements=>elements.map(e=>e.getAttribute('href'))));
  expect(new Set(seen).size).toBe(45);expect(seen).not.toContain(`/mapas/${foreign.mapId}`);expect(documentRequests).toBe(0);
  await page.reload();await expect(page.getByText('Página 3 de 3',{exact:true})).toBeVisible();await expect(page.getByLabel('Buscar pelo título')).toHaveValue(prefix);
  await page.screenshot({path:info.outputPath('library-pagination.png'),fullPage:true});
  // Create and rename through the interface, keeping 121-character input visible for correction.
  await button(page,'Projetos').click();await page.getByLabel('Nome do projeto',{exact:true}).fill('x'.repeat(121));await expect(button(page,'Criar projeto')).toBeDisabled();await expect(page.getByLabel('Nome do projeto',{exact:true})).toHaveValue('x'.repeat(121));
  const projectName=`Projeto ${prefix}`,clientName='Cliente CNVT';
  await page.getByLabel('Nome do projeto',{exact:true}).fill(projectName);await page.getByLabel('Cliente (opcional)').fill(clientName);await button(page,'Criar projeto').click();await expect(page.getByText('Projeto criado.',{exact:true})).toBeVisible();
  await button(page,`Editar projeto: ${projectName}`).click();await page.getByLabel('Nome do projeto',{exact:true}).fill(projectName+' final');await button(page,'Salvar projeto').click();await expect(page.getByText('Projeto atualizado.',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('projects.png'),fullPage:true});await button(page,'Fechar projetos').click();
  const projectId=await page.getByLabel('Projeto ou cliente').locator('option').filter({hasText:projectName+' final'}).getAttribute('value');expect(projectId).toBeTruthy();
  const before=await rpc('get_map_document',{p_map_id:maps[0]});
  await page.goto(`/mapas/${maps[0]}`);await expect(page.locator('.react-flow__node')).toHaveCount(1);await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  await button(page,'Detalhes do mapa').click();await page.getByLabel('Título do mapa',{exact:true}).fill('x'.repeat(121));await expect(button(page,'Salvar título')).toBeDisabled();
  const renamed=`${prefix} Renomeado`;await page.getByLabel('Título do mapa',{exact:true}).fill(renamed);await button(page,'Salvar título').click();await expect(page.getByText('Mapa salvo',{exact:true})).toBeVisible();
  await page.getByLabel('Projeto do mapa',{exact:true}).selectOption(projectId!);await button(page,'Salvar projeto do mapa').click();await expect(page.getByText('Mapa salvo',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('map-details.png'),fullPage:true});await button(page,'Fechar detalhes').click();
  const after=await rpc('get_map_document',{p_map_id:maps[0]});expect(after.nodes).toEqual(before.nodes);expect(after.map.revision).toBe(before.map.revision+2);expect(after.map.projectId).toBe(projectId);
  await button(page,'Desfazer').click();await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);expect((await rpc('get_map_document',{p_map_id:maps[0]})).map.projectId).toBeNull();
  await button(page,'Refazer').click();await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);expect((await rpc('get_map_document',{p_map_id:maps[0]})).map.projectId).toBe(projectId);
  await page.getByRole('link',{name:'Mapas',exact:true}).click();await page.getByLabel('Buscar pelo título').fill(prefix);await page.getByLabel('Projeto ou cliente').selectOption(projectId!);await page.getByLabel('Responsável',{exact:true}).selectOption(b.id);
  await expect(links(page)).toHaveCount(1);await expect(titles(page)).toHaveText(renamed);const filteredURL=page.url();await page.reload();await expect(titles(page)).toHaveText(renamed);expect(page.url()).toBe(filteredURL);await expect(page.getByLabel('Projeto ou cliente')).toHaveValue(projectId!);await expect(page.getByLabel('Responsável',{exact:true})).toHaveValue(b.id);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('library-filtered.png'),fullPage:true});
  if(info.project.name==='mobile'){await page.setViewportSize({width:360,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.setViewportSize({width:390,height:844});}
  // An actual failed read retains filters and retries the same real endpoint.
  await page.route('**/rpc/list_map_library',route=>route.abort('failed'));await page.reload();await expect(page.getByText('Não foi possível carregar os mapas. Seus filtros continuam aqui.')).toBeVisible();expect(page.url()).toBe(filteredURL);await expect(page.getByLabel('Projeto ou cliente')).toHaveValue(projectId!);
  await page.unroute('**/rpc/list_map_library');await button(page,'Tentar carregar mapas').click();await expect(titles(page)).toHaveText(renamed);
  // Hold a real response for an old search while the newer search finishes.
  await button(page,'Limpar filtros').click();await expect(links(page)).toHaveCount(20);
  let release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});let oldArrived:()=>void=()=>{};const oldReady=new Promise<void>(resolve=>{oldArrived=resolve;});
  await page.route('**/rpc/list_map_library',async route=>{const body=route.request().postDataJSON();if(body.p_query===prefix+' 00'){const response=await route.fetch();oldArrived();await held;await route.fulfill({response}).catch(()=>{});}else await route.continue();});
  await page.getByLabel('Buscar pelo título').fill(prefix+' 00');await oldReady;
  await page.getByLabel('Buscar pelo título').fill(prefix+' 01');await expect(titles(page)).toHaveText(prefix+' 01');release();await page.unroute('**/rpc/list_map_library');await expect(titles(page)).toHaveText(prefix+' 01');await expect(page.getByLabel('Buscar pelo título')).toHaveValue(prefix+' 01');
  await page.getByLabel('Buscar pelo título').fill(prefix+' inexistente');await expect(page.getByRole('heading',{name:'Nenhum mapa com esses filtros'})).toBeVisible();await expect(page.getByRole('heading',{name:'Nenhum mapa ainda',exact:true})).toHaveCount(0);
  expect(payloads.length).toBeGreaterThan(0);for(const body of payloads as {items:Record<string,unknown>[]}[]){expect(body.items.length).toBeLessThanOrEqual(20);for(const item of body.items){expect(item).not.toHaveProperty('nodes');expect(item).not.toHaveProperty('people');}}
});
