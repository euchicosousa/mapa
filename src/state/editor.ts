import { notifyAccessDenied } from '../auth/access-events';
import { create } from 'zustand';
import { applyMapCommand, applyMapHistory, MapError, mapId, validNodeText, validMapTitle, type MapCommand, type MapDocument, type MapErrorCode, type MapNode, type SendCommand, type HistoryAction, type HistoryRequest, getMapDocument, editorSessionId, createMapCopy, type CopyRequest } from '../maps/api';

import { reorganize } from '../maps/structure';
import { queryClient } from '../app/query-client';
import { supabase } from '../lib/supabase';
import { readDraft, writeDraft, clearMapDrafts, type DraftRecord } from '../maps/drafts';

export const TEXT_COALESCE_MS = 650;
const REQUEST_TIMEOUT_MS = 20_000;

type AIIntegration = { mapId: string; editorSessionId: string; result: Awaited<ReturnType<SendCommand>> };
type Operation = MapCommand & { operationId: string; sent: boolean; expectedRevision?: number; editorSessionId?: string };
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';
type Confirmed = { map: MapDocument['map']; nodes: MapNode[]; people: Record<string, string> };

export type Recovery = { record: DraftRecord | null; epoch: number; mapEpoch?: number; error?: boolean };
type Dependencies = { persist?: typeof writeDraft; erase?: typeof clearMapDrafts; read?: typeof getMapDocument; copy?: typeof createMapCopy; history?: HistoryAction; onRevoke?: (record: DraftRecord) => void; recover?: (record: DraftRecord) => Promise<{ document: MapDocument; recovery: Recovery }> };
type HistoryEntry = { operationId: string; command?: MapCommand };
type PendingHistory = HistoryRequest;
interface EditorState {
  activeMapId: string | null;
  selectedNodeId: string | null;
  userId: string | null;
  // Last server state, operations not yet confirmed (head may be in flight) and the
  // text still being typed. `nodes` is always confirmed + queue + draft.
  confirmed: Confirmed | null;
  queue: Operation[];
  draft: { nodeId: string; text: string } | null;
  inFlight: boolean;
  status: SaveStatus;
  failure: MapErrorCode | null;
  nodes: MapNode[];
  epoch: number;
  mapEpoch: number;
  recovered: boolean;
  revoked: boolean;
  deleted: boolean;
  deleteConfirmed: boolean;
  storageError: boolean;
  storageInitialized: boolean;
  needsHeadCheck: boolean;
  copyRequest: CopyRequest | null;
  copying: boolean;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  historyBusy: boolean;
  undoRequested: string | null;
  historyMessage: string | null;
  pendingHistory: PendingHistory | null;
  integrateAI: (job: AIIntegration) => 'applied' | 'wait' | 'conflict' | 'ignored';
  snapshot: () => DraftRecord | null;
  flushLocal: () => Promise<boolean>;
  retryStorage: () => Promise<boolean>;
  copyLocal: () => Promise<string | null>;
  discard: () => Promise<boolean>;
  acknowledgeCopy: () => Promise<boolean>;
  revoke: () => void;
  load: (document: MapDocument, userId: string, recovery?: Recovery) => void;
  select: (nodeId: string | null) => boolean;
  addChild: (parentId: string, text?: string) => string | null;
  deleteSubtree: (nodeId: string) => number | null;
  moveSubtree: (nodeId: string, newParentId: string) => boolean;
  reorderSibling: (nodeId: string, targetIndex: number) => boolean;
  renameMap: (title: string) => boolean;
  setProject: (projectId: string | null) => boolean;
  transferOwner: (ownerId: string) => boolean;
  deleteMap: () => boolean;
  markDeleted: () => void;
  undo: () => void;
  redo: () => void;
  typeText: (nodeId: string, text: string) => void;
  commitText: () => void;
  retry: () => void;
  reset: () => void;
}

// Apply a queued command to a local copy, guessing what the server will compute.
function applyLocal(nodes: MapNode[], command: MapCommand, userId: string): MapNode[] {
  if (command.kind === 'rename_map' || command.kind === 'set_project' || command.kind === 'transfer_owner' || command.kind === 'delete_map') return nodes;
  if (command.kind === 'add_child') {
    const { nodeId, parentId, text } = command.payload;
    if (nodes.some((node) => node.id === nodeId)) return nodes;
    const siblings = nodes.filter((node) => node.parentId === parentId);
    const sortOrder = siblings.reduce((max, node) => Math.max(max, node.sortOrder + 1), 0);
    return [...nodes, { id: nodeId, parentId, text, sortOrder, createdBy: userId, updatedBy: userId, source: 'manual' }];
  }
  if (command.kind === 'delete_subtree') {
    const removed = new Set([command.payload.nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes) if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) {
        removed.add(node.id);
        changed = true;
      }
    }
    return nodes.filter((node) => !removed.has(node.id));
  }
  if (command.kind === 'move_subtree' || command.kind === 'reorder_siblings') {
    const parentId = command.kind === 'move_subtree' ? command.payload.newParentId : nodes.find((node) => node.id === command.payload.nodeId)?.parentId;
    return parentId ? reorganize(nodes, command.payload.nodeId, parentId, command.payload.targetIndex, userId) ?? nodes : nodes;
  }
  const { nodeId, text } = command.payload;
  return nodes.map((node) => node.id === nodeId ? { ...node, text, updatedBy: userId } : node);
}

