import { expect, test, type Page } from '@playwright/test';
import type { Account, Run } from '../../scripts/validation-run.mjs';

const run = JSON.parse(process.env.MAPA_VALIDATION_RUN ?? 'null') as Run | null;
if (!run) throw new Error('Execução de validação ausente; rode pelo playwright.auth.config.ts.');
const accounts = run.accounts;
const teamCaption = (account: Account) => `Equipe: ${run.workspaces[account.workspace as 'X' | 'Y'].name}`;

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

for (const account of accounts) {
  test(`${account.key} has real workspace access and safe logout`, async ({ page }, testInfo) => {
    await page.goto('/equipe'); await expect(page).toHaveURL(/login\?next=/);
    await signIn(page, account.email, account.password);
    if (!account.workspace) {
      await expect(page).toHaveURL(/sem-acesso$/);
      await expect(page.getByRole('heading', { name: 'Sua conta não tem vínculo ativo' })).toBeVisible();
      await expect(page.getByText(run.workspaces.X.name)).toHaveCount(0);
    } else {
      await expect(page).toHaveURL(/equipe$/);
      await expect(page.getByText(teamCaption(account), { exact: true })).toBeVisible();
      await expect(page.getByText(`${account.name} (você)`, { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByText(`${account.name} (você)`, { exact: true })).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('authenticated.png'), fullPage: true });
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page).toHaveURL(/login$/);
    await page.goBack(); await expect(page).toHaveURL(/login/);
    await expect(page.getByText(`${account.name} (você)`, { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('mapa.auth.v1'))).toBeNull();
  });
}
test('wrong password preserves inputs and explains error', async ({ page }) => {
  await page.goto('/login');
  await signIn(page, accounts[0].email, `${accounts[0].password}-incorreta`);
  await expect(page.getByRole('alert')).toContainText('E-mail ou senha incorretos');
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue(accounts[0].email);
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeEnabled();
});
test('external return target never redirects away from app', async ({ page }) => {
  await page.goto('/login?next=https://example.com');
  await signIn(page, accounts[0].email, accounts[0].password);
  await expect(page).toHaveURL('http://127.0.0.1:4174/mapas');
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/login$/);
});
test('switching A to C in the same browser clears the previous team', async ({ page }) => {
  for (const account of [accounts[0], accounts[2]]) {
    await page.goto('/login');
    await signIn(page, account.email, account.password);
    await expect(page).toHaveURL(/mapas$/);
    await page.getByRole('link', { name: 'Equipe', exact: true }).click();
    await expect(page.getByText(`${account.name} (você)`, { exact: true })).toBeVisible();
    if (account.key === 'C') {
      await expect(page.getByText(`${accounts[0].name} (você)`, { exact: true })).toHaveCount(0);
      await expect(page.getByText(teamCaption(accounts[0]), { exact: true })).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page).toHaveURL(/login$/);
  }
});
