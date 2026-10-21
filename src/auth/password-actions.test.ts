import { beforeEach, expect, it, vi } from 'vitest';
import type { ActionFunctionArgs } from 'react-router';
const sdk = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  hasGrant: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('../lib/supabase', () => ({ supabase: { auth: sdk } }));
vi.mock('./password-links', () => ({ hasPasswordGrant: sdk.hasGrant, clearPasswordGrant: sdk.clear }));
vi.mock('./privacy', () => ({ lockPrivateData: () => 1, unlockPrivateData: vi.fn() }));
import { requestPasswordAction, savePasswordAction } from './password-actions';
function args(path: string, values: Record<string, string>): ActionFunctionArgs {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return {
    request: new Request(`http://127.0.0.1:4174/${path}`, { method: 'POST', body: form }),
    url: new URL(`http://127.0.0.1:4174/${path}`),
    pattern: `/${path}`,
    params: {},
    context: {},
  };
}
beforeEach(() => {
  vi.clearAllMocks();
});
it('unknown and known email addresses have the same generic outcome', async () => {
  sdk.resetPasswordForEmail
    .mockResolvedValueOnce({ error: null })
    .mockResolvedValueOnce({ error: { status: 400, code: 'user_not_found' } });
  for (const email of ['known@example.com', 'unknown@example.com'])
    expect(await requestPasswordAction(args('recuperar-senha', { email }))).toEqual({ sent: true });
  expect(sdk.resetPasswordForEmail).toHaveBeenCalledWith('known@example.com', {
    redirectTo: 'http://127.0.0.1:4174/auth/callback',
  });
});
it('transport and rate failures offer recovery without rendering raw provider errors', async () => {
  sdk.resetPasswordForEmail
    .mockResolvedValueOnce({ error: { status: 429, message: 'PRIVATE' } })
    .mockRejectedValueOnce(Error('PRIVATE'));
  for (let i = 0; i < 2; i++) {
    const result = await requestPasswordAction(args('recuperar-senha', { email: 'test@example.com' }));
    expect(result.error).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  }
});
it('a short or mismatched password never reaches Auth', async () => {
  await savePasswordAction(args('definir-senha', { password: 'short', confirmation: 'short' }));
  await savePasswordAction(args('definir-senha', { password: 'long-password', confirmation: 'different' }));
  expect(sdk.updateUser).not.toHaveBeenCalled();
});
it('an expired link cannot update the password even if a form is posted directly', async () => {
  sdk.hasGrant.mockResolvedValue(false);
  expect(
    await savePasswordAction(args('definir-senha', { password: 'long-password', confirmation: 'long-password' })),
  ).toEqual({ invalid: true });
  expect(sdk.updateUser).not.toHaveBeenCalled();
});
it('password updates use the session SDK, clear the grant and return to login', async () => {
  sdk.hasGrant.mockResolvedValue(true);
  sdk.updateUser.mockResolvedValue({ error: null });
  sdk.signOut.mockResolvedValue({ error: null });
  const result = await savePasswordAction(
    args('definir-senha', { password: 'long-password', confirmation: 'long-password' }),
  );
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).headers.get('Location')).toBe('/login?senha=atualizada');
  expect(sdk.clear).toHaveBeenCalled();
  expect(sdk.signOut).toHaveBeenCalledWith({ scope: 'local' });
});
