import { withAllowedOrigins } from '../_shared/cors.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { deliverInvitation, validInvitationRequest } from './delivery.ts';
declare const Deno: {
  env: { get: (key: string) => string | undefined };
  serve: (handler: (request: Request) => Promise<Response>) => void;
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
Deno.serve(
  withAllowedOrigins(async (request) => {
    if (request.method !== 'POST') return json({ error: 'VALIDATION' }, 405);
    const url = Deno.env.get('SUPABASE_URL'),
      secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !secret) return json({ error: 'UNAVAILABLE' }, 503);
    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return json({ error: 'UNAUTHENTICATED' }, 401);
    const { data: identity, error: authError } = await admin.auth.getUser(token);
    if (authError || !identity.user) return json({ error: 'UNAUTHENTICATED' }, 401);
    let body;
    try {
      const raw = await request.text();
      if (raw.length > 2000) return json({ error: 'VALIDATION' }, 400);
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'VALIDATION' }, 400);
    }
    if (!validInvitationRequest(body)) return json({ error: 'VALIDATION' }, 400);
    // The callback is derived only from an explicit deployment allowlist, never a
    // caller-supplied host. These local callbacks already exist in Supabase Auth.
    const callbacks = (
      Deno.env.get('MAPA_AUTH_CALLBACK_URLS') ??
      'http://127.0.0.1:5173/auth/callback,http://localhost:5173/auth/callback,http://127.0.0.1:4174/auth/callback,http://127.0.0.1:4173/auth/callback,http://localhost:4173/auth/callback'
    )
      .split(',')
      .map((s) => s.trim());
    if (body.action !== 'revoke' && !callbacks.includes(body.redirectTo)) return json({ error: 'VALIDATION' }, 400);
    const { data: reservation, error } = await admin.rpc('reserve_workspace_invitation', {
      p_actor: identity.user.id,
      p_action: body.action,
      p_workspace: body.workspaceId,
      p_id: body.invitationId,
      p_email: body.email ?? null,
    });
    if (error) {
      const code = [
        'FORBIDDEN',
        'VALIDATION',
        'NOT_FOUND',
        'CONFLICT',
        'INVITE_CLOSED',
        'COOLDOWN',
        'ALREADY_MEMBER',
      ].includes(error.message)
        ? error.message
        : 'UNAVAILABLE';
      return json({ error: code }, code === 'FORBIDDEN' ? 403 : code === 'UNAVAILABLE' ? 503 : 400);
    }
    if (!reservation.claimed)
      return json({ id: reservation.id, deliveryState: reservation.deliveryState, attempted: false });
    const outcome = await deliverInvitation({
      send: async () => {
        const { error } = await admin.auth.admin.inviteUserByEmail(reservation.email, { redirectTo: body.redirectTo });
        return error ? { code: error.code } : null;
      },
      finish: async (state) => {
        const { error } = await admin.rpc('finish_workspace_invitation', {
          p_id: reservation.id,
          p_attempt: reservation.attemptId,
          p_outcome: state,
        });
        return !error;
      },
    });
    return outcome.error
      ? json({ error: outcome.error, id: reservation.id }, 503)
      : json({ id: reservation.id, deliveryState: outcome.state, attempted: true });
  }, Deno.env.get('MAPA_ALLOWED_ORIGINS')),
);
