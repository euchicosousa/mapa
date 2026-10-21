import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { ACCESS_DENIED_EVENT } from './access-events';
import { supabase } from '../lib/supabase';
import { authActionRunning } from './transitions';
import { lockPrivateData, unlockPrivateData } from './privacy';

export type Revalidation = { revalidate: () => Promise<void>; isIdle: () => boolean };

// Identity transitions (another account or sign-out) hide and clear private data
// until access is revalidated. Same-identity signals (SIGNED_IN repeated on reload or
// session recovery, TOKEN_REFRESHED, returning to the tab) only revalidate, and never
// while a navigation or submission is in flight: interrupting an action with a cache
// wipe left it hanging behind "Verificando acesso…".
export function identityChanged(previousUserId: string | null | undefined, session: Session | null) {
  return previousUserId !== undefined && (session?.user.id ?? null) !== previousUserId;
}

export function connectAuthEvents({ revalidate, isIdle }: Revalidation) {
  if (!supabase) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  // undefined until INITIAL_SESSION tells us who is signed in.
  let userId: string | null | undefined;
  const lockAndRevalidate = () => {
    if (disposed) return;
    const ticket = lockPrivateData();
    clearTimeout(timer);
    // Auth callbacks stay synchronous. API calls run outside the SDK auth lock.
    const verifyWhenIdle = () => {
      if (disposed) return;
      if (authActionRunning()) {
        unlockPrivateData(ticket);
        return;
      }
      // Sign-in/out actions own their redirect. Keep data hidden until their
      // loaders finish instead of racing a second redirect from the old route.
      if (!isIdle()) {
        timer = setTimeout(verifyWhenIdle, 50);
        return;
      }
      void revalidate()
        .catch(() => {})
        .finally(() => unlockPrivateData(ticket));
    };
    timer = setTimeout(verifyWhenIdle, 0);
  };
  const softRevalidate = () => {
    if (disposed) return;
    clearTimeout(timer);
    const whenIdle = () => {
      if (disposed) return;
      if (authActionRunning() || !isIdle()) {
        timer = setTimeout(whenIdle, 50);
        return;
      }
      void revalidate().catch(() => {});
    };
    timer = setTimeout(whenIdle, 0);
  };
  const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session) => {
    const changed = event === 'SIGNED_OUT' || identityChanged(userId, session);
    userId = session?.user.id ?? null;
    if (authActionRunning()) {
      clearTimeout(timer);
      return;
    }
    if (event === 'INITIAL_SESSION') return;
    if (changed) lockAndRevalidate();
    else softRevalidate();
  });
  const visible = () => {
    if (document.visibilityState === 'visible') softRevalidate();
  };
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('focus', softRevalidate);
  window.addEventListener(ACCESS_DENIED_EVENT, softRevalidate);
  // A page restored from the back/forward cache may belong to a previous session.
  const restored = (event: PageTransitionEvent) => {
    if (event.persisted) lockAndRevalidate();
  };
  window.addEventListener('pageshow', restored);
  return () => {
    disposed = true;
    clearTimeout(timer);
    data.subscription.unsubscribe();
    document.removeEventListener('visibilitychange', visible);
    window.removeEventListener('focus', softRevalidate);
    window.removeEventListener(ACCESS_DENIED_EVENT, softRevalidate);
    window.removeEventListener('pageshow', restored);
  };
}
