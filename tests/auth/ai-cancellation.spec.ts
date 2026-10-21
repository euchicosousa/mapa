import { fileRun } from './file-run';
import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const run = fileRun();
const [adminAccount, memberAccount] = run.accounts;
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
test.skip(process.env.MAPA_AI_VALIDATION !== '1', 'IA real requer liberação das identidades descartáveis.');
test.afterEach(async ({ page }) => {
  if (!page.isClosed()) await page.unrouteAll({ behavior: 'ignoreErrors' });
});
async function fixture(page: Page, account = adminAccount) {
  const pending = page.waitForRequest((r) => r.url().includes('/rpc/list_map_library'));
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await button(page, 'Entrar').click();
  await expect(page.getByRole('heading', { name: 'Seus mapas' })).toBeVisible();
  const request = await pending,
    headers = await request.allHeaders(),
    auth = { authorization: headers.authorization, apikey: headers.apikey },
    base = new URL('/rest/v1/rpc/', request.url()).href;
  const rpc = async (name: string, data: object) => {
    const response = await page.request.post(base + name, { headers: auth, data });
    expect(response.status()).toBe(200);
    return response.json();
  };
  const made = await rpc('create_map', {
    p_workspace_id: run!.workspaces.X.id,
    p_operation_id: crypto.randomUUID(),
    p_editor_session_id: crypto.randomUUID(),
    p_title: `Cancelamento IA ${crypto.randomUUID().slice(0, 8)}`,
  });
  await page.goto(`/mapas/${made.mapId}`);
  await expect(button(page, 'Gerar caminhos com IA')).toBeVisible();
  const doc = await rpc('get_map_document', { p_map_id: made.mapId });
  return { mapId: made.mapId as string, root: doc.nodes[0].id as string, rpc };
}
async function start(page: Page) {
  const response = page.waitForResponse(
    (r) => r.url().includes('/functions/v1/generate-children') && r.request().postDataJSON().action !== 'availability',
  );
  await page
    .getByLabel('Orientação para a IA (opcional)', { exact: true })
    .fill('Quatro ações para organizar o trabalho de uma equipe.');
  await button(page, 'Gerar caminhos com IA').click();
  const reply = await response;
  expect(reply.status()).toBe(200);
  return reply.json();
}
test('cancel before application survives a lost cancellation response and does not insert late children', async ({
  page,
}, info) => {
  test.setTimeout(100_000);
  const f = await fixture(page);
  let cancellation = 0;
  await page.route('**/rpc/cancel_ai_generation', async (route) => {
    cancellation++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect((await response.json()).state).toBe('cancelled');
    await route.abort('timedout');
  });
  const job = await start(page);
  await button(page, 'Cancelar geração').click();
  await expect(page.getByText('Geração cancelada. Nenhum filho foi inserido.', { exact: true })).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  const current = await f.rpc('get_ai_generation', {
    p_map_id: f.mapId,
    p_generation_id: job.id,
    p_editor_session_id: job.editorSessionId,
  });
  expect(current.state).toBe('cancelled');
  expect(current.result).toBeNull();
  expect(cancellation).toBe(1);
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.getByText('Geração cancelada. Nenhum filho foi inserido.', { exact: true })).toBeVisible();
  await page.getByText('Geração cancelada. Nenhum filho foi inserido.', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('ai-cancelled.png') });
  if (info.project.name === 'mobile') {
    await page.setViewportSize({ width: 360, height: 844 });
    await page.getByText('Geração cancelada. Nenhum filho foi inserido.', { exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('ai-cancelled-360.png') });
  }
});
test('when application wins, cancellation reports the real result and offers a single batch undo', async ({
  page,
}, info) => {
  test.setTimeout(100_000);
  const f = await fixture(page);
  let hold = true;
  await page.route('**/rpc/get_ai_generation', async (route) => {
    const response = await route.fetch(),
      job = await response.json();
    // Keep the real status response in flight so the visible cancel action races
    // with an application already committed on the server.
    if (hold && job?.state === 'applied') {
      while (hold) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!page.isClosed()) await route.fulfill({ response });
  });
  await start(page);
  await expect
    .poll(async () => (await f.rpc('get_map_document', { p_map_id: f.mapId })).nodes.length, { timeout: 65_000 })
    .toBe(5);
  await button(page, 'Cancelar geração').click();
  await expect(
    page.getByText('A geração já foi aplicada antes do cancelamento. Os quatro caminhos permanecem no mapa.', {
      exact: true,
    }),
  ).toBeVisible();
  hold = false;
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await expect(button(page, 'Desfazer geração')).toBeEnabled();
  await button(page, 'Desfazer geração').scrollIntoViewIfNeeded();
  await expect(button(page, 'Desfazer geração')).toBeVisible();
  await page.screenshot({ path: info.outputPath('ai-applied-before-cancel.png') });
  await button(page, 'Desfazer geração').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  expect((await f.rpc('get_map_document', { p_map_id: f.mapId })).map.revision).toBe(3);
});
test('closing and reopening in another tab resumes the existing job without another generation request', async ({
  page,
  context,
}, info) => {
  test.setTimeout(100_000);
  const f = await fixture(page);
  let paidStarts = 0;
  context.on('request', (request) => {
    if (
      request.url().includes('/functions/v1/generate-children') &&
      request.method() === 'POST' &&
      request.postDataJSON()?.action !== 'availability'
    )
      paidStarts++;
  });
  const job = await start(page);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(`/mapas/${f.mapId}`);
  await expect(reopened.locator('.react-flow__node')).toHaveCount(5, { timeout: 65_000 });
  expect(paidStarts).toBe(1);
  const doc = await f.rpc('get_map_document', { p_map_id: f.mapId });
  expect(doc.map.revision).toBe(2);
  expect(
    new Set(
      doc.nodes
        .filter((node: { source: string }) => node.source === 'ai')
        .map((node: { aiGenerationId: string }) => node.aiGenerationId),
    ),
  ).toEqual(new Set([job.id]));
  await button(reopened, 'Enquadrar').click();
  await reopened.screenshot({ path: info.outputPath('ai-reopened.png'), fullPage: true });
  await reopened.reload();
  await expect(reopened.locator('.react-flow__node')).toHaveCount(5);
  expect(paidStarts).toBe(1);
});
test('a changed ancestor while the real worker runs makes the job stale and inserts no children', async ({
  page,
}, info) => {
  test.setTimeout(100_000);
  const f = await fixture(page);
  await start(page);
  await f.rpc('apply_map_command', {
    p_map_id: f.mapId,
    p_operation_id: crypto.randomUUID(),
    p_editor_session_id: crypto.randomUUID(),
    p_expected_revision: 1,
    p_kind: 'edit_text',
    p_payload: { nodeId: f.root, text: 'Ancestral alterado durante a geração' },
  });
  await expect(
    page.getByText('O contexto mudou durante a geração. Nenhum filho foi inserido. Você pode tentar novamente.', {
      exact: true,
    }),
  ).toBeVisible({ timeout: 65_000 });
  const remote = await f.rpc('get_map_document', { p_map_id: f.mapId });
  expect(remote.nodes).toHaveLength(1);
  expect(remote.map.revision).toBe(2);
  await page.screenshot({ path: info.outputPath('ai-stale.png'), fullPage: true });
});

