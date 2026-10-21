import { reorganize } from '../maps/structure';
import { draftSchema } from '../maps/drafts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MapError, type CommandRequest, type CommandResult, type MapDocument, type MapNode, type HistoryRequest } from '../maps/api';
import { createEditorStore, projectedMap, TEXT_COALESCE_MS } from './editor';

const user = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const rootId = '00000000-0000-4000-8000-0000000000aa';
const document: MapDocument = {
  map: { id: '00000000-0000-4000-8000-0000000000ff', workspaceId: user, title: 'Mapa', ownerId: other, ownerName: 'B', revision: 1, createdAt: '', updatedAt: '' },
  nodes: [{ id: rootId, parentId: null, text: 'Ideia central', sortOrder: 0, createdBy: other, updatedBy: other, source: 'manual' }],
  people: { [other]: 'B' },
};

// A fake server: applies commands like the RPC and lets the test resolve each call.
type Call = { request: CommandRequest; resolve: () => void; reject: (error: unknown) => void };
function fakeServer(initial: MapDocument = document) {
  const calls: Call[] = [];
  let revision = initial.map.revision;
  let title = initial.map.title, projectId = initial.map.projectId ?? null;
  let ownerId = initial.map.ownerId;
  const nodes = new Map<string, MapNode>(initial.nodes.map((node) => [node.id, node]));
  const applied = new Map<string, CommandResult>();
  const send = (request: CommandRequest) => new Promise<CommandResult>((resolve, reject) => {
    calls.push({ request, reject, resolve: () => {
      const previous = applied.get(request.operationId);
      if (previous) { resolve(previous); return; }
      revision += 1;
      let changedNodes: MapNode[] = [];
      let deletedNodeIds: string[] = [];
      if (request.kind === 'add_child') {
        const node: MapNode = { id: request.payload.nodeId, parentId: request.payload.parentId, text: request.payload.text, sortOrder: 0, createdBy: user, updatedBy: user, source: 'manual' };
        nodes.set(node.id, node); changedNodes = [node];
      } else if (request.kind === 'edit_text') {
        const node = { ...nodes.get(request.payload.nodeId)!, text: request.payload.text, updatedBy: user };
        nodes.set(node.id, node); changedNodes = [node];
      } else if (request.kind === 'move_subtree' || request.kind === 'reorder_siblings') {
        const parentId = request.kind === 'move_subtree' ? request.payload.newParentId : nodes.get(request.payload.nodeId)!.parentId!;
        changedNodes = reorganize([...nodes.values()], request.payload.nodeId, parentId, request.payload.targetIndex, user)!;
        for (const node of changedNodes) nodes.set(node.id, node);
      } else if (request.kind === 'rename_map') {
        title = request.payload.title;
      } else if (request.kind === 'set_project') {
        projectId = request.payload.projectId;
      } else if (request.kind === 'transfer_owner') {
        ownerId = request.payload.ownerId;
      } else if (request.kind === 'delete_map') {
        // Soft deletion leaves the retained tree untouched.
      } else {
        const removed = new Set([request.payload.nodeId]);
        let more = true;
        while (more) {
          more = false;
          for (const node of nodes.values()) if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) { removed.add(node.id); more = true; }
        }
        deletedNodeIds = [...removed];
        for (const id of deletedNodeIds) nodes.delete(id);
      }
      const result = { operationId: request.operationId, revision, changedNodes, deletedNodeIds, mapPatch: { revision, updatedBy: user, updatedAt: '', title, projectId, ownerId, ownerName:ownerId===user?'A':'B' } };
      applied.set(request.operationId, result);
      resolve(result);
    } });
  });
  return { calls, send, nodes };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { vi.useRealTimers(); });
const advance = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); };

it('shows changes immediately and keeps one write in flight, in order', async () => {
  const server = fakeServer();
  const store = createEditorStore(server.send);
  store.getState().load(document, user);
  expect(store.getState().status).toBe('saved');
  const child = store.getState().addChild(rootId, 'Filho');
  if (!child) throw new Error('Expected valid child creation');
  const grandchild = store.getState().addChild(child, 'Neto');
  expect(store.getState().nodes.map((node) => node.text)).toEqual(['Ideia central', 'Filho', 'Neto']);
  expect(store.getState().status).toBe('saving');
  expect(server.calls).toHaveLength(1);
  server.calls[0].resolve(); await advance(0);
  expect(server.calls).toHaveLength(2);
  expect(server.calls[1].request).toMatchObject({ kind: 'add_child', expectedRevision: 2, payload: { nodeId: grandchild, parentId: child } });
  expect(store.getState().status).toBe('saving');
  server.calls[1].resolve(); await advance(0);
  expect(store.getState().status).toBe('saved');
  expect(store.getState().confirmed?.map.revision).toBe(3);
});

