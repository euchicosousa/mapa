import { fileRun } from './file-run';
import { expect, test, type Locator, type Page } from '@playwright/test';

const run = fileRun();
const [a, b] = run.accounts;

async function signIn(page: Page, account: { email: string; password: string }) {
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 15_000 });
}
async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/login$/);
}
const saveState = (page: Page) => page.locator('.save-state [role="status"]');
const node = (page: Page, text: string) =>
  page.locator('.react-flow__node').filter({ has: page.getByText(text, { exact: true }) });
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("B builds child and grandchild, A edits B's node and authorship is preserved", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const mobile = testInfo.project.name === 'mobile';
  // Touch only on mobile: no hover, double click or physical keyboard shortcut.
  const press = (target: Locator) => (mobile ? target.tap() : target.click());

  await page.goto('/mapas');
  await signIn(page, b);
  await expect(page.getByRole('heading', { name: 'Seus mapas', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Novo mapa', exact: true }).click();
  await expect(page).toHaveURL(/\/mapas\/[0-9a-f-]{36}$/);
  const mapPath = new URL(page.url()).pathname;
  await expect(page.getByText('Nó central')).toBeVisible();
  await expect(saveState(page)).toHaveText(/Salvo/);

  await press(page.getByRole('button', { name: 'Adicionar filho' }));
  const field = page.getByLabel('Texto do nó');
  await expect(field).toBeFocused();
  await field.fill('Filho de B');
  await press(page.getByRole('button', { name: 'Concluir edição' }));
  await press(page.getByRole('button', { name: 'Adicionar filho' }));
  await field.fill('Neto de B');
  await press(page.getByRole('button', { name: 'Concluir edição' }));
  await expect(node(page, 'Neto de B')).toBeVisible();
  await expect(saveState(page)).toHaveText(/Salvo/);
  await expect(page.getByText('Criado por você · Última edição por você')).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('editor-b-tree.png') });

  // Invalid text stays on screen and is never sent.
  await press(page.getByRole('button', { name: 'Editar texto' }));
  await field.fill('   ');
  await expect(page.getByRole('alert').filter({ hasText: 'entre 1 e 500 caracteres' })).toBeVisible();
  await expect(field).toHaveValue('   ');
  await expect(page.getByRole('button', { name: 'Concluir edição' })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('editor-validation.png') });
  // Regression: invalid text must survive attempts to select another node.
  const oversized = 'x'.repeat(501);
  await field.fill(oversized);
  await expect(page.getByRole('button', { name: 'Adicionar filho' })).toBeDisabled();
  await expect(page.getByRole('alert').filter({ hasText: 'Corrija o texto para trocar de nó' })).toBeVisible();
  // Navigation no longer resets zoom after additions; fit before selecting a distant ancestor.
  await press(page.getByRole('button', { name: 'Enquadrar', exact: true }));
  await press(node(page, 'Filho de B'));
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(oversized);
  await expect(saveState(page)).toHaveText(/Alterações pendentes/);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('editor-invalid-draft-preserved.png') });
  await field.fill('Neto de B');
  await press(page.getByRole('button', { name: 'Concluir edição' }));
  await expect(saveState(page)).toHaveText(/Salvo/);
  // A distinct target avoids interpreting rapid repeated taps as canvas double-tap zoom.
  await press(node(page, 'Ideia central'));
  await expect(page.locator('.node-panel .node-text')).toHaveText('Ideia central');

  await page.reload();
  await expect(node(page, 'Filho de B')).toBeVisible();
  await expect(node(page, 'Neto de B')).toBeVisible();
  await signOut(page);

  await page.goto(mapPath);
  await signIn(page, a);
  await expect(page).toHaveURL(new RegExp(`${mapPath}$`));
  await press(node(page, 'Filho de B'));
  await expect(page.getByText(`Criado por ${b.name} · Última edição por ${b.name}`)).toBeVisible();
  await press(page.getByRole('button', { name: 'Editar texto' }));
  await field.fill('Filho de B, editado por A');
  await press(page.getByRole('button', { name: 'Concluir edição' }));
  await expect(saveState(page)).toHaveText(/Salvo/);
  await expect(page.getByText(`Criado por ${b.name} · Última edição por você`)).toBeVisible();
  await page.reload();
  await press(node(page, 'Filho de B, editado por A'));
  await expect(page.getByText(`Criado por ${b.name} · Última edição por você`)).toBeVisible();
  await expect(node(page, 'Neto de B')).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('editor-a-edited.png') });

  // Two quick edits with a slow server: order kept and "Salvo" only after the last one.
  const sent: string[] = [];
  await page.route('**/rest/v1/rpc/apply_map_command', async (route) => {
    sent.push(String(route.request().postDataJSON().p_payload.text));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await press(page.getByRole('button', { name: 'Editar texto' }));
  await field.fill('Primeira');
  await expect(saveState(page)).toHaveText(/Salvando/);
  await field.fill('Segunda');
  await press(page.getByRole('button', { name: 'Concluir edição' }));
  await expect(saveState(page)).not.toHaveText(/Salvo/);
  await page.screenshot({ path: testInfo.outputPath('editor-saving.png') });
  await expect(saveState(page)).toHaveText(/Salvo/, { timeout: 10_000 });
  expect(sent).toEqual(['Primeira', 'Segunda']);
  await page.unroute('**/rest/v1/rpc/apply_map_command');

  // The server commits but the response is lost: retry uses the same id, no duplicate.
  let lost = 0;
  const operations: string[] = [];
  await page.route('**/rest/v1/rpc/apply_map_command', async (route) => {
    operations.push(route.request().postDataJSON().p_operation_id);
    if (lost++ === 0) {
      await route.fetch();
      await route.abort('timedout');
    } else await route.continue();
  });
  await press(node(page, 'Segunda'));
  await press(page.getByRole('button', { name: 'Adicionar filho' }));
  await field.fill('Depois do timeout');
  await field.blur();
  await expect(saveState(page)).toHaveText(/Falha ao salvar/);
  await page.screenshot({ path: testInfo.outputPath('editor-retry.png') });
  await press(page.getByRole('button', { name: 'Tentar novamente' }));
  await expect(saveState(page)).toHaveText(/Salvo/);
  expect(operations[1]).toBe(operations[0]);
  await page.unroute('**/rest/v1/rpc/apply_map_command');
  await page.reload();
  await expect(node(page, 'Depois do timeout')).toHaveCount(1);
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await signOut(page);
});

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  await page.screenshot({ path: info.outputPath('failure.png'), fullPage: true });
});
