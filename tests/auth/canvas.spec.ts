import { fileRun } from './file-run';
import { expect, test, type Page } from '@playwright/test';
const run = fileRun();
const [, account] = run.accounts;

async function openMap(page: Page) {
  await page.goto('/mapas');
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Seus mapas' })).toBeVisible();
  const request = page.waitForRequest('**/rest/v1/rpc/get_map_document');
  const response = page.waitForResponse('**/rest/v1/rpc/get_map_document');
  await page.getByRole('button', { name: 'Novo mapa', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  return {
    request: await request,
    document: (await (await response).json()) as { map: { id: string; revision: number }; nodes: { id: string }[] },
  };
}
const transform = (page: Page) => page.locator('.react-flow__viewport').getAttribute('style');

async function geometry(page: Page) {
  return page.locator('.react-flow__node').evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );
}

test('50 real nodes: measured layout, explicit fit and stable zoom after editing', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const { request, document } = await openMap(page);
  const headers = await request.allHeaders();
  const endpoint = request.url().replace('get_map_document', 'apply_map_command');
  const ids = [document.nodes[0].id];
  let revision = document.map.revision;
  const session = crypto.randomUUID();
  for (let index = 1; index < 50; index++) {
    const nodeId = crypto.randomUUID();
    const response = await page.request.post(endpoint, {
      headers: { authorization: headers.authorization, apikey: headers.apikey },
      data: {
        p_map_id: document.map.id,
        p_operation_id: crypto.randomUUID(),
        p_editor_session_id: session,
        p_expected_revision: revision,
        p_kind: 'add_child',
        p_payload: {
          nodeId,
          parentId: ids[Math.floor((index - 1) / 7)],
          text: `Ramo ${index}: ` + 'Conteúdo longo com palavras e ideias. '.repeat(8 + (index % 5)),
        },
      },
    });
    expect(response.status()).toBe(200);
    revision = (await response.json()).revision;
    ids.push(nodeId);
  }
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(50);
  await expect
    .poll(async () => {
      const boxes = await geometry(page);
      return boxes.every((a, index) =>
        boxes
          .slice(index + 1)
          .every(
            (b) =>
              a.x + a.width <= b.x + 0.1 ||
              b.x + b.width <= a.x + 0.1 ||
              a.y + a.height <= b.y + 0.1 ||
              b.y + b.height <= a.y + 0.1,
          ),
      );
    })
    .toBe(true);
  await page.getByRole('button', { name: 'Enquadrar', exact: true }).click();
  await expect
    .poll(async () => {
      const canvas = await page.locator('.canvas').boundingBox();
      return (
        canvas &&
        (await geometry(page)).every(
          (b) =>
            b.x >= canvas.x &&
            b.y >= canvas.y + 64 &&
            b.x + b.width <= canvas.x + canvas.width &&
            b.y + b.height <= canvas.y + canvas.height,
        )
      );
    })
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('50-nodes-fit.png'), fullPage: true });
  await page.getByRole('button', { name: 'Aproximar', exact: true }).click();
  const before = await transform(page);
  await page.getByRole('button', { name: 'Editar texto', exact: true }).click();
  await page.getByLabel('Texto do nó').fill('Raiz editada sem reenquadrar a árvore');
  await page.getByRole('button', { name: 'Concluir edição' }).click();
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  expect(await transform(page)).toBe(before);
  await page.screenshot({ path: testInfo.outputPath('50-nodes-edit.png'), fullPage: true });
});

