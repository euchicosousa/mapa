import { expect, it } from 'vitest';
import { safeReturnTo } from './return-to';
it('accepts internal protected destinations', () => {
  for (const path of ['/mapas', '/mapas/abc-123', '/equipe', '/mapas?busca=ideia'])
    expect(safeReturnTo(path)).toBe(path);
});
it('rejects external origins, encoded redirects and auth loops', () => {
  for (const path of [
    null,
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    '/%2fevil.test',
    '/mapas%2f..',
    '/login',
    '/auth/callback',
    '/equipe\n',
    '/mapas/../../login',
  ])
    expect(safeReturnTo(path)).toBe('/mapas');
});
