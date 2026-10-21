import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { duplicateMap, MapError, mapId, type MapDocument } from '../maps/api';
import { hasPendingEdits } from '../state/editor-lifecycle';
import { useEditorStore } from '../state/editor';
import { DraftDialog } from './draft-dialog';

export function MapDuplication({ map, userId }: { map: MapDocument['map']; userId: string }) {
  const key = `mapa.duplicate.v1:${userId}:${map.workspaceId}:${map.id}`;
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [pending, setPending] = useState(() => {
    try { return mapId.safeParse(sessionStorage.getItem(key)).success; } catch { return false; }
  });
  const opener = useRef<HTMLButtonElement>(null), running = useRef(false), alive = useRef(true);
  const navigate = useNavigate(), queries = useQueryClient();
  const blocked = useEditorStore(s => s.deleted || s.deleteConfirmed || s.status !== 'saved' || s.inFlight || s.historyBusy || s.pendingHistory !== null || s.undoRequested !== null || s.copyRequest !== null || s.draft !== null || !s.storageInitialized);
  // Only an operation identifier is stored, scoped to this tab, account and map.
  // Retrying after an ambiguous response or a reload must reuse the same request.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function duplicate() {
    if (running.current || blocked || hasPendingEdits()) return;
    running.current = true; setBusy(true); setError('');
    let retained = false;
    try {
      const stored = sessionStorage.getItem(key);
      const operationId = mapId.safeParse(stored).success && stored ? stored : crypto.randomUUID();
      // Fail before contacting the server if a safe retry cannot be retained.
      sessionStorage.setItem(key, operationId);
      retained = true; setPending(true);
      const copy = await duplicateMap(map.id, operationId);
      if (!alive.current || useEditorStore.getState().userId !== userId || useEditorStore.getState().activeMapId !== map.id) return;
      await queries.invalidateQueries({ queryKey: ['maps', userId, map.workspaceId], refetchType: 'none' });
      if (alive.current) {
        await navigate(`/mapas/${copy.mapId}`);
        sessionStorage.removeItem(key);
      }
    } catch (cause) {
      if (!alive.current) return;
      setError(!retained ? 'Não foi possível guardar a solicitação neste navegador. Libere o armazenamento e tente novamente.'
        : cause instanceof MapError && ['NOT_FOUND', 'FORBIDDEN', 'UNAUTHENTICATED'].includes(cause.code)
        ? 'O mapa não está disponível para duplicação. Confira seu acesso e tente novamente.'
        : 'Não foi possível confirmar a cópia. Tente novamente; a mesma solicitação será repetida.');
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return <section className="map-owner" aria-label="Duplicação do mapa">
    <h3>Duplicar mapa</h3>
    <p>Crie uma cópia independente, com você como responsável e no mesmo projeto.</p>
    <button ref={opener} className="button button-secondary" disabled={blocked} onClick={() => setOpen(true)}>Duplicar mapa</button>
    {blocked && <p className="field-help">Conclua o salvamento e resolva as alterações pendentes para duplicar.</p>}
    <DraftDialog open={open} busy={busy} onClose={() => setOpen(false)} onReturnFocus={() => opener.current?.focus()} closeLabel="Voltar ao original" title="Duplicar este mapa?" description="A cópia usa a última versão salva no servidor. Textos, estrutura e projeto serão mantidos. Histórico e preferências de visualização começam vazios.">
      <p className="map-copy-summary"><strong>{map.title}</strong></p>
      {pending && <p role="status">Há uma cópia aguardando confirmação. A nova tentativa retoma a primeira solicitação, mesmo que o original tenha mudado depois.</p>}
      <button className="button" disabled={busy || blocked} onClick={() => void duplicate()}>{busy ? 'Duplicando…' : pending ? 'Tentar confirmar cópia' : 'Confirmar duplicação'}</button>
      {busy && <p role="status">Criando a cópia. Aguarde a confirmação para abrir o novo mapa.</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
    </DraftDialog>
  </section>;
}
