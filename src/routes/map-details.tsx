import { MAP_TITLE_MAX } from '../maps/limits';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DraftDialog } from './draft-dialog';
import { listProjects, listOwners } from '../maps/library';
import { validMapTitle, type MapDocument } from '../maps/api';
import { useEditorStore } from '../state/editor';
import { MapDuplication } from './map-duplication';

export function MapDetailsDialog({
  map,
  userId,
  role,
  onClose,
  onReturnFocus,
}: {
  map: MapDocument['map'];
  userId: string;
  role: 'member' | 'admin';
  onClose: () => void;
  onReturnFocus: () => void;
}) {
  const [title, setTitle] = useState(map.title),
    [projectId, setProjectId] = useState(map.projectId ?? ''),
    [error, setError] = useState('');
  const projects = useQuery({
    queryKey: ['projects', userId, map.workspaceId],
    queryFn: ({ signal }) => listProjects(map.workspaceId, signal),
    staleTime: 0,
    retry: false,
  });
  const rename = useEditorStore((s) => s.renameMap),
    associate = useEditorStore((s) => s.setProject),
    status = useEditorStore((s) => s.status);
  const frozen = useEditorStore(
    (s) =>
      s.deleted ||
      s.deleteConfirmed ||
      s.queue.some((operation) => operation.kind === 'delete_map') ||
      s.historyBusy ||
      s.pendingHistory !== null ||
      s.undoRequested !== null ||
      s.copyRequest !== null ||
      !s.storageInitialized ||
      s.status === 'conflict',
  );
  const valid = validMapTitle(title);
  const historyMessage = useEditorStore((s) => s.historyMessage);
  return (
    <DraftDialog
      open
      onClose={onClose}
      onReturnFocus={onReturnFocus}
      closeLabel="Fechar detalhes"
      title="Detalhes do mapa"
      description="Título e projeto são salvos no mapa e podem ser desfeitos. O texto do nó central é independente do título."
    >
      <div className="map-details">
        <form
          className="project-form"
          onSubmit={(event) => {
            event.preventDefault();
            setError(rename(title) ? '' : 'Corrija as alterações pendentes antes de renomear o mapa.');
          }}
        >
          <label htmlFor="map-title">Título do mapa</label>
          <input
            id="map-title"
            value={title}
            disabled={frozen}
            aria-invalid={!valid}
            aria-describedby="map-title-help"
            onChange={(e) => setTitle(e.target.value)}
          />
          <p id="map-title-help" className={valid ? 'field-help' : 'form-error'}>
            {title.length}/{MAP_TITLE_MAX} · O título não pode ficar em branco.
          </p>
          <button className="button" disabled={!valid || frozen || title === map.title}>
            Salvar título
          </button>
        </form>
        <form
          className="project-form"
          onSubmit={(event) => {
            event.preventDefault();
            setError(
              associate(projectId || null) ? '' : 'Corrija as alterações pendentes antes de associar o projeto.',
            );
          }}
        >
          <label htmlFor="map-project">Projeto do mapa</label>
          <select
            id="map-project"
            value={projectId}
            disabled={frozen || projects.isPending || projects.isError}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">Sem projeto</option>
            {projectId && !projects.data?.some((p) => p.id === projectId) && (
              <option value={projectId}>Projeto atual</option>
            )}
            {projects.data?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
                {project.clientName ? ` · ${project.clientName}` : ''}
              </option>
            ))}
          </select>
          <button
            className="button"
            disabled={frozen || projects.isPending || projects.isError || projectId === (map.projectId ?? '')}
          >
            Salvar projeto do mapa
          </button>
        </form>
        {projects.isPending && <p role="status">Carregando projetos…</p>}
        {projects.isError && (
          <div role="alert">
            <p>Não foi possível carregar os projetos. O título continua disponível.</p>
            <button className="button button-secondary" onClick={() => void projects.refetch()}>
              Tentar carregar projetos
            </button>
          </div>
        )}
        <MapDuplication key={map.id} map={map} userId={userId} />
        <section className="map-owner" aria-label="Responsabilidade do mapa">
          <h3>Responsabilidade</h3>
          <p>Responsável atual: {map.ownerName ?? 'Membro da equipe'}</p>
          {role === 'admin' || map.ownerId === userId ? (
            <OwnerTransfer key={map.ownerId} map={map} userId={userId} />
          ) : (
            <p className="field-help">
              O responsável ou um administrador pode transferir este mapa. Você continua podendo editar.
            </p>
          )}
        </section>
        {(role === 'admin' || map.ownerId === userId) && <MapDeletion map={map} />}
        {historyMessage && <p role="status">{historyMessage}</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <p role="status">
          {status === 'saved'
            ? 'Mapa salvo'
            : status === 'error'
              ? 'Falha ao salvar. Feche os detalhes para tentar novamente.'
              : status === 'conflict'
                ? 'O mapa mudou em outra sessão. Feche os detalhes para revisar.'
                : 'Salvando mapa…'}
        </p>
      </div>
    </DraftDialog>
  );
}

