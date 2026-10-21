import { expect, it } from 'vitest';
import { librarySearch, parseLibraryFilters } from './library';
it('round trips shared library URLs and rejects invalid identifiers and pages', () => {
  const filters = { query: 'Ideia & 100%_', project: 'none', owner: '00000000-0000-4000-8000-000000000001', page: 3 };
  expect(parseLibraryFilters(librarySearch(filters))).toEqual(filters);
  for (const page of ['0', '-1', '1.5', 'Infinity', '2147483648'])
    expect(parseLibraryFilters(new URLSearchParams({ page, project: 'invalid', owner: 'invalid' }))).toEqual({
      query: '',
      project: '',
      owner: '',
      page: 1,
    });
  expect(librarySearch({ query: '', project: '', owner: '', page: 1 }).toString()).toBe('');
});
