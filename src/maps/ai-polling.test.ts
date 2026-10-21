import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { acceptGeneration, watchGeneration } from './ai-polling';
import type { AIGeneration } from './ai';
const job: AIGeneration = {
  id: 'job',
  mapId: 'map',
  parentNodeId: 'node',
  editorSessionId: 'session',
  state: 'running',
  errorCode: null,
  result: null,
};
let hidden = false;
const listeners = new Set<EventListenerOrEventListenerObject>();
const visibility = {
  get hidden() {
    return hidden;
  },
  addEventListener: (_name: string, listener: EventListenerOrEventListenerObject) => {
    listeners.add(listener);
  },
  removeEventListener: (_name: string, listener: EventListenerOrEventListenerObject) => {
    listeners.delete(listener);
  },
};
const change = (value: boolean) => {
  hidden = value;
  for (const listener of listeners) if (typeof listener === 'function') listener(new Event('visibilitychange'));
};
beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  listeners.clear();
});
afterEach(() => vi.useRealTimers());
it('polls active jobs once per second, stops while hidden, and resumes immediately on visibility', async () => {
  const read = vi.fn(async () => job),
    receive = vi.fn(() => true),
    watcher = watchGeneration({ read, receive, pending: () => false, visibility });
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(read).toHaveBeenCalledTimes(2);
  change(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(read).toHaveBeenCalledTimes(2);
  change(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(3);
  watcher.dispose();
  await vi.advanceTimersByTimeAsync(5000);
  change(false);
  expect(read).toHaveBeenCalledTimes(3);
  expect(listeners.size).toBe(0);
});
it('retries a lost initial status read and stops after a terminal confirmation', async () => {
  const read = vi
    .fn()
    .mockRejectedValueOnce(Error('offline'))
    .mockResolvedValue({ ...job, state: 'applied' });
  const watcher = watchGeneration({ read, receive: () => false, pending: () => false, visibility });
  await vi.advanceTimersByTimeAsync(1000);
  expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(5000);
  expect(read).toHaveBeenCalledTimes(2);
  watcher.dispose();
});
it('does not overlap slow reads and ignores responses after disposal', async () => {
  let resolve!: (job: AIGeneration) => void;
  const read = vi.fn(
      () =>
        new Promise<AIGeneration>((done) => {
          resolve = done;
        }),
    ),
    receive = vi.fn(() => true);
  const watcher = watchGeneration({ read, receive, pending: () => true, visibility });
  watcher.refresh();
  watcher.refresh();
  await vi.advanceTimersByTimeAsync(3000);
  expect(read).toHaveBeenCalledOnce();
  watcher.dispose();
  resolve(job);
  await vi.advanceTimersByTimeAsync(0);
  expect(receive).not.toHaveBeenCalled();
});
it('never replaces a terminal cancellation with a late running/start response', () => {
  const cancelled = { ...job, state: 'cancelled' as const };
  expect(acceptGeneration(cancelled, job)).toBe(cancelled);
  const applied = { ...job, state: 'applied' as const };
  expect(acceptGeneration(applied, job)).toBe(applied);
  expect(acceptGeneration(cancelled, { ...job, id: 'new-job' }).id).toBe('new-job');
});

it('stops rejected-access reads even when there was a pending request', async () => {
  const read = vi.fn().mockRejectedValue(Error('revoked'));
  const failure = vi.fn(() => false);
  const watcher = watchGeneration({ read, receive: () => false, pending: () => true, failure, visibility });
  await vi.advanceTimersByTimeAsync(5000);
  expect(read).toHaveBeenCalledOnce();
  expect(failure).toHaveBeenCalledOnce();
  watcher.dispose();
});
