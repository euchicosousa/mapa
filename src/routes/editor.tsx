import { AIGenerationControls } from './ai-generation';
import { MapDetailsDialog } from './map-details';
import { MapExport } from './map-export';
import { DeletedMapPage } from './deleted-map';
import { queryClient } from '../app/query-client';
import { useStore } from 'zustand';
import { createMapViewStore } from '../state/map-view';
import { visibleNodes, visibleAncestor } from '../maps/visibility';
import { descendantCounts, reorganize, siblingOrder, subtreeIds } from '../maps/structure';
import type { MapNode } from '../maps/api';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useLoaderData, useNavigate } from 'react-router';
import { Handle, Panel, Position, ReactFlow, useReactFlow, useViewport, type Edge, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { Page } from './pages';
import { MapUnavailablePage } from './library';
import { NODE_TEXT_MAX, validNodeText, type MapErrorCode } from '../maps/api';
import { layoutMap, NODE_WIDTH, revealNodeViewport, type NodeHeights } from '../maps/layout';
import type { MapLoaderData } from '../maps/loaders';
import { DraftDialog } from './draft-dialog';
import { downloadEmergencyDraft } from '../maps/drafts';
import { hasPendingEdits, synchronizeEditor } from '../state/editor-lifecycle';
import { canvasNodes, projectedMap, useEditorStore, type Recovery, type SaveStatus } from '../state/editor';

type MindNodeData = { text: string; root: boolean; selected: boolean; hiddenCount: number; hasChildren: boolean; toggle: (id: string) => void; measure: (id: string, height: number) => void };

const MindNode = memo(function MindNode({ id, data }: NodeProps<Node<MindNodeData>>) {
  const element = useRef<HTMLDivElement>(null);
  const { measure } = data;
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    const observer = new ResizeObserver(() => measure(id, target.offsetHeight));
    observer.observe(target);
    return () => observer.disconnect();
  }, [id, measure]);
  return <div ref={element} className={['mind-node', data.root && 'mind-node-root', data.selected && 'mind-node-selected'].filter(Boolean).join(' ')}>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <span className="mind-node-text">{data.text}</span>
    {data.hasChildren && <button type="button" className="node-collapse nopan nodrag nowheel"
      aria-expanded={data.hiddenCount === 0} aria-label={`${data.hiddenCount ? 'Expandir' : 'Recolher'} ramo: ${data.text}`}
      onClick={(event) => { event.stopPropagation(); data.toggle(id); }}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}>
      {data.hiddenCount ? '+' : '−'}
    </button>}
    {data.hiddenCount > 0 && <span className="mind-node-hidden">{data.hiddenCount} ocultos</span>}
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </div>;
});
const nodeTypes = { mind: MindNode };
const nodeInstructions = 'Use as setas para navegar. Espaço abre as ações do nó. Tab cria filho; Enter cria irmão; F2 edita; Delete exclui; Escape fecha as ações. Shift+Tab sai do mapa. Os botões oferecem as mesmas ações.';
const flowLabels = {
  'node.a11yDescription.default': nodeInstructions,
  'node.a11yDescription.keyboardDisabled': nodeInstructions,
  'edge.a11yDescription.default': 'Conexão entre pai e filho.',
  'controls.ariaLabel': 'Navegação do mapa', 'controls.zoomIn.ariaLabel': 'Aproximar',
  'controls.zoomOut.ariaLabel': 'Afastar', 'controls.fitView.ariaLabel': 'Enquadrar',
  'controls.interactive.ariaLabel': 'Alternar interação', 'minimap.ariaLabel': 'Visão geral', 'handle.ariaLabel': 'Conexão',
};
function focusMapNode(id: string | null) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const target = id ? window.document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`) : null;
    (target ?? window.document.querySelector<HTMLElement>('.canvas'))?.focus();
  }));
}
function panelAction(action: string) {
  if (action === 'focus') {
    window.document.querySelector<HTMLElement>('.node-panel [data-node-action="edit"], .node-panel #node-text')?.focus(); return;
  }
  window.document.querySelector<HTMLButtonElement>(`.node-panel [data-node-action="${action}"]`)?.click();
}
// Reserve the toolbar's height so fitting tall trees never hides their top nodes.
const fitOptions = { minZoom: 0.001, maxZoom: 1, padding: { top: '72px', bottom: '24px', left: '24px', right: '24px' } } as const;

const statusText: Record<SaveStatus, string> = {
  saved: 'Salvo', pending: 'Alterações pendentes', saving: 'Salvando…', error: 'Falha ao salvar', conflict: 'Conflito',
};
const failureText: Partial<Record<MapErrorCode, string>> = {
  UNAVAILABLE: 'Não foi possível falar com o servidor. Suas alterações continuam nesta tela.',
  UNAUTHENTICATED: 'Sua sessão expirou. Entre novamente na mesma conta e tente outra vez.',
  NOT_FOUND: 'Este mapa não está mais disponível para a sua conta.',
  FORBIDDEN: 'Sua conta não pode editar este mapa.',
  VALIDATION: 'O servidor recusou esta alteração. Confira o texto e tente novamente.',
  LIMIT_EXCEEDED: 'O mapa atingiu o limite de 500 nós ou 30 níveis.',
};

export function Component() {
  const data = useLoaderData<MapLoaderData>();
  if (data.kind === 'unavailable') return <MapUnavailablePage />;
  if (data.kind === 'deleted') return <DeletedMapPage record={data.record} storageError={data.storageError}/>;
  return <MapEditor key={`${data.access.userId}:${data.document.map.id}`} document={data.document} recovery={data.recovery} userId={data.access.userId} role={data.access.role} />;
}

function MapEditor({ document, userId, recovery, role }: { recovery: Recovery; document: Extract<MapLoaderData, { kind: 'ready' }>['document']; userId: string; role:'member'|'admin' }) {
  const { map } = document;
  const [detailsOpen,setDetailsOpen] = useState(false);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const [viewStore] = useState(() => createMapViewStore(userId, map.id, document.nodes));
  const view = useStore(viewStore);
  const restoredView = useRef(-1);
  const applyingView = useRef(true);
  useEffect(() => {
    void viewStore.getState().load();
    const flush = () => { void viewStore.getState().flush(); };
    window.document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
      viewStore.getState().dispose();
    };
  }, [viewStore]);
  const load = useEditorStore((state) => state.load);
  useEffect(() => { load(document, userId, recovery); }, [document, userId, recovery, load]);
  const ready = useEditorStore((state) => state.activeMapId === map.id);
  const confirmed = useEditorStore((state) => state.confirmed);
  const queue = useEditorStore((state) => state.queue);
  const nodes = useMemo(() => canvasNodes(confirmed, queue, userId), [confirmed, queue, userId]);
  const displayMap = useMemo(() => projectedMap(confirmed,queue) ?? map,[confirmed,queue,map]);
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId);
  const select = useEditorStore((state) => state.select);
  const status = useEditorStore((state) => state.status);
  const canUndo = useEditorStore((state) => state.undoStack.length > 0 || state.queue.length > 0 || state.draft !== null || state.inFlight || state.pendingHistory?.mode === 'undo');
  const canRedo = useEditorStore((state) => state.redoStack.length > 0 || state.pendingHistory?.mode === 'redo');
  const pendingHistoryMode = useEditorStore((state) => state.pendingHistory?.mode);
  const historyBusy = useEditorStore((state) => state.historyBusy || state.undoRequested !== null);
  const historyMessage = useEditorStore((state) => state.historyMessage);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const storageInitialized = useEditorStore((state) => state.storageInitialized);
  const unsaved = status !== 'saved' || historyBusy || pendingHistoryMode !== undefined || !storageInitialized;
  const revoked = useEditorStore((state) => state.revoked);
  const deleted = useEditorStore(state=>state.deleted);
  const deleteConfirmed = useEditorStore(state=>state.deleteConfirmed);
  const navigateAfterDelete=useNavigate();
  useEffect(()=>{
    if(!deleteConfirmed||status!=='saved')return;
    queryClient.removeQueries({queryKey:['map',userId,map.id]});
    void queryClient.invalidateQueries({queryKey:['maps',userId,map.workspaceId],refetchType:'none'});
    useEditorStore.getState().reset();void navigateAfterDelete('/mapas',{replace:true});
  },[deleteConfirmed,status,userId,map.id,map.workspaceId,navigateAfterDelete]);
  const expired = useEditorStore((state) => state.failure === 'UNAUTHENTICATED');
  const [navigationError, setNavigationError] = useState('');
  const [navigationBusy, setNavigationBusy] = useState(false);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if(useEditorStore.getState().deleted||useEditorStore.getState().deleteConfirmed)return false;
    if (useEditorStore.getState().failure === 'UNAUTHENTICATED' && nextLocation.pathname === '/login') return false;
    return hasPendingEdits() && currentLocation.pathname !== nextLocation.pathname;
  });
  useEffect(() => {
    if (blocker.state === 'blocked') {
      useEditorStore.getState().commitText();
      void useEditorStore.getState().flushLocal();
    }
  }, [blocker.state]);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      void useEditorStore.getState().flushLocal(); event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const flow = useRef<ReactFlowInstance<Node<MindNodeData>, Edge> | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [initialized, setInitialized] = useState(false);
  const [heights, setHeights] = useState<NodeHeights>({});
  const measure = useCallback((id: string, height: number) => {
    setHeights((current) => current[id] === height ? current : { ...current, [id]: height });
  }, []);
  useEffect(() => { if (ready) viewStore.getState().clean(nodes); }, [nodes, ready, viewStore]);
  const shown = useMemo(() => visibleNodes(nodes, view.collapsedIds), [nodes, view.collapsedIds]);
  const toggleCollapse = useCallback((id: string) => {
    const editor = useEditorStore.getState();
    if (editor.copyRequest || editor.historyBusy || editor.pendingHistory || editor.undoRequested || !editor.storageInitialized) return;
    if (editor.draft && !validNodeText(editor.draft.text)) { window.document.getElementById('node-text')?.focus(); return; }
    const collapsed = viewStore.getState().collapsedIds;
    if (!collapsed.includes(id) && editor.selectedNodeId && subtreeIds(editor.nodes, id).has(editor.selectedNodeId) && !editor.select(id)) return;
    viewStore.getState().setCollapsed(collapsed.includes(id) ? collapsed.filter((entry) => entry !== id) : [...collapsed, id]);
  }, [viewStore]);
  // Structural changes/history can put selection below an already collapsed ancestor.
  useEffect(() => {
    if (!selectedNodeId || shown.some((node) => node.id === selectedNodeId)) return;
    const editor = useEditorStore.getState();
    if (editor.draft && !validNodeText(editor.draft.text)) {
      viewStore.getState().setCollapsed(viewStore.getState().collapsedIds.filter((id) => !subtreeIds(nodes,id).has(selectedNodeId)));
      return;
    }
    const ancestor = visibleAncestor(nodes, shown, selectedNodeId);
    if (ancestor) select(ancestor);
  }, [nodes, shown, selectedNodeId, select, viewStore, historyBusy, status]);
  const focusedNode = useRef<string | null>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    // React Flow commits controlled nodes after its parent renders. Observe the
    // actual removal so focus restoration cannot run before that commit.
    const observer = new MutationObserver(() => {
      const id = focusedNode.current;
      if (!id || element.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)) return;
      const active = window.document.activeElement;
      if (active === window.document.body || (active instanceof HTMLElement && element.contains(active))) {
        const editor = useEditorStore.getState();
        const visible = visibleNodes(editor.nodes, viewStore.getState().collapsedIds);
        focusMapNode(editor.selectedNodeId && visible.some(node => node.id === editor.selectedNodeId) ? editor.selectedNodeId : visibleAncestor(editor.nodes, visible, id));
      }
      focusedNode.current = null;
    });
    observer.observe(element, {childList:true,subtree:true});
    return () => observer.disconnect();
  }, [ready, view.ready, viewStore]);
  const counts = useMemo(() => descendantCounts(nodes), [nodes]);
  const placed = useMemo(() => layoutMap(shown, heights), [shown, heights]);
  const baseFlowNodes = useMemo(() => placed.map(({ node, x, y }): Node<MindNodeData> => ({
    id: node.id, type: 'mind', position: { x, y }, width: NODE_WIDTH,
    draggable: false, connectable: false, selected: false,
    measured: heights[node.id] ? {width:NODE_WIDTH,height:heights[node.id]} : undefined,
    domAttributes: { 'aria-roledescription': 'nó do mapa', 'aria-keyshortcuts': 'Tab Enter F2 Delete Escape' },
    ariaLabel: node.text + (view.collapsedIds.includes(node.id) ? `, ${counts.get(node.id) ?? 0} descendentes ocultos` : ''),
    data: { text: node.text, root: node.parentId === null, selected: false, measure, toggle: toggleCollapse, hasChildren: (counts.get(node.id) ?? 0) > 0, hiddenCount: view.collapsedIds.includes(node.id) ? counts.get(node.id) ?? 0 : 0 },
  })), [placed, measure, counts, view.collapsedIds, toggleCollapse, heights]);
  // Preserve unchanged node/data objects when only selection changes. React Flow
  // can then skip the other 198/498 nodes, including their measured dimensions.
  const flowNodes = useMemo(() => baseFlowNodes.map(node => node.id === selectedNodeId
    ? { ...node, selected: true, data: { ...node.data, selected: true } }
    : node), [baseFlowNodes, selectedNodeId]);
  const edges = useMemo(() => shown.filter((node) => node.parentId).map((node): Edge => ({
    id: `${node.parentId}-${node.id}`, source: node.parentId!, target: node.id, type: 'smoothstep',
  })), [shown]);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!ready || !view.ready || !initialized || !shown.length || shown.some((node) => !heights[node.id])) return;
    const frame = requestAnimationFrame(() => {
      const instance = flow.current;
      if (!instance) return;
      if (restoredView.current !== view.restoreVersion) {
        applyingView.current = true;
        restoredView.current = view.restoreVersion;
        const saved = viewStore.getState().viewport;
        const restoration = saved ? instance.setViewport(saved) : instance.fitView(fitOptions);
        void restoration.then(() => {
          viewStore.getState().initializeViewport(instance.getViewport());
          applyingView.current = false;
        });
      }
      else if (selectedNodeId && !seen.current?.has(selectedNodeId) && canvas.current) {
        const child = placed.find(({ node }) => node.id === selectedNodeId);
        if (child) void instance.setViewport(revealNodeViewport(instance.getViewport(), {
          ...child, height: heights[selectedNodeId],
        }, { width: canvas.current.clientWidth, height: canvas.current.clientHeight }));
      }
      seen.current = new Set(nodes.map((node) => node.id));
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, view.ready, view.restoreVersion, initialized, nodes, shown, heights, placed, selectedNodeId, viewStore]);

  if (revoked) return <MapUnavailablePage />;
  if (deleted) return <DeletedMapPage record={useEditorStore.getState().snapshot()}/>;
  if (expired) return <Page title="Entre novamente" eyebrow="Sessão expirada"><p>Seu rascunho permanece isolado neste navegador. Entre na mesma conta para recuperar as alterações.</p><Link className="button" to={`/login?next=/mapas/${map.id}`}>Entrar novamente</Link></Page>;
  if (!ready || !view.ready) return <Page title={map.title} eyebrow="Mapa"><p className="loading" role="status">Abrindo o mapa…</p></Page>;
  return <Page title={displayMap.title} eyebrow="Mapa">
    <div className="editor-bar">
      <p className="editor-meta">Responsável: {displayMap.ownerName ?? 'Membro da equipe'} · <Link className="inline-link" to="/mapas">Seus mapas</Link></p>
      <div className="editor-history" role="group" aria-label="Histórico desta sessão">
        <button ref={detailsButton} className="button button-secondary" type="button" disabled={historyBusy || pendingHistoryMode!==undefined || status==='conflict' || !storageInitialized} onClick={()=>setDetailsOpen(true)}>Detalhes do mapa</button>
        <MapExport mapId={map.id} userId={userId}/>
        <button className="button button-secondary" type="button" disabled={!canUndo || historyBusy || pendingHistoryMode === 'redo' || status === 'conflict'} onClick={undo}>Desfazer</button>
        <button className="button button-secondary" type="button" disabled={!canRedo || historyBusy || pendingHistoryMode === 'undo' || status === 'conflict'} onClick={redo}>Refazer</button>
        {historyBusy && <span role="status" aria-live="polite">{pendingHistoryMode === 'redo' ? 'Refazendo…' : 'Desfazendo…'}</span>}
      </div>
      <SaveIndicator />
    </div>
    <div className="view-state" role="group" data-status={view.status} aria-label="Visualização pessoal">
      <p role="status">{view.status === 'error' ? `Não foi possível ${view.loadFailed ? 'carregar' : 'salvar'} sua visualização. A edição do conteúdo continua disponível.` : view.status === 'saved' ? 'Visualização pessoal salva' : 'Salvando visualização pessoal…'}</p>
      {view.status === 'error' && <button type="button" className="button button-secondary" onClick={() => void viewStore.getState().retry()}>Tentar salvar visualização novamente</button>}
    </div>
    {historyMessage && <p className="history-message" role="status" aria-live="polite">{historyMessage}</p>}
    {detailsOpen && <MapDetailsDialog map={displayMap} userId={userId} role={role} onClose={()=>setDetailsOpen(false)} onReturnFocus={()=>detailsButton.current?.focus()}/>}
    <RecoveryPanel />
    <DraftDialog open={blocker.state === 'blocked'} onClose={() => { blocker.reset?.(); setNavigationError(''); }} title="Há alterações pendentes" description="Sincronize antes de continuar ou preserve um rascunho local. Ele só será recuperado após verificar novamente sua conta e seu acesso.">
      {navigationError && <p className="form-error" role="alert">{navigationError}</p>}
      <button className="button" disabled={navigationBusy} onClick={async () => {
        setNavigationBusy(true);
        if (await synchronizeEditor()) blocker.proceed?.();
        else setNavigationError('Não foi possível sincronizar. Continue nesta tela ou preserve o rascunho.');
        setNavigationBusy(false);
      }}>Sincronizar e continuar</button>
      <button className="button button-secondary" disabled={navigationBusy} onClick={async () => {
        if (await useEditorStore.getState().flushLocal()) blocker.proceed?.();
        else setNavigationError('Não foi possível proteger o rascunho neste navegador. Exporte antes de continuar.');
      }}>Manter rascunho e continuar</button>
      <button className="button button-secondary" disabled={navigationBusy || !storageInitialized} onClick={() => {
        const record = useEditorStore.getState().snapshot();
        if (record) downloadEmergencyDraft(record);
        blocker.proceed?.();
      }}>Exportar rascunho e continuar</button>
    </DraftDialog>
    <div className="editor-workspace">
    <div className="canvas-help">
      <button className="button button-secondary" type="button" disabled={!selectedNodeId} onClick={() => { panelAction('focus'); }}>Ações do nó selecionado</button>
      <p className="field-help" id="canvas-keyboard-help">{nodeInstructions}</p>
    </div>
    <div ref={canvas} className="canvas" role="region" tabIndex={0} aria-label={`Mapa ${displayMap.title}`} aria-describedby="canvas-keyboard-help"
      onBlurCapture={event => {
        if (event.relatedTarget instanceof HTMLElement && !event.currentTarget.contains(event.relatedTarget)) focusedNode.current = null;
      }}
      onFocusCapture={event => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const wrapper = target.closest<HTMLElement>('.react-flow__node');
        focusedNode.current = wrapper?.dataset.id ?? null;
        if (target === wrapper && wrapper?.dataset.id && !select(wrapper.dataset.id)) window.document.getElementById('node-text')?.focus();
      }}
      onKeyDown={event => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || (target !== event.currentTarget && !target.matches('.react-flow__node')) || event.nativeEvent.isComposing) return;
        const current = nodes.find(node => node.id === (target.dataset.id ?? selectedNodeId)) ?? shown[0];
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
          event.preventDefault(); if (event.shiftKey) redo(); else undo(); return;
        }
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !current) return;
        const action = event.key === 'Tab' ? 'child' : event.key === 'Enter' ? current.parentId ? 'sibling' : 'child' : event.key === 'F2' ? 'edit' : event.key === 'Delete' ? 'delete' : event.key === 'Escape' ? 'close' : event.key === ' ' ? 'focus' : null;
        if (action) {
          if (action === 'delete' && !current.parentId) return;
          event.preventDefault(); if (event.repeat) return;
          if (!selectedNodeId) select(current.id);
          // Wait for the panel to render when the canvas itself has no selection.
          requestAnimationFrame(() => panelAction(action)); return;
        }
        const index = shown.findIndex(node => node.id === current.id);
        const next = event.key === 'ArrowLeft' ? shown.find(node => node.id === current.parentId)
          : event.key === 'ArrowRight' ? shown.filter(node => node.parentId === current.id).sort(siblingOrder)[0]
          : event.key === 'ArrowDown' ? shown[index + 1] : event.key === 'ArrowUp' ? shown[index - 1] : null;
        if (next) { event.preventDefault(); focusMapNode(next.id); }
      }}>
      <ReactFlow ariaLabelConfig={flowLabels} deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null} panActivationKeyCode={null} nodes={flowNodes} edges={edges} nodeTypes={nodeTypes} minZoom={0.001} maxZoom={2}
        onMoveEnd={(_, viewport) => { if (!applyingView.current) viewStore.getState().changeViewport(viewport); }}
        panOnDrag panOnScroll zoomOnScroll={false} zoomOnPinch zoomOnDoubleClick={false} selectionOnDrag={false}
        onInit={(instance) => { flow.current = instance; setInitialized(true); }} onNodeClick={(_, node) => {
          if (!select(node.id)) window.document.getElementById('node-text')?.focus();
          revealPanel();
        }}
        nodesDraggable={false} nodesConnectable={false} edgesFocusable={false} elementsSelectable={false}><CanvasControls /></ReactFlow>
    </div>
    <NodePanel collapsedIds={view.collapsedIds} toggleCollapse={toggleCollapse} />
    </div>
  </Page>;
}

function CanvasControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { zoom } = useViewport();
  return <Panel role="group" position="top-left" className="canvas-controls nopan nodrag nowheel" aria-label="Navegação do mapa">
    <button type="button" aria-label="Afastar" disabled={zoom <= 0.001001} onClick={() => void zoomOut()}>−</button>
    <output aria-label="Zoom">{zoom < 0.01 ? (zoom * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : Math.round(zoom * 100)}%</output>
    <button type="button" aria-label="Aproximar" disabled={zoom >= 1.999} onClick={() => void zoomIn()}>+</button>
    <button type="button" onClick={() => void fitView(fitOptions)}>Enquadrar</button>
  </Panel>;
}

// Below 768 px the panel follows the canvas: after a tap, scroll just enough to show it.
function revealPanel() {
  if (!window.matchMedia('(max-width: 767px)').matches) return;
  requestAnimationFrame(() => window.document.querySelector('.node-panel')?.scrollIntoView({ block: 'nearest' }));
}

function RecoveryPanel() {
  const recovered = useEditorStore((state) => state.recovered);
  const storageError = useEditorStore((state) => state.storageError);
  const initialized = useEditorStore((state) => state.storageInitialized);
  const conflict = useEditorStore((state) => state.status === 'conflict');
  const copyRequest = useEditorStore((state) => state.copyRequest);
  const copying = useEditorStore((state) => state.copying);
  const inFlight = useEditorStore((state) => state.inFlight);
  const invalid = useEditorStore((state) => state.nodes.some((node) => !validNodeText(node.text)));
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardBusy, setDiscardBusy] = useState(false);
  const [discardError, setDiscardError] = useState(false);
  const navigate = useNavigate();
  const copy = async () => {
    const id = await useEditorStore.getState().copyLocal();
    if (id) {
      await useEditorStore.getState().acknowledgeCopy();
      await navigate(`/mapas/${id}`);
    }
  };
  if (!recovered && !storageError && !conflict && !copyRequest) return null;
  return <aside className="draft-recovery" aria-label="Recuperação de alterações">
    {recovered && <p role="status">Rascunho recuperado deste navegador. Suas alterações locais foram mantidas; use Tentar novamente para sincronizar.</p>}
    {storageError && <div role="alert"><p>{initialized ? 'Não foi possível proteger o rascunho neste navegador. Suas alterações continuam nesta tela. Tente novamente ou exporte uma cópia de emergência antes de fechar.' : 'Não foi possível ler seus rascunhos neste navegador. A edição está pausada para preservá-los. Tente abrir os rascunhos novamente.'}</p>
      <button className="button button-secondary" onClick={() => void useEditorStore.getState().retryStorage()}>{initialized ? 'Tentar proteger rascunho' : 'Tentar abrir rascunhos'}</button>
      <button className="button button-secondary" disabled={!initialized} onClick={() => { const record = useEditorStore.getState().snapshot(); if (record) downloadEmergencyDraft(record); }}>Exportar rascunho de emergência</button>
    </div>}
    {(conflict || copyRequest) && <><h2>{conflict ? 'Duas versões foram preservadas' : 'Confirme a cópia da versão local'}</h2>
      <p>{copyRequest ? 'A solicitação de cópia foi guardada. A edição está pausada até confirmar essa mesma cópia; repetir a solicitação não cria outro mapa.' : 'Outra sessão salvou alterações primeiro. Sua versão continua nesta tela e não foi enviada por cima dela. Salve-a como um mapa novo ou abra a versão do servidor.'}</p>
      {invalid && <p className="form-error" role="alert">Corrija o texto inválido antes de criar a cópia.</p>}
      <div className="draft-dialog-actions">
        <button className="button" disabled={copying || inFlight || invalid} onClick={() => void copy()}>{copying ? 'Salvando cópia…' : copyRequest ? 'Tentar salvar a mesma cópia' : 'Salvar minha versão como cópia'}</button>
        <button className="button button-secondary" disabled={copying || inFlight} onClick={() => setDiscardOpen(true)}>Descartar alterações locais</button>
      </div></>}
    <DraftDialog open={discardOpen} onClose={() => setDiscardOpen(false)} title="Descartar suas alterações locais?" description="As alterações deste rascunho serão descartadas. A versão salva no servidor será carregada; outros mapas não serão excluídos.">
      {discardError && <p className="form-error" role="alert">Não foi possível abrir a versão salva. Suas alterações locais foram mantidas. Confira a conexão e tente novamente.</p>}
      <button className="button" disabled={discardBusy} onClick={async () => {
        setDiscardBusy(true); setDiscardError(false);
        if (await useEditorStore.getState().discard()) setDiscardOpen(false); else setDiscardError(true);
        setDiscardBusy(false);
      }}>Confirmar descarte e abrir versão salva</button>
    </DraftDialog>
  </aside>;
}

function SaveIndicator() {
  const status = useEditorStore((state) => state.status);
  const failure = useEditorStore((state) => state.failure);
  const retry = useEditorStore((state) => state.retry);
  const copying = useEditorStore((state) => state.copyRequest !== null);
  return <div className="save-state" data-status={status}>
    <p role="status" aria-live="polite"><span className="save-mark" aria-hidden="true">{status === 'saved' ? '✓' : status === 'error' || status === 'conflict' ? '!' : '…'}</span>{statusText[status]}</p>
    {status === 'error' && !copying && <div className="save-problem" role="alert"><p>{failureText[failure ?? 'UNAVAILABLE'] ?? failureText.UNAVAILABLE}</p>
      <button className="button button-secondary" type="button" onClick={retry}>Tentar novamente</button></div>}
    {status === 'conflict' && <div className="save-problem" role="alert"><p>Este mapa foi alterado em outra sessão. O salvamento foi pausado e suas alterações continuam nesta tela, sem sobrescrever a outra versão.</p></div>}
  </div>;
}

function NodePanel({ collapsedIds, toggleCollapse }: { collapsedIds: string[]; toggleCollapse: (id: string) => void }) {
  const currentNodes = useEditorStore((state) => state.nodes);
  const node = useEditorStore((state) => state.nodes.find((entry) => entry.id === state.selectedNodeId));
  const people = useEditorStore((state) => state.confirmed?.people);
  const userId = useEditorStore((state) => state.userId);
  const addChild = useEditorStore((state) => state.addChild);
  const draft = useEditorStore((state) => state.draft);
  const typeText = useEditorStore((state) => state.typeText);
  const commitText = useEditorStore((state) => state.commitText);
  const reorderSibling = useEditorStore((state) => state.reorderSibling);
  const [moveOpen, setMoveOpen] = useState(false);
  const moveButton = useRef<HTMLButtonElement>(null);
  const deleteSubtree = useEditorStore((state) => state.deleteSubtree);
  const frozen = useEditorStore((state) => state.copyRequest !== null || state.historyBusy || state.pendingHistory !== null || state.undoRequested !== null || !state.storageInitialized);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ nodeId: string; descendants: number } | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const selectNode = useEditorStore(state => state.select);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      panel.current?.style.setProperty('--editor-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
      if (window.document.activeElement === field.current) panel.current?.scrollIntoView({ block: 'nearest' });
    };
    resize();
    viewport?.addEventListener('resize', resize);
    return () => viewport?.removeEventListener('resize', resize);
  }, []);
  const editing = node !== undefined && (editingId === node.id || draft?.nodeId === node.id);
  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);

  if (!node) return <aside className="node-panel" aria-label="Nó selecionado"><p className="support-copy">Toque em um nó para ver as ações.</p></aside>;
  const name = (id: string) => id === userId ? 'você' : people?.[id] ?? 'Membro da equipe';
  const text = draft?.nodeId === node.id ? draft.text : node.text;
  const invalid = !validNodeText(text);
  const parents = new Map(currentNodes.map((entry) => [entry.id, entry.parentId]));
  const descendantCount = currentNodes.filter((candidate) => {
    let parentId = candidate.parentId;
    while (parentId) {
      if (parentId === node.id) return true;
      parentId = parents.get(parentId) ?? null;
    }
    return false;
  }).length;
  const siblings = currentNodes.filter((entry) => entry.parentId === node.parentId).sort(siblingOrder);
  const siblingIndex = siblings.findIndex((entry) => entry.id === node.id);
  const finish = () => { commitText(); if (!invalid) { setEditingId(null); requestAnimationFrame(() => editButton.current?.focus()); } };
  const close = () => {
    if (invalid) { field.current?.focus(); return; }
    finish(); if (selectNode(null)) focusMapNode(null);
  };
  const remove = () => { if (deleteSubtree(node.id) !== null) focusMapNode(node.parentId); };
  const add = (parent: string) => { if (collapsedIds.includes(parent)) toggleCollapse(parent); const id = addChild(parent); setEditingId(id); };
  return <aside ref={panel} aria-disabled={frozen} className="node-panel" aria-label="Nó selecionado" onKeyDown={event => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.closest('[role="dialog"]'))) return;
    event.preventDefault(); close();
  }}>
    <div className="node-panel-content">
    <span className="section-number">{node.parentId === null ? 'Nó central' : 'Nó selecionado'}</span>
    {editing ? <div className="node-edit">
      <label htmlFor="node-text">Texto do nó</label>
      <textarea id="node-text" ref={field} disabled={frozen} value={text} rows={4} aria-invalid={invalid} aria-describedby="node-text-help"
        onChange={(event) => typeText(node.id, event.target.value)} onBlur={commitText}
        onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); finish(); } }} />
      <p id="node-text-help" className={invalid ? 'form-error' : 'field-help'} role={invalid ? 'alert' : undefined}>
        {invalid ? `O texto precisa ter entre 1 e ${NODE_TEXT_MAX} caracteres e não pode ficar em branco. O que você digitou continua aqui. Corrija o texto para trocar de nó ou adicionar um filho. ` : ''}{text.length}/{NODE_TEXT_MAX}
      </p>
    </div> : <p className="node-text">{node.text}</p>}
    <p className="node-authors">{node.source==='ai'?`Gerado com IA por ${name(node.createdBy)}`:`Criado por ${name(node.createdBy)}`} · Última edição por {name(node.updatedBy)}</p>
    <AIGenerationControls nodeId={node.id}/>
    </div>
    <div className="node-actions">
      {descendantCount > 0 && <button className="button button-secondary" type="button" disabled={invalid || frozen}
        aria-expanded={!collapsedIds.includes(node.id)} onClick={() => toggleCollapse(node.id)}>
        {collapsedIds.includes(node.id) ? `Expandir ramo (${descendantCount} ocultos)` : `Recolher ramo (${descendantCount})`}
      </button>}
      {editing
        // Commit on click: a blur-triggered save can resize the bar and move this
        // button between pointerdown and pointerup, swallowing the click.
        ? <button className="button" type="button" onPointerDown={event=>event.preventDefault()} onTouchEnd={event=>{event.preventDefault();finish();}} onClick={finish} disabled={invalid || frozen}>Concluir edição</button>
        : <button ref={editButton} data-node-action="edit" className="button button-secondary" type="button" disabled={frozen} onClick={() => setEditingId(node.id)}>Editar texto</button>}
      <button data-node-action="child" className={editing ? 'button button-secondary' : 'button'} type="button" disabled={invalid || frozen}
        aria-describedby={invalid ? 'node-text-help' : undefined}
        onClick={() => add(node.id)}>Adicionar filho</button>
      {node.parentId !== null && <button data-node-action="sibling" className="button button-secondary" type="button" disabled={invalid || frozen} onClick={() => add(node.parentId!)}>Adicionar irmão</button>}
      {node.parentId !== null && <button data-node-action="delete" className="button button-secondary" type="button" disabled={invalid || frozen}
        onClick={() => {
          if (descendantCount > 0) setDeleteConfirmation({ nodeId: node.id, descendants: descendantCount });
          else remove();
        }}>{descendantCount > 0 ? 'Excluir ramo' : 'Excluir nó'}</button>}
      {node.parentId !== null && <>
        <button ref={moveButton} className="button button-secondary" type="button" disabled={invalid || frozen} onClick={() => { finish(); setMoveOpen(true); }}>Mover</button>
        <button className="button button-secondary" type="button" disabled={invalid || frozen || siblingIndex === 0} onClick={() => reorderSibling(node.id, siblingIndex - 1)}>Subir</button>
        <button className="button button-secondary" type="button" disabled={invalid || frozen || siblingIndex === siblings.length - 1} onClick={() => reorderSibling(node.id, siblingIndex + 1)}>Descer</button>
        <p className="sibling-position" role="status">Posição {siblingIndex + 1} de {siblings.length} entre irmãos</p>
      </>}
      <button data-node-action="close" className="button button-secondary" type="button" disabled={frozen} onClick={close}>Fechar ações do nó</button>
    </div>
    {moveOpen && <MoveDialog node={node} nodes={currentNodes} onClose={() => setMoveOpen(false)} onReturnFocus={() => moveButton.current?.focus()} />}
    <DraftDialog open={deleteConfirmation !== null} onClose={() => setDeleteConfirmation(null)} onReturnFocus={() => {
      const target = useEditorStore.getState().selectedNodeId; focusMapNode(target);
    }}
      title="Excluir este ramo?"
      description={`Este ramo contém ${deleteConfirmation?.descendants ?? 0} descendente${deleteConfirmation?.descendants === 1 ? '' : 's'}. O ramo inteiro será removido do mapa.`}>
      <div className="draft-dialog-actions">
        <button className="button" type="button" onClick={() => {
          const target = deleteConfirmation;
          setDeleteConfirmation(null);
          if (target) { deleteSubtree(target.nodeId); focusMapNode(node.parentId); }
        }}>Confirmar exclusão</button>
        <button className="button button-secondary" type="button" onClick={() => setDeleteConfirmation(null)}>Cancelar</button>
      </div>
    </DraftDialog>
  </aside>;
}

function MoveDialog({ node, nodes, onClose, onReturnFocus }: { node: MapNode; nodes: MapNode[]; onClose: () => void; onReturnFocus: () => void }) {
  const [search, setSearch] = useState('');
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState('');
  const move = useEditorStore((state) => state.moveSubtree);
  const actor = useEditorStore((state) => state.userId) ?? '';
  const frozen = useEditorStore((state) => state.historyBusy || state.pendingHistory !== null || state.undoRequested !== null || state.status === 'conflict' || state.copyRequest !== null);
  const excluded = subtreeIds(nodes, node.id);
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  const path = (candidate: MapNode) => {
    const names: string[] = [];
    let current = candidate.parentId ? byId.get(candidate.parentId) : undefined;
    while (current) { names.unshift(current.text); current = current.parentId ? byId.get(current.parentId) : undefined; }
    return names.join(' / ') || 'Nó central';
  };
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const candidates = nodes.filter((entry) => !excluded.has(entry.id) && entry.id !== node.parentId)
    .map((entry) => ({ ...entry, path: path(entry) }))
    .filter((entry) => normalize(`${entry.text} ${entry.path}`).includes(normalize(search)));
  return <DraftDialog open onClose={onClose} onReturnFocus={onReturnFocus} closeLabel="Cancelar" title="Mover ramo" description="Escolha o novo pai. O ramo inteiro será inserido como último filho, mantendo os descendentes.">
    <div className="move-form">
      <label htmlFor="move-search">Buscar novo pai</label>
      <input id="move-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      <fieldset className="move-parents"><legend>Novo pai</legend>
        {candidates.map((entry) => {
          const tooDeep = !reorganize(nodes, node.id, entry.id, nodes.filter((n) => n.parentId === entry.id).length, actor);
          return <label className="move-parent" key={entry.id}>
            <input type="radio" name="move-parent" value={entry.id} checked={parentId === entry.id} disabled={tooDeep || frozen} onChange={() => { setParentId(entry.id); setError(''); }} />
            <span><strong>{entry.text}</strong><small>{entry.path}{tooDeep ? ' — excede 30 níveis' : ''}</small></span>
          </label>;
        })}
        {candidates.length === 0 && <p>Nenhum pai disponível para esta busca.</p>}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button" type="button" disabled={!parentId || frozen} onClick={() => {
        if (move(node.id, parentId)) onClose(); else setError('Não foi possível mover para este pai. Verifique o limite de 30 níveis e as alterações pendentes.');
      }}>Mover para este pai</button>
    </div>
  </DraftDialog>;
}
