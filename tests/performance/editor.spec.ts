import { expect, test } from '@playwright/test';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Run } from '../../scripts/validation-run.mjs';
import { performanceBackup } from './fixture';

const run = JSON.parse(process.env.MAPA_VALIDATION_RUN ?? 'null') as Run;
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: values.length, p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1), samples: values };
};
for (const count of [200, 500] as const) test(`${count} nodes: production latency, frames and integrity`, async ({ page, browser }, info) => {
  const phase = process.env.MAPA_PERF_PHASE ?? 'after';
  await page.goto('/mapas');
  await page.getByLabel('E-mail', { exact: true }).fill(run.accounts[1].email);
  await page.getByLabel('Senha', { exact: true }).fill(run.accounts[1].password);
  const libraryRequest = page.waitForRequest('**/rpc/list_map_library');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Seus mapas' })).toBeVisible();
  const request = await libraryRequest, headers = await request.allHeaders();
  const auth = { authorization: headers.authorization, apikey: headers.apikey };
  const base = new URL('/rest/v1/rpc/', request.url()).href;
  const rpc = async (name: string, data: object) => {
    const response = await page.request.post(base + name, { headers: auth, data });
    expect(response.status(), `RPC ${name}`).toBe(200);
    return response.json();
  };
  const assets = await readdir('dist/assets');
  const editorAsset = assets.find(name => /^editor-.*\.js$/.test(name))!;
  expect(editorAsset).toBeTruthy();
  const libraryResources = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name));
  expect(libraryResources.some(url => url.includes(editorAsset))).toBe(false);
  expect(libraryResources.some(url => url.includes('get_map_document') || url.includes('map_nodes'))).toBe(false);
  const backup = performanceBackup(count);
  const created = await rpc('import_map_backup', { p_operation_id: crypto.randomUUID(), p_editor_session_id: crypto.randomUUID(), p_backup: backup });
  const original = await rpc('get_map_document', { p_map_id: created.mapId });
  const documentTimes: number[] = [];
  page.on('response', response => {
    if (response.url().includes('/rpc/get_map_document')) void response.finished().then(() => documentTimes.push(response.request().timing().responseEnd));
  });
  const preference = await page.request.post(new URL('../map_user_preferences?on_conflict=map_id,user_id', base).href, {
    headers: { ...auth, Prefer: 'resolution=merge-duplicates' },
    data: { map_id: created.mapId, user_id: run.accounts[1].id, viewport: { x: 64, y: 160, zoom: 1 }, collapsed_node_ids: [] },
  });
  expect(preference.ok()).toBe(true);
  const opened = Date.now();
  await page.goto(`/mapas/${created.mapId}`);
  await expect(page.locator('.react-flow__node')).toHaveCount(count);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  // Let initial ResizeObservers/layout/fit/preferences finish before sampling.
  await page.waitForTimeout(1200);
  const openMs = Date.now() - opened;
  expect(await page.locator('.react-flow__viewport').getAttribute('style')).toContain('scale(1)');
  await page.evaluate(() => {
    const state = { select: [] as number[], edit: [] as number[], frames: [] as number[], events: [] as number[], longTasks: [] as number[], pending: null as null | { start: number; kind: 'select' | 'edit' }, sampling: false };
    Object.assign(window, { mapaPerf: state });
    document.addEventListener('keydown', e => {
      if (e.key.startsWith('Arrow') && (e.target as HTMLElement).matches('.react-flow__node')) state.pending = { start: performance.now(), kind: 'select' };
      if (e.target instanceof HTMLTextAreaElement && e.key.length === 1) state.pending = { start: performance.now(), kind: 'edit' };
    }, true);
    const afterPaint = (kind: 'select' | 'edit') => {
      const pending = state.pending;
      if (!pending || pending.kind !== kind) return;
      state.pending = null;
      // After DOM update, rAF + task is an after-paint proxy, NOT an INP measurement.
      requestAnimationFrame(() => setTimeout(() => state[kind].push(performance.now() - pending.start), 0));
    };
    document.addEventListener('input', () => afterPaint('edit'), true);
    new MutationObserver(records => {
      if (records.some(r => r.type === 'attributes' && r.attributeName === 'class' && (r.target as Element).matches('.mind-node-selected'))) afterPaint('select');
    }).observe(document.querySelector('.canvas')!, { subtree: true, attributes: true, attributeFilter: ['class'] });
    new PerformanceObserver(list => { for (const e of list.getEntries()) state.longTasks.push(e.duration); }).observe({ type: 'longtask', buffered: false });
    new PerformanceObserver(list => { for (const e of list.getEntries()) state.events.push(e.duration); }).observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
  });
  const data = () => page.evaluate(() => (window as unknown as { mapaPerf: { select: number[]; edit: number[]; frames: number[]; events: number[]; longTasks: number[]; sampling: boolean } }).mapaPerf);
  const geometryBefore = await page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(n => ({ id: n.getAttribute('data-id'), style: n.getAttribute('style') })));
  await page.locator('.react-flow__node').first().focus();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press(i % 2 ? 'ArrowUp' : 'ArrowDown');
    await expect.poll(async () => (await data()).select.length).toBe(i + 1);
  }
  expect(await page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(n => ({ id: n.getAttribute('data-id'), style: n.getAttribute('style') })))).toEqual(geometryBefore);
  await expect(page.locator('.mind-node-selected')).toHaveCount(1);
  await page.getByRole('button', { name: 'Editar texto', exact: true }).click();
  const field = page.getByLabel('Texto do nó', { exact: true });
  await field.press('End');
  for (let i = 0; i < 60; i++) {
    await page.keyboard.type('x');
    await expect.poll(async () => (await data()).edit.length).toBe(i + 1);
  }
  const editedText = await field.inputValue();
  await page.getByRole('button', { name: 'Concluir edição', exact: true }).click();
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  const changed = await rpc('get_map_document', { p_map_id: created.mapId });
  expect(changed.nodes).toHaveLength(count);
  const changedNode = changed.nodes.find((n: { text: string }) => n.text === editedText);
  expect(changedNode).toBeTruthy();
  for (const before of original.nodes) {
    const after = changed.nodes.find((n: { id: string }) => n.id === before.id);
    expect({ ...after, text: before.text, updatedAt: before.updatedAt }).toEqual(before);
  }
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  await page.getByRole('button', { name: 'Refazer', exact: true }).click();
  await expect(page.locator('.save-state [role="status"]')).toHaveText(/Salvo/);
  expect((await rpc('get_map_document', { p_map_id: created.mapId })).nodes.find((n: { id: string }) => n.id === changedNode.id).text).toBe(editedText);
  // Keep all nodes rendered while sampling; no virtualization/collapse shortcut.
  const network: string[] = [];
  page.on('request', r => { if (r.url().includes('/rest/v1/')) network.push(new URL(r.url()).pathname); });
  const frameStart = () => page.evaluate(() => {
    const s = (window as unknown as { mapaPerf: { frames: number[]; sampling: boolean } }).mapaPerf;
    s.frames = []; s.sampling = true;
    let previous = performance.now();
    const tick = (now: number) => { if (!s.sampling) return; s.frames.push(now - previous); previous = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const frameStop = async () => { await page.evaluate(() => { (window as unknown as { mapaPerf: { sampling: boolean } }).mapaPerf.sampling = false; }); return (await data()).frames.slice(1); };
  await page.locator('.canvas').scrollIntoViewIfNeeded();
  const canvas = await page.locator('.react-flow__pane').boundingBox(); expect(canvas).toBeTruthy();
  const panStart = await page.locator('.react-flow__viewport').getAttribute('style');
  const visibleTop = Math.max(canvas!.y, 0), visibleBottom = Math.min(canvas!.y + canvas!.height, page.viewportSize()!.height);
  const visibleLeft = Math.max(canvas!.x, 0), visibleRight = Math.min(canvas!.x + canvas!.width, page.viewportSize()!.width);
  expect(visibleBottom - visibleTop).toBeGreaterThan(100);
  const x1 = visibleLeft + (visibleRight - visibleLeft) * .8, x2 = visibleLeft + (visibleRight - visibleLeft) * .5;
  const y1 = visibleTop + (visibleBottom - visibleTop) * .8, y2 = visibleTop + (visibleBottom - visibleTop) * .5;
  const touch = info.project.use.isMobile ? await page.context().newCDPSession(page) : null;
  await frameStart();
  for (let i = 0; i < 3; i++) {
    if (touch) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
      for (let step = 1; step <= 60; step++) {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * step / 60, y: y1 + (y2 - y1) * step / 60 }] });
        await page.waitForTimeout(16);
      }
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(x1, y1); await page.mouse.down();
      await page.mouse.move(x2, y2, { steps: 60 }); await page.mouse.up();
    }
  }
  const pan = await frameStop();
  const panEnd = await page.locator('.react-flow__viewport').getAttribute('style');
  expect(panEnd).not.toBe(panStart);
  await frameStart();
  for (let i = 0; i < 12; i++) { await page.getByRole('button', { name: i % 2 ? 'Afastar' : 'Aproximar', exact: true }).click(); await page.waitForTimeout(180); }
  const zoom = await frameStop();
  expect(pan.length).toBeGreaterThan(100); expect(zoom.length).toBeGreaterThan(100);
  await page.waitForTimeout(900);
  expect(network.filter(url => !url.includes('map_user_preferences'))).toEqual([]);
  expect(network.length).toBeLessThan(30);
  // Collapse root removes every descendant, then restoring preserves measured geometry.
  const root = original.nodes.find((n: { parentId: string | null }) => n.parentId === null);
  await page.locator(`.react-flow__node[data-id="${root.id}"]`).focus();
  await page.getByRole('button', { name: /^Recolher ramo \(/ }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.getByRole('button', { name: /^Expandir ramo \(/ }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(count);
  await page.getByRole('button', { name: 'Enquadrar', exact: true }).click();
  await page.screenshot({ path: `.scratch/mapa-mental/evidence/24/${phase}-${info.project.name}-${count}.png`, fullPage: true });
  const sampled = await data();
  const result = {
    phase, count, project: info.project.name, browser: browser.version(), viewport: info.project.use.viewport,
    fixtureSha256: createHash('sha256').update(JSON.stringify(backup)).digest('hex'),
    build: { editorAsset, sha256: createHash('sha256').update(await readFile(`dist/assets/${editorAsset}`)).digest('hex') },
    panInput: touch ? 'CDP touch' : 'Playwright mouse', panStart, panEnd, initialZoom: 1, openMs, documentNetworkMs: documentTimes,
    selectAfterPaintProxyMs: stats(sampled.select), editAfterPaintProxyMs: stats(sampled.edit),
    panFrameMs: stats(pan), zoomFrameMs: stats(zoom),
    panRafFps: 1000 / (pan.reduce((a, b) => a + b, 0) / pan.length),
    zoomRafFps: 1000 / (zoom.reduce((a, b) => a + b, 0) / zoom.length),
    eventTimingMs: sampled.events, longTasksMs: sampled.longTasks, viewportRequests: network,
  };
  await writeFile(`.scratch/mapa-mental/evidence/24/${phase}-${info.project.name}-${count}.json`, JSON.stringify(result, null, 2));
  if (phase === 'after' && count === 200) {
    expect(result.selectAfterPaintProxyMs.p95).toBeLessThan(100);
    expect(result.editAfterPaintProxyMs.p95).toBeLessThan(100);
    expect(result.panRafFps).toBeGreaterThanOrEqual(55);
    expect(result.zoomRafFps).toBeGreaterThanOrEqual(55);
  }
  console.log(JSON.stringify({ phase, count, project: info.project.name, selectP95: result.selectAfterPaintProxyMs.p95, editP95: result.editAfterPaintProxyMs.p95, panFps: result.panRafFps, zoomFps: result.zoomRafFps }));
  await page.reload(); await expect(page.locator('.react-flow__node')).toHaveCount(count);
  expect((await rpc('get_map_document', { p_map_id: created.mapId })).nodes.find((n: { id: string }) => n.id === changedNode.id).text).toBe(editedText);
});
