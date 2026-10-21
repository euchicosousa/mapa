import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  unsubscribe: vi.fn(),
  lock: vi.fn(),
  unlock: vi.fn(),
  authRunning: vi.fn(() => false),
}));
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: mocks.unsubscribe } } }) } },
}));
vi.mock('./privacy', () => ({ lockPrivateData: mocks.lock, unlockPrivateData: mocks.unlock }));
vi.mock('./transitions', () => ({ authActionRunning: mocks.authRunning }));
import { connectAuthEvents } from './events';
import { notifyAccessDenied } from './access-events';
let dispose: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.authRunning.mockReturnValue(false);
});
afterEach(() => {
  dispose?.();
  vi.useRealTimers();
});
it('focus revalidation waits for navigation to finish without clearing drafts prematurely', async () => {
  let idle = false;
  const revalidate = vi.fn().mockResolvedValue(undefined);
  dispose = connectAuthEvents({ isIdle: () => idle, revalidate });
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(100);
  expect(revalidate).not.toHaveBeenCalled();
  expect(mocks.lock).not.toHaveBeenCalled();
  idle = true;
  await vi.advanceTimersByTimeAsync(50);
  expect(revalidate).toHaveBeenCalledTimes(1);
});
it('an access-denied signal is not dropped during an action and is removed on dispose', async () => {
  mocks.authRunning.mockReturnValue(true);
  const revalidate = vi.fn().mockResolvedValue(undefined);
  dispose = connectAuthEvents({ isIdle: () => true, revalidate });
  notifyAccessDenied();
  await vi.advanceTimersByTimeAsync(100);
  expect(revalidate).not.toHaveBeenCalled();
  mocks.authRunning.mockReturnValue(false);
  await vi.advanceTimersByTimeAsync(50);
  expect(revalidate).toHaveBeenCalledTimes(1);
  dispose();
  notifyAccessDenied();
  await vi.advanceTimersByTimeAsync(100);
  expect(revalidate).toHaveBeenCalledTimes(1);
});
