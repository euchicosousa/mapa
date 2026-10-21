import { redirect } from 'react-router';
import { supabase } from '../lib/supabase';
import { beginAuthAction } from './transitions';
import { lockPrivateData, unlockPrivateData } from './privacy';

export type PasswordLink = { kind: 'recovery' | 'invite'; access_token: string; refresh_token: string };
const grantKey = 'mapa.password-link.v1';
type Grant = { userId: string; expiresAt: number };
let memoryGrant: Grant | null = null;

export function parsePasswordLink(url: URL): PasswordLink | null {
  const hash = new URLSearchParams(url.hash.slice(1));
  const kind = hash.get('type');
  if (url.searchParams.has('error') || hash.has('error') || hash.has('error_code')) return null;
  const access_token = hash.get('access_token'),
    refresh_token = hash.get('refresh_token');
  if ((kind !== 'recovery' && kind !== 'invite') || !access_token || !refresh_token) return null;
  return { kind, access_token, refresh_token };
}

// Capture once before the router starts. Tokens live only in memory and the SDK's
// session storage; they never enter router errors, navigation state or form data.
function captureLink() {
  if (!['/auth/callback', '/definir-senha'].includes(window.location.pathname)) return null;
  const url = new URL(window.location.href);
  const link = parsePasswordLink(url);
  window.history.replaceState(window.history.state, '', url.pathname);
  return link;
}
let incomingLink = captureLink();
let consumption: Promise<boolean> | undefined;

export function connectPasswordLinks(navigate: (path: string) => void) {
  const changed = () => {
    if (!['/auth/callback', '/definir-senha'].includes(window.location.pathname) || !window.location.hash) return;
    incomingLink = captureLink();
    consumption = undefined;
    navigate(window.location.pathname);
  };
  window.addEventListener('hashchange', changed);
  return () => window.removeEventListener('hashchange', changed);
}

export function clearPasswordGrant() {
  memoryGrant = null;
  try {
    sessionStorage.removeItem(grantKey);
  } catch {
    /* In-memory flow still works. */
  }
}

async function consumeLink() {
  const link = incomingLink;
  incomingLink = null;
  if (!link || !supabase) return false;
  clearPasswordGrant();
  const finish = beginAuthAction(),
    ticket = lockPrivateData();
  try {
    const { data, error } = await supabase.auth.setSession({
      access_token: link.access_token,
      refresh_token: link.refresh_token,
    });
    if (error || !data.session) return false;
    memoryGrant = {
      userId: data.session.user.id,
      expiresAt: Math.min((data.session.expires_at ?? 0) * 1000, Date.now() + 30 * 60_000),
    };
    try {
      sessionStorage.setItem(grantKey, JSON.stringify(memoryGrant));
    } catch {
      /* No token stored here. */
    }
    return true;
  } catch {
    return false;
  } finally {
    finish();
    unlockPrivateData(ticket);
  }
}

export async function hasPasswordGrant() {
  if (!supabase) return false;
  let grant = memoryGrant;
  try {
    grant ??= JSON.parse(sessionStorage.getItem(grantKey) ?? 'null') as Grant | null;
  } catch {
    return false;
  }
  if (!grant || typeof grant.expiresAt !== 'number' || grant.expiresAt <= Date.now()) {
    clearPasswordGrant();
    return false;
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || data.user?.id !== grant.userId) {
    clearPasswordGrant();
    return false;
  }
  return true;
}

export async function passwordCallbackLoader() {
  consumption ??= consumeLink();
  if (await consumption) return redirect('/definir-senha');
  return { valid: false };
}

export async function passwordFormLoader() {
  if (incomingLink) {
    consumption ??= consumeLink();
    await consumption;
  }
  try {
    return { valid: await hasPasswordGrant() };
  } catch {
    return { valid: false };
  }
}