it('deletes exactly the selected three-level branch, keeps siblings and selects its parent', async () => {
  const child = '00000000-0000-4000-8000-0000000000ab';
  const grandchild = '00000000-0000-4000-8000-0000000000ac';
  const greatGrandchild = '00000000-0000-4000-8000-0000000000ad';
  const sibling = '00000000-0000-4000-8000-0000000000ae';
  const tree: MapDocument = { ...document, nodes: [document.nodes[0],
    { id: child, parentId: rootId, text: 'Ramo', sortOrder: 0, createdBy: user, updatedBy: user, source: 'manual' },
    { id: grandchild, parentId: child, text: 'Filho do ramo', sortOrder: 0, createdBy: user, updatedBy: user, source: 'manual' },
    { id: greatGrandchild, parentId: grandchild, text: 'Neto', sortOrder: 0, createdBy: user, updatedBy: user, source: 'manual' },
    { id: sibling, parentId: rootId, text: 'Irmão', sortOrder: 1, createdBy: other, updatedBy: other, source: 'manual' }],
  };
  const server = fakeServer(tree);
  const store = createEditorStore(server.send);
  store.getState().load(tree, user);
  expect(store.getState().deleteSubtree(rootId)).toBeNull();
  expect(store.getState().deleteSubtree(child)).toBe(2);
  expect(store.getState().selectedNodeId).toBe(rootId);
  expect(store.getState().nodes.map((node) => node.id)).toEqual([rootId, sibling]);
  expect(server.calls[0].request).toMatchObject({ kind: 'delete_subtree', payload: { nodeId: child } });
  server.calls[0].resolve(); await advance(0);
  expect(store.getState().status).toBe('saved');
  expect([...server.nodes.keys()]).toEqual([rootId, sibling]);
});

it('undoes and redoes a confirmed creation with the same id and creator', async () => {
  const server = fakeServer();
  let revision = 1;
  let createdId = '';
  const history = vi.fn(async (request: { mode: 'undo' | 'redo'; operationId: string; targetOperationId: string }) => {
    revision += 1;
    const nodeId = createdId;
    let changedNodes: MapNode[] = [];
    let deletedNodeIds: string[] = [];
    if (request.mode === 'undo') { deletedNodeIds = [nodeId]; server.nodes.delete(nodeId); }
    else {
      const restored: MapNode = { id: nodeId, parentId: rootId, text: 'Filho', sortOrder: 0, createdBy: user, updatedBy: user, source: 'manual' };
      server.nodes.set(nodeId, restored); changedNodes = [restored];
    }
    const result: CommandResult = { operationId: request.operationId, revision, changedNodes, deletedNodeIds, mapPatch: { revision, updatedBy: user, updatedAt: '' } };
    return result;
  });
  const store = createEditorStore(server.send, undefined, { history });
  store.getState().load(document, user);
  const childId = store.getState().addChild(rootId, 'Filho')!;
  createdId = childId;
  server.calls[0].resolve(); await advance(0);
  expect(store.getState().undoStack).toHaveLength(1);
  store.getState().undo(); await advance(0);
  expect(store.getState().nodes.map((node) => node.id)).toEqual([rootId]);
  expect(store.getState().redoStack.map((entry) => entry.operationId)).toEqual([server.calls[0].request.operationId]);
  expect(history.mock.calls[0][0]).toMatchObject({ mode: 'undo', targetOperationId: server.calls[0].request.operationId });
  store.getState().redo(); await advance(0);
  expect(store.getState().nodes.find((node) => node.id === childId)).toMatchObject({ createdBy: user, updatedBy: user, text: 'Filho' });
  expect(history.mock.calls[1][0]).toMatchObject({ mode: 'redo', targetOperationId: server.calls[0].request.operationId });
  expect(store.getState().undoStack).toHaveLength(1);
  expect(store.getState().redoStack).toHaveLength(0);
  store.getState().undo(); await advance(0);
  store.getState().addChild(rootId, 'Nova ação');
  server.calls[1].resolve(); await advance(0);
  expect(store.getState().redoStack).toHaveLength(0);
});

it('keeps history and retries the same inverse after an unavailable response', async () => {
  const server = fakeServer();
  let createdId = '';
  let revision = 1;
  const history = vi.fn(async (request: { mode: 'undo' | 'redo'; operationId: string }) => {
    if (history.mock.calls.length === 1) throw new MapError('UNAVAILABLE');
    revision += 1;
    server.nodes.delete(createdId);
    return { operationId: request.operationId, revision, changedNodes: [], deletedNodeIds: [createdId], mapPatch: { revision, updatedBy: user, updatedAt: '' } };
  });
  const store = createEditorStore(server.send, undefined, { history });
  store.getState().load(document, user);
  createdId = store.getState().addChild(rootId, 'Filho')!;
  server.calls[0].resolve(); await advance(0);
  store.getState().undo(); await advance(0);
  expect(store.getState().undoStack).toHaveLength(1);
  expect(store.getState().pendingHistory?.operationId).toBeTruthy();
  expect(store.getState().nodes.some((node) => node.id === createdId)).toBe(true);
  const firstId = store.getState().pendingHistory!.operationId;
  store.getState().undo(); await advance(0);
  expect(history.mock.calls.map(([request]) => request.operationId)).toEqual([firstId, firstId]);
  expect(store.getState().undoStack).toHaveLength(0);
  expect(store.getState().nodes.some((node) => node.id === createdId)).toBe(false);
});

it('cancels a newer queued action locally while an earlier write is in flight', async () => {
  const server = fakeServer();
  const store = createEditorStore(server.send);
  store.getState().load(document, user);
  store.getState().addChild(rootId, 'Primeiro');
  const second = store.getState().addChild(rootId, 'Segundo')!;
  const secondOperationId = store.getState().queue[1].operationId;
  expect(store.getState().queue).toHaveLength(2);
  store.getState().undo();
  expect(store.getState().queue).toHaveLength(1);
  expect(store.getState().nodes.some((node) => node.id === second)).toBe(false);
  expect(server.calls).toHaveLength(1);
  server.calls[0].resolve(); await advance(0);
  expect(store.getState().redoStack).toHaveLength(1);
  store.getState().redo();
  expect(server.calls[1].request.operationId).toBe(secondOperationId);
  server.calls[1].resolve(); await advance(0);
  expect(store.getState().nodes.find((node) => node.id === second)).toMatchObject({ text: 'Segundo', createdBy: user });
});

