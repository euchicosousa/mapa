import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DraftDialog } from './draft-dialog';
import { listProjects, saveProject, type ProjectRequest } from '../maps/library';
import { validMapTitle, MapError } from '../maps/api';
import { queryClient } from '../app/query-client';

export function ProjectsDialog({
  open,
  onClose,
  onReturnFocus,
  userId,
  workspaceId,
}: {
  open: boolean;
  onClose: () => void;
  onReturnFocus: () => void;
  userId: string;
  workspaceId: string;
}) {
  const projects = useQuery({
    queryKey: ['projects', userId, workspaceId],
    queryFn: ({ signal }) => listProjects(workspaceId, signal),
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  const [editing, setEditing] = useState<string | null>(null),
    [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(''),
    [client, setClient] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [pending, setPending] = useState<{ request: ProjectRequest; creating: boolean } | null>(null);
  const valid = validMapTitle(name) && (!client.trim() || validMapTitle(client));
  const reset = () => {
    setEditing(null);
    setDraftId(crypto.randomUUID());
    setName('');
    setClient('');
    setError('');
    setMessage('');
  };
  return (
    <DraftDialog
      open={open}
      onClose={onClose}
      onReturnFocus={onReturnFocus}
      closeLabel="Fechar projetos"
      title="Projetos da equipe"
      description="Todos os membros podem criar e renomear projetos. O cliente é opcional."
    >
      <div className="project-manager">
        {projects.isPending && <p role="status">Carregando projetos…</p>}
        {projects.isError && (
          <div role="alert">
            <p>Não foi possível carregar os projetos.</p>
            <button className="button button-secondary" onClick={() => void projects.refetch()}>
              Tentar carregar projetos
            </button>
          </div>
        )}
        <ul className="project-list">
          {projects.data?.map((project) => (
            <li key={project.id}>
              <span>
                <strong>{project.name}</strong>
                {project.clientName && <small>{project.clientName}</small>}
              </span>
              <button
                className="button button-secondary"
                type="button"
                disabled={busy || pending !== null}
                aria-label={`Editar projeto: ${project.name}`}
                onClick={() => {
                  setEditing(project.id);
                  setName(project.name);
                  setClient(project.clientName ?? '');
                  setMessage('');
                  setError('');
                }}
              >
                Editar
              </button>
            </li>
          ))}
        </ul>
        <form
          className="project-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || busy) return;
            const attempt = pending ?? {
              request: { id: editing ?? draftId, name, clientName: client.trim() ? client : null },
              creating: editing === null,
            };
            setPending(attempt);
            setBusy(true);
            setError('');
            setMessage('');
            void saveProject(workspaceId, attempt.request, attempt.creating)
              .then(async () => {
                await queryClient.invalidateQueries({ queryKey: ['projects', userId, workspaceId] });
                await queryClient.invalidateQueries({ queryKey: ['maps', userId, workspaceId] });
                setPending(null);
                reset();
                setMessage(attempt.creating ? 'Projeto criado.' : 'Projeto atualizado.');
              })
              .catch((reason: unknown) => {
                if (reason instanceof MapError && reason.code !== 'UNAVAILABLE') setPending(null);
                setError('Não foi possível salvar o projeto. Confira seu acesso e tente novamente.');
              })
              .finally(() => setBusy(false));
          }}
        >
          <h3>{editing ? 'Editar projeto' : 'Novo projeto'}</h3>
          <label htmlFor="project-name">Nome do projeto</label>
          <input
            id="project-name"
            value={name}
            disabled={busy || pending !== null}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={name !== '' && !validMapTitle(name)}
          />
          <label htmlFor="project-client">Cliente (opcional)</label>
          <input
            id="project-client"
            value={client}
            disabled={busy || pending !== null}
            onChange={(e) => setClient(e.target.value)}
            aria-invalid={client.trim() !== '' && !validMapTitle(client)}
          />
          <p className="field-help">Nome e cliente: até 120 caracteres. O nome não pode ficar em branco.</p>
          {error && (
            <p className="form-error" role="alert">
              {error}
              {pending ? ' A tentativa mantém os mesmos dados para evitar duplicação.' : ''}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <div className="project-form-actions">
            <button className="button" disabled={!valid || busy}>
              {busy
                ? 'Salvando projeto…'
                : pending
                  ? 'Tentar salvar projeto novamente'
                  : editing
                    ? 'Salvar projeto'
                    : 'Criar projeto'}
            </button>
            {editing && (
              <button
                className="button button-secondary"
                type="button"
                disabled={busy || pending !== null}
                onClick={reset}
              >
                Novo projeto
              </button>
            )}
          </div>
        </form>
      </div>
    </DraftDialog>
  );
}
