import { fileRun } from './file-run';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const run = fileRun();
const [, b] = run.accounts;
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const saved = (page: Page) => expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
function membership(status: 'active' | 'inactive') {
  const result = spawnSync(
    process.execPath,
    ['scripts/validation-run.mjs', 'membership-status', run!.runId, b.id, status],
    { encoding: 'utf8' },
  );
  expect(result.status, 'Vínculo temporário da execução').toBe(0);
}
async function fixture(page: Page) {
  const requested = page.waitForRequest((r) => r.url().includes('/rpc/list_map_library'));
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(b.email);
  await page.getByLabel('Senha', { exact: true }).fill(b.password);
  await button(page, 'Entrar').click();
  await expect(page.getByRole('heading', { name: 'Seus mapas' })).toBeVisible();
  const req = await requested,
    headers = await req.allHeaders(),
    auth = { authorization: headers.authorization, apikey: headers.apikey },
    base = new URL('/rest/v1/rpc/', req.url()).href;
  const rpc = async (name: string, data: object) => {
    const response = await page.request.post(base + name, { headers: auth, data });
    expect(response.status()).toBe(200);
    return await response.json();
  };
  const title = `../ Café ☕ 日本語 ${crypto.randomUUID().slice(0, 8)}`,
    session = crypto.randomUUID();
  const made = await rpc('create_map', {
      p_workspace_id: run!.workspaces.X.id,
      p_operation_id: crypto.randomUUID(),
      p_editor_session_id: session,
      p_title: title,
    }),
    mapId = made.mapId as string;
  const initial = await rpc('get_map_document', { p_map_id: mapId }),
    root = initial.nodes[0].id as string,
    branch = crypto.randomUUID(),
    leaf = crypto.randomUUID();
  let revision = 1;
  for (const [nodeId, parentId, text] of [
    [branch, root, 'Ação e conexão 🌎'],
    [leaf, branch, '日本語\nTexto <script> é literal'],
  ])
    await rpc('apply_map_command', {
      p_map_id: mapId,
      p_operation_id: crypto.randomUUID(),
      p_editor_session_id: session,
      p_expected_revision: revision++,
      p_kind: 'add_child',
      p_payload: { nodeId, parentId, text },
    });
  const other = await rpc('create_map', {
    p_workspace_id: run!.workspaces.X.id,
    p_operation_id: crypto.randomUUID(),
    p_editor_session_id: session,
    p_title: 'Não exportar outro mapa',
  });
  const read = () => rpc('get_map_document', { p_map_id: mapId }),
    before = await read();
  await page.goto(`/mapas/${mapId}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await saved(page);
  return { mapId, title, read, before, other };
}
async function fileDownload(page: Page, path: string) {
  const downloading = page.waitForEvent('download');
  await button(page, 'Baixar backup JSON').click();
  const file = await downloading;
  await file.saveAs(path);
  return { name: file.suggestedFilename(), raw: await readFile(path, 'utf8') };
}
test('portable Unicode backup contains only this whole local tree, including hidden branches, and does not mutate revision', async ({
  page,
}, info) => {
  test.setTimeout(75_000);
  const f = await fixture(page);
  await button(page, 'Recolher ramo (2)').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await button(page, 'Exportar backup').click();
  await expect(page.getByText('O documento local está salvo. A exportação não muda a revisão do mapa.')).toBeVisible();
  const file = await fileDownload(page, info.outputPath('portable-saved.json')),
    backup = JSON.parse(file.raw);
  expect(Object.keys(backup).sort()).toEqual(
    ['format', 'version', 'exportedAt', 'hasPendingChanges', 'map', 'nodes'].sort(),
  );
  expect(backup.format).toBe('mapa-mental');
  expect(backup.version).toBe(1);
  expect(backup.hasPendingChanges).toBe(false);
  expect(backup.map).toEqual({ title: f.title });
  expect(Number.isNaN(Date.parse(backup.exportedAt))).toBe(false);
  expect(backup.nodes).toEqual(
    f.before.nodes.map(
      ({
        id,
        parentId,
        text,
        sortOrder,
      }: {
        id: string;
        parentId: string | null;
        text: string;
        sortOrder: number;
      }) => ({ id, parentId, text, sortOrder }),
    ),
  );
  for (const forbidden of [
    ...run!.accounts.map((a) => a.email),
    run!.workspaces.X.id,
    f.mapId,
    f.other.mapId,
    'Não exportar outro mapa',
    'access_token',
    'refresh_token',
    'createdBy',
    'updatedBy',
    'ownerId',
    'people',
    'workspaceId',
  ])
    expect(file.raw).not.toContain(forbidden);
  expect(file.name).toMatch(/^mapa-Café-日本語-.*-\d{4}-\d{2}-\d{2}\.json$/);
  expect(file.name).not.toMatch(/[\\/:*?"<>|]/);
  expect(await f.read()).toEqual(f.before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('backup-saved.png'), fullPage: true });
  await button(page, 'Fechar exportação').click();
  await expect(button(page, 'Exportar backup')).toBeFocused();
  if (info.project.name === 'mobile') {
    await page.setViewportSize({ width: 360, height: 844 });
    await button(page, 'Exportar backup').click();
    expect(await page.locator('.draft-dialog').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await button(page, 'Fechar exportação').click();
  }
});
test('invalid text is refused without truncation; unsaved local Unicode is exported with a visible pending marker', async ({
  page,
}, info) => {
  test.setTimeout(75_000);
  const f = await fixture(page);
  let downloads = 0;
  page.on('download', () => downloads++);
  await button(page, 'Editar texto').click();
  await page.getByLabel('Texto do nó', { exact: true }).fill(' ');
  await button(page, 'Exportar backup').click();
  await button(page, 'Baixar backup JSON').click();
  await expect(page.getByRole('alert').filter({ hasText: 'Nenhum conteúdo foi cortado.' })).toBeVisible();
  expect(downloads).toBe(0);
  await button(page, 'Fechar exportação').click();
  let release: () => void = () => {},
    reached: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
  await page.route('**/rpc/apply_map_command', async (route) => {
    if (route.request().postDataJSON().p_kind === 'edit_text') {
      reached();
      await gate;
    }
    await route.continue();
  });
  try {
    const localText = 'Rascunho ainda não salvo 🌍\n日本語 — ação';
    await page.getByLabel('Texto do nó', { exact: true }).fill(localText);
    await button(page, 'Concluir edição').click();
    await ready;
    await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvando/);
    await button(page, 'Exportar backup').click();
    await expect(
      page.getByText('Há alterações locais pendentes. Elas serão incluídas no backup e indicadas no arquivo.'),
    ).toBeVisible();
    const file = await fileDownload(page, info.outputPath('portable-pending.json')),
      backup = JSON.parse(file.raw);
    expect(backup.hasPendingChanges).toBe(true);
    expect(backup.nodes.find((n: { parentId: string | null }) => n.parentId === null).text).toBe(localText);
    expect(await f.read()).toEqual(f.before);
    await expect(
      page.getByText('Backup gerado com alterações locais pendentes. Ele não confirma o salvamento no servidor.'),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath('backup-pending.png'), fullPage: true });
    await button(page, 'Fechar exportação').click();
    release();
    await saved(page);
  } finally {
    release();
  }
});
test('access/network checks block download; leaving during verification and revoking membership cannot produce a late private file', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const f = await fixture(page);
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.route('**/rpc/get_map_document', (route) => route.abort('failed'));
  await button(page, 'Exportar backup').click();
  await button(page, 'Baixar backup JSON').click();
  await expect(
    page.getByText(
      'Não foi possível confirmar o acesso ao mapa. O arquivo não foi exportado. Confira sua conexão e seu acesso e tente novamente.',
    ),
  ).toBeVisible();
  expect(downloads).toBe(0);
  await button(page, 'Fechar exportação').click();
  await page.unroute('**/rpc/get_map_document');
  let release: () => void = () => {},
    reached: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
  await page.route('**/rpc/get_map_document', async (route) => {
    const response = await route.fetch();
    reached();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await button(page, 'Exportar backup').click();
    await button(page, 'Baixar backup JSON').click();
    await ready;
    await page.goBack();
    await expect(page).toHaveURL(/\/mapas$/);
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(page.getByRole('heading', { name: 'Seus mapas' })).toBeVisible();
    expect(downloads).toBe(0);
    await page.goto(`/mapas/${f.mapId}`);
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await saved(page);
    await button(page, 'Exportar backup').click();
    membership('inactive');
    await button(page, 'Baixar backup JSON').click();
    await expect(button(page, 'Exportar backup')).toHaveCount(0);
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    expect(downloads).toBe(0);
    await page.screenshot({ path: info.outputPath('backup-access-revoked.png'), fullPage: true });
  } finally {
    release();
    membership('active');
  }
});
