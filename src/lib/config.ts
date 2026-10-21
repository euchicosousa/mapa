import { z } from 'zod';

export type PublicConfig =
  { status: 'ready'; url: string; publishableKey: string } | { status: 'unavailable'; fields: string[] };

const urlSchema = z.url().refine((value) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash &&
    (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  );
});

function isPublicKey(value: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(value)) return true;
  // Supabase local can still provide legacy anon JWTs. Never accept service_role.
  try {
    const parts = value.split('.');
    if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return false;
    const payload: unknown = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return z.object({ role: z.literal('anon') }).safeParse(payload).success;
  } catch {
    return false;
  }
}

export function validatePublicConfig(env: Record<string, string | undefined>): PublicConfig {
  const url = env.VITE_SUPABASE_URL?.trim() ?? '';
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  const fields: string[] = [];
  if (!urlSchema.safeParse(url).success) fields.push('VITE_SUPABASE_URL');
  if (!isPublicKey(publishableKey)) fields.push('VITE_SUPABASE_PUBLISHABLE_KEY');
  return fields.length ? { status: 'unavailable', fields } : { status: 'ready', url, publishableKey };
}