test('pan, touch selection, pinch and panel with reduced keyboard space', async ({ page, context }, testInfo) => {
  await openMap(page);
  const mobile = testInfo.project.name === 'mobile';
  const press = async (name: string) => {
    const button = page.getByRole('button', { name, exact: true });
    if (mobile) await button.tap();
    else await button.click();
  };
  const originalZoom = await page.getByLabel('Zoom', { exact: true }).textContent();
  await press('Adicionar filho');
  await page.getByLabel('Texto do nó').fill('Filho para navegar');
  await press('Concluir edição');
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  expect(await page.getByLabel('Zoom', { exact: true }).textContent()).toBe(originalZoom);
  await expect
    .poll(async () => {
      const canvas = (await page.locator('.canvas').boundingBox())!;
      const child = (await page.locator('.react-flow__node').filter({ hasText: 'Filho para navegar' }).boundingBox())!;
      return child.x >= canvas.x && child.x + child.width <= canvas.x + canvas.width;
    })
    .toBe(true);
  await press('Enquadrar');
  await page.locator('.canvas').scrollIntoViewIfNeeded();
  const box = (await page.locator('.canvas').boundingBox())!;
  const before = await transform(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height - 70;
  if (mobile) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let offset = 10; offset <= 60; offset += 10)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + offset, y: y - offset / 2 }],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => transform(page)).not.toBe(before);
    const pannedZoom = await page.getByLabel('Zoom', { exact: true }).textContent();
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 30, y },
        { x: x + 30, y },
      ],
    });
    for (let offset = 35; offset <= 60; offset += 5)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: x - offset, y },
          { x: x + offset, y },
        ],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.getByLabel('Zoom', { exact: true }).textContent()).not.toBe(pannedZoom);
    await cdp.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y - 30, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => transform(page)).not.toBe(before);
  }
  await press('Enquadrar');
  const root = page.locator('.react-flow__node').filter({ hasText: 'Ideia central' });
  if (mobile) await root.tap();
  else await root.click();
  await expect(page.locator('.node-panel .node-text')).toHaveText('Ideia central');
  await press('Editar texto');
  await page.getByLabel('Texto do nó').fill('Edição por toque. '.repeat(27));
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  const panelView = await transform(page);
  const field = page.getByLabel('Texto do nó');
  if (mobile) {
    await field.scrollIntoViewIfNeeded();
    await field.evaluate((element) => {
      element.scrollTop = 0;
    });
    const area = (await field.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const point = { x: area.x + area.width / 2, y: area.y + area.height - 12 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    for (let offset = 10; offset <= 70; offset += 10)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: point.x, y: point.y - offset }],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => field.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await cdp.detach();
  } else {
    await field.hover();
    await page.mouse.wheel(0, 200);
  }
  expect(await transform(page)).toBe(panelView);
  await page.screenshot({ path: testInfo.outputPath('navigation-edit.png'), fullPage: true });
  // A viewport reduction models available keyboard space; it does not emulate an OS keyboard.
  for (const width of mobile ? [390, 768] : [768]) {
    await page.setViewportSize({ width, height: 420 });
    await page.getByLabel('Texto do nó').focus();
    await page.getByRole('button', { name: 'Concluir edição' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Concluir edição' })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`keyboard-space-${width}.png`) });
  }
  await press('Concluir edição');
  await expect(page.getByRole('button', { name: 'Editar texto' })).toBeVisible();
});

test('deletes a three-level branch only after confirmation and selects its parent', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const { request: documentRequest, document } = await openMap(page);
  const mobile = testInfo.project.name === 'mobile';
  const press = async (name: string) => {
    const button = page.getByRole('button', { name, exact: true });
    if (mobile) await button.tap();
    else await button.click();
  };
  const add = async (text: string) => {
    await press('Adicionar filho');
    await page.getByLabel('Texto do nó').fill(text);
    await press('Concluir edição');
    await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  };
  await add('Ramo para excluir');
  await add('Filho do ramo');
  await add('Neto do ramo');
  await page.getByRole('button', { name: 'Enquadrar', exact: true }).click();
  const root = page.locator('.react-flow__node').filter({ hasText: 'Ideia central' });
  if (mobile) await root.tap();
  else await root.click();
  await add('Irmão preservado');
  await page.getByRole('button', { name: 'Enquadrar', exact: true }).click();
  const branch = page.locator('.react-flow__node').filter({ hasText: 'Ramo para excluir' });
  if (mobile) await branch.tap();
  else await branch.click();

  const commands: { p_kind: string; p_payload: { nodeId: string } }[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/rest/v1/rpc/apply_map_command')) commands.push(request.postDataJSON());
  });
  const requestHeaders = await documentRequest.allHeaders();
  const getMapRevision = async () => {
    const response = await page.request.post(documentRequest.url(), {
      headers: { authorization: requestHeaders.authorization, apikey: requestHeaders.apikey },
      data: { p_map_id: document.map.id },
    });
    return (await response.json()).map.revision as number;
  };
  const revisionBeforeCancel = await getMapRevision();
  await press('Excluir ramo');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/Este ramo contém 2 descendentes/)).toBeVisible();
  await press('Cancelar');
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  expect(commands.filter((command) => command.p_kind === 'delete_subtree')).toHaveLength(0);
  expect(await getMapRevision()).toBe(revisionBeforeCancel);

  await press('Excluir ramo');
  await dialog.getByRole('button', { name: 'Confirmar exclusão', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Ramo para excluir' })).toHaveCount(0);
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Filho do ramo' })).toHaveCount(0);
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Neto do ramo' })).toHaveCount(0);
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Irmão preservado' })).toBeVisible();
  await expect(page.locator('.node-panel .node-text')).toHaveText('Ideia central');
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  expect(commands.filter((command) => command.p_kind === 'delete_subtree')).toHaveLength(1);
  expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('subtree-deleted-parent-selected.png'), fullPage: true });

  await press('Desfazer');
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  await press('Enquadrar');
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Neto do ramo' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('subtree-restored-by-undo.png'), fullPage: true });
  await press('Refazer');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);

  const leaf = page.locator('.react-flow__node').filter({ hasText: 'Irmão preservado' });
  if (mobile) await leaf.tap();
  else await leaf.click();
  await press('Excluir nó');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.locator('.node-panel .node-text')).toHaveText('Ideia central');
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
});

