import { expect, test, type Page, type BrowserContext } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { Run } from '../../scripts/validation-run.mjs';
const run = JSON.parse(process.env.MAPA_VALIDATION_RUN ?? 'null') as Run | null;
if (!run) throw new Error('Execução de validação ausente.');
const [a, b] = run.accounts;
const state = (page: Page) => page.locator('.save-state [role="status"]');
const canvasText = (page: Page, text: string) => page.locator('.react-flow__node').getByText(text, { exact: true });
async function signIn(page: Page, account = b, path = '/mapas') {
  await page.goto(path);
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}
async function openMap(page: Page) {
  page.on('dialog', (dialog) => void dialog.accept()); // native reload warning; app decisions remain Radix dialogs
  await signIn(page);
  const request = page.waitForRequest('**/rest/v1/rpc/get_map_document');
  await page.getByRole('button', { name: 'Novo mapa', exact: true }).click();
  await expect(canvasText(page, 'Ideia central')).toBeVisible();
  return { path: new URL(page.url()).pathname, request: await request };
}
async function edit(page: Page, text: string) {
  await page.getByRole('button', { name: 'Editar texto', exact: true }).click();
  await page.getByLabel('Texto do nó').fill(text);
  await page.getByRole('button', { name: 'Concluir edição', exact: true }).click();
}
async function records(page: Page, userId = b.id) {
  return page.evaluate(async (userId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mapa.drafts.v1', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ userId: string; queue: unknown[]; draft: { text: string } | null }[]>(
        (resolve, reject) => {
          const request = db.transaction('drafts').objectStore('drafts').getAll();
          request.onsuccess = () =>
            resolve(request.result.filter((entry: { userId: string }) => entry.userId === userId));
          request.onerror = () => reject(request.error);
        },
      );
    } finally {
      db.close();
    }
  }, userId);
}
async function externalEdit(
  page: Page,
  request: Awaited<ReturnType<typeof openMap>>['request'],
  mapPath: string,
  text: string,
) {
  const headers = await request.allHeaders();
  const url = request.url().replace('get_map_document', 'apply_map_command');
  const response = await page.request.post(request.url(), {
    headers: { authorization: headers.authorization, apikey: headers.apikey },
    data: { p_map_id: mapPath.split('/').at(-1) },
  });
  const doc = await response.json();
  const write = await page.request.post(url, {
    headers: { authorization: headers.authorization, apikey: headers.apikey },
    data: {
      p_map_id: doc.map.id,
      p_operation_id: crypto.randomUUID(),
      p_editor_session_id: crypto.randomUUID(),
      p_expected_revision: doc.map.revision,
      p_kind: 'edit_text',
      p_payload: { nodeId: doc.nodes.find((node: { parentId: string | null }) => node.parentId === null).id, text },
    },
  });
  expect(write.status()).toBe(200);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test.beforeEach(() => {
  test.setTimeout(90_000);
});

test('failed writes, invalid draft and backend-offline reload preserve work for the same verified account', async ({
  page,
}, info) => {
  await openMap(page);
  await page.route('**/rest/v1/rpc/apply_map_command', (route) => route.abort('internetdisconnected'));
  await edit(page, 'Texto sem rede');
  await expect(state(page)).toHaveText(/Falha ao salvar/);
  await page.getByRole('button', { name: 'Editar texto', exact: true }).click();
  const invalid = 'x'.repeat(501);
  await page.getByLabel('Texto do nó').fill(invalid);
  await expect.poll(async () => (await records(page))[0]?.draft?.text).toBe(invalid);
  // All backend access is unavailable, but the frontend shell still loads. No cached identity authorizes private rendering.
  await page.route('**/auth/v1/user*', (route) => route.abort('internetdisconnected'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Não foi possível abrir esta página' })).toBeVisible();
  await expect(page.getByLabel('Texto do nó')).toHaveCount(0);
  await page.unroute('**/auth/v1/user*');
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByText('Rascunho recuperado deste navegador.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Texto do nó')).toHaveValue(invalid);
  await expect(page.getByRole('button', { name: 'Concluir edição' })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('recovered-invalid-draft.png'), fullPage: true });
  await page.getByLabel('Texto do nó').fill('Texto recuperado e sincronizado');
  await page.getByRole('button', { name: 'Concluir edição' }).click();
  await page.unroute('**/rest/v1/rpc/apply_map_command');
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(state(page)).toHaveText(/Salvo/);
  await page.reload();
  await expect(canvasText(page, 'Texto recuperado e sincronizado')).toBeVisible();
  await noOverflow(page);
  await expect.poll(async () => (await records(page)).length).toBe(0);
});

test('two revision-1 sessions conflict; a lost copy response and reload retry preserve both versions', async ({
  page,
  browser,
}, info) => {
  const { path } = await openMap(page);
  const other: BrowserContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:4174',
    viewport: info.project.use.viewport,
    isMobile: info.project.name === 'mobile',
    hasTouch: info.project.name === 'mobile',
  });
  try {
    const second = await other.newPage();
    second.on('dialog', (dialog) => void dialog.accept());
    await signIn(second, a, path);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await second.route('**/rest/v1/rpc/apply_map_command', async (route) => {
      await held;
      await route.continue();
    });
    const pending = second.waitForRequest('**/rest/v1/rpc/apply_map_command');
    await edit(second, 'Versão local de A');
    expect((await pending).postDataJSON().p_expected_revision).toBe(1);
    await edit(page, 'Versão salva por B');
    await expect(state(page)).toHaveText(/Salvo/);
    release();
    await expect(state(second)).toHaveText(/Conflito/);
    await second.screenshot({ path: info.outputPath('conflict-two-sessions.png'), fullPage: true });
    await second.unroute('**/rest/v1/rpc/apply_map_command');
    const copies: { p_operation_id: string }[] = [];
    await second.route('**/rest/v1/rpc/create_map_copy', async (route) => {
      copies.push(route.request().postDataJSON());
      if (copies.length === 1) {
        await route.fetch();
        await route.abort('timedout');
      } else await route.continue();
    });
    await second.getByRole('button', { name: 'Salvar minha versão como cópia' }).click();
    await expect(second.getByRole('button', { name: 'Tentar salvar a mesma cópia' })).toBeVisible();
    await second.reload();
    await second.getByRole('button', { name: 'Tentar salvar a mesma cópia' }).click();
    await expect(second).not.toHaveURL(new RegExp(`${path}$`));
    await expect(second.getByRole('heading', { name: 'Novo mapa — cópia', exact: true })).toBeVisible();
    await expect(canvasText(second, 'Versão local de A')).toBeVisible();
    await expect(second.getByText(`Responsável: ${a.name}`, { exact: false })).toBeVisible();
    expect(copies).toHaveLength(2);
    expect(copies[1]).toEqual(copies[0]);
    await page.reload();
    await expect(canvasText(page, 'Versão salva por B')).toBeVisible();
    await noOverflow(second);
    await second.screenshot({ path: info.outputPath('local-copy-confirmed.png'), fullPage: true });
  } finally {
    await other.close();
  }
});

