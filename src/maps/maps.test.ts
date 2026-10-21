import { expect, it } from 'vitest';
import { MapError, toMapError } from './api';
import { layoutMap } from './layout';

it('maps typed server codes and hides everything else as unavailable', () => {
  expect(toMapError({ message: 'FORBIDDEN' }).code).toBe('FORBIDDEN');
  expect(toMapError({ message: 'CONFLICT' }).code).toBe('CONFLICT');
  expect(toMapError({ message: 'permission denied for function create_map' }).code).toBe('UNAVAILABLE');
  expect(toMapError(null)).toBeInstanceOf(MapError);
});

it('places the root at the origin and children to its right in sort order', () => {
  const base = { createdBy: 'u', updatedBy: 'u', source: 'manual' as const };
  const placed = layoutMap([
    { ...base, id: 'r', parentId: null, text: 'Raiz', sortOrder: 0 },
    { ...base, id: 'b', parentId: 'r', text: 'B', sortOrder: 1 },
    { ...base, id: 'a', parentId: 'r', text: 'A', sortOrder: 0 },
  ]);
  const byId = Object.fromEntries(placed.map((entry) => [entry.node.id, entry]));
  expect([byId.r.x, byId.r.y]).toEqual([0, 0]);
  expect(byId.a.x).toBeGreaterThan(0);
  expect(byId.a.y).toBeLessThan(byId.b.y);
});

it('separates 50 variable-height nodes, including cousins and internal nodes', () => {
  const base = { createdBy: 'u', updatedBy: 'u', source: 'manual' as const };
  const nodes = Array.from({ length: 50 }, (_, index) => ({
    ...base,
    id: String(index),
    parentId: index === 0 ? null : String(Math.floor((index - 1) / 4)),
    text: 'Longo '.repeat(index + 1),
    sortOrder: index,
  }));
  const heights = Object.fromEntries(nodes.map((node, index) => [node.id, 50 + (index % 7) * 57]));
  for (const measured of [heights, { ...heights, '3': 900, '12': 700 }]) {
    const placed = layoutMap(nodes, measured);
    for (const a of placed)
      for (const b of placed) {
        if (a.node.id >= b.node.id || a.x !== b.x) continue;
        expect(a.y + measured[a.node.id] + 31.99 <= b.y || b.y + measured[b.node.id] + 31.99 <= a.y).toBe(true);
      }
  }
});