test('undo and redo controls work by button and canvas shortcut on desktop and mobile', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await openMap(page);
  const mobile = testInfo.project.name === 'mobile';
  const press = async (name: string) => {
    const button = page.getByRole('button', { name, exact: true });
    if (mobile) await button.tap();
    else await button.click();
  };
  await press('Adicionar filho');
  await press('Concluir edição');
  const child = page.locator('.react-flow__node').filter({ hasText: 'Nova ideia' });
  await expect(child).toBeVisible();
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);

  await press('Desfazer');
  await expect(child).toHaveCount(0);
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  await press('Refazer');
  await expect(child).toBeVisible();
  await expect(page.locator('.node-panel .node-text')).toHaveText('Nova ideia');

  const canvas = page.locator('.canvas');
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect(child).toHaveCount(0);
  await canvas.focus();
  await page.keyboard.press('Control+Shift+z');
  await expect(child).toBeVisible();
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  await press('Editar texto');
  const field = page.getByLabel('Texto do nó');
  await field.fill('Texto editado');
  let historyCalls = 0;
  page.on('request', (request) => {
    if (request.url().includes('/rpc/apply_map_history')) historyCalls++;
  });
  await field.press('End');
  await field.pressSequentially(' extra');
  await field.press('Control+z');
  expect(historyCalls).toBe(0);
  await field.fill('Texto editado');
  await press('Concluir edição');
  await expect(page.locator('.node-panel .node-text')).toHaveText('Texto editado');
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  await press('Desfazer');
  await expect(page.locator('.node-panel .node-text')).toHaveText('Nova ideia');
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  await press('Refazer');
  await expect(page.locator('.node-panel .node-text')).toHaveText('Texto editado');
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  await press('Desfazer');
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  await press('Adicionar filho');
  await press('Concluir edição');
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  await expect(page.getByRole('button', { name: 'Refazer', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('undo-redo-session-history.png'), fullPage: true });
});

test('an operation from another editor session invalidates this session history with an explanation', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const { request: documentRequest, document } = await openMap(page);
  const mobile = testInfo.project.name === 'mobile';
  const press = async (name: string) => {
    const button = page.getByRole('button', { name, exact: true });
    if (mobile) await button.tap();
    else await button.click();
  };
  let mutationBody: { p_payload: { nodeId: string } } | undefined;
  page.on('request', (request) => {
    if (request.url().includes('/rest/v1/rpc/apply_map_command')) mutationBody = request.postDataJSON();
  });
  const commandResponse = page.waitForResponse((response) => response.url().includes('/rest/v1/rpc/apply_map_command'));
  await press('Adicionar filho');
  await press('Concluir edição');
  const created = await commandResponse;
  const commandResult = (await created.json()) as { revision: number };
  // The completed UI operation has its id in the editor's own session. A second
  // editor session for the same account changes the saved node before undo.
  expect(mutationBody).toBeDefined();
  const headers = await documentRequest.allHeaders();
  const endpoint = documentRequest.url().replace('get_map_document', 'apply_map_command');
  const external = await page.request.post(endpoint, {
    headers: { authorization: headers.authorization, apikey: headers.apikey },
    data: {
      p_map_id: document.map.id,
      p_operation_id: crypto.randomUUID(),
      p_editor_session_id: crypto.randomUUID(),
      p_expected_revision: commandResult.revision,
      p_kind: 'edit_text',
      p_payload: { nodeId: mutationBody!.p_payload.nodeId, text: 'Alterado em outra sessão' },
    },
  });
  expect(external.status()).toBe(200);
  await press('Desfazer');
  await expect(
    page.getByText('O mapa mudou em outra sessão. O histórico foi limpo e a versão atual será carregada.'),
  ).toBeVisible();
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Alterado em outra sessão' })).toBeVisible();
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  await expect(page.getByRole('button', { name: 'Desfazer', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('external-session-history-cleared.png'), fullPage: true });
});

