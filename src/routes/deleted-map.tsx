import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Page } from './pages';
import { applyMapCommand, getMapDocument, MapError } from '../maps/api';
import { clearMapDrafts, downloadEmergencyDraft, type DraftRecord } from '../maps/drafts';
import { useEditorStore } from '../state/editor';
import { queryClient } from '../app/query-client';

export function DeletedMapPage({
  record,
  storageError = false,
}: {
  record: DraftRecord | null;
  storageError?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const navigate = useNavigate();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const deletion = record?.queue.find(
    (operation) =>
      operation.kind === 'delete_map' &&
      operation.sent &&
      operation.expectedRevision !== undefined &&
      operation.editorSessionId,
  );
  const local = record && (record.queue.length > 0 || record.draft || record.pendingHistory || record.copyRequest);
  const exportLocal = async () => {
    if (!record) return;
    setBusy(true);
    setError('');
    try {
      try {
        await getMapDocument(record.mapId, AbortSignal.timeout(20_000));
      } catch (reason) {
        if (!(reason instanceof MapError && reason.deleted)) throw reason;
      }
      if (alive.current) downloadEmergencyDraft(record);
    } catch (reason) {
      if (!alive.current) return;
      if (
        reason instanceof MapError &&
        !reason.deleted &&
        (reason.code === 'NOT_FOUND' || reason.code === 'FORBIDDEN')
      ) {
        useEditorStore.getState().revoke();
        await clearMapDrafts(record);
        await navigate('/mapas', { replace: true });
      } else
        setError(
          'Não foi possível verificar seu acesso à equipe. O arquivo não foi exportado. Entre novamente ou tente outra vez.',
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Page title="Mapa indisponível" eyebrow="Mapa excluído">
      <div className="access-panel">
        <h2>Este mapa foi excluído</h2>
        <p>Ele saiu da biblioteca e não aceita novas edições. Não há restauração nesta versão.</p>
        {local && (
          <>
            <p>
              Seu rascunho local permanece neste navegador enquanto você tiver acesso à equipe. Você pode exportá-lo
              como arquivo de emergência.
            </p>
            <button className="button button-secondary" disabled={busy} onClick={() => void exportLocal()}>
              Exportar rascunho local
            </button>
          </>
        )}
        {storageError && (
          <p role="alert">
            Não foi possível ler todos os rascunhos deste navegador. Os registros existentes foram mantidos; recarregue
            para tentar novamente.
          </p>
        )}
        {deletion && record && (
          <>
            <p>
              Há uma exclusão sua aguardando confirmação neste navegador. A nova tentativa apenas confirma a mesma
              solicitação.
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError('');
                void applyMapCommand(
                  {
                    kind: 'delete_map',
                    payload: {},
                    mapId: record.mapId,
                    operationId: deletion.operationId,
                    expectedRevision: deletion.expectedRevision!,
                    editorSessionId: deletion.editorSessionId,
                  },
                  AbortSignal.timeout(20_000),
                )
                  .then(async () => {
                    if (!alive.current) return;
                    await clearMapDrafts(record);
                    if (!alive.current) return;
                    useEditorStore.getState().reset();
                    queryClient.removeQueries({ queryKey: ['map', record.userId, record.mapId] });
                    await queryClient.invalidateQueries({
                      queryKey: ['maps', record.userId, record.workspaceId],
                      refetchType: 'none',
                    });
                    if (alive.current) await navigate('/mapas', { replace: true });
                  })
                  .catch(async (reason: unknown) => {
                    if (!alive.current) return;
                    if (
                      reason instanceof MapError &&
                      !reason.deleted &&
                      (reason.code === 'NOT_FOUND' || reason.code === 'FORBIDDEN')
                    ) {
                      useEditorStore.getState().revoke();
                      await clearMapDrafts(record);
                      await navigate('/mapas', { replace: true });
                      return;
                    }
                    setError('Não foi possível confirmar a exclusão. Sua solicitação permanece guardada.');
                  })
                  .finally(() => {
                    if (alive.current) setBusy(false);
                  });
              }}
            >
              {busy ? 'Confirmando…' : 'Confirmar exclusão pendente'}
            </button>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Link className="button button-secondary" to="/mapas">
          Voltar para mapas
        </Link>
      </div>
    </Page>
  );
}