it('cancels a coalescing text draft locally and can redo it without changing creator', async () => {
  const server = fakeServer();
  const store = createEditorStore(server.send);
  store.getState().load(document, user);
  store.getState().typeText(rootId, 'Uma edição');
  store.getState().undo(); await advance(TEXT_COALESCE_MS);
  expect(server.calls).toHaveLength(0);
  expect(store.getState().nodes[0].text).toBe('Ideia central');
  store.getState().redo();
  server.calls[0].resolve(); await advance(0);
  expect(store.getState().nodes[0]).toMatchObject({ text: 'Uma edição', createdBy: other, updatedBy: user });
});

it('persists an immutable history request before sending and recovers a lost response', async () => {
  const server = fakeServer();
  const persist = vi.fn(async () => {});
  let committed: CommandResult | undefined;
  let childId = '';
  const history = vi.fn(async (request: HistoryRequest) => {
    expect(persist).toHaveBeenCalled();
    if (!committed) {
      committed = { operationId: request.operationId, revision: request.expectedRevision + 1, changedNodes: [], deletedNodeIds: [childId],
        mapPatch: { revision: request.expectedRevision + 1, updatedBy: user, updatedAt: '' } };
      throw new MapError('UNAVAILABLE');
    }
    return committed;
  });
  const store = createEditorStore(server.send, undefined, { persist, history });
  store.getState().load(document, user);
  childId = store.getState().addChild(rootId, 'Filho')!;
  await advance(0); server.calls[0].resolve(); await advance(0);
  store.getState().undo(); store.getState().undo(); await advance(0);
  expect(history).toHaveBeenCalledTimes(1);
  expect(store.getState().status).toBe('error');
  const record = store.getState().snapshot()!;
  expect(record.pendingHistory).toEqual(history.mock.calls[0][0]);
  expect(store.getState().addChild(rootId, 'Não pode concorrer')).toBeNull();
  store.getState().typeText(rootId, 'Bloqueado até reconciliar');
  expect(store.getState().draft).toBeNull();
  const remote = { ...document, map: { ...document.map, revision: committed!.revision } };
  const recovered = createEditorStore(server.send, undefined, { history, persist, read: async () => remote });
  recovered.getState().load(remote, user, { record, epoch: record.epoch });
  recovered.getState().retry(); await advance(0);
  expect(history.mock.calls[1][0]).toEqual(history.mock.calls[0][0]);
  expect(recovered.getState().confirmed?.map.revision).toBe(committed!.revision);
  expect(recovered.getState().nodes.map((node) => node.id)).toEqual([rootId]);
  expect(recovered.getState().pendingHistory).toBeNull();
  expect(recovered.getState().status).toBe('saved');
});

it('preserves history on an unchanged refetch and invalidates it on an external revision', async () => {
  const server = fakeServer();
  const store = createEditorStore(server.send);
  store.getState().load(document, user);
  store.getState().addChild(rootId, 'Filho'); server.calls[0].resolve(); await advance(0);
  const confirmed = store.getState().confirmed!;
  store.getState().load(confirmed, user);
  expect(store.getState().undoStack).toHaveLength(1);
  store.getState().load({ ...confirmed, map: { ...confirmed.map, revision: confirmed.map.revision + 1 } }, user);
  expect(store.getState().undoStack).toHaveLength(0);
  expect(store.getState().historyMessage).toContain('outra sessão');
});

it('keeps at most 100 confirmed history entries in this editor session', async () => {
  const server = fakeServer();
  const store = createEditorStore(server.send);
  store.getState().load(document, user);
  for (let index = 0; index < 101; index++) {
    store.getState().typeText(rootId, `Edição ${index}`);
    store.getState().commitText();
    server.calls[index].resolve(); await advance(0);
  }
  expect(store.getState().undoStack).toHaveLength(100);
  expect(store.getState().undoStack[0].operationId).toBe(server.calls[1].request.operationId);
});

it('waits for an ambiguous in-flight command before applying its inverse', async () => {
  const server = fakeServer();
  let childId = '';
  let revision = 2;
  const history = vi.fn(async (request: { operationId: string }) => ({ operationId: request.operationId, revision: ++revision,
    changedNodes: [], deletedNodeIds: [childId], mapPatch: { revision, updatedBy: user, updatedAt: '' } }));
  const store = createEditorStore(server.send, undefined, { history });
  store.getState().load(document, user);
  childId = store.getState().addChild(rootId, 'Filho')!;
  store.getState().undo();
  store.getState().undo();
  expect(store.getState().snapshot()?.undoRequested).toBe(server.calls[0].request.operationId);
  expect(store.getState().addChild(rootId, 'Não deve tomar o alvo do desfazer')).toBeNull();
  store.getState().typeText(rootId, 'Aguardar confirmação');
  expect(store.getState().draft).toBeNull();
  expect(history).not.toHaveBeenCalled();
  server.calls[0].resolve(); await advance(0);
  expect(history).toHaveBeenCalledTimes(1);
  await advance(0);
  expect(store.getState().nodes.some((node) => node.id === childId)).toBe(false);
  expect(store.getState().undoStack).toHaveLength(0);
});