test('history with a committed but lost response survives reload and replays identically', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  page.on('dialog', (dialog) => void dialog.accept());
  const { request: documentRequest, document } = await openMap(page);
  await page.getByRole('button', { name: 'Adicionar filho', exact: true }).click();
  await page.getByRole('button', { name: 'Concluir edição', exact: true }).click();
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  const requests: unknown[] = [];
  await page.route('**/rest/v1/rpc/apply_map_history', async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      await route.abort('timedout');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Falha/);
  await expect(page.getByRole('button', { name: 'Adicionar filho', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByText(/Rascunho recuperado deste navegador/)).toBeVisible();
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  const headers = await documentRequest.allHeaders();
  const remote = await page.request.post(documentRequest.url(), {
    headers: { authorization: headers.authorization, apikey: headers.apikey },
    data: { p_map_id: document.map.id },
  });
  const result = await remote.json();
  expect(result.nodes).toHaveLength(1);
  expect(result.map.revision).toBe(3);
  await page.screenshot({ path: testInfo.outputPath('history-lost-response-recovered.png'), fullPage: true });
});

test('undo waits for a real in-flight creation and blocks repeated clicks and new edits', async ({ page }) => {
  test.setTimeout(90_000);
  await openMap(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/rest/v1/rpc/apply_map_command', async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await gate;
    await route.fulfill({ response });
  });
  let inverses = 0;
  page.on('request', (request) => {
    if (request.url().includes('/rpc/apply_map_history')) inverses++;
  });
  await page.getByRole('button', { name: 'Adicionar filho', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Desfazer', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Adicionar filho', exact: true })).toBeDisabled();
  expect(inverses).toBe(0);
  release();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  expect(inverses).toBe(1);
});

