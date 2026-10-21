import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Run } from '../../scripts/validation-run.mjs';
const run = JSON.parse(process.env.MAPA_VALIDATION_RUN ?? 'null') as Run | null;
if (!run) throw Error('Execução de validação ausente');
const [a, b] = run.accounts;
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const saved = (page: Page) => expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
async function login(page: Page, account: typeof a, url = '/login') {
  await page.goto(url);
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await button(page, 'Entrar').click();
}
async function fixture(page: Page) {
  const requested = page.waitForRequest((r) => r.url().includes('/rpc/list_map_library'));
  await login(page, a);
  await expect(page.getByRole('heading', { name: 'Seus mapas' })).toBeVisible();
  const request = await requested,
    headers = await request.allHeaders(),
    auth = { authorization: headers.authorization, apikey: headers.apikey },
    base = new URL('/rest/v1/rpc/', request.url()).href;
  const rpc = async (name: string, data: object) => {
    const response = await page.request.post(base + name, { headers: auth, data });
    expect(response.status()).toBe(200);
    return await response.json();
  };
  const title = `Importação Café 🌍 ${crypto.randomUUID().slice(0, 8)}`,
    session = crypto.randomUUID();
  const made = await rpc('create_map', {
      p_workspace_id: run!.workspaces.X.id,
      p_operation_id: crypto.randomUUID(),
      p_editor_session_id: session,
      p_title: title,
    }),
    mapId = made.mapId as string;
  const doc = await rpc('get_map_document', { p_map_id: mapId }),
    root = doc.nodes[0].id as string,
    branch = crypto.randomUUID();
  let revision = 1;
  for (const [nodeId, parentId, text] of [
    [branch, root, 'Ação e conexão 🌎'],
    [crypto.randomUUID(), branch, '日本語\n<script>Texto puro</script>'],
  ])
    await rpc('apply_map_command', {
      p_map_id: mapId,
      p_operation_id: crypto.randomUUID(),
      p_editor_session_id: session,
      p_expected_revision: revision++,
      p_kind: 'add_child',
      p_payload: { nodeId, parentId, text },
    });
  const original = await rpc('get_map_document', { p_map_id: mapId });
  await button(page, 'Sair').click();
  await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible();
  await login(page, b);
  await expect(page.getByRole('heading', { name: 'Seus mapas' })).toBeVisible();
  return { mapId, title, original, rpc };
}
const payload = (value: unknown) => ({
  name: 'backup.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(value)),
});
const portable = async () => JSON.parse(await readFile('tests/fixtures/mapa-backup-v1.json', 'utf8'));
test('a colleague exports a map and imports a new independent map with remapped tree, manual authorship and a fresh history', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const f = await fixture(page);
  await page.goto(`/mapas/${f.mapId}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await saved(page);
  await button(page, 'Exportar backup').click();
  const downloading = page.waitForEvent('download');
  await button(page, 'Baixar backup JSON').click();
  const download = await downloading,
    path = info.outputPath('roundtrip-backup.json');
  await download.saveAs(path);
  await button(page, 'Fechar exportação').click();
  await page.getByRole('link', { name: 'Mapas', exact: true }).click();
  await expect(page).toHaveURL(/\/mapas$/);
  await button(page, 'Importar backup').click();
  await page.getByLabel('Arquivo de backup', { exact: true }).setInputFiles(path);
  await expect(page.getByText('3 nós · Sem projeto', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('import-confirmation.png'), fullPage: true });
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/rpc/import_map_backup')) requests++;
  });
  await button(page, 'Confirmar importação').dblclick();
  await expect(page).toHaveURL(/\/mapas\/[0-9a-f-]+$/);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await saved(page);
  expect(requests).toBe(1);
  const copyId = new URL(page.url()).pathname.split('/').pop()!;
  expect(copyId).not.toBe(f.mapId);
  const copy = await f.rpc('get_map_document', { p_map_id: copyId }),
    byText = new Map(copy.nodes.map((n: { text: string; id: string }) => [n.text, n]));
  expect(copy.map.ownerId).toBe(b.id);
  expect(copy.map.title).toBe(f.title);
  expect(copy.map.projectId).toBeNull();
  expect(copy.map.revision).toBe(1);
  for (const n of f.original.nodes) {
    const created = copy.nodes.find((entry: { text: string }) => entry.text === n.text);
    expect(created).toBeTruthy();
    expect(f.original.nodes.some((old: { id: string }) => old.id === created.id)).toBe(false);
    expect(created.createdBy).toBe(b.id);
    expect(created.updatedBy).toBe(b.id);
    expect(created.source).toBe('manual');
    expect(created.sortOrder).toBe(n.sortOrder);
    const parentText = f.original.nodes.find((old: { id: string }) => old.id === n.parentId)?.text;
    expect(created.parentId).toBe(parentText ? (byText.get(parentText) as { id: string }).id : null);
  }
  await expect(button(page, 'Desfazer')).toBeDisabled();
  await button(page, 'Editar texto').click();
  await page.getByLabel('Texto do nó', { exact: true }).fill('Somente o mapa importado');
  await button(page, 'Concluir edição').click();
  await saved(page);
  expect(await f.rpc('get_map_document', { p_map_id: f.mapId })).toEqual(f.original);
  await page.screenshot({ path: info.outputPath('import-independent.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('bad format/version, cycles, missing parents, two roots and oversized files never enable import or create maps', async ({
  page,
}, info) => {
  test.setTimeout(75_000);
  const f = await fixture(page),
    file = await portable(),
    before = await f.rpc('list_map_library', { p_workspace_id: run!.workspaces.X.id });
  let requests = 0;
  page.on('request', (r) => {
    if (r.url().includes('/rpc/import_map_backup')) requests++;
  });
  await button(page, 'Importar backup').click();
  const invalid = [
    { ...file, version: 2 },
    { ...file, format: 'mapa-emergency-draft' },
    {
      ...file,
      nodes: [
        file.nodes[0],
        { ...file.nodes[1], parentId: file.nodes[2].id },
        { ...file.nodes[2], parentId: file.nodes[1].id },
      ],
    },
    { ...file, nodes: [file.nodes[0], { ...file.nodes[1], parentId: crypto.randomUUID() }] },
    { ...file, nodes: [file.nodes[0], { ...file.nodes[1], parentId: null }] },
    { ...file, map: { ...file.map, ownerId: a.id } },
  ];
  for (const value of invalid) {
    await page.getByLabel('Arquivo de backup', { exact: true }).setInputFiles(payload(value));
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(button(page, 'Confirmar importação')).toBeDisabled();
  }
  await page
    .getByLabel('Arquivo de backup', { exact: true })
    .setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.alloc(2097153, 'x') });
  await expect(page.getByText('O arquivo ultrapassa o limite de 2 MB.')).toBeVisible();
  await expect(button(page, 'Confirmar importação')).toBeDisabled();
  expect(requests).toBe(0);
  expect((await f.rpc('list_map_library', { p_workspace_id: run!.workspaces.X.id })).total).toBe(before.total);
  await page.screenshot({ path: info.outputPath('import-rejected.png'), fullPage: true });
  if (info.project.name === 'mobile') {
    await page.setViewportSize({ width: 360, height: 844 });
    expect(await page.locator('.draft-dialog').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
});
test('committed import with a lost response keeps the library and reselecting the same file after reload repeats one operation', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const f = await fixture(page),
    file = await portable();
  file.map.title = `Retomada ${crypto.randomUUID().slice(0, 8)}`;
  const requests: unknown[] = [];
  await page.route('**/rpc/import_map_backup', async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      await route.abort('timedout');
    } else await route.continue();
  });
  await button(page, 'Importar backup').click();
  await page.getByLabel('Arquivo de backup', { exact: true }).setInputFiles(payload(file));
  await button(page, 'Confirmar importação').click();
  await expect(
    page.getByText(
      'Não foi possível confirmar a importação. Tente novamente com o mesmo arquivo para evitar uma cópia adicional.',
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/mapas$/);
  await page.screenshot({ path: info.outputPath('import-lost-response.png'), fullPage: true });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Seus mapas' })).toBeVisible();
  await button(page, 'Importar backup').click();
  await page.getByLabel('Arquivo de backup', { exact: true }).setInputFiles(payload(file));
  await button(page, 'Confirmar importação').click();
  await expect(page).toHaveURL(/\/mapas\/[0-9a-f-]+$/);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await saved(page);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(
    (await f.rpc('list_map_library', { p_workspace_id: run!.workspaces.X.id, p_query: file.map.title })).total,
  ).toBe(1);
  await page.screenshot({ path: info.outputPath('import-confirmed-once.png'), fullPage: true });
});