it('recovers an undo requested while a durable creation was still in flight', async () => {
  const server = fakeServer();
  const history = vi.fn(async (request: HistoryRequest) => ({ operationId: request.operationId, revision: request.expectedRevision + 1,
    changedNodes: [], deletedNodeIds: [childId], mapPatch: { revision: request.expectedRevision + 1, updatedBy: user, updatedAt: '' } }));
  const store = createEditorStore(server.send, undefined, { history });
  store.getState().load(document, user);
  const childId = store.getState().addChild(rootId, 'Filho')!;
  store.getState().undo();
  const record = store.getState().snapshot()!;
  const recovered = createEditorStore(server.send, undefined, { history });
  recovered.getState().load(document, user, { record, epoch: record.epoch });
  recovered.getState().retry();
  expect(server.calls[1].request).toEqual(server.calls[0].request);
  server.calls[1].resolve(); await advance(0);
  expect(history).toHaveBeenCalledTimes(1);
  expect(history.mock.calls[0][0].targetOperationId).toBe(server.calls[0].request.operationId);
  expect(recovered.getState().nodes.some((node) => node.id === childId)).toBe(false);
  expect(recovered.getState().status).toBe('saved');
});

it('retries a failed subtree delete with the same operation and preserves local state', async () => {
  const child = '00000000-0000-4000-8000-0000000000ab';
  const grandchild = '00000000-0000-4000-8000-0000000000ac';
  const tree: MapDocument = { ...document, nodes: [document.nodes[0],
    { id: child, parentId: rootId, text: 'Ramo', sortOrder: 0, createdBy: user, updatedBy: user, source: 'manual' },
    { id: grandchild, parentId: child, text: 'Neto', sortOrder: 0, createdBy: user, updatedBy: user, source: 'manual' }] };
  const server = fakeServer(tree);
  let fail = true;
  const store = createEditorStore((request) => {
    if (fail) { fail = false; return Promise.reject(new MapError('UNAVAILABLE')); }
    return server.send(request);
  });
  store.getState().load(tree, user);
  store.getState().deleteSubtree(child);
  await advance(0);
  const operation = store.getState().queue[0];
  expect(store.getState().status).toBe('error');
  expect(store.getState().nodes.map((node) => node.id)).toEqual([rootId]);
  store.getState().retry(); await advance(0);
  expect(server.calls[0].request.operationId).toBe(operation.operationId);
  expect(store.getState().nodes.map((node) => node.id)).toEqual([rootId]);
  server.calls[0].resolve(); await advance(0);
  expect(store.getState().status).toBe('saved');
});

it('coalesces typing for 650 ms and never marks Salvo before the newest edit is confirmed', async () => {
  const server = fakeServer();
  const store = createEditorStore(server.send);
  store.getState().load(document, user);
  store.getState().typeText(rootId, 'Pri');
  store.getState().typeText(rootId, 'Primeira');
  expect(store.getState().nodes[0].text).toBe('Primeira');
  expect(store.getState().status).toBe('pending');
  await advance(TEXT_COALESCE_MS - 1);
  expect(server.calls).toHaveLength(0);
  await advance(1);
  expect(server.calls.map((call) => call.request.kind === 'edit_text' ? call.request.payload.text : '')).toEqual(['Primeira']);
  // Second quick edit while the first is still in flight (delayed response).
  store.getState().typeText(rootId, 'Segunda');
  store.getState().commitText(); // blur
  server.calls[0].resolve(); await advance(0);
  // The old confirmation must not mark the newer edit as saved.
  expect(store.getState().status).toBe('saving');
  expect(store.getState().nodes[0].text).toBe('Segunda');
  expect(server.calls.map((call) => call.request.kind === 'edit_text' ? call.request.payload.text : '')).toEqual(['Primeira', 'Segunda']);
  server.calls[1].resolve(); await advance(0);
  expect(store.getState().status).toBe('saved');
  expect(server.nodes.get(rootId)?.text).toBe('Segunda');
});

it('retains a failed operation and retries it with the same id without duplicating', async () => {
  const server = fakeServer();
  // First attempt: the server commits but the response is lost (timeout).
  let lose = true;
  const store = createEditorStore((request) => {
    const pending = server.send(request);
    server.calls.at(-1)!.resolve();
    if (lose) { lose = false; return pending.then(() => { throw new MapError('UNAVAILABLE'); }); }
    return pending;
  });
  store.getState().load(document, user);
  const id = store.getState().addChild(rootId, 'Filho');
  await advance(0);
  expect(store.getState().status).toBe('error');
  expect(store.getState().failure).toBe('UNAVAILABLE');
  expect(store.getState().nodes.some((node) => node.id === id)).toBe(true);
  store.getState().retry(); await advance(0);
  const [first, second] = server.calls.map((call) => call.request);
  expect(second.operationId).toBe(first.operationId);
  expect(second.payload).toEqual(first.payload);
  expect(store.getState().status).toBe('saved');
  expect([...server.nodes.values()].filter((node) => node.parentId === rootId)).toHaveLength(1);
});

it('pauses on conflict without overwriting the local document', async () => {
  const store = createEditorStore(() => Promise.reject(new MapError('CONFLICT')));
  store.getState().load(document, user);
  store.getState().typeText(rootId, 'Minha versão');
  store.getState().commitText();
  await advance(0);
  expect(store.getState().status).toBe('conflict');
  store.getState().addChild(rootId, 'Depois');
  await advance(0);
  expect(store.getState().queue).toHaveLength(2);
  expect(store.getState().nodes.map((node) => node.text)).toEqual(['Minha versão', 'Depois']);
  // A refetch does not replace the local document while changes are pending.
  store.getState().load({ ...document, map: { ...document.map, revision: 5 }, nodes: [{ ...document.nodes[0], text: 'Versão de outra pessoa' }] }, user);
  expect(store.getState().nodes[0].text).toBe('Minha versão');
});

