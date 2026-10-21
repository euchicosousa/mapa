import { createBrowserRouter, type RouteObject } from 'react-router';
import { Shell } from './shell';
import { LoginPage, NotFoundPage, RouteErrorPage } from '../routes/pages';
import { RecoverPasswordPage, DefinePasswordPage, InvalidPasswordLink } from '../routes/password';
import { connectPasswordLinks, passwordCallbackLoader, passwordFormLoader } from '../auth/password-links';
import { requestPasswordAction, savePasswordAction } from '../auth/password-actions';
import { homeLoader, loginLoader, readAccess } from '../auth/access';
import { createMapAction, libraryLoader, mapLoader } from '../maps/loaders';
import { LibraryPage } from '../routes/library';
import { loginAction, logoutAction } from '../auth/actions';
import { connectAuthEvents } from '../auth/events';
import { NoAccessPage, TeamPage } from '../routes/team';
import { teamAction } from '../auth/member-access';
import { teamLoader, pendingInvitationsLoader } from '../auth/team-loader';
import { acceptInvitationAction } from '../auth/invitations';

export const routes: RouteObject[] = [{
  path: '/',
  Component: Shell,
  loader: readAccess,
  shouldRevalidate: () => true,
  ErrorBoundary: RouteErrorPage,
  HydrateFallback: () => <p className="loading" role="status">Carregando o Mapa…</p>,
  children: [
    { index: true, loader: homeLoader },
    { path: 'login', Component: LoginPage, loader: loginLoader, action: loginAction },
    { path: 'sair', action: logoutAction },
    { path: 'recuperar-senha', Component: RecoverPasswordPage, action: requestPasswordAction },
    { path: 'auth/callback', Component: InvalidPasswordLink, loader: passwordCallbackLoader },
    { path: 'definir-senha', Component: DefinePasswordPage, loader: passwordFormLoader, action: savePasswordAction },
    { path: 'sem-acesso', Component: NoAccessPage, loader: pendingInvitationsLoader, action: acceptInvitationAction },
    { path: 'mapas', Component: LibraryPage, loader: libraryLoader, action: createMapAction,
      shouldRevalidate: ({ currentUrl, nextUrl, formMethod, defaultShouldRevalidate }) =>
        !formMethod && currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search ? false : defaultShouldRevalidate },
    // Access and document load in the main bundle; only the canvas is lazy.
    { path: 'mapas/:mapId', loader: mapLoader, lazy: () => import('../routes/editor') },
    { path: 'equipe', Component: TeamPage, loader: teamLoader, action: teamAction },
    { path: '*', Component: NotFoundPage },
  ],
}];
export const router = createBrowserRouter(routes);
const disconnectLinks = connectPasswordLinks((path) => { void router.navigate(path, { replace: true }); });
const disconnect = connectAuthEvents({
  revalidate: () => router.revalidate(),
  isIdle: () => router.state.navigation.state === 'idle' && router.state.revalidation === 'idle' && [...router.state.fetchers.values()].every((fetcher) => fetcher.state === 'idle'),
});
if (import.meta.hot) import.meta.hot.dispose(() => { disconnect(); disconnectLinks(); });
