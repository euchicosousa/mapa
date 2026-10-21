import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import type { Run } from '../../scripts/validation-run.mjs';
const run = JSON.parse(process.env.MAPA_VALIDATION_RUN ?? 'null') as Run | null;
if (!run) throw Error('Execução ausente');
const [account] = run.accounts;
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
test.skip(
  process.env.MAPA_AI_VALIDATION !== '1' && process.env.MAPA_AI_ROLLOUT !== '1',
  'Requer configuração real de IA.',
);
async function fixture(page: Page) {
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
    p_title: `Limites IA ${crypto.randomUUID().slice(0, 8)}`,
  });
  await page.goto(`/mapas/${made.mapId}`);
  await expect(button(page, 'Gerar caminhos com IA')).toBeVisible();
  return { mapId: made.mapId as string, rpc };
}
function control(action: string, mapId: string, extra?: string) {
  const result = spawnSync(
    process.execPath,
    ['scripts/validation-ai.mjs', action, run!.runId, mapId, ...(extra ? [extra] : [])],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  expect(result.status).toBe(0);
  return result.stdout;
}
test('token budget rejection keeps the editor usable and never retries the paid request automatically', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const f = await fixture(page),
    ids = control('hold', f.mapId);
  let attempts = 0;
  page.on('request', (r) => {
    if (
      r.url().includes('/functions/v1/generate-children') &&
      r.method() === 'POST' &&
      r.postDataJSON().action !== 'availability'
    )
      attempts++;
  });
  try {
    const response = page.waitForResponse(
      (r) =>
        r.url().includes('/functions/v1/generate-children') && r.request().postDataJSON().action !== 'availability',
    );
    await button(page, 'Gerar caminhos com IA').click();
    expect((await response).status()).toBe(429);
    const message =
      'O saldo diário de tokens não permite outra geração agora. Aguarde a conclusão das chamadas em andamento ou a renovação à meia-noite UTC.';
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(button(page, 'Gerar caminhos com IA')).toBeDisabled();
    await button(page, 'Editar texto').click();
    await page.getByLabel('Texto do nó', { exact: true }).fill('Edição funciona mesmo após o limite');
    await button(page, 'Concluir edição').click();
    await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
    expect((await f.rpc('get_map_document', { p_map_id: f.mapId })).nodes[0].text).toBe(
      'Edição funciona mesmo após o limite',
    );
    expect(attempts).toBe(1);
    await page.getByText(message, { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('ai-budget-rejected.png') });
    if (info.project.name === 'mobile') {
      await page.setViewportSize({ width: 360, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('ai-budget-360.png') });
    }
  } finally {
    control('release', f.mapId, ids);
  }
});
test('real smoke records provider usage and a single saved batch', async ({ page }, info) => {
  test.setTimeout(90_000);
  const f = await fixture(page);
  await page
    .getByLabel('Orientação para a IA (opcional)', { exact: true })
    .fill('Quatro ações breves de planejamento. LOG_CONTENT_PROBE_22');
  const response = page.waitForResponse(
    (r) => r.url().includes('/functions/v1/generate-children') && r.request().postDataJSON().action !== 'availability',
  );
  await button(page, 'Gerar caminhos com IA').click();
  const job = await (await response).json();
  await expect(page.locator('.react-flow__node')).toHaveCount(5, { timeout: 65_000 });
  const accounting = JSON.parse(control('inspect', f.mapId, job.id));
  expect(accounting.state).toBe('applied');
  expect(accounting.usage.total_tokens).toBeGreaterThan(0);
  expect(accounting.accountedTokens).toBe(accounting.usage.total_tokens);
  expect(accounting.accountedTokens).toBeLessThanOrEqual(17000);
  expect((await f.rpc('get_map_document', { p_map_id: f.mapId })).map.revision).toBe(2);
  await button(page, 'Enquadrar').click();
  await page.screenshot({ path: info.outputPath('ai-real-usage.png'), fullPage: true });
});
