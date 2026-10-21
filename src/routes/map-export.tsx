import { useEffect, useRef, useState } from 'react';
import { createPortableBackup, downloadPortableBackup } from '../maps/backup';
import { getMapDocument, MapError } from '../maps/api';
import { projectedMap, useEditorStore } from '../state/editor';
import { hasPendingEdits } from '../state/editor-lifecycle';
import { DraftDialog } from './draft-dialog';

export function MapExport({ mapId, userId }: { mapId: string; userId: string }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState('');
  const opener = useRef<HTMLButtonElement>(null), alive = useRef(true), running = useRef(false);
  const pending = useEditorStore(s => s.status !== 'saved' || s.draft !== null || s.queue.length > 0 || s.historyBusy || s.pendingHistory !== null || s.needsHeadCheck || !s.storageInitialized);
  const unavailable = useEditorStore(s => s.deleted || s.deleteConfirmed || s.revoked || s.queue.some(operation => operation.kind === 'delete_map'));
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function download() {
    if (running.current) return;
    const state = useEditorStore.getState(), map = projectedMap(state.confirmed, state.queue);
    if (!map || state.activeMapId !== mapId || state.userId !== userId || unavailable) return;
    running.current = true; setBusy(true); setError(''); setResult('');
    try {
      const file = createPortableBackup({ title: map.title, nodes: state.nodes }, hasPendingEdits() || state.status !== 'saved');
      await getMapDocument(mapId, AbortSignal.timeout(20_000));
      const current = useEditorStore.getState();
      if (!alive.current || current.activeMapId !== mapId || current.userId !== userId || current.revoked || current.deleted || current.deleteConfirmed) return;
      downloadPortableBackup(file);
      setResult(file.backup.hasPendingChanges ? 'Backup gerado com alterações locais pendentes. Ele não confirma o salvamento no servidor.' : 'Backup gerado. A revisão do mapa não foi alterada pela exportação.');
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof MapError) {
        setError('Não foi possível confirmar o acesso ao mapa. O arquivo não foi exportado. Confira sua conexão e seu acesso e tente novamente.');
        if (cause.deleted) useEditorStore.getState().markDeleted();
        else if (cause.code === 'NOT_FOUND' || cause.code === 'FORBIDDEN') useEditorStore.getState().revoke();
      } else setError(cause instanceof Error ? cause.message : 'Não foi possível gerar o backup. Tente novamente.');
    } finally { running.current = false; if (alive.current) setBusy(false); }
  }
  return <>
    <button ref={opener} className="button button-secondary" type="button" disabled={unavailable} onClick={() => { setOpen(true); setError(''); setResult(''); }}>Exportar backup</button>
    <DraftDialog open={open} busy={busy} onClose={() => setOpen(false)} onReturnFocus={() => opener.current?.focus()} closeLabel="Fechar exportação" title="Exportar backup" description="Baixe um arquivo JSON com o título, todos os nós e seus textos, incluindo ramos recolhidos. Dados de acesso, equipe e autoria ficam fora do arquivo.">
      <div className="map-details">
        <p role="status">{pending ? 'Há alterações locais pendentes. Elas serão incluídas no backup e indicadas no arquivo.' : 'O documento local está salvo. A exportação não muda a revisão do mapa.'}</p>
        <p>O arquivo retrata o documento local no momento em que você pede o download. O acesso é confirmado antes de baixar.</p>
        <button className="button" disabled={busy || unavailable} onClick={() => void download()}>{busy ? 'Preparando backup…' : 'Baixar backup JSON'}</button>
        {error && <p role="alert" className="form-error">{error}</p>}
        {result && <p role="status">{result}</p>}
      </div>
    </DraftDialog>
  </>;
}