function project(confirmed: Confirmed | null, queue: Operation[], draft: EditorState['draft'], userId: string | null): MapNode[] {
  if (!confirmed || !userId) return [];
  let nodes = queue.reduce((current, operation) => applyLocal(current, operation, userId), confirmed.nodes);
  if (draft) nodes = applyLocal(nodes, { kind: 'edit_text', payload: draft }, userId);
  return nodes;
}

// Metadata shares the durable queue and trusted patches; node projection stays unchanged.
export function projectedMap(confirmed: Confirmed | null, queue: MapCommand[]) {
  if (!confirmed) return null;
  return queue.reduce((map,command) => command.kind === 'rename_map' ? { ...map,title:command.payload.title }
    : command.kind === 'set_project' ? { ...map,projectId:command.payload.projectId } : map, confirmed.map);
}
function patchedMap(map: MapDocument['map'], result: Awaited<ReturnType<SendCommand>>) {
  return { ...map, revision: Math.max(map.revision,result.revision), updatedAt:result.mapPatch.updatedAt,
    ...(result.mapPatch.title !== undefined ? {title:result.mapPatch.title} : {}),
    ...(result.mapPatch.projectId !== undefined ? {projectId:result.mapPatch.projectId} : {}),
    ...(result.mapPatch.ownerId !== undefined ? {ownerId:result.mapPatch.ownerId} : {}),
    ...(result.mapPatch.ownerName !== undefined ? {ownerName:result.mapPatch.ownerName} : {}) };
}

// Canvas changes at logical commits; the panel still displays every keystroke.
export function canvasNodes(confirmed: Confirmed | null, queue: Operation[], userId: string | null) {
  return project(confirmed, queue, null, userId);
}

const idle = {
  activeMapId: null, selectedNodeId: null, userId: null, confirmed: null, queue: [], draft: null,
  inFlight: false, status: 'saved' as SaveStatus, failure: null, nodes: [],
  epoch: 0, mapEpoch: 0, recovered: false, revoked: false, deleted:false, deleteConfirmed:false, storageError: false, storageInitialized: true, needsHeadCheck: false, copyRequest: null, copying: false,
  undoStack: [], redoStack: [], historyBusy: false, undoRequested: null, historyMessage: null, pendingHistory: null,
};

// Timers are called unbound: browsers throw "Illegal invocation" if window.setTimeout
// runs with another `this`, so the defaults wrap the globals.
const browserTimers = {
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
};