test('a deleted map during generation preserves a local draft for verified emergency export', async ({
  page,
}, info) => {
  test.setTimeout(100_000);
  const f = await fixture(page);
  await start(page);
  await button(page, 'Editar texto').click();
  const text = 'Rascunho ainda não salvo ' + 'x'.repeat(501);
  await page.getByLabel('Texto do nó', { exact: true }).fill(text);
  await f.rpc('apply_map_command', {
    p_map_id: f.mapId,
    p_operation_id: crypto.randomUUID(),
    p_editor_session_id: crypto.randomUUID(),
    p_expected_revision: 1,
    p_kind: 'delete_map',
    p_payload: {},
  });
  await expect(page.getByRole('heading', { name: 'Este mapa foi excluído' })).toBeVisible();
  await expect(button(page, 'Exportar rascunho local')).toBeVisible();
  const pending = page.waitForEvent('download');
  await button(page, 'Exportar rascunho local').click();
  const download = await pending;
  const json = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(json.record.draft.text).toBe(text);
  await page.screenshot({ path: info.outputPath('ai-deleted-map-draft.png'), fullPage: true });
});
test('revocation during generation hides private content and does not offer a recovery copy', async ({
  page,
}, info) => {
  test.setTimeout(100_000);
  const f = await fixture(page, memberAccount);
  await f.rpc('apply_map_command', {
    p_map_id: f.mapId,
    p_operation_id: crypto.randomUUID(),
    p_editor_session_id: crypto.randomUUID(),
    p_expected_revision: 1,
    p_kind: 'transfer_owner',
    p_payload: { ownerId: adminAccount.id },
  });
  await page.reload();
  await expect(button(page, 'Gerar caminhos com IA')).toBeVisible();
  await start(page);
  await button(page, 'Editar texto').click();
  await page.getByLabel('Texto do nó', { exact: true }).fill('Conteúdo local reservado ' + 'x'.repeat(501));
  const change = (status: string) => {
    const result = spawnSync(
      process.execPath,
      ['scripts/validation-control.mjs', run!.runId, memberAccount.id, status],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(result.status).toBe(0);
  };
  change('inactive');
  try {
    await expect(page.getByRole('heading', { name: 'Sem acesso à equipe' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Salvar minha versão como cópia' })).toHaveCount(0);
    await expect(page.getByLabel('Texto do nó', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('ai-revoked.png'), fullPage: true });
  } finally {
    change('active');
  }
});