test('moves a branch by searchable parent and reorders siblings with undo/redo and stable viewport', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const { request, document } = await openMap(page);
  const mobile = testInfo.project.name === 'mobile';
  const press = async (name: string) => {
    const button = page.getByRole('button', { name, exact: true });
    if (mobile) await button.tap();
    else await button.click();
  };
  const saved = async () => expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  const select = async (text: string) => {
    await press('Enquadrar');
    const node = page.locator('.react-flow__node').filter({ hasText: text });
    if (mobile) await node.tap();
    else await node.click();
    await expect(page.locator('.node-panel .node-text')).toHaveText(text);
  };
  const add = async (text: string) => {
    await press('Adicionar filho');
    await page.getByLabel('Texto do nó').fill(text);
    await press('Concluir edição');
    await saved();
    await expect(page.locator('.node-panel .node-text')).toHaveText(text);
  };
  await expect(page.getByRole('button', { name: 'Mover', exact: true })).toHaveCount(0);
  await add('Ramo móvel');
  await add('Filho preservado');
  await add('Neto preservado');
  await select('Ideia central');
  await add('Destino disponível');
  await add('Filho existente');
  await select('Ramo móvel');
  await expect(page.getByRole('button', { name: 'Subir', exact: true })).toBeDisabled();
  const headers = await request.allHeaders();
  const read = async () => {
    const r = await page.request.post(request.url(), {
      headers: { authorization: headers.authorization, apikey: headers.apikey },
      data: { p_map_id: document.map.id },
    });
    expect(r.status()).toBe(200);
    return (await r.json()) as {
      map: { revision: number };
      nodes: {
        id: string;
        parentId: string | null;
        text: string;
        sortOrder: number;
        createdBy: string;
        updatedBy: string;
        source: string;
      }[];
    };
  };
  const before = await read();
  await testInfo.attach('structural-setup', { body: JSON.stringify(before), contentType: 'application/json' });
  const branch = before.nodes.find((n) => n.text === 'Ramo móvel')!,
    dest = before.nodes.find((n) => n.text === 'Destino disponível')!;
  expect(before.nodes.find((n) => n.text === 'Filho existente')?.parentId).toBe(dest.id);
  const previousViewport = await transform(page);
  await press('Mover');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio')).toHaveCount(2); // Destination and its existing child; self/descendants/current parent absent.
  await expect(dialog.getByRole('radio', { name: /Ramo móvel|Filho preservado|Neto preservado/ })).toHaveCount(0);
  await page.getByLabel('Buscar novo pai').fill('nao existe');
  await expect(dialog.getByText('Nenhum pai disponível para esta busca.')).toBeVisible();
  await page.getByLabel('Buscar novo pai').fill('destino disponivel');
  const radio = dialog.getByRole('radio', { name: /^Destino disponível/ });
  if (mobile) await radio.tap();
  else await radio.check();
  await page.screenshot({ path: testInfo.outputPath('move-parent-search.png'), fullPage: true });
  await press('Cancelar');
  await expect(page.getByRole('button', { name: 'Mover', exact: true })).toBeFocused();
  expect((await read()).map.revision).toBe(before.map.revision);
  await press('Mover');
  await page.getByLabel('Buscar novo pai').fill('Destino disponível');
  const again = dialog.getByRole('radio', { name: /^Destino disponível/ });
  if (mobile) await again.tap();
  else await again.check();
  await press('Mover para este pai');
  await saved();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.node-panel .node-text')).toHaveText('Ramo móvel');
  expect(await transform(page)).toBe(previousViewport);
  const moved = await read();
  expect(moved.nodes.find((n) => n.id === branch.id)).toMatchObject({
    parentId: dest.id,
    sortOrder: 1,
    createdBy: branch.createdBy,
  });
  for (const text of ['Filho preservado', 'Neto preservado'])
    expect(moved.nodes.find((n) => n.text === text)).toEqual(before.nodes.find((n) => n.text === text));
  await expect(page.getByRole('button', { name: 'Descer', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('branch-moved.png'), fullPage: true });
  await press('Subir');
  await saved();
  expect((await read()).nodes.find((n) => n.id === branch.id)?.sortOrder).toBe(0);
  await expect(page.getByRole('button', { name: 'Subir', exact: true })).toBeDisabled();
  await press('Descer');
  await saved();
  expect((await read()).nodes.find((n) => n.id === branch.id)?.sortOrder).toBe(1);
  await press('Desfazer');
  await saved();
  expect((await read()).nodes.find((n) => n.id === branch.id)?.sortOrder).toBe(0);
  await press('Desfazer');
  await saved();
  expect((await read()).nodes.find((n) => n.id === branch.id)?.sortOrder).toBe(1);
  await press('Desfazer');
  await saved();
  const restored = await read();
  expect([...restored.nodes].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
    [...before.nodes].sort((a, b) => a.id.localeCompare(b.id)),
  );
  await expect(page.locator('.node-panel .node-text')).toHaveText('Ramo móvel');
  expect(await transform(page)).toBe(previousViewport);
  for (let i = 0; i < 3; i++) {
    await press('Refazer');
    await saved();
  }
  expect((await read()).nodes.find((n) => n.id === branch.id)).toMatchObject({ parentId: dest.id, sortOrder: 1 });
  expect(await transform(page)).toBe(previousViewport);
  expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('branch-order-history.png'), fullPage: true });
  // Space available with a keyboard: verify a non-root panel containing all six actions.
  await page.setViewportSize({ width: mobile ? 390 : 768, height: 420 });
  await press('Editar texto');
  await page.getByLabel('Texto do nó').focus();
  await page.getByRole('button', { name: 'Concluir edição', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Concluir edição', exact: true })).toBeInViewport({ ratio: 0.99 });
  await press('Concluir edição');
  await press('Mover');
  await expect(page.getByLabel('Buscar novo pai')).toBeFocused();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Cancelar', exact: true })).toBeInViewport({ ratio: 0.99 });
  await page.screenshot({ path: testInfo.outputPath('move-keyboard-space.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  expect((await read()).nodes.find((n) => n.id === branch.id)).toMatchObject({ parentId: dest.id, sortOrder: 1 });
});
