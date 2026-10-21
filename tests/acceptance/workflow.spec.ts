import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import type { Run, Account } from '../../scripts/validation-run.mjs';
const run = JSON.parse(process.env.MAPA_VALIDATION_RUN ?? 'null') as Run;
if (!run) throw Error('Scoped validation run required');
const [a, b] = run.accounts;
const origin = 'https://mapa.cnvt.com.br',
  evidence = '.scratch/mapa-mental/evidence/28';
type Node = {
  id: string;
  parentId: string | null;
  text: string;
  sortOrder: number;
  createdBy: string;
  updatedBy: string;
  source: string;
  aiGenerationId?: string;
};
type Doc = { map: { id: string; ownerId: string; revision: number }; nodes: Node[] };
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const saved = (page: Page) => expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
const node = (page: Page, text: string) =>
  page.locator('.react-flow__node').filter({ has: page.getByText(text, { exact: true }) });
async function login(page: Page, account: Account, path = '/login') {
  await page.goto(path);
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await button(page, 'Entrar').click();
  await page.locator('input[type="password"]').evaluateAll((inputs) => {
    for (const input of inputs) (input as HTMLInputElement).value = '';
  });
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}
async function api(page: Page) {
  const pending = page.waitForRequest((r) => r.url().includes('/rest/v1/rpc/') && r.method() === 'POST');
  await page.reload();
  const sent = await pending,
    headers = await sent.allHeaders(),
    base = new URL('/rest/v1/rpc/', sent.url()).href;
  return async (name: string, data: object) => {
    const response = await page.request.post(base + name, {
      headers: { apikey: headers.apikey, authorization: headers.authorization },
      data,
    });
    if (!response.ok()) throw Error(`Validation RPC rejected: ${name}`);
    return response.json();
  };
}
async function edit(page: Page, text: string) {
  await button(page, 'Editar texto').click();
  await page.getByLabel('Texto do nó', { exact: true }).fill(text);
  await button(page, 'Concluir edição').click();
}
async function select(page: Page, text: string, mobile: boolean) {
  await button(page, 'Enquadrar').click();
  if (mobile) await node(page, text).tap();
  else await node(page, text).click();
  await expect(page.locator('.node-panel .node-text')).toHaveText(text);
}
function recipient(): Account {
  const result = spawnSync(process.execPath, ['scripts/invitation-validation.mjs'], {
    input: JSON.stringify({ action: 'create-recipient', workspaceId: run.workspaces.X.id, runId: run.runId }),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw Error('Could not create disposable invitation recipient');
  return JSON.parse(result.stdout);
}

test('complete shared workflow with real AI, portable backup and revoked access', async ({ page, browser }, info) => {
  const mobile = info.project.name === 'mobile',
    invited = recipient();
  await login(page, a);
  await expect(page.getByRole('heading', { name: 'Seus mapas' })).toBeVisible();
  await page.getByRole('link', { name: 'Equipe', exact: true }).click();
  await page.getByLabel('E-mail da pessoa').fill(invited.email);
  await button(page, 'Enviar convite').click();
  await expect(page.getByRole('status').filter({ hasText: 'A conta já existe' })).toBeVisible();
  const context = await browser.newContext({
    baseURL: origin,
    viewport: info.project.use.viewport,
    isMobile: mobile,
    hasTouch: mobile,
  });
  try {
    const member = await context.newPage();
    await login(member, invited);
    await button(member, 'Aceitar convite').click();
    await expect(member.getByRole('heading', { name: 'Seus mapas' })).toBeVisible();
    const rpc = await api(member);
    await button(member, 'Novo mapa').click();
    await expect(member.locator('.react-flow__node')).toHaveCount(1);
    const mapId = new URL(member.url()).pathname.split('/').at(-1)!;
    const read = async (): Promise<Doc> => rpc('get_map_document', { p_map_id: mapId });
    await saved(member);
    await button(member, 'Adicionar filho').click();
    await member.getByLabel('Texto do nó').fill('Ramo A');
    await button(member, 'Concluir edição').click();
    await saved(member);
    await select(member, 'Ideia central', mobile);
    await button(member, 'Adicionar filho').click();
    await member.getByLabel('Texto do nó').fill('Ramo B');
    await button(member, 'Concluir edição').click();
    await saved(member);
    await button(member, 'Mover').click();
    await member.getByRole('radio', { name: /Ramo A/ }).check();
    await button(member, 'Mover para este pai').click();
    await saved(member);
    let doc = await read();
    expect(doc.nodes.find((n) => n.text === 'Ramo B')?.parentId).toBe(doc.nodes.find((n) => n.text === 'Ramo A')?.id);
    await select(member, 'Ramo A', mobile);
    await member.getByRole('button', { name: 'Recolher ramo (1)', exact: true }).click();
    await expect(member.locator('.react-flow__node')).toHaveCount(2);
    await member.getByRole('button', { name: 'Expandir ramo (1 ocultos)', exact: true }).click();
    await expect(member.locator('.react-flow__node')).toHaveCount(3);
    await select(member, 'Ideia central', mobile);
    await member.getByLabel('Orientação para a IA (opcional)').fill('Quatro etapas breves para planejar um projeto.');
    const response = member.waitForResponse(
      (r) =>
        r.url().includes('/functions/v1/generate-children') &&
        r.request().method() === 'POST' &&
        r.request().postDataJSON().action !== 'availability',
    );
    await button(member, 'Gerar caminhos com IA').click();
    const jobResponse = await response;
    expect(jobResponse.status()).toBe(200);
    const job = await jobResponse.json();
    await expect(member.locator('.react-flow__node')).toHaveCount(7, { timeout: 65_000 });
    await saved(member);
    doc = await read();
    const generated = doc.nodes.filter((n) => n.source === 'ai');
    expect(generated).toHaveLength(4);
    for (const n of generated) {
      expect(n.createdBy).toBe(invited.id);
      expect(n.aiGenerationId).toBe(job.id);
    }
    const inspect = spawnSync(process.execPath, ['scripts/validation-ai.mjs', 'inspect', run.runId, mapId, job.id], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (inspect.status !== 0) throw Error('Provider usage inspection failed');
    const usage = JSON.parse(inspect.stdout);
    expect(usage.state).toBe('applied');
    expect(usage.usage.total_tokens).toBeGreaterThan(0);
    expect(usage.accountedTokens).toBe(usage.usage.total_tokens);
    await writeFile(
      `${evidence}/${info.project.name}-ai-usage.json`,
      JSON.stringify(
        {
          runId: run.runId,
          mapId,
          jobId: job.id,
          ...usage,
          monetaryCost: null,
          monetaryCostNote:
            'No verified billing total available; provider token usage recorded without estimating currency.',
        },
        null,
        2,
      ) + '\n',
    );
    await button(member, 'Desfazer').click();
    await expect(member.locator('.react-flow__node')).toHaveCount(3);
    await saved(member);
    await button(member, 'Refazer').click();
    await expect(member.locator('.react-flow__node')).toHaveCount(7);
    await saved(member);
    await select(member, 'Ramo B', mobile);
    await edit(member, 'Ramo B revisado');
    await saved(member);
    await button(member, 'Excluir nó').click();
    await expect(member.locator('.react-flow__node')).toHaveCount(6);
    await saved(member);
    await button(member, 'Desfazer').click();
    await expect(member.locator('.react-flow__node')).toHaveCount(7);
    await saved(member);
    await page.goto(`/mapas/${mapId}`);
    await expect(page.locator('.react-flow__node')).toHaveCount(7);
    await select(page, 'Ideia central', mobile);
    await edit(page, 'Planejamento compartilhado');
    await saved(page);
    doc = await read();
    const root = doc.nodes.find((n) => n.parentId === null)!;
    expect(root.createdBy).toBe(invited.id);
    expect(root.updatedBy).toBe(a.id);
    await member.reload();
    await expect(member.locator('.react-flow__node')).toHaveCount(7);
    await button(member, 'Detalhes do mapa').click();
    await member.getByLabel('Novo responsável', { exact: true }).selectOption(a.id);
    await button(member, 'Transferir responsabilidade').click();
    await expect(member.getByText(`Responsável atual: ${a.name}`, { exact: true })).toBeVisible();
    await button(member, 'Fechar detalhes').click();
    await saved(member);
    const original = await read();
    expect(original.map.ownerId).toBe(a.id);
    await button(member, 'Exportar backup').click();
    const download = member.waitForEvent('download');
    await button(member, 'Baixar backup JSON').click();
    const file = `${evidence}/${info.project.name}-portable-backup.json`;
    await (await download).saveAs(file);
    await button(member, 'Fechar exportação').click();
    const backup = JSON.parse(await readFile(file, 'utf8'));
    expect(backup.nodes).toHaveLength(7);
    expect(backup.hasPendingChanges).toBe(false);
    await member.getByRole('link', { name: 'Mapas', exact: true }).click();
    await button(member, 'Importar backup').click();
    await member.getByLabel('Arquivo de backup').setInputFiles(file);
    await button(member, 'Confirmar importação').click();
    await expect(member.locator('.react-flow__node')).toHaveCount(7);
    const copyId = new URL(member.url()).pathname.split('/').at(-1)!;
    expect(copyId).not.toBe(mapId);
    const copy = (await rpc('get_map_document', { p_map_id: copyId })) as Doc;
    for (const n of original.nodes) {
      const match = copy.nodes.find((c) => c.text === n.text)!;
      expect(match).toBeTruthy();
      expect(match.id).not.toBe(n.id);
      expect(match.sortOrder).toBe(n.sortOrder);
      expect(match.createdBy).toBe(invited.id);
      expect(match.source).toBe('manual');
      const parentText = original.nodes.find((p) => p.id === n.parentId)?.text;
      expect(copy.nodes.find((p) => p.id === match.parentId)?.text).toBe(parentText);
    }
    expect(await read()).toEqual(original);
    await member.screenshot({ path: `${evidence}/${info.project.name}-roundtrip.png`, fullPage: true });
    await rpc('apply_map_command', {
      p_map_id: copyId,
      p_operation_id: crypto.randomUUID(),
      p_editor_session_id: crypto.randomUUID(),
      p_expected_revision: copy.map.revision,
      p_kind: 'delete_map',
      p_payload: {},
    });
    expect(await read()).toEqual(original);
    await member.goto(`/mapas/${mapId}`);
    await expect(member.locator('.react-flow__node')).toHaveCount(7);
    for (const width of [mobile ? 390 : 1440, mobile ? 360 : 768]) {
      await member.setViewportSize({ width, height: mobile ? 844 : 900 });
      expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await member.setViewportSize(info.project.use.viewport!);
    await page.getByRole('link', { name: 'Equipe', exact: true }).click();
    await page
      .getByRole('listitem')
      .filter({ hasText: invited.name })
      .getByRole('button', { name: 'Desativar acesso', exact: true })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar desativação' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Acesso desativado' })).toBeVisible();
    await member.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(member.getByRole('heading', { name: 'Sem acesso à equipe' })).toBeVisible();
    await expect(member.locator('.react-flow__node')).toHaveCount(0);
    await member.screenshot({ path: `${evidence}/${info.project.name}-revoked.png`, fullPage: true });
    await writeFile(
      `${evidence}/${info.project.name}-workflow.json`,
      JSON.stringify(
        {
          runId: run.runId,
          mapId,
          copyId,
          invited: true,
          moved: true,
          collapsed: true,
          realAi: true,
          aiUndoRedo: true,
          deletedAndUndone: true,
          authorshipPreserved: true,
          transferred: true,
          backupRoundtrip: true,
          originalUnchanged: true,
          onlyValidationCopyDeleted: true,
          accessRevoked: true,
          extraWidth: mobile ? 360 : 768,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await context.close();
  }
});

test('two real sessions preserve a conflict and recover a failed network write', async ({ page, browser }, info) => {
  const mobile = info.project.name === 'mobile';
  await login(page, b);
  await expect(page.getByRole('heading', { name: 'Seus mapas' })).toBeVisible();
  await button(page, 'Novo mapa').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  const path = new URL(page.url()).pathname;
  const context = await browser.newContext({
    baseURL: origin,
    viewport: info.project.use.viewport,
    isMobile: mobile,
    hasTouch: mobile,
  });
  let release = () => {};
  try {
    const other = await context.newPage();
    await login(other, a, path);
    await expect(other.locator('.react-flow__node')).toHaveCount(1);
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await other.route('**/rpc/apply_map_command', async (route) => {
      await held;
      await route.continue();
    });
    const pending = other.waitForRequest('**/rpc/apply_map_command');
    await edit(other, 'Versão local de A');
    await pending;
    await edit(page, 'Versão salva por B');
    await saved(page);
    release();
    await expect(other.locator('.save-state [role="status"]')).toHaveText(/Conflito/);
    await other.screenshot({ path: `${evidence}/${info.project.name}-conflict.png`, fullPage: true });
    await other.unroute('**/rpc/apply_map_command');
    await button(other, 'Descartar alterações locais').click();
    await button(other, 'Confirmar descarte e abrir versão salva').click();
    await expect(node(other, 'Versão salva por B')).toBeVisible();
    await other.route('**/rpc/apply_map_command', (route) => route.abort('internetdisconnected'));
    await edit(other, 'Edição recuperada após a rede voltar');
    await expect(other.locator('.save-state [role="status"]')).toHaveText(/Falha ao salvar/);
    await other.reload();
    await expect(other.getByText('Rascunho recuperado deste navegador.', { exact: false })).toBeVisible();
    await other.unroute('**/rpc/apply_map_command');
    await button(other, 'Tentar novamente').click();
    await saved(other);
    await other.reload();
    await expect(node(other, 'Edição recuperada após a rede voltar')).toBeVisible();
    await other.screenshot({ path: `${evidence}/${info.project.name}-network-recovered.png`, fullPage: true });
    await writeFile(
      `${evidence}/${info.project.name}-resilience.json`,
      JSON.stringify(
        {
          runId: run.runId,
          conflict: true,
          remotePreserved: true,
          localDiscardExplicit: true,
          networkFailureInjectedOnlyInBrowser: true,
          durableDraft: true,
          retrySaved: true,
          reloadConfirmed: true,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    release();
    await context.close();
  }
});
