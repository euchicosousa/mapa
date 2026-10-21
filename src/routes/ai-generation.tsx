import { AI_GUIDANCE_MAX } from '../maps/limits';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  aiAvailable,
  aiErrorText,
  AIError,
  cancelAI,
  getAI,
  startAI,
  type AIGeneration,
  type AIRequest,
  type AIAvailability,
} from '../maps/ai';
import { acceptGeneration, watchGeneration } from '../maps/ai-polling';
import { editorSessionId, MapError } from '../maps/api';
import { useEditorStore } from '../state/editor';

export function AIGenerationControls({ nodeId }: { nodeId: string }) {
  const mapId = useEditorStore((state) => state.activeMapId);
  const status = useEditorStore((state) => state.status);
  const frozen = useEditorStore(
    (state) =>
      state.copyRequest !== null ||
      state.historyBusy ||
      state.pendingHistory !== null ||
      !state.storageInitialized ||
      state.revoked ||
      state.deleted,
  );
  const redoStack = useEditorStore((state) => state.redoStack);
  const undoTop = useEditorStore((state) => state.undoStack.at(-1)?.operationId);
  const [availability, setAvailability] = useState<AIAvailability | null>(null),
    [guidance, setGuidance] = useState(''),
    [job, setJob] = useState<AIGeneration | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [unknown, setUnknown] = useState(false);
  const [cancelling, setCancelling] = useState(false),
    [cancelAttempt, setCancelAttempt] = useState<string | null>(null);
  const [cancelUnknown, setCancelUnknown] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const enabled = availability?.enabled === true;
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(0), Math.max(0, cooldown - Date.now()));
    return () => clearTimeout(timer);
  }, [cooldown]);
  const request = useRef<AIRequest | null>(null),
    inFlight = useRef(false),
    cancelFlight = useRef(false),
    mounted = useRef(true),
    handled = useRef<string | null>(null);
  const latest = useRef<AIGeneration | null>(null),
    watcher = useRef<ReturnType<typeof watchGeneration> | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    void aiAvailable().then((value) => {
      if (active) setAvailability(value);
    });
    return () => {
      active = false;
    };
  }, []);
  const failure = useCallback(
    (error: unknown) => {
      const editor = useEditorStore.getState();
      if (editor.activeMapId !== mapId) return false;
      if (error instanceof MapError) {
        if (error.deleted) {
          editor.markDeleted();
          return false;
        }
        if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') {
          editor.revoke();
          return false;
        }
        if (error.code === 'UNAUTHENTICATED') {
          useEditorStore.setState({ failure: error.code, status: 'error' });
          return false;
        }
      }
      return true;
    },
    [mapId],
  );
  const receive = useCallback(
    (incoming: AIGeneration) => {
      if (incoming.mapId !== mapId || (request.current && request.current.generationId !== incoming.id)) return false;
      const current = acceptGeneration(latest.current, incoming);
      latest.current = current;
      setJob(current);
      let waiting = false;
      if (current.state === 'applied' && current.result && handled.current !== current.id) {
        const result = useEditorStore
          .getState()
          .integrateAI({ mapId: current.mapId, editorSessionId: current.editorSessionId, result: current.result });
        waiting = result === 'wait';
        if (!waiting) handled.current = current.id;
      }
      const active = ['pending', 'running'].includes(current.state);
      if (!active) {
        setBusy(false);
        setUnknown(false);
        setCancelUnknown(false);
        setMessage('');
        request.current = null;
      }
      return active || waiting;
    },
    [mapId],
  );
  useEffect(() => {
    if (!mapId) return;
    const active = watchGeneration({
      read: () => getAI(mapId, request.current?.generationId ?? latest.current?.id ?? null),
      receive,
      pending: () => request.current !== null,
      failure,
    });
    watcher.current = active;
    return () => {
      active.dispose();
      watcher.current = null;
    };
  }, [mapId, receive, failure]);
  const submit = async () => {
    if (inFlight.current || !mapId || !enabled || cooldown > Date.now()) return;
    const editor = useEditorStore.getState();
    editor.commitText();
    if (editor.draft || useEditorStore.getState().status !== 'saved') {
      setMessage('Aguarde salvar o texto do nó antes de pedir IA.');
      return;
    }
    if (!navigator.onLine) {
      setMessage('Conecte-se à internet para gerar caminhos com IA.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    setUnknown(false);
    setCancelAttempt(null);
    setCancelUnknown(false);
    if (!request.current) {
      latest.current = null;
      setJob(null);
    }
    request.current ??= { mapId, parentNodeId: nodeId, generationId: crypto.randomUUID(), editorSessionId, guidance };
    // Poll even if the start response is lost. Queries never repeat a paid call.
    watcher.current?.refresh();
    try {
      const next = await startAI(request.current);
      if (mounted.current) {
        receive(next);
        watcher.current?.refresh();
      }
    } catch (error) {
      if (!mounted.current) return;
      // A successful poll may already have confirmed a terminal result.
      if (latest.current && !['pending', 'running'].includes(latest.current.state)) return;
      const code = error instanceof AIError ? error.code : 'AI_UNAVAILABLE';
      if (error instanceof AIError && error.retryAfter) setCooldown(Date.now() + error.retryAfter * 1000);
      setMessage(aiErrorText[code] ?? 'Não foi possível iniciar a geração. Confira o mapa e tente novamente.');
      if (code === 'AI_UNAVAILABLE') setUnknown(true);
      else request.current = null;
      setBusy(false);
      watcher.current?.refresh();
    } finally {
      inFlight.current = false;
    }
  };
  const cancel = async () => {
    const id = request.current?.generationId ?? latest.current?.id;
    if (!mapId || !id || cancelFlight.current) return;
    cancelFlight.current = true;
    setCancelling(true);
    setMessage('');
    setCancelAttempt(id);
    try {
      const result = await cancelAI(mapId, id);
      if (mounted.current) {
        receive(result);
        setCancelUnknown(false);
        watcher.current?.refresh();
      }
    } catch (error) {
      if (!failure(error)) return;
      if (mounted.current) {
        const terminal = latest.current && !['pending', 'running'].includes(latest.current.state);
        setCancelUnknown(!terminal);
        setMessage(
          terminal
            ? ''
            : 'Não foi possível confirmar o cancelamento. Consulte o resultado ou tente cancelar a mesma geração novamente.',
        );
        watcher.current?.refresh();
      }
    } finally {
      cancelFlight.current = false;
      if (mounted.current) setCancelling(false);
    }
  };
  if (!availability) return null;
  if (!enabled && !job && !busy)
    return (
      <section className="ai-generation" aria-label="Geração com IA">
        <p role="status">{aiErrorText[availability.code ?? 'AI_UNAVAILABLE'] ?? aiErrorText.AI_UNAVAILABLE}</p>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void aiAvailable().then(setAvailability)}
        >
          Consultar disponibilidade da IA
        </button>
      </section>
    );
  const running = busy || job?.state === 'pending' || job?.state === 'running';
  const failed = job && ['failed', 'stale'].includes(job.state);
  const appliedBeforeCancel = job?.state === 'applied' && cancelAttempt === job.id;
  const undone = job?.result && redoStack.some((entry) => entry.operationId === job.result?.operationId);
  const canUndo =
    job?.result?.operationId === undoTop && job?.editorSessionId === editorSessionId && status === 'saved' && !frozen;
  return (
    <section className="ai-generation" aria-label="Geração com IA">
      <label htmlFor="ai-guidance">Orientação para a IA (opcional)</label>
      <textarea
        id="ai-guidance"
        rows={2}
        value={guidance}
        disabled={running || unknown || cancelling || cancelUnknown}
        onChange={(event) => setGuidance(event.target.value)}
        aria-describedby="ai-guidance-help"
      />
      <p className="field-help" id="ai-guidance-help">
        {guidance.length}/1.000 caracteres · Serão inseridos quatro filhos.
      </p>
      <button
        className="button button-secondary"
        type="button"
        disabled={
          !enabled ||
          cooldown > 0 ||
          running ||
          frozen ||
          cancelling ||
          cancelUnknown ||
          status !== 'saved' ||
          guidance.length > AI_GUIDANCE_MAX
        }
        onClick={() => void submit()}
      >
        {running ? 'Gerando caminhos…' : unknown ? 'Consultar a mesma solicitação' : 'Gerar caminhos com IA'}
      </button>
      {(running || unknown || cancelUnknown) && (
        <button className="button button-secondary" type="button" disabled={cancelling} onClick={() => void cancel()}>
          {cancelling
            ? 'Confirmando cancelamento…'
            : cancelUnknown
              ? 'Tentar cancelar a mesma geração'
              : 'Cancelar geração'}
        </button>
      )}
      <p role="status" aria-live="polite">
        {job?.state === 'cancelled'
          ? 'Geração cancelada. Nenhum filho foi inserido.'
          : appliedBeforeCancel && undone
            ? 'A geração foi desfeita nesta sessão. Refazer continua disponível no histórico.'
            : appliedBeforeCancel
              ? 'A geração já foi aplicada antes do cancelamento. Os quatro caminhos permanecem no mapa.'
              : running
                ? 'A IA está gerando quatro caminhos. Você pode continuar editando.'
                : job?.state === 'applied'
                  ? 'Quatro caminhos gerados com IA e salvos no mapa.'
                  : failed
                    ? (aiErrorText[job.errorCode ?? 'PROVIDER_FAILED'] ?? 'A geração terminou sem inserir filhos.')
                    : ''}
      </p>
      {appliedBeforeCancel && !undone && (
        <>
          <button
            className="button button-secondary"
            type="button"
            disabled={!canUndo}
            onClick={() => useEditorStore.getState().undo()}
          >
            Desfazer geração
          </button>
          {!canUndo && (
            <p className="field-help">
              Use Desfazer na ordem do histórico. Alterações posteriores e rascunhos são preservados.
            </p>
          )}
        </>
      )}
      {running && (
        <p className="field-help">
          Fechar a página não cancela a geração. Cancelar pode não evitar uma cobrança já iniciada.
        </p>
      )}
      {cooldown > 0 && (
        <p className="field-help">
          Nova tentativa disponível após {new Date(cooldown).toLocaleTimeString('pt-BR')}. A geração só começa quando
          você pedir.
        </p>
      )}
      {message && (
        <p role="alert" className="form-error">
          {message}
        </p>
      )}
    </section>
  );
}
