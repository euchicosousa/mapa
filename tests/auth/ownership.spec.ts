import { expect, test, type Page } from '@playwright/test';
import type { Run } from '../../scripts/validation-run.mjs';
const run = JSON.parse(process.env.MAPA_VALIDATION_RUN ?? 'null') as Run | null;
if (!run) throw Error('Execução de validação ausente');
const [a, b, c] = run.accounts;
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const saved = (page: Page) => expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
async function login(page: Page, account: typeof a, url = '/mapas') {
  await page.goto(url);
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await button(page, 'Entrar').click();
}
async function fixture(page: Page) {
  const initial = page.waitForRequest((r) => r.url().includes('/rpc/list_map_library'));
  await login(page, b);
  await expect(page.getByRole('heading', { name: 'Seus mapas' })).toBeVisible();
  const request = await initial,
    headers = await request.allHeaders(),
    auth = { authorization: headers.authorization, apikey: headers.apikey },
    base = new URL('/rest/v1/rpc/', request.url()).href;
  const rpc = async (name: string, data: object) => {
    const r = await page.request.post(base + name, { headers: auth, data });
    expect(r.status()).toBe(200);
    return await r.json();
  };
  const title = `Responsabilidade ${crypto.randomUUID().slice(0, 8)}`;
  const made = await rpc('create_map', {
    p_workspace_id: run!.workspaces.X.id,
    p_operation_id: crypto.randomUUID(),
    p_editor_session_id: crypto.randomUUID(),
    p_title: title,
  });
  const mapId = made.mapId as string,
    read = () => rpc('get_map_document', { p_map_id: mapId });
  await page.goto(`/mapas/${mapId}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await saved(page);
  return { mapId, title, rpc, read, auth, base };
}
async function editRoot(page: Page, text: string) {
  await button(page, 'Editar texto').click();
  await page.getByLabel('Texto do nó', { exact: true }).fill(text);
  await button(page, 'Concluir edição').click();
  await expect(page.locator('.node-panel .node-text')).toHaveText(text);
  await saved(page);
}
test('owner and admin transfer responsibility while colleagues keep editing and historical authorship', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  page.on('requestfailed', (request) => {
    if (request.url().includes('/rest/v1/rpc/'))
      console.log('RPC network failure', new URL(request.url()).pathname, request.failure()?.errorText);
  });
  page.on('response', (response) => {
    if (response.url().includes('/rpc/apply_map_command') && !response.ok())
      void response
        .json()
        .then((body) => console.log('RPC rejected', response.status(), body.code, body.message))
        .catch(() => {});
  });
  const f = await fixture(page),
    before = await f.read(),
    mobile = info.project.name === 'mobile';
  await button(page, 'Detalhes do mapa').click();
  await expect(page.getByText(`Responsável atual: ${b.name}`, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Novo responsável', { exact: true })).toBeEnabled();
  expect(
    await page
      .getByLabel('Novo responsável', { exact: true })
      .locator('option')
      .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value)),
  ).toEqual(['', a.id]);
  await page.getByLabel('Novo responsável', { exact: true }).selectOption(a.id);
  await button(page, 'Transferir responsabilidade').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('owner-transfer-select.png'), fullPage: true });
  await button(page, 'Transferir responsabilidade').click();
  await expect(page.getByText(`Responsável atual: ${a.name}`, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Novo responsável', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Responsabilidade transferida. O histórico desta sessão foi reiniciado.', { exact: true }).last(),
  ).toBeVisible();
  await button(page, 'Fechar detalhes').click();
  await saved(page);
  await expect(page.locator('.editor-meta')).toContainText(a.name);
  await expect(button(page, 'Desfazer')).toBeDisabled();
  let doc = await f.read();
  expect(doc.map.ownerId).toBe(a.id);
  expect(doc.map.revision).toBe(2);
  expect(doc.nodes).toEqual(before.nodes);
  await editRoot(page, 'B continua editando depois de transferir');
  const colleagueContext = await browser.newContext({
    viewport: page.viewportSize(),
    isMobile: mobile,
    hasTouch: mobile,
  });
  try {
    const colleague = await colleagueContext.newPage();
    await login(colleague, a, `${new URL(page.url()).origin}/login?next=/mapas/${f.mapId}`);
    await expect(colleague.locator('.react-flow__node')).toHaveCount(1);
    await saved(colleague);
    await editRoot(colleague, 'A edita preservando o autor B');
    doc = await f.read();
    expect(doc.nodes[0].createdBy).toBe(b.id);
    expect(doc.nodes[0].updatedBy).toBe(a.id);
    // Admin A can transfer a different map currently owned by B.
    const second = await f.rpc('create_map', {
      p_workspace_id: run!.workspaces.X.id,
      p_operation_id: crypto.randomUUID(),
      p_editor_session_id: crypto.randomUUID(),
      p_title: f.title + ' admin',
    });
    await colleague.goto(`/mapas/${second.mapId}`);
    await expect(colleague.locator('.react-flow__node')).toHaveCount(1);
    await saved(colleague);
    await button(colleague, 'Detalhes do mapa').click();
    await expect(colleague.getByText(`Responsável atual: ${b.name}`, { exact: true })).toBeVisible();
    await colleague.getByLabel('Novo responsável', { exact: true }).selectOption(a.id);
    await button(colleague, 'Transferir responsabilidade').click();
    await expect(colleague.getByText(`Responsável atual: ${a.name}`, { exact: true })).toBeVisible();
    await colleague.screenshot({ path: info.outputPath('admin-transfer-confirmed.png'), fullPage: true });
    await button(colleague, 'Fechar detalhes').click();
    await saved(colleague);
    const adminMap = await f.rpc('get_map_document', { p_map_id: second.mapId });
    expect(adminMap.map.ownerId).toBe(a.id);
    expect(adminMap.nodes[0].createdBy).toBe(b.id);
  } finally {
    await colleagueContext.close();
  }
  await page.bringToFront();
  await page.reload();
  await expect(page.locator('.node-panel .node-text')).toHaveText('A edita preservando o autor B');
  await button(page, 'Detalhes do mapa').click();
  await expect(page.getByLabel('Novo responsável', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('O responsável ou um administrador pode transferir este mapa. Você continua podendo editar.'),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('colleague-no-transfer.png'), fullPage: true });
  await button(page, 'Fechar detalhes').click();
  await editRoot(page, 'B mantém acesso de edição');
  doc = await f.read();
  expect(doc.map.ownerId).toBe(a.id);
  expect(doc.nodes[0].createdBy).toBe(b.id);
  await page.getByRole('link', { name: 'Mapas', exact: true }).click();
  await page.getByLabel('Buscar pelo título').fill(f.title);
  await page.getByLabel('Responsável', { exact: true }).selectOption(a.id);
  await expect(page.locator('.library-map-link:visible')).toHaveCount(2);
  await page.reload();
  await expect(page.getByLabel('Responsável', { exact: true })).toHaveValue(a.id);
  await expect(page.locator('.library-map-link:visible')).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('library-new-owner.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (mobile) {
    await page.setViewportSize({ width: 360, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  // Real foreign account cannot read or transfer this map, even via direct RPC.
  const loginC = await page.request.post(new URL('/auth/v1/token?grant_type=password', f.base).href, {
    headers: { apikey: f.auth.apikey },
    data: { email: c.email, password: c.password },
  });
  expect(loginC.status()).toBe(200);
  const cHeaders = { ...f.auth, authorization: `Bearer ${(await loginC.json()).access_token}` };
  const foreign = await page.request.post(f.base + 'get_map_document', {
    headers: cHeaders,
    data: { p_map_id: f.mapId },
  });
  expect(foreign.status()).toBe(200);
  expect(await foreign.json()).toBeNull();
  const denied = await page.request.post(f.base + 'apply_map_command', {
    headers: cHeaders,
    data: {
      p_map_id: f.mapId,
      p_operation_id: crypto.randomUUID(),
      p_editor_session_id: crypto.randomUUID(),
      p_expected_revision: doc.map.revision,
      p_kind: 'transfer_owner',
      p_payload: { ownerId: c.id },
    },
  });
  expect((await denied.json()).message).toBe('NOT_FOUND');
});
test('a committed transfer with a lost response survives reload and retries exactly once', async ({ page }, info) => {
  test.setTimeout(90_000);
  const f = await fixture(page),
    before = await f.read();
  page.on('dialog', (dialog) => void dialog.accept());
  const requests: unknown[] = [];
  await page.route('**/rpc/apply_map_command', async (route) => {
    if (route.request().postDataJSON().p_kind !== 'transfer_owner') {
      await route.continue();
      return;
    }
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      await route.abort('timedout');
    } else await route.continue();
  });
  await button(page, 'Detalhes do mapa').click();
  await page.getByLabel('Novo responsável', { exact: true }).selectOption(a.id);
  await button(page, 'Transferir responsabilidade').click();
  await expect(page.getByText('Falha ao salvar. Feche os detalhes para tentar novamente.')).toBeVisible();
  await button(page, 'Fechar detalhes').click();
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Falha/);
  expect((await f.read()).map.ownerId).toBe(a.id);
  await page.screenshot({ path: info.outputPath('transfer-lost-response.png'), fullPage: true });
  await page.reload();
  await expect(page.getByText(/Rascunho recuperado deste navegador/)).toBeVisible();
  await button(page, 'Tentar novamente').click();
  await saved(page);
  await expect(page.locator('.editor-meta')).toContainText(a.name);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  const after = await f.read();
  expect(after.map.revision).toBe(2);
  expect(after.nodes).toEqual(before.nodes);
  expect(after.map.ownerId).toBe(a.id);
  await button(page, 'Detalhes do mapa').click();
  await expect(page.getByLabel('Novo responsável', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('transfer-recovered.png'), fullPage: true });
  await button(page, 'Fechar detalhes').click();
  await editRoot(page, 'Edição depois de recuperar transferência');
});