test('discard confirms explicitly and internal navigation can retain a durable draft', async ({ page }, info) => {
  const { path, request } = await openMap(page);
  await page.route('**/rest/v1/rpc/apply_map_command', (route) => route.abort('internetdisconnected'));
  await edit(page, 'Versão local a preservar');
  await expect(state(page)).toHaveText(/Falha ao salvar/);
  await page.getByRole('link', { name: 'Mapas', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Manter rascunho e continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Seus mapas' })).toBeVisible();
  // Opening a missing map must never erase a pending draft from another map.
  await page.goto(`/mapas/${crypto.randomUUID()}`);
  await expect(page.getByRole('heading', { name: 'Mapa indisponível', exact: true })).toBeVisible();
  expect((await records(page)).length).toBe(1);
  await page.goto(path);
  await expect(canvasText(page, 'Versão local a preservar')).toBeVisible();
  await externalEdit(page, request, path, 'Versão remota a abrir');
  await page.unroute('**/rest/v1/rpc/apply_map_command');
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(state(page)).toHaveText(/Conflito/);
  await page.getByRole('button', { name: 'Descartar alterações locais' }).click();
  await expect(dialog.getByRole('heading', { name: 'Descartar suas alterações locais?' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('discard-confirmation.png') });
  await dialog.getByRole('button', { name: 'Ficar nesta página' }).click();
  await expect(canvasText(page, 'Versão local a preservar')).toBeVisible();
  await page.getByRole('button', { name: 'Descartar alterações locais' }).click();
  await dialog.getByRole('button', { name: 'Confirmar descarte e abrir versão salva' }).click();
  await expect(canvasText(page, 'Versão remota a abrir')).toBeVisible();
  await expect.poll(async () => (await records(page)).length).toBe(0);
  await noOverflow(page);
});

test('unavailable or full storage warns, exports and retries without losing the in-memory edit', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const original = indexedDB.open.bind(indexedDB);
    sessionStorage.setItem('test-idb-failure', '0');
    indexedDB.open = (...args) => {
      if (sessionStorage.getItem('test-idb-failure') === '1')
        throw new DOMException('Storage unavailable', 'QuotaExceededError');
      return original(...args);
    };
  });
  await openMap(page);
  await page.route('**/rest/v1/rpc/apply_map_command', (route) => route.abort('internetdisconnected'));
  await page.evaluate(() => sessionStorage.setItem('test-idb-failure', '1'));
  await edit(page, 'Não perder por falta de armazenamento');
  await expect(page.getByText('Não foi possível proteger o rascunho neste navegador.', { exact: false })).toBeVisible();
  await page.screenshot({ path: info.outputPath('storage-failure.png'), fullPage: true });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar rascunho de emergência' }).click();
  const file = await download;
  const json = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(json.format).toBe('mapa-emergency-draft');
  expect(json.record.queue[0].payload.text).toBe('Não perder por falta de armazenamento');
  await page.evaluate(() => sessionStorage.removeItem('test-idb-failure'));
  // A scheduled checkpoint may recover immediately when storage becomes available.
  // If it removes the button before the click, verify that recovery actually completed.
  await page
    .getByRole('button', { name: 'Tentar proteger rascunho' })
    .click({ timeout: 2000 })
    .catch(async () => {
      await expect(
        page.getByText('Não foi possível proteger o rascunho neste navegador.', { exact: false }),
      ).toHaveCount(0);
    });
  await expect(page.getByText('Não foi possível proteger o rascunho neste navegador.', { exact: false })).toHaveCount(
    0,
  );
  await expect.poll(async () => (await records(page)).length).toBe(1);
  await page.unroute('**/rest/v1/rpc/apply_map_command');
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(state(page)).toHaveText(/Salvo/);
});

