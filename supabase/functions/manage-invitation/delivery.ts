export type InvitationRequest = {
  action: 'create' | 'retry' | 'revoke';
  workspaceId: string;
  invitationId: string;
  email?: string;
  redirectTo: string;
};
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function validInvitationRequest(value: unknown): value is InvitationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  return (
    Object.keys(b).every((k) => ['action', 'workspaceId', 'invitationId', 'email', 'redirectTo'].includes(k)) &&
    ['create', 'retry', 'revoke'].includes(String(b.action)) &&
    uuid(b.workspaceId) &&
    uuid(b.invitationId) &&
    (b.action === 'revoke' || typeof b.redirectTo === 'string') &&
    (b.action !== 'create' ||
      (typeof b.email === 'string' && b.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim())))
  );
}
export async function deliverInvitation(adapter: {
  send: () => Promise<{ code?: string } | null>;
  finish: (state: 'sent' | 'failed' | 'existing') => Promise<boolean>;
}) {
  let state: 'sent' | 'failed' | 'existing';
  try {
    const error = await adapter.send();
    state = !error
      ? 'sent'
      : error.code === 'email_exists' || error.code === 'email_already_exists'
        ? 'existing'
        : 'failed';
  } catch {
    state = 'failed';
  }
  try {
    if (!(await adapter.finish(state))) return { error: 'DELIVERY_UNKNOWN' };
  } catch {
    return { error: 'DELIVERY_UNKNOWN' };
  }
  return state === 'failed' ? { error: 'SEND_FAILED' } : { state };
}
