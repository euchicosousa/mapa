import { expect, it, vi } from 'vitest';
import { deliverInvitation, validInvitationRequest } from '../../supabase/functions/manage-invitation/delivery';
const request = {
  action: 'create',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  invitationId: '00000000-0000-4000-8000-000000000002',
  email: 'test@example.com',
  redirectTo: 'https://mapa.test/auth/callback',
};
it('rejects malformed input and actor/role spoofing fields', () => {
  expect(validInvitationRequest(request)).toBe(true);
  for (const value of [
    null,
    [],
    { ...request, actor: 'admin' },
    { ...request, role: 'admin' },
    { ...request, email: 'invalid' },
    { ...request, workspaceId: 'invalid' },
  ])
    expect(validInvitationRequest(value)).toBe(false);
});
it('does not claim success when email transport fails', async () => {
  const finish = vi.fn().mockResolvedValue(true);
  expect(await deliverInvitation({ send: async () => ({ code: 'unexpected_failure' }), finish })).toEqual({
    error: 'SEND_FAILED',
  });
  expect(finish).toHaveBeenCalledWith('failed');
});
it('records existing accounts instead of promising a sent invitation', async () => {
  const finish = vi.fn().mockResolvedValue(true);
  expect(await deliverInvitation({ send: async () => ({ code: 'email_exists' }), finish })).toEqual({
    state: 'existing',
  });
  expect(finish).toHaveBeenCalledWith('existing');
});
it('a lost database acknowledgement remains explicitly uncertain', async () => {
  expect(await deliverInvitation({ send: async () => null, finish: async () => false })).toEqual({
    error: 'DELIVERY_UNKNOWN',
  });
});
it('records a confirmed delivery only after transport and database acknowledgement', async () => {
  expect(await deliverInvitation({ send: async () => null, finish: async () => true })).toEqual({ state: 'sent' });
});
