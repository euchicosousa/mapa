import { expect, test } from '@playwright/test';
test('login, unknown URL and browser history are distinct', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Um lugar para suas próximas ideias.');
  await page.getByRole('link', { name: 'Recuperar senha' }).click();
  await expect(page).toHaveURL(/recuperar-senha$/);
  await page.goBack(); await expect(page).toHaveURL(/login$/);
  await page.goForward(); await expect(page).toHaveURL(/recuperar-senha$/);
  await page.goto('/pagina-desconhecida'); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Página não encontrada');
  await page.screenshot({ path: testInfo.outputPath('404.png'), fullPage: true });
  await page.getByRole('link', { name: 'Ir para o acesso' }).click(); await expect(page).toHaveURL(/login$/);
  expect(errors).toEqual([]);
});
test('all direct routes survive reload without page overflow', async ({ page }) => {
  for (const path of ['/', '/login', '/recuperar-senha', '/auth/callback', '/definir-senha', '/sem-acesso', '/mapas', '/mapas/00000000-0000-4000-8000-000000000001', '/equipe', '/inexistente']) {
    await page.goto(path); await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.reload(); await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
test('missing config explains setup and never offers fabricated login', async ({ page }, testInfo) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Configuração necessária' })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('login.png'), fullPage: true });
  await page.getByText('Como configurar o ambiente').click();
  await expect(page.getByText('VITE_SUPABASE_URL', { exact: true })).toBeVisible();
  await expect(page.getByText('VITE_SUPABASE_PUBLISHABLE_KEY', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('login-config.png'), fullPage: true });
  for (const target of await page.locator('nav a, summary, .text-link, .brand').all()) {
    const box = await target.boundingBox(); expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('link', { name: 'Equipe', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Acesso', exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('focus-navigation.png'), fullPage: true });
});
test('protected URLs never expose private content without configured Auth', async ({ page }) => {
  for (const path of ['/mapas', '/equipe', '/mapas/test', '/sem-acesso']) {
    await page.goto(path);
    await expect(page).toHaveURL(/login/);
    await expect(page.getByRole('heading', {name:'Um lugar para suas próximas ideias.'})).toBeVisible();
    await expect(page.getByText('Pessoas da equipe',{exact:true})).toHaveCount(0);
  }
});
test('MAPA vector logo is served and renders without an external font', async ({ page }) => {
  await page.goto('/login');
  const logo = page.getByRole('img', {name:'MAPA',exact:true});
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
  const svg = await page.request.get('/brand/mapa.svg'); expect(svg.ok()).toBe(true);
  expect(await svg.text()).toContain('<path');
});
