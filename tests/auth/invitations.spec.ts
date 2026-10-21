import { spawnSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import type { Run, Account } from '../../scripts/validation-run.mjs';
const run = JSON.parse(process.env.MAPA_VALIDATION_RUN ?? 'null') as Run;
if (!run) throw Error('Validation run required');
const admin = run.accounts.find((a) => a.key === 'A')!;
async function login(page: Page, account: Account) {
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}
function fixture(action: string, id: string) {
  const r = spawnSync(process.execPath, ['scripts/invitation-validation.mjs'], {
    input: JSON.stringify({ action, id, workspaceId: run.workspaces.X.id, runId: run.runId }),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (r.status !== 0) throw Error('Scoped invitation fixture failed');
}
test('administrator invites, recipient rejects invalid states and accepts one membership', async ({
  page,
  browser,
}, info) => {
  const created = spawnSync(process.execPath, ['scripts/invitation-validation.mjs'], {
    input: JSON.stringify({ action: 'create-recipient', workspaceId: run.workspaces.X.id, runId: run.runId }),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (created.status !== 0) throw Error('Could not prepare scoped invitee');
  const recipient = JSON.parse(created.stdout) as Account;
  await login(page, admin);
  await expect(page).toHaveURL(/mapas$/);
  await page.getByRole('link', { name: 'Equipe', exact: true }).click();
  await page.getByLabel('E-mail da pessoa').fill(recipient.email);
  await page.getByRole('button', { name: 'Enviar convite', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'A conta já existe' })).toBeVisible();
  let row = page.getByRole('listitem').filter({ hasText: recipient.email });
  await expect(row).toHaveCount(1);
  const context = await browser.newContext({
    viewport: info.project.use.viewport,
    isMobile: info.project.name === 'mobile',
    hasTouch: info.project.name === 'mobile',
  });
  const invitee = await context.newPage();
  try {
    await login(invitee, recipient);
    await expect(invitee).toHaveURL(/sem-acesso$/);
    await expect(invitee.getByRole('button', { name: 'Aceitar convite' })).toBeVisible();
    await row.getByRole('button', { name: 'Revogar convite' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Convite revogado' })).toBeVisible();
    await invitee.getByRole('button', { name: 'Aceitar convite' }).click();
    await expect(invitee.getByRole('alert')).toContainText('expirou, foi revogado');
    await page.getByLabel('E-mail da pessoa').fill(recipient.email);
    await page.getByRole('button', { name: 'Enviar convite', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'A conta já existe' })).toBeVisible();
    row = page
      .getByRole('listitem')
      .filter({ hasText: recipient.email })
      .filter({ has: page.getByRole('button', { name: 'Revogar convite' }) });
    const id = await row.locator('input[name=invitationId]').first().inputValue();
    fixture('fail', id);
    await page.reload();
    row = page
      .getByRole('listitem')
      .filter({ hasText: recipient.email })
      .filter({ has: page.getByRole('button', { name: 'Revogar convite' }) });
    await expect(row.getByText('Falha no envio', { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: /Reenviar em/ })).toBeDisabled();
    await page.screenshot({ path: `.scratch/mapa-mental/evidence/04/${info.project.name}-failed.png`, fullPage: true });
    fixture('cooldown', id);
    fixture('expire', id);
    await invitee.reload();
    await expect(invitee.getByRole('button', { name: 'Aceitar convite' })).toHaveCount(0);
    await page.reload();
    row = page
      .getByRole('listitem')
      .filter({ hasText: recipient.email })
      .filter({ has: page.getByRole('button', { name: 'Revogar convite' }) });
    await expect(row.getByText('Vencido', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Reenviar convite', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'A conta já existe' })).toBeVisible();
    await invitee.reload();
    await invitee.getByRole('button', { name: 'Aceitar convite' }).click();
    await expect(invitee).toHaveURL(/mapas$/);
    await invitee.getByRole('link', { name: 'Equipe', exact: true }).click();
    await expect(invitee.getByText(`${recipient.name} (você)`, { exact: true })).toBeVisible();
    await expect(invitee.getByRole('button', { name: 'Enviar convite', exact: true })).toHaveCount(0);
    expect(await invitee.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await invitee.screenshot({
      path: `.scratch/mapa-mental/evidence/04/${info.project.name}-accepted.png`,
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.getByRole('listitem').filter({ hasText: recipient.email }).filter({ hasText: 'Aceito' }),
    ).toHaveCount(1);
  } finally {
    await context.close();
  }
});
