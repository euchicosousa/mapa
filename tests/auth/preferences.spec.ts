import { fileRun } from './file-run';
import { expect, test, type Page, type BrowserContext } from '@playwright/test';
const run = fileRun();
const [a, b] = run.accounts;
type Doc = { map: { id: string; revision: number }; nodes: { id: string; parentId: string | null; text: string }[] };
type View = { viewport: { x: number; y: number; zoom: number }; collapsed_node_ids: string[] };
async function login(page: Page, account: typeof a, url = '/mapas') {
  await page.goto(url);
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}
async function fixture(page: Page) {
  // Fixture creation is a real authenticated RPC; this slice starts by opening an existing map.
  const libraryRequest = page.waitForRequest((request) =>
    ['/rest/v1/maps', '/rest/v1/rpc/list_map_library'].includes(new URL(request.url()).pathname),
  );
  await login(page, b);
  await expect(page.getByRole('heading', { name: 'Seus mapas' })).toBeVisible();
  const library = await libraryRequest,
    headers = await library.allHeaders(),
    auth = { authorization: headers.authorization, apikey: headers.apikey };
  const rpcBase = new URL('/rest/v1/rpc/', library.url()).href;
  const made = await page.request.post(rpcBase + 'create_map', {
    headers: auth,
    data: {
      p_workspace_id: run!.workspaces.X.id,
      p_operation_id: crypto.randomUUID(),
      p_editor_session_id: crypto.randomUUID(),
    },
  });
  expect(made.status()).toBe(200);
  const mapId = (await made.json()).mapId as string;
  const request = { url: () => rpcBase + 'get_map_document' };
  const opened = await page.request.post(request.url(), { headers: auth, data: { p_map_id: mapId } });
  expect(opened.status()).toBe(200);
  const document = (await opened.json()) as Doc;
  const root = document.nodes[0].id,
    branch = crypto.randomUUID(),
    child = crypto.randomUUID(),
    grandchild = crypto.randomUUID(),
    sibling = crypto.randomUUID();
  let revision = document.map.revision;
  for (const [nodeId, parentId, text] of [
    [branch, root, 'Ramo principal'],
    [child, branch, 'Filho ocultável'],
    [grandchild, child, 'Neto ocultável'],
    [sibling, root, 'Ramo lateral'],
  ]) {
    const response = await page.request.post(request.url().replace('get_map_document', 'apply_map_command'), {
      headers: auth,
      data: {
        p_map_id: document.map.id,
        p_operation_id: crypto.randomUUID(),
        p_editor_session_id: crypto.randomUUID(),
        p_expected_revision: revision,
        p_kind: 'add_child',
        p_payload: { nodeId, parentId, text },
      },
    });
    expect(response.status()).toBe(200);
    revision = (await response.json()).revision;
  }
  const read = async () => {
    const response = await page.request.post(request.url(), { headers: auth, data: { p_map_id: document.map.id } });
    expect(response.status()).toBe(200);
    return (await response.json()) as Doc;
  };
  const prefUrl = request.url().replace('/rpc/get_map_document', '/map_user_preferences');
  const own = async (): Promise<View | null> => {
    const response = await page.request.get(
      `${prefUrl}?map_id=eq.${document.map.id}&user_id=eq.${b.id}&select=viewport,collapsed_node_ids`,
      { headers: auth },
    );
    expect(response.status()).toBe(200);
    return (await response.json())[0] ?? null;
  };
  const put = async (value: View) => {
    const response = await page.request.post(prefUrl, {
      headers: { ...auth, Prefer: 'resolution=merge-duplicates' },
      data: { map_id: document.map.id, user_id: b.id, ...value },
    });
    expect(response.ok()).toBe(true);
  };
  await page.goto(`/mapas/${mapId}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  return { root, branch, child, grandchild, read, own, put, mapId: document.map.id };
}
const saved = (page: Page) => expect(page.locator('.view-state')).toHaveAttribute('data-status', 'saved');
const press = async (page: Page, name: string, mobile: boolean) => {
  const button = page.getByRole('button', { name, exact: true });
  if (mobile) await button.tap();
  else await button.click();
};
const transform = (page: Page) => page.locator('.react-flow__viewport').getAttribute('style');
async function assertViewport(page: Page, viewport: View['viewport']) {
  await expect
    .poll(async () => {
      const style = await transform(page);
      const match = style?.match(/translate\(([-\d.e+]+)px,\s*([-\d.e+]+)px\) scale\(([-\d.e+]+)\)/);
      return (
        !!match &&
        Math.abs(Number(match[1]) - viewport.x) < 0.001 &&
        Math.abs(Number(match[2]) - viewport.y) < 0.001 &&
        Math.abs(Number(match[3]) - viewport.zoom) < 0.00001
      );
    })
    .toBe(true);
}
test('personal collapse and viewport survive reload independently for two real accounts', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const mobile = testInfo.project.name === 'mobile';
  const f = await fixture(page);
  const before = await f.read();
  await press(page, 'Enquadrar', mobile);
  const branchBody = page.locator('.react-flow__node').filter({ hasText: 'Ramo principal' });
  if (mobile) await branchBody.tap();
  else await branchBody.click();
  await expect(page.locator('.node-panel .node-text')).toHaveText('Ramo principal');
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  const leaf = page.locator('.react-flow__node').filter({ hasText: 'Neto ocultável' });
  if (mobile) await leaf.tap();
  else await leaf.click();
  await expect(page.locator('.node-panel .node-text')).toHaveText('Neto ocultável');
  await press(page, 'Recolher ramo: Ramo principal', mobile);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await expect(page.locator('.node-panel .node-text')).toHaveText('Ramo principal');
  await expect(page.getByRole('group', { name: 'Neto ocultável', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Filho ocultável', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Expandir ramo: Ramo principal', exact: true })).toHaveText('+');
  await expect(page.getByText('2 ocultos', { exact: true })).toBeVisible();
  await press(page, 'Aproximar', mobile);
  await saved(page);
  // A real pan ends with a separate preference write, preserving the content head.
  await page.locator('.canvas').scrollIntoViewIfNeeded();
  const box = (await page.locator('.canvas').boundingBox())!;
  const old = await transform(page),
    x = box.x + box.width / 2,
    y = box.y + box.height - 50;
  if (mobile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 10; i <= 60; i += 10)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i, y: y - 20 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y - 20, { steps: 6 });
    await page.mouse.up();
  }
  await expect.poll(() => transform(page)).not.toBe(old);
  await saved(page);
  await expect
    .poll(async () => {
      const stored = await f.own();
      if (!stored) return false;
      const match = (await transform(page))?.match(/translate\(([-\d.e+]+)px,\s*([-\d.e+]+)px\) scale\(([-\d.e+]+)\)/);
      return (
        !!match &&
        Math.abs(Number(match[1]) - stored.viewport.x) < 0.001 &&
        Math.abs(Number(match[2]) - stored.viewport.y) < 0.001 &&
        Math.abs(Number(match[3]) - stored.viewport.zoom) < 0.00001
      );
    })
    .toBe(true);
  await saved(page);
  const bView = (await f.own())!;
  expect(bView.collapsed_node_ids).toEqual([f.branch]);
  expect(await f.read()).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('personal-branch-collapsed.png'), fullPage: true });
  let other: BrowserContext | undefined;
  try {
    other = await browser.newContext({ viewport: page.viewportSize(), isMobile: mobile, hasTouch: mobile });
    const colleague = await other.newPage();
    await login(colleague, a, `${new URL(page.url()).origin}/login?next=/mapas/${f.mapId}`);
    await expect(colleague.locator('.react-flow__node')).toHaveCount(5);
    await expect(colleague.locator('.react-flow__edge')).toHaveCount(4);
    await press(colleague, 'Aproximar', mobile);
    await press(colleague, 'Recolher ramo: Ideia central', mobile);
    await saved(colleague);
    await expect(colleague.locator('.react-flow__node')).toHaveCount(1);
    await expect(colleague.getByRole('button', { name: 'Expandir ramo: Ideia central', exact: true })).toHaveText('+');
    await expect(colleague.getByText('4 ocultos', { exact: true })).toBeVisible();
    await colleague.screenshot({ path: testInfo.outputPath('colleague-independent-view.png'), fullPage: true });
    // A saved id may refer to a branch deleted since the last visit; drop it on load.
    await f.put({ ...bView, collapsed_node_ids: [f.branch, crypto.randomUUID()] });
    await page.reload();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await saved(page);
    await assertViewport(page, bView.viewport);
    await expect.poll(async () => (await f.own())?.collapsed_node_ids).toEqual([f.branch]);
    await colleague.reload();
    await expect(colleague.locator('.react-flow__node')).toHaveCount(1);
    await page.bringToFront();
    await page.screenshot({ path: testInfo.outputPath('personal-view-restored.png'), fullPage: true });
    await press(page, 'Expandir ramo: Ramo principal', mobile);
    await saved(page);
    await expect(page.locator('.react-flow__node')).toHaveCount(5);
    await expect(page.locator('.react-flow__edge')).toHaveCount(4);
    await expect(colleague.locator('.react-flow__node')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('.react-flow__node')).toHaveCount(5);
    await expect(page.getByRole('button', { name: 'Desfazer', exact: true })).toBeDisabled();
    expect(await f.read()).toEqual(before);
  } finally {
    await other?.close();
  }
});

test('preference read/write failures leave content saved and editable and retry real persistence', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const mobile = testInfo.project.name === 'mobile',
    f = await fixture(page);
  await press(page, 'Aproximar', mobile);
  await saved(page);
  const originalView = await f.own();
  const original = await f.read();
  await page.route('**/rest/v1/map_user_preferences*', (route) =>
    route.request().method() === 'GET' ? route.abort('failed') : route.continue(),
  );
  await page.reload();
  await expect(page.locator('.view-state')).toContainText('Não foi possível carregar');
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await press(page, 'Recolher ramo: Ramo principal', mobile);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  expect(await f.own()).toEqual(originalView);
  await page.unroute('**/rest/v1/map_user_preferences*');
  await press(page, 'Tentar salvar visualização novamente', mobile);
  await saved(page);
  expect((await f.own())?.collapsed_node_ids).toEqual([f.branch]);
  expect(await f.read()).toEqual(original);
  await page.route('**/rest/v1/map_user_preferences*', (route) =>
    route.request().method() === 'POST' ? route.abort('failed') : route.continue(),
  );
  await press(page, 'Expandir ramo: Ramo principal', mobile);
  await expect(page.locator('.view-state')).toContainText('Não foi possível salvar');
  await expect(page.locator('.node-panel .node-text')).toHaveText('Ideia central');
  await press(page, 'Editar texto', mobile);
  await page.getByLabel('Texto do nó').fill('Conteúdo salvo apesar da falha de visualização');
  await press(page, 'Concluir edição', mobile);
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  await expect(page.locator('.view-state')).toContainText('Não foi possível salvar');
  const edited = await f.read();
  expect(edited.map.revision).toBe(original.map.revision + 1);
  expect(edited.nodes.find((n) => n.id === f.root)?.text).toBe('Conteúdo salvo apesar da falha de visualização');
  await page.screenshot({ path: testInfo.outputPath('view-failure-content-saved.png'), fullPage: true });
  await page.unroute('**/rest/v1/map_user_preferences*');
  await press(page, 'Tentar salvar visualização novamente', mobile);
  await saved(page);
  expect((await f.own())?.collapsed_node_ids).toEqual([]);
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  expect(await f.read()).toEqual(edited);
});