it('keeps invalid text as a local draft and never sends it', async () => {
  const server = fakeServer();
  const store = createEditorStore(server.send);
  store.getState().load(document, user);
  store.getState().typeText(rootId, '   ');
  await advance(TEXT_COALESCE_MS);
  store.getState().commitText();
  expect(server.calls).toHaveLength(0);
  expect(store.getState().draft?.text).toBe('   ');
  expect(store.getState().status).toBe('pending');
  store.getState().typeText(rootId, 'x'.repeat(501));
  store.getState().commitText();
  expect(server.calls).toHaveLength(0);
  expect(store.getState().draft?.text).toHaveLength(501);
});

for (const invalid of ['   ', 'x'.repeat(501)]) {
  it(`keeps invalid draft when selecting another node or creating a child (${invalid.length} chars)`, async () => {
    const server = fakeServer();
    const store = createEditorStore(server.send);
    store.getState().load(document, user);
    const child = store.getState().addChild(rootId, 'Filho');
    if (!child) throw new Error('Expected valid child creation');
    server.calls[0].resolve(); await advance(0);
    store.getState().select(rootId);
    store.getState().typeText(rootId, invalid);
    await advance(TEXT_COALESCE_MS);
    store.getState().select(child);
    expect(store.getState().selectedNodeId).toBe(rootId);
    store.getState().typeText(child, 'Outra edição');
    expect(store.getState().draft).toEqual({ nodeId: rootId, text: invalid });
    expect(store.getState().nodes.find((node) => node.id === child)?.text).toBe('Filho');
    expect(store.getState().addChild(rootId)).toBeNull();
    expect(store.getState().selectedNodeId).toBe(rootId);
    expect(store.getState().nodes).toHaveLength(2);
    expect(server.calls).toHaveLength(1);
    expect(store.getState().status).toBe('pending');

    // Correcting the same text releases the transition and saves normally.
    store.getState().typeText(rootId, 'Raiz corrigida');
    store.getState().select(child);
    expect(store.getState().selectedNodeId).toBe(child);
    expect(server.calls).toHaveLength(2);
    expect(server.calls[1].request.payload).toEqual({ nodeId: rootId, text: 'Raiz corrigida' });
    server.calls[1].resolve(); await advance(0);
    expect(store.getState().status).toBe('saved');
    expect(store.getState().addChild(child, 'Neto')).toBeTruthy();
    expect(store.getState().nodes).toHaveLength(3);
    server.calls[2].resolve(); await advance(0);
    store.getState().reset();
  });
}

it('restores an ambiguous request with the same ids/revision and pauses later edits after a newer remote head', async () => {
  const server = fakeServer();
  const first = createEditorStore(server.send);
  first.getState().load(document, user);
  const child = first.getState().addChild(rootId, 'Uma vez')!;
  first.getState().typeText(child, 'Edição ainda local');
  const snapshot = first.getState().snapshot()!;
  const request = server.calls[0].request;
  first.getState().reset(); // response no longer belongs to this generation
  server.calls[0].resolve(); await advance(0);
  const remote: MapDocument = { ...document, map: { ...document.map, revision: 3 }, nodes: [...server.nodes.values()].map((node) => node.id === rootId ? { ...node, text: 'Outra sessão' } : node) };
  const restored = createEditorStore(server.send, undefined, { read: async () => remote });
  restored.getState().load(remote, user, { record: snapshot, epoch: 0 });
  expect(restored.getState().nodes.find((node) => node.id === child)?.text).toBe('Edição ainda local');
  expect(restored.getState().recovered).toBe(true);
  restored.getState().retry();
  expect(server.calls[1].request).toEqual(request);
  server.calls[1].resolve(); await advance(0);
  expect(restored.getState().status).toBe('conflict');
  expect(server.calls).toHaveLength(2);
  expect(restored.getState().queue).toHaveLength(1);
  expect(restored.getState().nodes.find((node) => node.id === child)?.text).toBe('Edição ainda local');
});

it('checkpoints request metadata before sending; quota failure remains recoverable without discarding the queue', async () => {
  const server = fakeServer();
  let finish: (() => void) | undefined;
  let fail = false;
  const records: unknown[] = [];
  const store = createEditorStore(server.send, undefined, { persist: async (record) => {
    records.push(structuredClone(record));
    if (fail) throw new DOMException('Quota', 'QuotaExceededError');
    await new Promise<void>((resolve) => { finish = resolve; });
  } });
  store.getState().load(document, user);
  store.getState().addChild(rootId);
  expect(server.calls).toHaveLength(0);
  await advance(0);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ queue: [{ sent: true, expectedRevision: 1, editorSessionId: expect.any(String) }] });
  finish!(); await advance(0);
  expect(server.calls).toHaveLength(1);
  server.calls[0].reject(new MapError('UNAVAILABLE')); await advance(0);
  fail = true; await store.getState().flushLocal();
  expect(store.getState().storageError).toBe(true);
  expect(store.getState().queue).toHaveLength(1);
  fail = false;
  const retry = store.getState().flushLocal(); await advance(0); finish!(); await retry;
  expect(store.getState().storageError).toBe(false);
});

