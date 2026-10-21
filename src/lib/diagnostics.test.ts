import { expect, test, vi } from 'vitest';
import { captureFailure, connectDiagnostics, readDiagnostics } from './diagnostics';

test('failure capture excludes identifiers, query/hash, error content and keeps bounded copies', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  window.history.replaceState({}, '', '/mapas/private-map-id?token=secret#private-content');
  const disconnect = connectDiagnostics();
  window.dispatchEvent(new ErrorEvent('error', { message: 'PRIVATE_MAP_TEXT', error: new Error('PRIVATE_TOKEN') }));
  expect(readDiagnostics().at(-1)).toMatchObject({ kind: 'runtime', route: '/mapas/:id', version: 'test' });
  window.history.replaceState({}, '', '/private-unknown-title?token=secret');
  for (let i = 0; i < 25; i++) captureFailure('route');
  const records = readDiagnostics();
  expect(records).toHaveLength(20);
  expect(records.at(-1)?.route).toBe('/404');
  expect(JSON.stringify(warn.mock.calls)).not.toMatch(/PRIVATE|secret|private-/);
  records[0].route = 'modified';
  expect(readDiagnostics()[0].route).toBe('/404');
  disconnect();
  warn.mockRestore();
  window.history.replaceState({}, '', '/');
});
