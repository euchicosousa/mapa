import { expect, test, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Run } from '../../scripts/validation-run.mjs';
const run = JSON.parse(process.env.MAPA_VALIDATION_RUN ?? 'null') as Run | null;
if (!run) throw Error('Execução ausente');
const account = run.accounts[0];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const events: string[] = [];
    Object.assign(window, { accessibilityFocusEvents: events });
    document.addEventListener('focusin', (event) => {
      const el = event.target;
      if (el instanceof HTMLElement)
        events.push(
          `${el.tagName}.${el.className}: ${el.getAttribute('aria-label') ?? el.textContent?.slice(0, 35) ?? ''}`,
        );
    });
  });
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    const focus = await page.evaluate(() => ({
      active: document.activeElement?.outerHTML.slice(0, 250),
      events: Reflect.get(window, 'accessibilityFocusEvents'),
    }));
    console.log(JSON.stringify(focus));
  }
});
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
async function audit(page: Page, info: TestInfo, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  await info.attach(`axe-${label}`, {
    body: JSON.stringify(
      {
        url: new URL(page.url()).pathname,
        violations: results.violations,
        incomplete: results.incomplete.map((i) => ({
          id: i.id,
          impact: i.impact,
          nodes: i.nodes.map((n) => n.target),
        })),
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect(
    results.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  expect(results.incomplete.filter((item) => item.id === 'aria-prohibited-attr')).toEqual([]);
}
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await button(page, 'Entrar').click();
  await expect(page.getByRole('heading', { name: 'Seus mapas' })).toBeVisible();
}
async function create(page: Page) {
  await login(page);
  await button(page, 'Novo mapa').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(button(page, 'Editar texto')).toBeEnabled();
  await expect(page.getByLabel('Orientação para a IA (opcional)', { exact: true })).toBeVisible();
}
async function keyboardButton(page: Page, name: string) {
  const target = button(page, name);
  await target.focus();
  await page.keyboard.press('Enter');
}
async function saved(page: Page) {
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
}

test('audit login, library, import and editor at required widths', async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.goto('/login');
  await audit(page, info, 'login');
  await login(page);
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await audit(page, info, `library-${width}`);
    await keyboardButton(page, 'Importar backup');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await audit(page, info, `import-${width}`);
    await page.screenshot({ path: info.outputPath(`import-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(button(page, 'Importar backup')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await button(page, 'Novo mapa').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await button(page, 'Enquadrar').click();
    await audit(page, info, `editor-${width}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`editor-${width}.png`), fullPage: true });
  }
});

async function tabTo(page: Page, name: string, back = false) {
  const target = button(page, name);
  for (let i = 0; i < 65; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return target;
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
  }
  throw Error(`Controle não alcançado por teclado: ${name}`);
}
async function activate(page: Page, name: string, back = false) {
  await tabTo(page, name, back);
  await page.keyboard.press('Enter');
}

test('essential actions work with keyboard buttons, native fields and modal focus', async ({ page }, info) => {
  test.setTimeout(150_000);
  await create(page);
  await activate(page, 'Ações do nó selecionado');
  await expect(button(page, 'Editar texto')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Texto do nó', { exact: true })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('Raiz acessível');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Segunda linha');
  await expect(page.getByLabel('Texto do nó', { exact: true })).toHaveValue('Raiz acessível\nSegunda linha');
  const count = await page.locator('.react-flow__node').count();
  await page.keyboard.press('Tab');
  expect(await page.locator('.react-flow__node').count()).toBe(count);
  expect(await page.getByLabel('Texto do nó', { exact: true }).evaluate((el) => el === document.activeElement)).toBe(
    false,
  );
  await activate(page, 'Concluir edição');
  await expect(button(page, 'Editar texto')).toBeFocused();
  await saved(page);
  await activate(page, 'Adicionar filho');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('Ramo A');
  await activate(page, 'Concluir edição');
  await saved(page);
  await activate(page, 'Adicionar irmão');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('Ramo B');
  await activate(page, 'Concluir edição');
  await saved(page);
  await activate(page, 'Mover');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Buscar novo pai')).toBeFocused();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(button(page, 'Mover')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('radio', { name: /Ramo A/ }).focus();
  await page.keyboard.press('Space');
  await activate(page, 'Mover para este pai');
  await expect(button(page, 'Mover')).toBeFocused();
  await saved(page);
  await audit(page, info, 'after-move');
  await activate(page, 'Excluir nó', true);
  await saved(page);
  await expect(page.locator('.node-panel .node-text')).toHaveText('Ramo A');
  await expect(page.getByRole('group', { name: 'Ramo A', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(button(page, 'Editar texto')).toBeFocused();
  await activate(page, 'Gerar caminhos com IA', true);
  await expect(page.getByText('Quatro caminhos gerados com IA e salvos no mapa.', { exact: true })).toBeVisible({
    timeout: 65_000,
  });
  await saved(page);
  await audit(page, info, 'generated');
  await page.screenshot({ path: info.outputPath('keyboard-generated.png'), fullPage: true });
  // Reach history backwards so Tab's optional canvas shortcut is not invoked.
  await activate(page, 'Desfazer', true);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await saved(page);
  await page.screenshot({ path: info.outputPath('keyboard-undo.png'), fullPage: true });
});

test('canvas shortcuts stay scoped and focus leaves deleted or collapsed nodes', async ({ page }, info) => {
  await create(page);
  const root = page.locator('.react-flow__node').first();
  await root.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Texto do nó', { exact: true })).toBeFocused();
  await page.keyboard.insertText('Filho pelo atalho');
  await keyboardButton(page, 'Concluir edição');
  await saved(page);
  let child = page.locator('.react-flow__node').filter({ hasText: 'Filho pelo atalho' });
  await child.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Texto do nó', { exact: true })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('Irmão pelo atalho');
  await keyboardButton(page, 'Concluir edição');
  await saved(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  child = page.locator('.react-flow__node').filter({ hasText: 'Irmão pelo atalho' });
  await child.focus();
  await page.keyboard.press('F2');
  await expect(page.getByLabel('Texto do nó', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(button(page, 'Editar texto')).toBeFocused();
  await child.focus();
  await page.keyboard.press('Delete');
  await saved(page);
  await expect(root).toBeFocused();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await root.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(root).not.toBeFocused();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await root.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Filho pelo atalho' })).toBeFocused();
  // Collapsing a parent while focus is in its descendants must return to a visible node.
  await page
    .getByRole('button', { name: 'Recolher ramo: Ideia central', exact: true })
    .evaluate((el) => (el as HTMLButtonElement).click());
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(root).toBeFocused();
  await page.keyboard.press('Space');
  await expect(button(page, 'Editar texto')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.canvas')).toBeFocused();
  await expect(button(page, 'Editar texto')).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(button(page, 'Editar texto')).toBeFocused();
  await audit(page, info, 'shortcuts');
});

test('touch targets, short viewport, zoom and import errors remain reachable', async ({ page }, info) => {
  test.setTimeout(120_000);
  await create(page);
  const press = async (name: string) => {
    if (info.project.name.includes('mobile')) await button(page, name).tap();
    else await button(page, name).click();
  };
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 420 });
    await press('Editar texto');
    await page.getByLabel('Texto do nó', { exact: true }).fill('Texto que permanece visível com teclado aberto');
    await button(page, 'Concluir edição').scrollIntoViewIfNeeded();
    await expect(button(page, 'Concluir edição')).toBeInViewport({ ratio: 1 });
    await press('Concluir edição');
    await saved(page);
    for (const el of await page
      .locator(
        '.node-actions button, .ai-generation button, .canvas-controls button, .editor-history button, .app-header a, .app-header button',
      )
      .all()) {
      if (!(await el.isVisible())) continue;
      const box = await el.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(await el.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await button(page, 'Enquadrar').click();
    await page.screenshot({ path: info.outputPath(`short-viewport-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 720, height: 450 });
  await audit(page, info, '200-percent-equivalent');
  const text = page.getByLabel('Orientação para a IA (opcional)', { exact: true });
  await text.focus();
  await page.keyboard.insertText('Texto nativo');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(text).toHaveValue('');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.getByRole('link', { name: 'Seus mapas', exact: true }).click();
  await press('Importar backup');
  await page
    .getByLabel('Arquivo de backup')
    .setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') });
  await expect(page.getByRole('alert')).toBeVisible();
  await audit(page, info, 'import-error');
  const dialog = page.getByRole('dialog');
  await page.setViewportSize({ width: 360, height: 420 });
  await dialog.getByRole('button', { name: 'Fechar importação', exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: 'Fechar importação', exact: true })).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Escape');
  await expect(button(page, 'Importar backup')).toBeFocused();
});