it('a failed copy is frozen and retried identically, retaining work until acknowledged', async () => {
  const requests: unknown[] = [];
  const store = createEditorStore(fakeServer().send, undefined, { copy: async (request) => {
    requests.push(structuredClone(request));
    if (requests.length === 1) throw new MapError('UNAVAILABLE');
    return { operationId: request.operationId, mapId: user, revision: 1 };
  } });
  store.getState().load(document, user);
  store.getState().typeText(rootId, 'Versão local');
  store.setState({ status: 'conflict' });
  expect(await store.getState().copyLocal()).toBeNull();
  store.getState().typeText(rootId, 'Não deve substituir a cópia enviada');
  expect(store.getState().nodes[0].text).toBe('Versão local');
  expect(await store.getState().copyLocal()).toBe(user);
  expect(requests[1]).toEqual(requests[0]);
  expect(store.getState().draft).not.toBeNull();
  await store.getState().acknowledgeCopy();
  expect(store.getState().status).toBe('saved');
  expect(store.getState().draft).toBeNull();
});

it('access revocation immediately hides all local content and ignores late responses', async () => {
  const server = fakeServer();
  const store = createEditorStore(server.send);
  store.getState().load(document, user); store.getState().addChild(rootId);
  server.calls[0].reject(new MapError('FORBIDDEN')); await advance(0);
  expect(store.getState().revoked).toBe(true);
  expect(store.getState().nodes).toEqual([]);
  expect(store.getState().snapshot()).toBeNull();
  expect(store.getState().userId).toBeNull();
});

it('does not announce Saved until the stale recovery record has been removed', async () => {
  const server = fakeServer();
  let finishCleanup: (() => void) | undefined;
  const store = createEditorStore(server.send, undefined, { persist: async (_record, pending) => {
    if (!pending) await new Promise<void>((resolve) => { finishCleanup = resolve; });
  } });
  store.getState().load(document, user);
  store.getState().addChild(rootId); await advance(0);
  server.calls[0].resolve(); await advance(0);
  expect(store.getState().status).toBe('saving');
  expect(finishCleanup).toBeDefined();
  finishCleanup!(); await advance(0);
  expect(store.getState().status).toBe('saved');
});

it('cannot overwrite unread storage and recovers its current epoch after access verification', async () => {
  const server = fakeServer();
  const store = createEditorStore(server.send, undefined, {
    persist: async () => {},
    recover: async () => ({ document, recovery: { record: null, epoch: 7, mapEpoch: 2 } }),
  });
  store.getState().load(document, user, { record: null, epoch: 0, error: true });
  expect(store.getState().storageInitialized).toBe(false);
  expect(store.getState().addChild(rootId)).toBeNull();
  store.getState().typeText(rootId, 'Não substituir rascunho não lido');
  expect(store.getState().draft).toBeNull();
  expect(await store.getState().retryStorage()).toBe(true);
  expect(store.getState().storageInitialized).toBe(true);
  expect(store.getState().snapshot()).toMatchObject({ epoch: 7, mapEpoch: 2 });
});

it('ending a no-op draft while a request is in flight never releases that request slot', async () => {
  const server = fakeServer();
  const store = createEditorStore(server.send);
  store.getState().load(document, user);
  const child = store.getState().addChild(rootId, 'Mesmo texto')!;
  store.getState().typeText(child, 'Mesmo texto');
  store.getState().commitText(); await advance(0);
  expect(store.getState().inFlight).toBe(true);
  expect(server.calls).toHaveLength(1);
  server.calls[0].resolve(); await advance(0);
  expect(store.getState().status).toBe('saved');
});

it('a failed discard keeps the conflict and local work paused until a remote read succeeds', async () => {
  const store = createEditorStore(fakeServer().send, undefined, { read: async () => { throw new MapError('UNAVAILABLE'); } });
  store.getState().load(document, user);
  store.getState().typeText(rootId, 'Preservar versão local');
  store.setState({ status: 'conflict' });
  expect(await store.getState().discard()).toBe(false);
  expect(store.getState().status).toBe('conflict');
  expect(store.getState().nodes[0].text).toBe('Preservar versão local');
});

it('queues structural commands in order, preserves selection and recovers the exact pending move', async () => {
  const a = '00000000-0000-4000-8000-000000000011';
  const b = '00000000-0000-4000-8000-000000000012';
  const c = '00000000-0000-4000-8000-000000000013';
  const initial = { ...document, nodes: [...document.nodes, ...[a,b,c].map((id,index) => ({ ...document.nodes[0], id, parentId: rootId, sortOrder:index }))] };
  const server = fakeServer(initial);
  const store = createEditorStore(server.send);
  store.getState().load(initial,user);
  store.getState().select(a);
  expect(store.getState().moveSubtree(rootId,b)).toBe(false);
  expect(store.getState().moveSubtree(a,b)).toBe(true);
  expect(store.getState().nodes.find((n)=>n.id===a)?.parentId).toBe(b);
  expect(store.getState().selectedNodeId).toBe(a);
  expect(store.getState().moveSubtree(b,a)).toBe(false);
  expect(store.getState().reorderSibling(c,0)).toBe(true);
  expect(server.calls).toHaveLength(1);
  const snapshot = draftSchema.parse(store.getState().snapshot());
  // The second, unsent gesture is locally reversible without another write.
  store.getState().undo();
  expect(store.getState().nodes.find((n)=>n.id===c)?.sortOrder).toBe(1);
  server.calls[0].resolve(); await advance(0);
  store.getState().redo();
  expect(store.getState().nodes.find((n)=>n.id===c)?.sortOrder).toBe(0);
  const replay = fakeServer(initial);
  const recovered = createEditorStore(replay.send);
  recovered.getState().load(initial,user,{record:snapshot,epoch:snapshot.epoch});
  recovered.getState().retry();
  expect(replay.calls[0].request).toEqual(server.calls[0].request);
  replay.calls[0].resolve(); await advance(0);
  expect(replay.calls[1].request).toMatchObject({kind:'reorder_siblings',expectedRevision:2,payload:{nodeId:c,targetIndex:0}});
  replay.calls[1].resolve(); await advance(0);
  expect(recovered.getState().status).toBe('saved');
  expect(recovered.getState().nodes.find((n)=>n.id===a)?.createdBy).toBe(other);
  server.calls[1].resolve(); await advance(0);
});

