import { spawnSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import type { Run, Account } from '../../scripts/validation-run.mjs';
const run = JSON.parse(process.env.MAPA_VALIDATION_RUN ?? 'null') as Run;
if (!run) throw Error('Scoped validation run required');
const [a, b, , d] = run.accounts;
const origin = 'https://mapa.cnvt.com.br';
const ticket = process.env.MAPA_EVIDENCE_TICKET ?? '27';
if (!['27', '28'].includes(ticket)) throw Error('Invalid evidence destination');
const evidence = `.scratch/mapa-mental/evidence/${ticket}`;
async function login(page: Page, account: Account) {
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  // Avoid retaining even disposable validation passwords in failure snapshots.
  await page.locator('input[type="password"]').evaluateAll(inputs => { for (const input of inputs) (input as HTMLInputElement).value = ''; });
}
async function logout(page: Page) {
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/login$/);
}
test('published deep link, refresh, history and edits persist across two accounts', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', () => errors.push('runtime'));
  await page.goto('/mapas'); await login(page, b);
  await expect(page.getByRole('heading', { name: 'Seus mapas', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Novo mapa', exact: true }).click();
  await expect(page).toHaveURL(/\/mapas\/[a-f0-9-]{36}$/);
  const path = new URL(page.url()).pathname;
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.getByRole('button', { name: 'Editar texto', exact: true }).click();
  await page.getByLabel('Texto do nó', { exact: true }).fill(`Publicação ${info.project.name}`);
  await page.getByRole('button', { name: 'Concluir edição', exact: true }).click();
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  await page.reload();
  await expect(page.locator('.react-flow__node')).toContainText(`Publicação ${info.project.name}`);
  await page.getByRole('link', { name: 'Mapas', exact: true }).click();
  await expect(page).toHaveURL(/\/mapas$/);
  await page.goBack(); await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.goForward(); await expect(page).toHaveURL(/\/mapas$/);
  await logout(page);
  await page.goto(path); await expect(page).toHaveURL(/login\?next=/);
  await login(page, a); await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.locator('.react-flow__node')).toContainText(`Publicação ${info.project.name}`);
  await expect(page.getByRole('button', { name: 'Gerar caminhos com IA', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${evidence}/${info.project.name}-editor.png`, fullPage: true });
  expect(errors).toEqual([]);
  await logout(page);
});

for (const kind of ['recovery', 'invite'] as const) test(`published ${kind} callback consumes real Auth link and password works`, async ({ page }, info) => {
  const result = spawnSync(process.execPath, ['scripts/password-validation.mjs'], {
    input: JSON.stringify({ runId: run.runId, kind, userId: d.id, origin }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw Error('Could not prepare scoped production callback');
  const prepared = JSON.parse(result.stdout) as { link: string; email: string; password: string };
  try { await page.goto(prepared.link); } catch { throw Error('Production callback navigation failed'); }
  await expect(page.getByRole('heading', { name: 'Definir nova senha', exact: true })).toBeVisible();
  expect(new URL(page.url()).origin).toBe(origin);
  expect(new URL(page.url()).hash).toBe(''); expect(new URL(page.url()).search).toBe('');
  await page.reload();
  await page.getByLabel('Nova senha', { exact: true }).fill(prepared.password);
  await page.getByLabel('Confirmar nova senha', { exact: true }).fill(prepared.password);
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page.getByText('Senha salva. Entre com sua nova senha.')).toBeVisible();
  await login(page, { ...d, email: prepared.email, password: prepared.password });
  await expect(page).toHaveURL(/sem-acesso$/);
  await page.screenshot({ path: `${evidence}/${info.project.name}-${kind}.png`, fullPage: true });
  await logout(page);
});

test('published administrator invitation, member acceptance and no admin controls', async ({ page, browser }, info) => {
  const result = spawnSync(process.execPath, ['scripts/invitation-validation.mjs'], {
    input: JSON.stringify({ action: 'create-recipient', workspaceId: run.workspaces.X.id, runId: run.runId }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw Error('Could not prepare scoped invitee');
  const recipient = JSON.parse(result.stdout) as Account;
  await page.goto('/login'); await login(page, a); await expect(page).toHaveURL(/mapas$/);
  await page.getByRole('link', { name: 'Equipe', exact: true }).click();
  await page.getByLabel('E-mail da pessoa').fill(recipient.email);
  await page.getByRole('button', { name: 'Enviar convite', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'A conta já existe' })).toBeVisible();
  const context = await browser.newContext({ baseURL: origin, viewport: info.project.use.viewport, isMobile: info.project.name === 'mobile', hasTouch: info.project.name === 'mobile' });
  try {
    const invitee = await context.newPage(); await invitee.goto('/login'); await login(invitee, recipient);
    await expect(invitee).toHaveURL(/sem-acesso$/);
    await invitee.getByRole('button', { name: 'Aceitar convite' }).click(); await expect(invitee).toHaveURL(/mapas$/);
    await invitee.getByRole('link', { name: 'Equipe', exact: true }).click();
    await expect(invitee.getByText(`${recipient.name} (você)`, { exact: true })).toBeVisible();
    await expect(invitee.getByRole('button', { name: 'Enviar convite', exact: true })).toHaveCount(0);
    await invitee.screenshot({ path: `${evidence}/${info.project.name}-invitation.png`, fullPage: true });
    await logout(invitee);
  } finally { await context.close(); }
  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: recipient.email }).filter({ hasText: 'Aceito' })).toHaveCount(1);
  await logout(page);
});

test('published unknown page and invalid Auth callback show safe states', async ({ page }, info) => {
  await page.goto('/endereco-inexistente');
  await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
  await page.goto('/auth/callback#error=access_denied&error_description=PRIVATE_MARKER');
  await expect(page.getByRole('heading', { name: 'Link inválido ou expirado' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  expect(await page.locator('body').innerText()).not.toContain('PRIVATE_MARKER');
  await page.getByRole('link', { name: 'Solicitar novo link' }).click();
  await expect(page.getByRole('heading', { name: 'Recuperar senha', exact: true })).toBeVisible();
  await page.screenshot({ path: `${evidence}/${info.project.name}-recovery.png`, fullPage: true });
});
