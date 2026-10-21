import { afterEach, expect, it } from 'vitest';
import { queryClient } from '../app/query-client';
import { privacySnapshot, lockPrivateData, unlockPrivateData } from './privacy';
import { useEditorStore } from '../state/editor';
afterEach(() => {
  queryClient.clear();
  useEditorStore.getState().reset();
});
it('removes remote cache and editor identity before exposing another session', () => {
  queryClient.setQueryData(['team', 'previous-user'], [{ name: 'Private colleague' }]);
  useEditorStore.setState({ activeMapId: 'old-map', selectedNodeId: 'old-node' });
  const ticket = lockPrivateData();
  expect(privacySnapshot()).toBe(true);
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  expect(useEditorStore.getState().activeMapId).toBeNull();
  expect(useEditorStore.getState().selectedNodeId).toBeNull();
  unlockPrivateData(ticket);
  expect(privacySnapshot()).toBe(false);
});
it('an obsolete request cannot unlock a newer session transition', () => {
  const first = lockPrivateData();
  const second = lockPrivateData();
  unlockPrivateData(first);
  expect(privacySnapshot()).toBe(true);
  unlockPrivateData(second);
  expect(privacySnapshot()).toBe(false);
});
it('only a different account or sign-out counts as an identity change', async () => {
  const { identityChanged } = await import('./events');
  const session = (id: string) => ({ user: { id } }) as Parameters<typeof identityChanged>[1];
  expect(identityChanged(undefined, session('a'))).toBe(false);
  expect(identityChanged('a', session('a'))).toBe(false);
  expect(identityChanged('a', session('c'))).toBe(true);
  expect(identityChanged('a', null)).toBe(true);
  expect(identityChanged(null, session('a'))).toBe(true);
});