it('queues metadata with node edits, accepts canonical null and preserves the central node',async()=>{
  const server=fakeServer(),store=createEditorStore(server.send);
  store.getState().load(document,user);
  expect(store.getState().renameMap(' '.repeat(4))).toBe(false);
  expect(store.getState().renameMap('x'.repeat(121))).toBe(false);
  expect(store.getState().renameMap('Novo título')).toBe(true);
  expect(store.getState().setProject(other)).toBe(true);
  expect(store.getState().setProject(null)).toBe(true);
  expect(projectedMap(store.getState().confirmed,store.getState().queue)).toMatchObject({title:'Novo título',projectId:null,revision:1});
  expect(store.getState().nodes).toEqual(document.nodes);
  expect(server.calls).toHaveLength(1);
  for(let i=0;i<3;i++){server.calls[i].resolve();await advance(0);}
  expect(store.getState().confirmed?.map).toMatchObject({title:'Novo título',projectId:null,revision:4});
  expect(store.getState().confirmed?.nodes).toEqual(document.nodes);
  expect(store.getState().undoStack).toHaveLength(3);
  expect(store.getState().status).toBe('saved');
});

it('preserves a pending local title when recovering a conflicting document as a copy',async()=>{
  const copy=vi.fn(async(request:{operationId:string})=>({operationId:request.operationId,mapId:user,revision:1}));
  const store=createEditorStore(async()=>{throw new MapError('CONFLICT');},undefined,{copy});
  store.getState().load(document,user);
  store.getState().renameMap('Título da versão local');await advance(0);
  expect(store.getState().status).toBe('conflict');
  expect(await store.getState().copyLocal()).toBe(user);
  expect(copy).toHaveBeenCalledWith(expect.objectContaining({title:'Título da versão local — cópia',nodes:document.nodes.map(({id,parentId,text,sortOrder})=>({id,parentId,text,sortOrder}))}));
});

it('confirms ownership from the server, clears history at transfer and keeps colleagues editing',async()=>{
  const server=fakeServer(),store=createEditorStore(server.send);
  store.getState().load(document,user);
  store.getState().renameMap('Mapa da equipe');server.calls[0].resolve();await advance(0);
  expect(store.getState().undoStack).toHaveLength(1);
  expect(store.getState().transferOwner(user)).toBe(true);
  expect(store.getState().confirmed?.map.ownerId).toBe(other);
  expect(store.getState().transferOwner(user)).toBe(false);
  server.calls[1].resolve();await advance(0);
  expect(store.getState().confirmed?.map).toMatchObject({ownerId:user,ownerName:'A',revision:3});
  expect(store.getState().undoStack).toEqual([]);expect(store.getState().redoStack).toEqual([]);
  expect(store.getState().historyMessage).toContain('Responsabilidade transferida');
  expect(store.getState().nodes).toEqual(document.nodes);
  expect(store.getState().addChild(rootId,'Todos editam')).toBeTruthy();server.calls[2].resolve();await advance(0);
  expect(store.getState().status).toBe('saved');expect(store.getState().undoStack).toHaveLength(1);
});
it.each(['FORBIDDEN','VALIDATION'] as const)('a rejected transfer (%s) preserves content access and later queued edits',async code=>{
  const server=fakeServer(),store=createEditorStore(server.send,undefined,{read:async()=>document});
  store.getState().load(document,user);store.getState().transferOwner(user);
  const child=store.getState().addChild(rootId,'Edição preservada');
  server.calls[0].reject(new MapError(code));await advance(0);
  expect(store.getState().revoked).toBe(false);expect(store.getState().confirmed?.map.ownerId).toBe(other);
  expect(store.getState().nodes.some(node=>node.id===child)).toBe(true);
  expect(server.calls).toHaveLength(2);expect(server.calls[1].request.kind).toBe('add_child');
  server.calls[1].resolve();await advance(0);expect(store.getState().status).toBe('saved');
});
it('retries a lost transfer response identically and refreshes canonical owner before further content writes',async()=>{
  const server=fakeServer(),read=vi.fn(async()=>({...document,map:{...document.map,revision:2,ownerId:user,ownerName:'A'}}));
  const store=createEditorStore(server.send,undefined,{read});store.getState().load(document,user);
  store.getState().transferOwner(user);server.calls[0].reject(new MapError('UNAVAILABLE'));await advance(0);
  store.getState().retry();expect(server.calls[1].request).toEqual(server.calls[0].request);
  server.calls[1].resolve();await advance(0);expect(read).toHaveBeenCalledOnce();expect(store.getState().confirmed?.map.ownerId).toBe(user);expect(store.getState().status).toBe('saved');
});