test('expired session isolates the draft, another account cannot see it, deliberate logout exports and erases it', async ({
  page,
}, info) => {
  const { path } = await openMap(page);
  await page.route('**/rest/v1/rpc/apply_map_command', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST303', message: 'JWT expired' }),
    }),
  );
  await edit(page, 'Rascunho isolado de B');
  await expect(page.getByRole('heading', { name: 'Entre novamente' })).toBeVisible();
  await expect.poll(async () => (await records(page)).length).toBe(1);
  await page.evaluate(() => localStorage.removeItem('mapa.auth.v1'));
  await page.getByRole('link', { name: 'Entrar novamente' }).click();
  await page.getByLabel('E-mail', { exact: true }).fill(a.email);
  await page.getByLabel('Senha', { exact: true }).fill(a.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(canvasText(page, 'Ideia central')).toBeVisible();
  await expect(canvasText(page, 'Rascunho isolado de B')).toHaveCount(0);
  expect((await records(page)).length).toBe(1);
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/login$/);
  await page.unroute('**/rest/v1/rpc/apply_map_command');
  await signIn(page, b, path);
  await expect(canvasText(page, 'Rascunho isolado de B')).toBeVisible();
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(state(page)).toHaveText(/Salvo/);
  await page.route('**/rest/v1/rpc/apply_map_command', (route) => route.abort('internetdisconnected'));
  await edit(page, 'Exportar antes de sair');
  await expect(state(page)).toHaveText(/Falha ao salvar/);
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Sincronizar e sair' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/Não foi possível sincronizar/);
  await page.screenshot({ path: info.outputPath('logout-with-pending.png') });
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Exportar rascunho e sair' }).click();
  const json = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(json.format).toBe('mapa-emergency-draft');
  expect(json.record.queue[0].payload.text).toBe('Exportar antes de sair');
  await expect(page).toHaveURL(/login$/);
  await expect.poll(async () => (await records(page)).length).toBe(0);
});

