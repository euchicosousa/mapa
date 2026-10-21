import { afterEach, expect, it, vi } from 'vitest';
import { createMapViewStore, VIEW_DEBOUNCE_MS } from './map-view';
import type { MapNode } from '../maps/api';
import type { ViewPreferences } from '../maps/preferences';
const nodes: MapNode[] = ['root', 'child'].map((id) => ({
  id,
  parentId: id === 'root' ? null : 'root',
  text: id,
  sortOrder: 0,
  createdBy: 'a',
  updatedBy: 'a',
  source: 'manual',
}));
const viewport = { x: 50, y: -20, zoom: 0.5 };
const tick = async () => {
  await vi.advanceTimersByTimeAsync(VIEW_DEBOUNCE_MS);
};
afterEach(() => vi.useRealTimers());
it('loads independently per account/map, discards stale ids and never persists a synthetic default', async () => {
  vi.useFakeTimers();
  const write = vi.fn(async () => {});
  const store = createMapViewStore('a', 'map', nodes, {
    read: async () => ({ viewport, collapsedIds: ['root', 'gone', 'root'] }),
    write,
  });
  await store.getState().load();
  expect(store.getState().collapsedIds).toEqual(['root']);
  expect(store.getState().viewport).toEqual(viewport);
  await tick();
  expect(write).toHaveBeenCalledWith('a', 'map', { viewport, collapsedIds: ['root'] });
  const other = createMapViewStore('b', 'other', nodes, { read: async () => null, write });
  await other.getState().load();
  other.getState().initializeViewport(viewport);
  await tick();
  expect(other.getState().collapsedIds).toEqual([]);
  expect(write).toHaveBeenCalledTimes(1);
});
it('debounces rapid gestures and serializes the latest view after an in-flight write', async () => {
  vi.useFakeTimers();
  let release: () => void = () => {};
  const write = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const store = createMapViewStore('a', 'map', nodes, { read: async () => null, write });
  await store.getState().load();
  store.getState().initializeViewport(viewport);
  store.getState().setCollapsed(['root']);
  store.getState().changeViewport({ ...viewport, x: 60 });
  await tick();
  expect(write).toHaveBeenCalledTimes(1);
  store.getState().changeViewport({ ...viewport, x: 70 });
  store.getState().setCollapsed([]);
  expect(write).toHaveBeenCalledTimes(1);
  release();
  await tick();
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[1][2]).toEqual({ viewport: { ...viewport, x: 70 }, collapsedIds: [] });
  expect(store.getState().status).toBe('saved');
});
it('keeps failed preferences local and retries without changing any content state', async () => {
  vi.useFakeTimers();
  const write = vi.fn().mockRejectedValueOnce(Error('network')).mockResolvedValue(undefined);
  const store = createMapViewStore('a', 'map', nodes, { read: async () => null, write });
  await store.getState().load();
  store.getState().initializeViewport(viewport);
  store.getState().setCollapsed(['root']);
  await tick();
  expect(store.getState()).toMatchObject({ status: 'error', collapsedIds: ['root'] });
  await store.getState().retry();
  expect(store.getState().status).toBe('saved');
  expect(write.mock.calls[0]).toEqual(write.mock.calls[1]);
});
it('never overwrites stored preferences after a failed read until an explicit successful retry', async () => {
  vi.useFakeTimers();
  const read = vi
    .fn()
    .mockRejectedValueOnce(Error('network'))
    .mockResolvedValue({ viewport, collapsedIds: ['root'] });
  const write = vi.fn(async () => {});
  const store = createMapViewStore('a', 'map', nodes, { read, write });
  await store.getState().load();
  store.getState().initializeViewport({ x: 0, y: 0, zoom: 1 });
  await tick();
  expect(write).not.toHaveBeenCalled();
  await store.getState().retry();
  expect(store.getState()).toMatchObject({ viewport, collapsedIds: ['root'], status: 'saved' });
});
it('preserves gestures made while a read failed, then writes them after successful retry', async () => {
  vi.useFakeTimers();
  const read = vi
    .fn()
    .mockRejectedValueOnce(Error())
    .mockResolvedValue({ viewport, collapsedIds: ['root'] });
  const write = vi.fn(async () => {});
  const store = createMapViewStore('a', 'map', nodes, { read, write });
  await store.getState().load();
  store.getState().initializeViewport(viewport);
  store.getState().changeViewport({ ...viewport, x: 80 });
  await tick();
  expect(write).not.toHaveBeenCalled();
  await store.getState().retry();
  await tick();
  expect(write).toHaveBeenCalledWith('a', 'map', { viewport: { ...viewport, x: 80 }, collapsedIds: [] });
});
it('flushes on exit and ignores a late read from an unmounted editor', async () => {
  vi.useFakeTimers();
  const write = vi.fn(async () => {});
  const store = createMapViewStore('a', 'map', nodes, { read: async () => null, write });
  await store.getState().load();
  store.getState().initializeViewport(viewport);
  store.getState().setCollapsed(['root']);
  store.getState().dispose();
  await tick();
  expect(write).toHaveBeenCalledTimes(1);
  let release: (value: ViewPreferences) => void = () => {};
  const other = createMapViewStore('b', 'map', nodes, {
    read: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    write,
  });
  const loading = other.getState().load();
  other.getState().dispose();
  release({ viewport, collapsedIds: ['root'] });
  await loading;
  expect(other.getState().collapsedIds).toEqual([]);
});