it('soft deletion waits for acknowledgement, blocks subsequent mutations and clears history',async()=>{
  const server=fakeServer(),store=createEditorStore(server.send);store.getState().load(document,user);
  expect(store.getState().deleteMap()).toBe(true);expect(store.getState().deleteConfirmed).toBe(false);
  expect(store.getState().addChild(rootId)).toBeNull();expect(store.getState().renameMap('Não enviar')).toBe(false);expect(store.getState().deleteMap()).toBe(false);
  store.getState().undo();expect(store.getState().undoRequested).toBeNull();
  server.calls[0].resolve();await advance(0);expect(store.getState().deleteConfirmed).toBe(true);expect(store.getState().status).toBe('saved');expect(store.getState().undoStack).toEqual([]);
  expect(store.getState().nodes).toEqual(document.nodes);
});
it('a deleted map preserves local work for an active colleague and stops every later write',async()=>{
  const server=fakeServer(),erase=vi.fn(),store=createEditorStore(server.send,undefined,{erase});store.getState().load(document,user);
  const child=store.getState().addChild(rootId,'Rascunho preservado');server.calls[0].reject(new MapError('NOT_FOUND',true));await advance(0);
  expect(store.getState().deleted).toBe(true);expect(store.getState().revoked).toBe(false);expect(store.getState().queue).toHaveLength(1);expect(store.getState().nodes.some(n=>n.id===child)).toBe(true);expect(erase).not.toHaveBeenCalled();
  store.getState().retry();store.getState().typeText(rootId,'Não enviar');expect(store.getState().addChild(rootId)).toBeNull();expect(server.calls).toHaveLength(1);
  expect(await store.getState().copyLocal()).toBeNull();store.getState().revoke();expect(store.getState().confirmed).toBeNull();await advance(0);expect(erase).toHaveBeenCalled();
});
it('a lost delete response keeps the exact operation and never reads the deleted document after replay',async()=>{
  const server=fakeServer(),read=vi.fn(async()=>{throw new MapError('NOT_FOUND',true);}),store=createEditorStore(server.send,undefined,{read});store.getState().load(document,user);
  store.getState().deleteMap();server.calls[0].reject(new MapError('UNAVAILABLE'));await advance(0);store.getState().retry();expect(server.calls[1].request).toEqual(server.calls[0].request);
  server.calls[1].resolve();await advance(0);expect(store.getState().deleteConfirmed).toBe(true);expect(store.getState().status).toBe('saved');expect(read).not.toHaveBeenCalled();
});

function aiResult():CommandResult {
  return {operationId:crypto.randomUUID(),revision:2,changedNodes:Array.from({length:4},(_,index)=>({id:crypto.randomUUID(),parentId:rootId,text:`Caminho ${index}`,sortOrder:index,createdBy:user,updatedBy:user,source:'ai' as const,aiGenerationId:crypto.randomUUID()})),deletedNodeIds:[],mapPatch:{revision:2,updatedBy:user,updatedAt:''}};
}
it('integrates an AI batch once and records one undo entry',()=>{
  const store=createEditorStore(),result=aiResult();store.getState().load(document,user);
  const job={mapId:document.map.id,editorSessionId:store.getState().snapshot()!.sessionId,result};
  expect(store.getState().integrateAI(job)).toBe('applied');expect(store.getState().nodes).toHaveLength(5);expect(store.getState().undoStack).toEqual([{operationId:result.operationId}]);
  expect(store.getState().integrateAI(job)).toBe('ignored');expect(store.getState().nodes).toHaveLength(5);expect(store.getState().undoStack).toHaveLength(1);
});
it('preserves a typing draft when the AI result arrives and enters the existing conflict flow',()=>{
  const store=createEditorStore();store.getState().load(document,user);store.getState().typeText(rootId,'Texto ainda sendo digitado');
  expect(store.getState().integrateAI({mapId:document.map.id,editorSessionId:'other-session',result:aiResult()})).toBe('conflict');
  expect(store.getState().draft?.text).toBe('Texto ainda sendo digitado');expect(store.getState().nodes[0].text).toBe('Texto ainda sendo digitado');expect(store.getState().status).toBe('conflict');expect(store.getState().confirmed?.map.revision).toBe(1);
});
it('waits for in-flight writes and never integrates a result across an unknown revision',()=>{
  const server=fakeServer(),store=createEditorStore(server.send);store.getState().load(document,user);store.getState().addChild(rootId);
  expect(store.getState().integrateAI({mapId:document.map.id,editorSessionId:'session',result:aiResult()})).toBe('wait');expect(store.getState().queue).toHaveLength(1);
  const clean=createEditorStore();clean.getState().load(document,user);const result={...aiResult(),revision:5};
  expect(clean.getState().integrateAI({mapId:document.map.id,editorSessionId:'session',result})).toBe('conflict');expect(clean.getState().nodes).toHaveLength(1);
});

it('keeps an explicitly closed node panel closed when a save is confirmed', async () => {
  const server = fakeServer();
  const store = createEditorStore(server.send);
  store.getState().load(document, user);
  store.getState().typeText(rootId, 'Texto atualizado');
  store.getState().commitText();
  expect(server.calls).toHaveLength(1);
  expect(store.getState().select(null)).toBe(true);
  server.calls[0].resolve(); await advance(0);
  expect(store.getState().status).toBe('saved');
  expect(store.getState().selectedNodeId).toBeNull();
  expect(store.getState().nodes[0].text).toBe('Texto atualizado');
});
