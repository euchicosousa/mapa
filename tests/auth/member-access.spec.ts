import { expect, test, type Page } from '@playwright/test';
import type { Run, Account } from '../../scripts/validation-run.mjs';
const run = JSON.parse(process.env.MAPA_VALIDATION_RUN ?? 'null') as Run;
if (!run) throw Error('Validation run required');
const [a, b] = run.accounts;
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).filter({ visible: true });
async function login(page: Page, account: Account) {
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await button(page, 'Entrar').click();
  await expect(page).toHaveURL(/mapas$/);
}
async function api(page: Page) {
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem('mapa.auth.v1') ?? 'null'));
  if (!session) throw Error('Authenticated validation client required');
  // Reuse the public API key from the browser's own RPC request, never a service key.
  const request = page.waitForRequest(
    (request) => request.url().includes('/rest/v1/rpc/') && request.method() === 'POST',
  );
  await page.reload();
  const sent = await request;
  const headers = await sent.allHeaders();
  const base = sent.url().slice(0, sent.url().lastIndexOf('/') + 1);
  return async (name: string, data: object) => {
    const response = await page.request.post(base + name, {
      headers: { apikey: headers.apikey, authorization: `Bearer ${session.access_token}` },
      data,
    });
    const body = await response.json();
    if (!response.ok()) throw Error('Validation RPC rejected: ' + String(body.message));
    return body;
  };
}
async function privateCacheCount(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/app/query-client.ts';
    const { queryClient } = await import(/* @vite-ignore */ modulePath);
    return queryClient
      .getQueryCache()
      .getAll()
      .filter((q: { queryKey: readonly unknown[] }) => q.queryKey[0] !== 'access').length;
  });
}
async function recordCount(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('mapa.drafts.v1', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const r = db.transaction('drafts').objectStore('drafts').count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
}
test('admin transfers ownership, deactivates/reactivates and an open editor purges access', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  await login(page, b);
  const rpcB = await api(page);
  const title = `Acesso ${info.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  const made = await rpcB('create_map', {
    p_workspace_id: run.workspaces.X.id,
    p_operation_id: crypto.randomUUID(),
    p_editor_session_id: crypto.randomUUID(),
    p_title: title,
  });
  const mapId = String(made.mapId);
  await page.goto(`/mapas/${mapId}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.locator('.save-state [role=status]')).toHaveText(/Salvo/);
  const context = await browser.newContext({
    viewport: info.project.use.viewport,
    isMobile: info.project.name === 'mobile',
    hasTouch: info.project.name === 'mobile',
  });
  const admin = await context.newPage();
  try {
    await login(admin, a);
    const rpcA = await api(admin);
    await admin.getByRole('link', { name: 'Equipe', exact: true }).click();
    const member = () => admin.getByRole('listitem').filter({ hasText: b.name });
    await admin
      .getByRole('listitem')
      .filter({ hasText: a.name })
      .getByRole('button', { name: 'Desativar acesso', exact: true })
      .click();
    await admin.getByRole('dialog').getByRole('button', { name: 'Confirmar desativação' }).click();
    await expect(admin.getByRole('alert')).toContainText('último administrador');
    await member().getByRole('button', { name: 'Desativar acesso', exact: true }).click();
    await admin.getByRole('dialog').getByRole('button', { name: 'Confirmar desativação' }).click();
    await expect(admin.getByRole('alert')).toContainText('Transfira a responsabilidade');
    await expect(
      admin
        .getByRole('list', { name: 'Mapas que precisam ser transferidos' })
        .getByRole('link', { name: `${title} — abrir para transferir` }),
    ).toBeVisible();
    await admin.screenshot({ path: info.outputPath('member-blocked.png'), fullPage: true });
    await admin
      .getByRole('list', { name: 'Mapas que precisam ser transferidos' })
      .getByRole('link', { name: `${title} — abrir para transferir` })
      .click();
    await button(admin, 'Detalhes do mapa').click();
    await admin.getByLabel('Novo responsável', { exact: true }).selectOption(a.id);
    await button(admin, 'Transferir responsabilidade').click();
    await expect(admin.getByText(`Responsável atual: ${a.name}`, { exact: true })).toBeVisible();
    await button(admin, 'Fechar detalhes').click();
    // Other files share this run's disposable account. Transfer only its remaining
    // maps in X so OWNED_MAPS tests the scenario, not artifacts from earlier cases.
    // Production correctly refuses deactivation while any such map still exists.
    for (let batch = 0; batch < 100; batch++) {
      const library = await rpcA('list_map_library', {
        p_workspace_id: run.workspaces.X.id,
        p_owner_id: b.id,
        p_page: 1,
      });
      if (library.items.length === 0) break;
      for (const item of library.items) {
        const owned = await rpcA('get_map_document', { p_map_id: item.id });
        expect(owned.map.workspaceId).toBe(run.workspaces.X.id);
        expect(owned.map.ownerId).toBe(b.id);
        await rpcA('apply_map_command', {
          p_map_id: item.id,
          p_operation_id: crypto.randomUUID(),
          p_editor_session_id: crypto.randomUUID(),
          p_expected_revision: owned.map.revision,
          p_kind: 'transfer_owner',
          p_payload: { ownerId: a.id },
        });
      }
      expect(batch).toBeLessThan(99);
    }
    await admin.getByRole('link', { name: 'Equipe', exact: true }).click();
    // A draft and cached document must disappear when access is revalidated on focus.
    await page.bringToFront();
    await page.reload();
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    await button(page, 'Editar texto').click();
    await page.getByLabel('Texto do nó', { exact: true }).fill('');
    await expect.poll(() => recordCount(page)).toBeGreaterThan(0);
    await member().getByRole('button', { name: 'Desativar acesso', exact: true }).click();
    await admin.getByRole('dialog').getByRole('button', { name: 'Confirmar desativação' }).click();
    await expect(admin.getByRole('status').filter({ hasText: 'Acesso desativado' })).toBeVisible();
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('heading', { name: 'Sem acesso à equipe' })).toBeVisible();
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    await expect.poll(() => recordCount(page)).toBe(0);
    await expect.poll(() => privateCacheCount(page)).toBe(0);
    await expect(button(page, 'Salvar minha versão como cópia')).toHaveCount(0);
    await admin.screenshot({ path: info.outputPath('member-inactive.png'), fullPage: true });
    await page.screenshot({ path: info.outputPath('member-revoked.png'), fullPage: true });
    await member().getByRole('button', { name: 'Reativar acesso', exact: true }).click();
    await admin.getByRole('dialog').getByRole('button', { name: 'Confirmar reativação' }).click();
    await expect(admin.getByRole('status').filter({ hasText: 'Acesso reativado' })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/mapas$/);
    await page.goto(`/mapas/${mapId}`);
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    const doc = await rpcA('get_map_document', { p_map_id: mapId });
    expect(doc.nodes[0].createdBy).toBe(b.id);
    await expect(page.locator('.node-panel')).toContainText('Criado por você');
    // No window-focus event is dispatched here: a denied write must trigger access revalidation itself.
    await page.bringToFront();
    const removed = await rpcA('set_member_access', {
      p_workspace: run.workspaces.X.id,
      p_user: b.id,
      p_status: 'inactive',
    });
    expect(removed.status).toBe('inactive');
    await button(page, 'Editar texto').click();
    await page.getByLabel('Texto do nó', { exact: true }).fill('Não salvar após desativação');
    await button(page, 'Concluir edição').click();
    await expect(page.getByRole('heading', { name: 'Sem acesso à equipe' })).toBeVisible();
    await expect.poll(() => recordCount(page)).toBe(0);
    await expect.poll(() => privateCacheCount(page)).toBe(0);
    await expect(page.getByText('Não salvar após desativação', { exact: true })).toHaveCount(0);
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await rpcA('set_member_access', { p_workspace: run.workspaces.X.id, p_user: b.id, p_status: 'active' });
  } finally {
    await context.close();
  }
});