test('revoked access hides and purges recovery material and disallows copying', async ({ page }, info) => {
  await openMap(page);
  await page.route('**/rest/v1/rpc/apply_map_command', (route) => route.abort('internetdisconnected'));
  await edit(page, 'Não expor após revogação');
  await expect(state(page)).toHaveText(/Falha ao salvar/);
  await expect.poll(async () => (await records(page)).length).toBe(1);
  const change = (status: string) => {
    const result = spawnSync(process.execPath, ['scripts/validation-control.mjs', run!.runId, b.id, status], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(result.status).toBe(0);
  };
  change('inactive');
  try {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sem acesso à equipe' })).toBeVisible();
    await expect(page.getByText('Não expor após revogação', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Salvar minha versão como cópia' })).toHaveCount(0);
    await expect.poll(async () => (await records(page)).length).toBe(0);
    await page.screenshot({ path: info.outputPath('revoked-no-private-draft.png'), fullPage: true });
  } finally {
    change('active');
  }
});

test('reload after a committed but lost response replays the identical request before later edits', async ({
  page,
}) => {
  await openMap(page);
  const sent: Record<string, unknown>[] = [];
  await page.route('**/rest/v1/rpc/apply_map_command', async (route) => {
    sent.push(route.request().postDataJSON());
    if (sent.length === 1) {
      await route.fetch();
      await route.abort('timedout');
    } else await route.continue();
  });
  await edit(page, 'Primeiro commit confirmado no servidor');
  await expect(state(page)).toHaveText(/Falha ao salvar/);
  await page.getByRole('button', { name: 'Editar texto', exact: true }).click();
  await page.getByLabel('Texto do nó').fill('Texto seguinte ainda local');
  await expect.poll(async () => (await records(page))[0]?.draft?.text).toBe('Texto seguinte ainda local');
  await page.reload();
  await expect(page.getByLabel('Texto do nó')).toHaveValue('Texto seguinte ainda local');
  await page.getByRole('button', { name: 'Concluir edição' }).click();
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(state(page)).toHaveText(/Salvo/);
  expect(sent).toHaveLength(3);
  expect(sent[1]).toEqual(sent[0]);
  expect(sent[2].p_expected_revision).toBe(2);
  await page.reload();
  await expect(canvasText(page, 'Texto seguinte ainda local')).toBeVisible();
});

test('an initial storage-read failure cannot overwrite an unread draft; retry restores it after verification', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => {
      if (sessionStorage.getItem('test-initial-read-failure') === '1')
        throw new DOMException('Storage unavailable', 'SecurityError');
      return original(...args);
    };
  });
  await openMap(page);
  await page.route('**/rest/v1/rpc/apply_map_command', (route) => route.abort('internetdisconnected'));
  await edit(page, 'Rascunho que ainda não pôde ser lido');
  await expect(state(page)).toHaveText(/Falha ao salvar/);
  await expect.poll(async () => (await records(page)).length).toBe(1);
  await page.evaluate(() => sessionStorage.setItem('test-initial-read-failure', '1'));
  await page.reload();
  await expect(page.getByText('A edição está pausada para preservá-los.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar texto' })).toBeDisabled();
  await page.evaluate(() => sessionStorage.removeItem('test-initial-read-failure'));
  await page.getByRole('button', { name: 'Tentar abrir rascunhos' }).click();
  await expect(canvasText(page, 'Rascunho que ainda não pôde ser lido')).toBeVisible();
  await page.unroute('**/rest/v1/rpc/apply_map_command');
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(state(page)).toHaveText(/Salvo/);
});