export function createEditorStore(send: SendCommand = applyMapCommand, timers = browserTimers, dependencies: Dependencies = {}) {
  let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
  let writes = Promise.resolve();
  const persist = (): Promise<boolean> => {
    timers.clearTimeout(persistenceTimer);
    const record = store.getState().snapshot();
    if (!record || !dependencies.persist) return writes.then(() => true);
    if (!store.getState().storageInitialized) return Promise.resolve(false);
    const pending = record.queue.length > 0 || record.draft !== null || record.copyRequest !== null || record.conflict || record.needsHeadCheck || record.pendingHistory != null || record.undoRequested != null;
    const task = writes.then(() => dependencies.persist!(record, pending));
    writes = task.catch(() => {});
    return task.then(() => { store.setState({ storageError: false }); return true; }, () => { store.setState({ storageError: true }); return false; });
  };
  let textTimer: ReturnType<typeof setTimeout> | undefined;
  // Bumped on load/reset so late responses for a previous document are ignored.
  let generation = 0;
  let undoAfterFlight = false;
  const store = create<EditorState>((set, get) => {
    const derive = (patch: Partial<EditorState>) => {
      const next = { ...get(), ...patch };
      const busy = next.queue.length > 0 || next.draft !== null || next.pendingHistory !== null || next.undoRequested !== null;
      const status: SaveStatus = next.status === 'conflict' || next.status === 'error' ? next.status
        : next.inFlight || next.historyBusy || next.undoRequested !== null ? 'saving' : busy ? 'pending' : 'saved';
      const nodes = project(next.confirmed, next.queue, next.draft, next.userId);
      let selectedNodeId = next.selectedNodeId;
      while (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) {
        selectedNodeId = get().nodes.find((node) => node.id === selectedNodeId)?.parentId ?? null;
      }
      set({ ...patch, selectedNodeId: next.selectedNodeId === null ? null : selectedNodeId ?? nodes.find((node) => node.parentId === null)?.id ?? null,
        status, recovered: status === 'saved' ? false : next.recovered, nodes });
    };

    const frozenDocument = () => get().deleted || get().deleteConfirmed || get().queue.some(operation=>operation.kind==='delete_map');
    const handleFailure = (error: unknown) => {
      if(error instanceof MapError && error.deleted){get().markDeleted();return;}
      const code = error instanceof MapError ? error.code : 'UNAVAILABLE';
      if (code === 'NOT_FOUND' || code === 'FORBIDDEN') { get().revoke(); return; }
      if (code === 'CONFLICT') undoAfterFlight = false;
      set({ inFlight: false, copying: false, historyBusy: false, failure: code, status: code === 'CONFLICT' ? 'conflict' : 'error',
        ...(code === 'CONFLICT' ? { undoStack: [], redoStack: [], pendingHistory: null, undoRequested: null, historyMessage: 'O mapa mudou em outra sessão. O histórico foi limpo para proteger as alterações mais recentes.' } : {}) });
    };
    const readHead = async () => {
      if (!dependencies.read || !get().confirmed) { set({ needsHeadCheck: false }); return; }
      const ticket = generation;
      const remote = await dependencies.read(get().confirmed!.map.id, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
      if (ticket !== generation) return;
      const current = get();
      if (remote.map.revision > current.confirmed!.map.revision) {
        undoAfterFlight = false;
        const history = { undoStack: [], redoStack: [], undoRequested: null, historyMessage: current.historyMessage ?? 'O mapa mudou em outra sessão. O histórico foi limpo para proteger as alterações mais recentes.' };
        if (current.queue.length || current.draft) derive({ ...history, needsHeadCheck: false, status: 'conflict', failure: 'CONFLICT' });
        else derive({ ...history, confirmed: remote, needsHeadCheck: false });
      } else set({ needsHeadCheck: false });
    };
    // Write the immutable request ahead of the network. Replays keep their original
    // revision/session and read the remote head before any subsequent command.
    const pump = () => {
      const state = get();
      if (state.deleted || state.deleteConfirmed || state.inFlight || state.historyBusy || state.pendingHistory || state.status === 'conflict' || state.status === 'error' || !state.confirmed || state.copyRequest) return;
      if (state.needsHeadCheck) {
        const ticket = generation;
        derive({ inFlight: true });
        void readHead().then(async () => {
          if (ticket !== generation) return;
          await persist();
          if (ticket !== generation) return;
          derive({ inFlight: false });
          if (undoAfterFlight) { undoAfterFlight = false; set({ undoRequested: null }); get().undo(); } else pump();
        }).catch((error: unknown) => { if (ticket === generation) handleFailure(error); });
        return;
      }
      const head = state.queue[0];
      if (!head) { derive({}); return; }
      const ticket = generation;
      const ambiguous = head.sent;
      const operation = { ...head, sent: true, expectedRevision: head.expectedRevision ?? state.confirmed.map.revision, editorSessionId: head.editorSessionId ?? editorSessionId };
      derive({ inFlight: true, queue: [operation, ...state.queue.slice(1)] });
      const { operationId, kind, payload, expectedRevision, editorSessionId: session } = operation;
      const request = { mapId: state.confirmed.map.id, operationId, expectedRevision, editorSessionId: session, kind, payload } as Parameters<SendCommand>[0];
      const execute = () => {
        if (ticket !== generation) return;
        void send(request, AbortSignal.timeout(REQUEST_TIMEOUT_MS)).then(async (result) => {
          if (ticket !== generation) return;
          const current = get();
          const confirmed = current.confirmed!;
          const changed = new Map(result.changedNodes.map((node) => [node.id, node]));
          const nodes = confirmed.nodes.filter((node) => !result.deletedNodeIds.includes(node.id)).map((node) => changed.get(node.id) ?? node);
          for (const node of result.changedNodes) if (!confirmed.nodes.some((existing) => existing.id === node.id)) nodes.push(node);
          derive({ failure: null, queue: current.queue.filter((entry) => entry.operationId !== operationId), needsHeadCheck: ambiguous,
            undoStack: (kind==='transfer_owner'||kind==='delete_map')?[]:[...current.undoStack, { operationId }].slice(-100),
            ...((kind==='transfer_owner'||kind==='delete_map')?{redoStack:[],undoRequested:null}:{}),
            ...(kind==='delete_map'?{deleteConfirmed:true,needsHeadCheck:false}:{}),
            historyMessage: kind==='transfer_owner'?'Responsabilidade transferida. O histórico desta sessão foi reiniciado.':null,
            confirmed: { ...confirmed, nodes, map: patchedMap(confirmed.map,result) },
          });
          if (ambiguous && kind!=='delete_map') await readHead();
          if (ticket !== generation) return;
          // An old recovery record must be removed before the UI says Saved;
          // otherwise a fast reload could resurrect an already-corrected draft.
          await persist();
          if (ticket !== generation) return;
          derive({ inFlight: false });
          if (undoAfterFlight) { undoAfterFlight = false; set({ undoRequested: null }); get().undo(); } else pump();
        }).catch(async (error: unknown) => {
          if (ticket !== generation) return;
          // A rejected transfer does not revoke a colleague's content access.
          // Remove only this definitively rejected request; preserve later edits.
          if ((kind==='transfer_owner'||kind==='delete_map') && error instanceof MapError && (error.code==='FORBIDDEN'||error.code==='VALIDATION')) {
            derive({queue:get().queue.filter(entry=>entry.operationId!==operationId),inFlight:true,failure:null,status:'pending',
              historyMessage:kind==='delete_map'?'Somente o responsável atual ou um administrador pode excluir este mapa. A edição continua disponível.':error.code==='FORBIDDEN'?'Somente o responsável atual ou um administrador pode transferir este mapa. A edição continua disponível.':'O destino não está disponível. Escolha outro membro ativo da equipe.'});
            try {
              await readHead();
              if(ticket!==generation)return;
              await persist();
              if(ticket===generation){derive({inFlight:false});pump();}
            } catch(reason){if(ticket===generation)handleFailure(reason);}
          } else handleFailure(error);
        });
      };
      if (dependencies.persist) void persist().then(execute); else execute();
    };

    const enqueue = (command: MapCommand, finishText = false) => {
      if(frozenDocument())return;
      derive({ ...(finishText ? { draft: null } : {}), redoStack: [], queue: [...get().queue, { ...command, operationId: crypto.randomUUID(), sent: false }] });
      pump();
    };

    // The text a node will have once everything queued is confirmed.
    const queuedText = (nodeId: string) => project(get().confirmed, get().queue, null, get().userId).find((node) => node.id === nodeId)?.text;

    // There is one editing draft. A failed validation must keep ownership of
    // that slot until the user corrects the text, including calls outside the UI.
    const finishDraft = () => {
      if(frozenDocument())return false;
      get().commitText();
      return get().draft === null;
    };

    const applyHistory = (mode: 'undo' | 'redo') => {
      const state = get();
      if (state.historyBusy || state.inFlight || state.queue.length || state.draft || state.status === 'conflict'
        || state.copyRequest || !state.storageInitialized || !state.confirmed || !dependencies.history) return;
      if (state.pendingHistory && state.pendingHistory.mode !== mode) return;
      const stack = mode === 'undo' ? state.undoStack : state.redoStack;
      const target = state.pendingHistory ? { operationId: state.pendingHistory.targetOperationId } : stack.at(-1);
      if (!target) return;
      const replay = state.pendingHistory !== null;
      const request = state.pendingHistory ?? { mode, targetOperationId: target.operationId, operationId: crypto.randomUUID(),
        mapId: state.confirmed.map.id, expectedRevision: state.confirmed.map.revision, editorSessionId };
      const ticket = generation;
      derive({ historyBusy: true, pendingHistory: request, historyMessage: null, status: 'pending', failure: null });
      void (async () => {
        await persist();
        if (ticket !== generation) return;
        const result = await dependencies.history!(request, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
        if (ticket !== generation) return;
        const current = get();
        const changed = new Map(result.changedNodes.map((node) => [node.id, node]));
        const nodes = current.confirmed!.nodes.filter((node) => !result.deletedNodeIds.includes(node.id)).map((node) => changed.get(node.id) ?? node);
        for (const node of result.changedNodes) if (!current.confirmed!.nodes.some((entry) => entry.id === node.id)) nodes.push(node);
        const removedSelection = current.confirmed!.nodes.find((node) => node.id === current.selectedNodeId && result.deletedNodeIds.includes(node.id));
        const restored = result.changedNodes.find((node) => !current.confirmed!.nodes.some((entry) => entry.id === node.id));
        const selectedNodeId = removedSelection ? (nodes.some((node) => node.id === removedSelection.parentId)
          ? removedSelection.parentId : nodes.find((node) => node.parentId === null)?.id ?? null)
          : mode === 'redo' && restored ? restored.id : current.selectedNodeId;
        derive({ confirmed: { ...current.confirmed!, nodes, map: patchedMap(current.confirmed!.map,result) },
          selectedNodeId,
          undoStack: mode === 'undo' ? current.undoStack.slice(0, -1) : [...current.undoStack, target].slice(-100),
          redoStack: mode === 'undo' ? [...current.redoStack, target].slice(-100) : current.redoStack.slice(0, -1),
          pendingHistory: null, needsHeadCheck: replay, failure: null, status: 'pending' });
        if (replay) await readHead();
        if (ticket !== generation) return;
        await persist();
        if (ticket === generation) derive({ historyBusy: false });
      })().catch(async (error: unknown) => {
        if (ticket !== generation) return;
        const code = error instanceof MapError ? error.code : 'UNAVAILABLE';
        if (code === 'CONFLICT') {
          derive({ undoStack: [], redoStack: [], pendingHistory: null, needsHeadCheck: true, historyBusy: true,
            historyMessage: 'O mapa mudou em outra sessão. O histórico foi limpo e a versão atual será carregada.', status: 'pending', failure: null });
          try {
            await readHead();
            if (ticket !== generation) return;
            await persist();
            if (ticket === generation) derive({ historyBusy: false });
          } catch (readError) { if (ticket === generation) handleFailure(readError); }
        } else if (error instanceof MapError && error.deleted) get().markDeleted();
        else if (code === 'NOT_FOUND' || code === 'FORBIDDEN') get().revoke();
        else {
          derive({ historyBusy: false, failure: code, status: 'error',
            historyMessage: `Não foi possível confirmar ${mode === 'undo' ? 'o desfazer' : 'o refazer'}. Tente novamente; a mesma operação será repetida com segurança.` });
          await persist();
        }
      });
    };

    return {
      ...idle,
      integrateAI: (job) => {
        const state = get();
        if (!state.confirmed || state.activeMapId !== job.mapId || state.revoked || state.deleted || state.deleteConfirmed) return 'ignored';
        if (state.inFlight || state.historyBusy || state.pendingHistory || state.undoRequested || state.copying) return 'wait';
        const result = job.result;
        // A replay/reload whose confirmed document already contains this batch
        // must not resurrect an undone action or duplicate the session history.
        if (state.confirmed.map.revision >= result.revision) return 'ignored';
        if (state.queue.length || state.draft || state.copyRequest || state.status === 'conflict' || state.status === 'error'
          || state.confirmed.map.revision !== result.revision - 1) {
          derive({status:'conflict',failure:'CONFLICT',undoStack:[],redoStack:[],
            historyMessage:'A IA concluiu no servidor. Seu texto local foi preservado; escolha qual versão continuar.'});
          void persist();
          return 'conflict';
        }
        const changed = new Map(result.changedNodes.map(node => [node.id,node]));
        const nodes = state.confirmed.nodes.filter(node => !result.deletedNodeIds.includes(node.id)).map(node => changed.get(node.id) ?? node);
        for (const node of result.changedNodes) if (!state.confirmed.nodes.some(existing => existing.id === node.id)) nodes.push(node);
        derive({confirmed:{...state.confirmed,nodes,map:patchedMap(state.confirmed.map,result)},
          undoStack:job.editorSessionId===editorSessionId?[...state.undoStack,{operationId:result.operationId}].slice(-100):[],
          redoStack:[],failure:null,historyMessage:null});
        void persist();
        return 'applied';
      },
      snapshot: () => {
        const state = get();
        if (!state.confirmed || !state.userId) return null;
        return {
          version: 1, userId: state.userId, workspaceId: state.confirmed.map.workspaceId, mapId: state.confirmed.map.id,
          sessionId: editorSessionId, epoch: state.epoch, mapEpoch: state.mapEpoch, base: state.confirmed, queue: state.queue, draft: state.draft,
          selectedNodeId: state.selectedNodeId, conflict: state.status === 'conflict', needsHeadCheck: state.needsHeadCheck,
          copyRequest: state.copyRequest, pendingHistory: state.pendingHistory, undoRequested: state.undoRequested, updatedAt: new Date().toISOString(),
        };
      },
      flushLocal: persist,
      retryStorage: async () => {
        if (get().storageInitialized) return persist();
        const record = get().snapshot();
        if (!record || !dependencies.recover) return false;
        const ticket = generation;
        try {
          const { document, recovery } = await dependencies.recover(record);
          if (ticket !== generation) return false;
          get().load(document, record.userId, recovery);
          return persist();
        } catch (error) { if (ticket === generation) handleFailure(error); return false; }
      },
      markDeleted: () => {
        undoAfterFlight=false;timers.clearTimeout(textTimer);
        set({deleted:true,inFlight:false,historyBusy:false,undoRequested:null,undoStack:[],redoStack:[],status:'error',failure:'NOT_FOUND'});
        void persist();
      },
      revoke: () => {
        const snapshot = get().snapshot();
        generation += 1;
        undoAfterFlight = false;
        timers.clearTimeout(textTimer); timers.clearTimeout(persistenceTimer);
        set({ ...idle, revoked: true });
        if (snapshot) dependencies.onRevoke?.(snapshot);
        if (snapshot && dependencies.erase) writes = writes.then(() => dependencies.erase!(snapshot)).catch(() => { set({ storageError: true }); });
      },
      copyLocal: async () => {
        const state = get();
        if (frozenDocument() || !state.confirmed || state.copying || state.inFlight || state.historyBusy || state.pendingHistory || state.undoRequested || !state.userId || !dependencies.copy || state.nodes.some((node) => !validNodeText(node.text))) return null;
        const ticket = generation;
        const request = state.copyRequest ?? {
          sourceMapId: state.confirmed.map.id, operationId: crypto.randomUUID(), editorSessionId,
          title: `${projectedMap(state.confirmed,state.queue)!.title.slice(0, 112)} — cópia`,
          nodes: state.nodes.map(({ id, parentId, text, sortOrder }) => ({ id, parentId, text, sortOrder })),
        };
        timers.clearTimeout(textTimer);
        set({ copyRequest: request, copying: true });
        await persist();
        try {
          const result = await dependencies.copy(request);
          if (ticket !== generation) return null;
          set({ copying: false });
          return result.mapId;
        } catch (error) { if (ticket === generation) handleFailure(error); return null; }
      },
      acknowledgeCopy: async () => {
        derive({ queue: [], draft: null, copyRequest: null, status: 'saved', failure: null, recovered: false, needsHeadCheck: false });
        return persist();
      },
      discard: async () => {
        const state = get();
        if (frozenDocument() || !state.confirmed || state.inFlight || state.copying || state.historyBusy || state.pendingHistory || state.undoRequested || !dependencies.read) return false;
        const ticket = generation;
        try {
          const document = await dependencies.read(state.confirmed.map.id, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
          if (ticket !== generation) return false;
          generation += 1; undoAfterFlight = false; timers.clearTimeout(textTimer);
          derive({ confirmed: document, selectedNodeId: document.nodes.find((node) => node.parentId === null)?.id ?? null, queue: [], draft: null, copyRequest: null, undoStack: [], redoStack: [], pendingHistory: null, undoRequested: null, needsHeadCheck: false, status: 'pending', inFlight: true, failure: null, recovered: false });
          const cleanupTicket = generation;
          await persist();
          if (cleanupTicket !== generation) return false;
          derive({ inFlight: false }); return true;
        } catch (error) {
          if (ticket === generation) {
            const code = error instanceof MapError ? error.code : 'UNAVAILABLE';
            if (get().status === 'conflict' && code !== 'NOT_FOUND' && code !== 'FORBIDDEN' && code !== 'UNAUTHENTICATED') set({ failure: code });
            else handleFailure(error);
          }
          return false;
        }
      },
      load: (document, userId, recovery) => {
        const state = get();
        const sameMap = state.activeMapId === document.map.id && state.userId === userId;
        // A refetch never replaces a document with local changes or an older revision.
        if (sameMap && (state.queue.length > 0 || state.draft || state.inFlight || state.historyBusy || state.pendingHistory || state.undoRequested || state.status === 'conflict' || state.copyRequest || state.needsHeadCheck)) return;
        if (sameMap && state.confirmed && document.map.revision < state.confirmed.map.revision) return;
        if (!sameMap) { generation += 1; undoAfterFlight = false; timers.clearTimeout(textTimer); }
        const record = recovery?.record;
        if (record && record.userId === userId && record.mapId === document.map.id && record.workspaceId === document.map.workspaceId && record.epoch === recovery.epoch) {
          undoAfterFlight = record.undoRequested != null && record.queue.length > 0;
          derive({ activeMapId: document.map.id, userId, selectedNodeId: record.selectedNodeId, confirmed: record.base,deleted:false,deleteConfirmed:false,
            queue: record.queue, draft: record.draft, inFlight: false, failure: record.conflict ? 'CONFLICT' : 'UNAVAILABLE',
            status: record.conflict ? 'conflict' : 'error', epoch: recovery.epoch, mapEpoch: recovery.mapEpoch ?? record.mapEpoch, recovered: true, revoked: false,
            needsHeadCheck: record.needsHeadCheck, copyRequest: record.copyRequest, copying: false, pendingHistory: record.pendingHistory ?? null, undoStack: record.undoRequested && !record.queue.length ? [{ operationId: record.undoRequested }] : [], redoStack: [], undoRequested: record.undoRequested ?? null, historyBusy: false, storageError: recovery.error ?? false, storageInitialized: !recovery.error,
          }); return;
        }
        const root = document.nodes.find((node) => node.parentId === null);
        const selected = sameMap && document.nodes.some((node) => node.id === state.selectedNodeId) ? state.selectedNodeId : root?.id ?? null;
        derive({
          epoch: recovery?.epoch ?? state.epoch, mapEpoch: recovery?.mapEpoch ?? state.mapEpoch, storageError: recovery?.error ?? false, storageInitialized: !recovery?.error, recovered: false, revoked: false, copyRequest: null, needsHeadCheck: false,
          undoStack: sameMap && document.map.revision === state.confirmed?.map.revision ? state.undoStack : [],
          redoStack: sameMap && document.map.revision === state.confirmed?.map.revision ? state.redoStack : [],
          historyBusy: false, pendingHistory: null, undoRequested: null,
          historyMessage: !sameMap ? null : document.map.revision > (state.confirmed?.map.revision ?? 0) ? 'O mapa mudou em outra sessão. O histórico foi limpo para proteger as alterações mais recentes.' : state.historyMessage,
          activeMapId: document.map.id, userId, selectedNodeId: selected, deleted:false,deleteConfirmed:false, queue: [], draft: null, inFlight: false,
          status: 'saved', failure: null, confirmed: { map: document.map, nodes: document.nodes, people: document.people },
        });
      },
      select: (nodeId) => {
        if (!get().storageInitialized || get().copyRequest || get().historyBusy || get().pendingHistory || get().undoRequested || !finishDraft()) return false;
        set({ selectedNodeId: nodeId });
        return true;
      },
      addChild: (parentId, text = 'Nova ideia') => {
        // Structural changes wait for earlier text edits and their validation.
        if (!get().storageInitialized || get().copyRequest || get().historyBusy || get().pendingHistory || get().undoRequested || !finishDraft()) return null;
        const nodeId = crypto.randomUUID();
        enqueue({ kind: 'add_child', payload: { nodeId, parentId, text } });
        set({ selectedNodeId: nodeId });
        return nodeId;
      },
      deleteSubtree: (nodeId) => {
        if (!get().storageInitialized || get().copyRequest || get().historyBusy || get().pendingHistory || get().undoRequested || !finishDraft()) return null;
        const current = get().nodes;
        const target = current.find((node) => node.id === nodeId);
        if (!target || !target.parentId) return null;
        const parentId = target.parentId;
        const removed = new Set([nodeId]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const node of current) if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) {
            removed.add(node.id);
            changed = true;
          }
        }
        enqueue({ kind: 'delete_subtree', payload: { nodeId } });
        set({ selectedNodeId: parentId });
        return removed.size - 1;
      },
      moveSubtree: (nodeId, newParentId) => {
        if (!get().storageInitialized || get().copyRequest || get().historyBusy || get().pendingHistory || get().undoRequested || !finishDraft()) return false;
        const state = get();
        const targetIndex = state.nodes.filter((node) => node.parentId === newParentId && node.id !== nodeId).length;
        if (!state.userId || !reorganize(state.nodes, nodeId, newParentId, targetIndex, state.userId)) return false;
        enqueue({ kind: 'move_subtree', payload: { nodeId, newParentId, targetIndex } });
        return true;
      },
      reorderSibling: (nodeId, targetIndex) => {
        if (!get().storageInitialized || get().copyRequest || get().historyBusy || get().pendingHistory || get().undoRequested || !finishDraft()) return false;
        const state = get();
        const parentId = state.nodes.find((node) => node.id === nodeId)?.parentId;
        if (!parentId || !state.userId || !reorganize(state.nodes, nodeId, parentId, targetIndex, state.userId)) return false;
        enqueue({ kind: 'reorder_siblings', payload: { nodeId, targetIndex } });
        return true;
      },
      renameMap: (title) => {
        const state = get();
        if (!validMapTitle(title) || !state.storageInitialized || state.copyRequest || state.historyBusy || state.pendingHistory || state.undoRequested || state.status === 'conflict' || !finishDraft()) return false;
        enqueue({ kind:'rename_map',payload:{title} });return true;
      },
      setProject: (projectId) => {
        const state = get();
        if (!state.storageInitialized || state.copyRequest || state.historyBusy || state.pendingHistory || state.undoRequested || state.status === 'conflict' || !finishDraft()) return false;
        enqueue({ kind:'set_project',payload:{projectId} });return true;
      },
      transferOwner: (ownerId) => {
        const state=get();
        if (frozenDocument() || !mapId.safeParse(ownerId).success || !state.confirmed || state.status!=='saved' || state.inFlight || state.historyBusy || state.pendingHistory || state.undoRequested || state.copyRequest || !state.storageInitialized || ownerId===state.confirmed.map.ownerId) return false;
        enqueue({kind:'transfer_owner',payload:{ownerId}});return true;
      },
      deleteMap: () => {
        const state=get();
        if(frozenDocument() || !state.confirmed || state.status!=='saved' || state.historyBusy || state.copyRequest || !state.storageInitialized)return false;
        enqueue({kind:'delete_map',payload:{}});return true;
      },
      undo: () => {
        if(frozenDocument())return;
        if (get().historyBusy || get().undoRequested || get().copyRequest || !get().storageInitialized || get().status === 'conflict') return;
        if (get().pendingHistory) { applyHistory('undo'); return; }
        const draft = get().draft;
        if (draft) {
          if (!validNodeText(draft.text)) return;
          timers.clearTimeout(textTimer);
          derive({ draft: null, redoStack: queuedText(draft.nodeId) === draft.text ? get().redoStack
            : [...get().redoStack, { operationId: crypto.randomUUID(), command: { kind: 'edit_text' as const, payload: draft } }].slice(-100) });
          void persist();
          return;
        }
        const state = get();
        const lastPending = state.queue.at(-1);
        if (lastPending && !lastPending.sent) {
          derive({ queue: state.queue.slice(0, -1), redoStack: [...state.redoStack, { operationId: lastPending.operationId, command: lastPending }].slice(-100) });
          void persist().then(pump);
          return;
        }
        if (state.queue.length || state.inFlight) {
          if (!undoAfterFlight) {
            const targetOperationId = state.queue.at(-1)?.operationId ?? state.undoStack.at(-1)?.operationId;
            if (!targetOperationId) return;
            undoAfterFlight = true;
            derive({ undoRequested: targetOperationId });
            if (state.status === 'error') get().retry();
          }
          return;
        }
        applyHistory('undo');
      },
      redo: () => {
        if(frozenDocument())return;
        const state = get();
        if (state.queue.length || state.inFlight || state.historyBusy || state.undoRequested || state.copyRequest || !state.storageInitialized || state.status === 'conflict' || state.draft) return;
        const local = state.redoStack.at(-1);
        if (!state.pendingHistory && local?.command) {
          derive({ redoStack: state.redoStack.slice(0, -1), queue: [{ ...local.command, operationId: local.operationId, sent: false }] });
          pump();
          return;
        }
        applyHistory('redo');
      },
      typeText: (nodeId, text) => {
        if(frozenDocument())return;
        if (!get().storageInitialized || get().copyRequest || get().historyBusy || get().pendingHistory || get().undoRequested) return;
        const { draft } = get();
        if (draft && draft.nodeId !== nodeId && !finishDraft()) return;
        timers.clearTimeout(textTimer);
        derive({ draft: { nodeId, text }, redoStack: [] });
        textTimer = timers.setTimeout(() => get().commitText(), TEXT_COALESCE_MS);
      },
      // After 650 ms without typing or on blur. Invalid text stays as a local draft.
      commitText: () => {
        if(frozenDocument())return;
        timers.clearTimeout(textTimer);
        const { draft, queue } = get();
        if (!draft || !validNodeText(draft.text)) return;
        if (queuedText(draft.nodeId) === draft.text) {
          const ticket = generation;
          const current = get();
          const finalCleanup = !current.inFlight && current.queue.length === 0 && !current.needsHeadCheck && current.status !== 'error' && current.status !== 'conflict';
          derive({ draft: null, ...(finalCleanup ? { inFlight: true } : {}) });
          if (finalCleanup) void persist().then(() => { if (ticket === generation) { derive({ inFlight: false }); pump(); } });
          else void persist();
          return;
        }
        const last = queue.at(-1);
        // Coalesce into the previous edit of the same node only if it was never sent.
        if (last && !last.sent && last.kind === 'edit_text' && last.payload.nodeId === draft.nodeId) {
          derive({ draft: null, queue: [...queue.slice(0, -1), { ...last, payload: { nodeId: draft.nodeId, text: draft.text } }] });
          return;
        }
        enqueue({ kind: 'edit_text', payload: { nodeId: draft.nodeId, text: draft.text } }, true);
      },
      retry: () => {
        if(get().deleted || get().deleteConfirmed)return;
        if (get().status === 'conflict') return;
        if (get().pendingHistory) { applyHistory(get().pendingHistory!.mode); return; }
        if (get().undoRequested && !get().queue.length && !get().inFlight && !get().historyBusy) {
          undoAfterFlight = false; set({ undoRequested: null }); get().undo(); return;
        }
        set({ status: 'pending', failure: null });
        get().commitText();
        pump();
      },
      reset: () => {
        void persist();
        generation += 1;
        undoAfterFlight = false;
        timers.clearTimeout(textTimer); timers.clearTimeout(persistenceTimer);
        set({ ...idle });
      },
    };
  });
  if (dependencies.persist) store.subscribe((next, previous) => {
    if (!next.confirmed) return;
    if (next.confirmed === previous.confirmed && next.queue === previous.queue && next.draft === previous.draft && next.selectedNodeId === previous.selectedNodeId && next.status === previous.status && next.copyRequest === previous.copyRequest && next.needsHeadCheck === previous.needsHeadCheck && next.pendingHistory === previous.pendingHistory && next.undoRequested === previous.undoRequested) return;
    timers.clearTimeout(persistenceTimer);
    persistenceTimer = timers.setTimeout(() => { void persist(); }, 200);
  });
  return store;
}

// No fabricated document or persistence: the editor fills it from the loader.
export const useEditorStore = createEditorStore(applyMapCommand, browserTimers, {
  persist: writeDraft, erase: clearMapDrafts, read: getMapDocument, copy: createMapCopy, history: applyMapHistory,
  onRevoke: (record) => {
    queryClient.removeQueries({ queryKey: ['map', record.userId, record.mapId] });
    queryClient.removeQueries({ queryKey: ['maps', record.userId, record.workspaceId] });
    notifyAccessDenied();
  },
  recover: async (record) => {
    if (!supabase) throw new MapError('UNAVAILABLE');
    const { data, error } = await supabase.auth.getUser();
    if (error) throw new MapError(error.status === 401 || error.status === 403 ? 'UNAUTHENTICATED' : 'UNAVAILABLE');
    if (data.user?.id !== record.userId) throw new MapError('UNAUTHENTICATED');
    const document = await getMapDocument(record.mapId, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
    if (document.map.workspaceId !== record.workspaceId) throw new MapError('NOT_FOUND');
    const local = await readDraft(record);
    return { document, recovery: local };
  },
});
