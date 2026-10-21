import { fileRun } from './file-run';
import { expect, test, type Page } from '@playwright/test';

const run = fileRun();
const [a, b, c] = run.accounts;

async function signIn(page: Page, account: { email: string; password: string }) {
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}
async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/login$/);
}
// The root text also appears in the node panel; assertions look at the canvas.
const rootNode = (page: Page) => page.locator('.react-flow__node').getByText('Ideia central', { exact: true });
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('B creates a map in X, A reopens it and C cannot see it', async ({ page }, testInfo) => {
  // While the library is open (load and idle, before any click), it never requests nodes or documents.
  const libraryRequests: string[] = [];
  let watchingLibrary = false;
  page.on('request', (request) => {
    if (watchingLibrary && /\/rest\/v1\/(nodes|rpc\/get_map_document)/.test(request.url()))
      libraryRequests.push(request.url());
  });

  await page.goto('/mapas');
  await expect(page).toHaveURL(/login\?next=/);
  watchingLibrary = true;
  await signIn(page, b);
  await expect(page).toHaveURL(/\/mapas$/);
  await expect(page.getByRole('heading', { name: 'Seus mapas', level: 1 })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('library-b.png'), fullPage: true });
  watchingLibrary = false;
  await page.getByRole('button', { name: 'Novo mapa', exact: true }).click();
  await expect(page).toHaveURL(/\/mapas\/[0-9a-f-]{36}$/);
  const mapPath = new URL(page.url()).pathname;
  for (const step of ['created', 'reloaded']) {
    await expect(page.getByRole('heading', { name: 'Novo mapa', level: 1 })).toBeVisible();
    await expect(rootNode(page)).toBeVisible();
    await expect(page.getByText(`Responsável: ${b.name}`)).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`editor-${step}.png`), fullPage: true });
    if (step === 'created') await page.reload();
  }
  await signOut(page);

  await page.goto('/mapas');
  watchingLibrary = true;
  await signIn(page, a);
  const item = page.locator(`a[href="${mapPath}"]:visible`);
  await expect(item).toContainText('Novo mapa');
  await expect(page.locator(`[data-map-id="${mapPath.split('/').at(-1)}"]:visible`)).toContainText(b.name);
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('library-a.png'), fullPage: true });
  watchingLibrary = false;
  await item.click();
  await expect(page).toHaveURL(new RegExp(`${mapPath}$`));
  await expect(rootNode(page)).toBeVisible();
  await signOut(page);

  await page.goto('/mapas');
  await signIn(page, c);
  await expect(page.getByRole('heading', { name: 'Nenhum mapa ainda' })).toBeVisible();
  await page.goto(mapPath);
  await expect(page.getByRole('heading', { name: 'Mapa indisponível', level: 1 })).toBeVisible();
  await expect(rootNode(page)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('unavailable-c.png'), fullPage: true });
  await signOut(page);

  expect(libraryRequests).toEqual([]);
});
