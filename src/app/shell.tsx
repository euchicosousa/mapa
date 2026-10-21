import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, NavLink, Outlet, useFetcher, useLoaderData, useLocation, useNavigation } from 'react-router';

import { useEditorStore } from '../state/editor';
import { hasPendingEdits, synchronizeEditor, connectDraftLifecycle } from '../state/editor-lifecycle';
import { downloadEmergencyDraft } from '../maps/drafts';
import { DraftDialog } from '../routes/draft-dialog';
import type { Access } from '../auth/access';
import { privacySnapshot, subscribePrivacy } from '../auth/privacy';

export function Shell() {
  useEffect(connectDraftLifecycle, []);
  const storageInitialized = useEditorStore((state) => state.storageInitialized);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const navigation = useNavigation();
  const access = useLoaderData<Access>();
  const locked = useSyncExternalStore(subscribePrivacy, privacySnapshot);
  const logout = useFetcher<{ error?: string }>();
  const signedIn = access.kind === 'member' || access.kind === 'no-access' || access.kind === 'unavailable';
  const location = useLocation();
  const authPage = ['/login', '/recuperar-senha', '/auth/callback', '/definir-senha'].includes(location.pathname);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    main.current?.focus({ preventScroll: true });
  }, [location.pathname]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="app-header">
        <Link className="brand" to="/login" aria-label="Mapa, ideias conectadas, início">
          <img className="brand-logo" src="/brand/mapa.svg" width="48" height="48" alt="MAPA" />
          <span className="brand-caption">Ideias conectadas</span>
        </Link>
        <nav aria-label="Navegação principal">
          <NavLink to="/mapas">Mapas</NavLink>
          <NavLink to="/equipe">Equipe</NavLink>
          {signedIn ? (
            <logout.Form
              method="post"
              action="/sair"
              onSubmit={(event) => {
                if (hasPendingEdits()) {
                  event.preventDefault();
                  setConfirmLogout(true);
                  setLogoutError('');
                  void useEditorStore.getState().flushLocal();
                }
              }}
            >
              <button className="nav-button" disabled={logout.state !== 'idle' || navigation.state !== 'idle'}>
                {logout.state !== 'idle' ? 'Saindo…' : 'Sair'}
              </button>
            </logout.Form>
          ) : (
            <NavLink to="/login">Acesso</NavLink>
          )}
        </nav>
      </header>
      <main id="conteudo" ref={main} tabIndex={-1} aria-busy={navigation.state !== 'idle'}>
        {navigation.state !== 'idle' && (
          <p className="loading" role="status">
            Carregando página…
          </p>
        )}
        {logout.data?.error && (
          <p className="form-error" role="alert">
            {logout.data.error}
          </p>
        )}
        {(locked || navigation.state === 'loading') && signedIn && !authPage ? (
          <p className="loading" role="status">
            Verificando acesso…
          </p>
        ) : (
          <>
            {!locked && access.kind === 'member' && (
              <p className="workspace-caption">Equipe: {access.workspace.name}</p>
            )}
            <Outlet />
          </>
        )}
      </main>
      <DraftDialog
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        title="Há alterações pendentes"
        description="Antes de sair, sincronize suas alterações, exporte um rascunho de emergência ou confirme que deseja descartá-las. O rascunho desta conta será removido deste navegador ao sair."
      >
        {!storageInitialized && (
          <p role="alert">
            Não foi possível ler os rascunhos locais. Tente sincronizar para recuperá-los antes de sair; a exportação
            fica indisponível enquanto a leitura falhar.
          </p>
        )}
        {logoutError && (
          <p role="alert" className="form-error">
            {logoutError}
          </p>
        )}
        <button
          className="button"
          disabled={logoutBusy}
          onClick={async () => {
            setLogoutBusy(true);
            if (await synchronizeEditor()) {
              setConfirmLogout(false);
              void logout.submit({}, { method: 'post', action: '/sair' });
            } else setLogoutError('Não foi possível sincronizar. Suas alterações continuam protegidas nesta tela.');
            setLogoutBusy(false);
          }}
        >
          Sincronizar e sair
        </button>
        <button
          className="button button-secondary"
          disabled={logoutBusy || !storageInitialized}
          onClick={() => {
            const record = useEditorStore.getState().snapshot();
            if (record) downloadEmergencyDraft(record);
            setConfirmLogout(false);
            void logout.submit({ disposition: 'exported' }, { method: 'post', action: '/sair' });
          }}
        >
          Exportar rascunho e sair
        </button>
        <button
          className="button button-secondary"
          disabled={logoutBusy}
          onClick={() => {
            setConfirmLogout(false);
            void logout.submit({ disposition: 'discarded' }, { method: 'post', action: '/sair' });
          }}
        >
          Descartar alterações e sair
        </button>
      </DraftDialog>
      <footer>
        <span>Mapa · Espaço da equipe</span>
        <span>Uma ideia de cada vez.</span>
      </footer>
    </div>
  );
}
