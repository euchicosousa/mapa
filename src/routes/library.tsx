import { ENTITY_NAME_MAX } from '../maps/limits';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
  useNavigationType,
  useSearchParams,
} from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Page } from './pages';
import type { createMapAction, libraryLoader } from '../maps/loaders';
import {
  listLibrary,
  listProjects,
  listOwners,
  parseLibraryFilters,
  librarySearch,
  type LibraryFilters,
} from '../maps/library';
import { ProjectsDialog } from './projects';
import { MapImport } from './map-import';

const updated = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
export function LibraryPage() {
  const { access } = useLoaderData<typeof libraryLoader>();
  const result = useActionData<typeof createMapAction>(),
    navigation = useNavigation();
  const [params, setParams] = useSearchParams(),
    location = useLocation(),
    navigationType = useNavigationType();
  const filters = useMemo(() => parseLibraryFilters(params), [params]);
  const [search, setSearch] = useState(filters.query),
    [managerOpen, setManagerOpen] = useState(false);
  const [searchLocation, setSearchLocation] = useState(location.key);
  if (searchLocation !== location.key) {
    setSearchLocation(location.key);
    if (navigationType === 'POP') setSearch(filters.query);
  }
  const projectButton = useRef<HTMLButtonElement>(null);
  const [operationId] = useState(() => crypto.randomUUID());
  const creating = navigation.state !== 'idle' && navigation.formMethod === 'POST';
  const maps = useQuery({
    queryKey: ['maps', access.userId, access.workspace.id, filters],
    queryFn: ({ signal }) => listLibrary(access.workspace.id, filters, signal),
    enabled: filters.query.length <= ENTITY_NAME_MAX,
    staleTime: 0,
    retry: false,
  });
  const projects = useQuery({
    queryKey: ['projects', access.userId, access.workspace.id],
    queryFn: ({ signal }) => listProjects(access.workspace.id, signal),
    staleTime: 0,
    retry: false,
  });
  const owners = useQuery({
    queryKey: ['map-owners', access.userId, access.workspace.id],
    queryFn: ({ signal }) => listOwners(access.workspace.id, signal),
    staleTime: 0,
    retry: false,
  });
  useEffect(() => {
    if (search === filters.query || search.length > ENTITY_NAME_MAX) return;
    const timer = setTimeout(
      () =>
        setParams((current) => librarySearch({ ...parseLibraryFilters(current), query: search, page: 1 }), {
          replace: true,
        }),
      300,
    );
    return () => clearTimeout(timer);
  }, [search, filters.query, setParams]);
  useEffect(() => {
    if (maps.data && maps.data.page !== filters.page)
      setParams(librarySearch({ ...filters, page: maps.data.page }), { replace: true });
  }, [maps.data, filters, setParams]);
  const change = (patch: Partial<LibraryFilters>) =>
    setParams(librarySearch({ ...filters, query: search, page: 1, ...patch }));
  const clear = () => {
    setSearch('');
    setParams(new URLSearchParams());
  };
  const data = maps.data,
    invalid = search.length > ENTITY_NAME_MAX;
  return (
    <Page title="Seus mapas" eyebrow="Biblioteca">
      <div className="library-actions">
        <Form method="post">
          <input type="hidden" name="operationId" value={operationId} />
          <button className="button" disabled={creating}>
            {creating ? 'Criando mapa…' : 'Novo mapa'}
          </button>
        </Form>
        <button
          ref={projectButton}
          className="button button-secondary"
          type="button"
          onClick={() => setManagerOpen(true)}
        >
          Projetos
        </button>
        <MapImport
          key={`${access.userId}:${access.workspace.id}`}
          userId={access.userId}
          workspaceId={access.workspace.id}
        />
        <p className="support-copy">
          Você fica como responsável pelos mapas que criar. Toda a equipe pode abrir e editar.
        </p>
      </div>
      {result?.error && (
        <p className="form-error" role="alert">
          {result.error}
        </p>
      )}
      <form
        className="library-filters"
        aria-label="Filtrar mapas"
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalid) change({ query: search });
        }}
      >
        <div>
          <label htmlFor="map-search">Buscar pelo título</label>
          <input
            id="map-search"
            type="search"
            value={search}
            aria-invalid={invalid}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="project-filter">Projeto ou cliente</label>
          <select id="project-filter" value={filters.project} onChange={(e) => change({ project: e.target.value })}>
            <option value="">Todos os projetos</option>
            <option value="none">Sem projeto</option>
            {filters.project && filters.project !== 'none' && !projects.data?.some((p) => p.id === filters.project) && (
              <option value={filters.project}>Projeto selecionado</option>
            )}
            {projects.data?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
                {project.clientName ? ` · ${project.clientName}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="owner-filter">Responsável</label>
          <select id="owner-filter" value={filters.owner} onChange={(e) => change({ owner: e.target.value })}>
            <option value="">Todos os responsáveis</option>
            {filters.owner && !owners.data?.some((o) => o.id === filters.owner) && (
              <option value={filters.owner}>Responsável selecionado</option>
            )}
            {owners.data?.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
                {owner.active ? '' : ' · Inativo'}
              </option>
            ))}
          </select>
        </div>
        <button className="button button-secondary" type="button" onClick={clear}>
          Limpar filtros
        </button>
      </form>
      {invalid && (
        <p className="form-error" role="alert">
          A busca pode ter até {ENTITY_NAME_MAX} caracteres. Seu texto foi mantido para você ajustar.
        </p>
      )}
      {(projects.isError || owners.isError) && (
        <div className="library-notice" role="alert">
          <p>Não foi possível carregar todas as opções dos filtros. Sua seleção foi mantida.</p>
          <button
            className="button button-secondary"
            onClick={() => {
              void projects.refetch();
              void owners.refetch();
            }}
          >
            Atualizar opções
          </button>
        </div>
      )}
      {!invalid &&
        (maps.isPending ? (
          <p className="loading" role="status">
            Carregando mapas…
          </p>
        ) : maps.isError ? (
          <div className="library-notice" role="alert">
            <p>Não foi possível carregar os mapas. Seus filtros continuam aqui.</p>
            <button className="button button-secondary" onClick={() => void maps.refetch()}>
              Tentar carregar mapas
            </button>
          </div>
        ) : (
          data && (
            <>
              <p className="library-count" role="status">
                {maps.isFetching || search !== filters.query
                  ? 'Buscando mapas…'
                  : `${data.total} ${data.total === 1 ? 'mapa encontrado' : 'mapas encontrados'}`}
              </p>
              {data.total === 0 ? (
                <div className="access-panel">
                  <span className="section-number">
                    {data.unfilteredTotal === 0 ? 'Biblioteca vazia' : 'Nenhum resultado'}
                  </span>
                  <h2>{data.unfilteredTotal === 0 ? 'Nenhum mapa ainda' : 'Nenhum mapa com esses filtros'}</h2>
                  <p>
                    {data.unfilteredTotal === 0
                      ? 'Crie o primeiro mapa da equipe para começar a organizar ideias.'
                      : 'Ajuste a busca, o projeto ou o responsável para encontrar outros mapas.'}
                  </p>
                </div>
              ) : (
                <div className="library-results" role="region" aria-label="Mapas da equipe">
                  <table className="library-table">
                    <thead>
                      <tr>
                        <th>Título</th>
                        <th>Projeto / cliente</th>
                        <th>Responsável</th>
                        <th>Atualizado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((map) => (
                        <tr key={map.id} data-map-id={map.id}>
                          <td>
                            <Link className="library-map-link" to={`/mapas/${map.id}`}>
                              {map.title}
                            </Link>
                          </td>
                          <td>
                            {map.projectName ?? 'Sem projeto'}
                            {map.clientName && <small>{map.clientName}</small>}
                          </td>
                          <td>{map.ownerName}</td>
                          <td>
                            <time dateTime={map.updatedAt}>{updated.format(new Date(map.updatedAt))}</time>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <ul className="map-list library-cards">
                    {data.items.map((map) => (
                      <li key={map.id} data-map-id={map.id}>
                        <Link className="map-item library-map-link" to={`/mapas/${map.id}`}>
                          <strong>{map.title}</strong>
                          <span>
                            Projeto: {map.projectName ?? 'Sem projeto'}
                            {map.clientName ? ` · ${map.clientName}` : ''}
                          </span>
                          <span>Responsável: {map.ownerName}</span>
                          <time dateTime={map.updatedAt}>Atualizado em {updated.format(new Date(map.updatedAt))}</time>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.total > 0 && (
                <nav className="library-pagination" aria-label="Paginação dos mapas">
                  <button
                    className="button button-secondary"
                    disabled={data.page <= 1}
                    onClick={() => change({ page: data.page - 1 })}
                  >
                    Página anterior
                  </button>
                  <span>
                    Página {data.page} de {data.totalPages}
                  </span>
                  <button
                    className="button button-secondary"
                    disabled={data.page >= data.totalPages}
                    onClick={() => change({ page: data.page + 1 })}
                  >
                    Próxima página
                  </button>
                </nav>
              )}
            </>
          )
        ))}
      <ProjectsDialog
        key={`${access.userId}:${access.workspace.id}`}
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        onReturnFocus={() => projectButton.current?.focus()}
        userId={access.userId}
        workspaceId={access.workspace.id}
      />
    </Page>
  );
}
export function MapUnavailablePage() {
  return (
    <Page title="Mapa indisponível" eyebrow="Mapa">
      <div className="access-panel">
        <h2>Não foi possível abrir este mapa</h2>
        <p>Ele não existe ou não está disponível para a sua conta.</p>
        <Link className="button" to="/mapas">
          Ver seus mapas
        </Link>
      </div>
    </Page>
  );
}
