import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { DraftDialog } from './draft-dialog';
import { readPortableBackup, type PortableBackup } from '../maps/backup';
import { importMapBackup, mapId, MapError } from '../maps/api';

type Attempt = { backup: PortableBackup; operationId: string };
export function MapImport({ userId, workspaceId }: { userId: string; workspaceId: string }) {
  const [open, setOpen] = useState(false),
    [reading, setReading] = useState(false),
    [busy, setBusy] = useState(false);
  const [backup, setBackup] = useState<PortableBackup | null>(null),
    [attempt, setAttempt] = useState<Attempt | null>(null),
    [error, setError] = useState('');
  const opener = useRef<HTMLButtonElement>(null),
    alive = useRef(true),
    running = useRef(false),
    selection = useRef(0);
  const navigate = useNavigate(),
    queries = useQueryClient(),
    key = `mapa.import.v1:${userId}:${workspaceId}`;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function select(file: File | undefined) {
    const generation = ++selection.current;
    setBackup(null);
    setAttempt(null);
    setError('');
    if (!file) return;
    setReading(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const parsed = await Promise.race([
        readPortableBackup(file),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('A leitura demorou demais. Selecione o arquivo novamente.')),
            10_000,
          );
        }),
      ]);
      if (alive.current && selection.current === generation) setBackup(parsed);
    } catch (cause) {
      if (alive.current && selection.current === generation)
        setError(cause instanceof Error ? cause.message : 'Não foi possível ler o backup.');
    } finally {
      clearTimeout(timer);
      if (alive.current && selection.current === generation) setReading(false);
    }
  }
  async function confirm() {
    if (!backup || reading || running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      let request = attempt;
      if (!request) {
        // Store identifiers only, never the imported document. Reselecting the same
        // canonical file after reload safely confirms an ambiguous first response.
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(backup)));
        if (!alive.current) return;
        const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        const raw = sessionStorage.getItem(key);
        let stored: unknown = null;
        try {
          stored = raw ? JSON.parse(raw) : null;
        } catch {
          /* Replace a damaged identifier slot, without trusting its contents. */
        }
        const previous =
          typeof stored === 'object' &&
          stored !== null &&
          'fingerprint' in stored &&
          'operationId' in stored &&
          stored.fingerprint === fingerprint &&
          mapId.safeParse(stored.operationId).success
            ? stored.operationId
            : null;
        const operationId = typeof previous === 'string' ? previous : crypto.randomUUID();
        sessionStorage.setItem(key, JSON.stringify({ fingerprint, operationId }));
        request = { backup, operationId };
        setAttempt(request);
      }
      if (!alive.current) return;
      const result = await importMapBackup(request.backup, request.operationId);
      if (!alive.current) return;
      await queries.invalidateQueries({ queryKey: ['maps', userId, workspaceId], refetchType: 'none' });
      if (alive.current) {
        await navigate(`/mapas/${result.mapId}`);
        sessionStorage.removeItem(key);
      }
    } catch (cause) {
      if (!alive.current) return;
      if (
        cause instanceof MapError &&
        ['VALIDATION', 'LIMIT_EXCEEDED', 'FORBIDDEN', 'UNAUTHENTICATED', 'CONFLICT'].includes(cause.code)
      ) {
        setError(
          'O servidor recusou a importação. Confira seu acesso e o arquivo; nenhum novo mapa foi criado por esta tentativa.',
        );
      } else if (cause instanceof DOMException && ['QuotaExceededError', 'SecurityError'].includes(cause.name)) {
        setError('Não foi possível guardar a solicitação nesta aba. Libere o armazenamento e tente novamente.');
      } else
        setError(
          'Não foi possível confirmar a importação. Tente novamente com o mesmo arquivo para evitar uma cópia adicional.',
        );
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <>
      <button ref={opener} className="button button-secondary" type="button" onClick={() => setOpen(true)}>
        Importar backup
      </button>
      <DraftDialog
        open={open}
        busy={busy}
        onClose={() => {
          selection.current++;
          setReading(false);
          setOpen(false);
        }}
        onReturnFocus={() => opener.current?.focus()}
        closeLabel="Fechar importação"
        title="Importar backup"
        description="Selecione um backup portátil JSON do Mapa, de até 2 MB. A importação cria um mapa novo, sem alterar os existentes, com você como responsável."
      >
        <div className="map-details">
          <label htmlFor="map-backup-file">Arquivo de backup</label>
          <input
            id="map-backup-file"
            className="map-backup-file"
            type="file"
            accept=".json,application/json"
            disabled={busy || attempt !== null}
            onChange={(event) => void select(event.target.files?.[0])}
          />
          {reading && <p role="status">Validando arquivo…</p>}
          {backup && (
            <div>
              <p className="map-copy-summary">
                <strong>{backup.map.title}</strong>
              </p>
              <p>
                {backup.nodes.length} {backup.nodes.length === 1 ? 'nó' : 'nós'} · Sem projeto
              </p>
              <p>Textos e relações serão preservados; IDs, autoria e histórico serão novos.</p>
            </div>
          )}
          {attempt && (
            <p role="status">
              Há uma solicitação aguardando confirmação. A tentativa repete o mesmo arquivo e não cria outro mapa.
            </p>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {attempt && (
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => {
                setAttempt(null);
                setBackup(null);
                setError('');
              }}
            >
              Escolher outro arquivo
            </button>
          )}
          <button className="button" disabled={!backup || reading || busy} onClick={() => void confirm()}>
            {busy ? 'Importando…' : attempt ? 'Tentar confirmar importação' : 'Confirmar importação'}
          </button>
        </div>
      </DraftDialog>
    </>
  );
}