function OwnerTransfer({ map, userId }: { map: MapDocument['map']; userId: string }) {
  const [ownerId, setOwnerId] = useState(''),
    [error, setError] = useState('');
  const members = useQuery({
    queryKey: ['map-owners', userId, map.workspaceId],
    queryFn: ({ signal }) => listOwners(map.workspaceId, signal),
    staleTime: 0,
    retry: false,
  });
  const transfer = useEditorStore((s) => s.transferOwner);
  const blocked = useEditorStore(
    (s) =>
      s.status !== 'saved' ||
      s.inFlight ||
      s.historyBusy ||
      s.pendingHistory !== null ||
      s.undoRequested !== null ||
      s.copyRequest !== null ||
      !s.storageInitialized,
  );
  const candidates = members.data?.filter((member) => member.active && member.id !== map.ownerId) ?? [];
  return (
    <form
      className="project-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError(transfer(ownerId) ? '' : 'Salve as alterações pendentes e confira o destino antes de transferir.');
      }}
    >
      <p className="field-help" id="transfer-help">
        Toda a equipe continua podendo editar. A transferência fica registrada e reinicia o histórico desta sessão.
      </p>
      <label htmlFor="map-owner">Novo responsável</label>
      <select
        id="map-owner"
        value={ownerId}
        disabled={blocked || members.isPending || members.isError}
        aria-describedby="transfer-help"
        onChange={(event) => {
          setOwnerId(event.target.value);
          setError('');
        }}
      >
        <option value="">Selecione um membro ativo</option>
        {candidates.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
      <button className="button" disabled={blocked || !candidates.some((member) => member.id === ownerId)}>
        Transferir responsabilidade
      </button>
      {blocked && (
        <p className="field-help">Conclua o salvamento ou resolva as alterações pendentes para transferir.</p>
      )}
      {members.isPending && <p role="status">Carregando membros ativos…</p>}
      {members.isError && (
        <div role="alert">
          <p>Não foi possível carregar os membros. Nenhuma transferência foi feita.</p>
          <button className="button button-secondary" type="button" onClick={() => void members.refetch()}>
            Tentar carregar membros
          </button>
        </div>
      )}
      {members.isSuccess && candidates.length === 0 && (
        <p className="field-help">Não há outro membro ativo para receber este mapa.</p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  );
}

function MapDeletion({ map }: { map: MapDocument['map'] }) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState('');
  const opener = useRef<HTMLButtonElement>(null);
  const busy = useEditorStore((s) => s.inFlight),
    status = useEditorStore((s) => s.status),
    message = useEditorStore((s) => s.historyMessage);
  const pending = useEditorStore((s) => s.queue.some((operation) => operation.kind === 'delete_map'));
  const blocked = useEditorStore(
    (s) => s.status !== 'saved' || s.inFlight || s.historyBusy || s.copyRequest !== null || !s.storageInitialized,
  );
  return (
    <section className="map-owner" aria-label="Exclusão do mapa">
      <h3>Excluir mapa</h3>
      <p>Apenas o responsável ou um administrador pode excluir este mapa.</p>
      <button ref={opener} className="button button-secondary" disabled={blocked} onClick={() => setOpen(true)}>
        Excluir mapa
      </button>
      <DraftDialog
        open={open}
        onClose={() => setOpen(false)}
        onReturnFocus={() => opener.current?.focus()}
        closeLabel={pending ? 'Fechar confirmação' : 'Cancelar exclusão'}
        title="Excluir este mapa?"
        description="O mapa sairá da biblioteca e não aceitará novas edições. Não há restauração nesta versão."
      >
        <p>
          <strong>{map.title}</strong>
        </p>
        <button
          className="button"
          disabled={busy || (!pending && blocked)}
          onClick={() => {
            if (pending) {
              useEditorStore.getState().retry();
              return;
            }
            setError(useEditorStore.getState().deleteMap() ? '' : 'Conclua o salvamento antes de excluir o mapa.');
          }}
        >
          {busy ? 'Excluindo…' : pending ? 'Tentar confirmar exclusão' : 'Confirmar exclusão'}
        </button>
        {status === 'error' && pending && (
          <p role="alert">Não foi possível confirmar a exclusão. Tente novamente; a mesma solicitação será repetida.</p>
        )}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
      </DraftDialog>
    </section>
  );
}
