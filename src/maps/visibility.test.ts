import { expect, it } from 'vitest';
import type { MapNode } from './api';
import { cleanCollapsed, hiddenCount, visibleAncestor, visibleNodes } from './visibility';
const nodes: MapNode[] = [
  ['root', null],
  ['a', 'root'],
  ['b', 'root'],
  ['child', 'a'],
  ['grandchild', 'child'],
].map(([id, parentId]) => ({
  id: id!,
  parentId,
  text: id!,
  sortOrder: 0,
  createdBy: 'a',
  updatedBy: 'a',
  source: 'manual',
}));
it('hides complete descendant branches without changing the document and counts nested collapsed nodes', () => {
  const original = structuredClone(nodes);
  expect(visibleNodes(nodes, ['a', 'child']).map((n) => n.id)).toEqual(['root', 'a', 'b']);
  expect(hiddenCount(nodes, 'a')).toBe(2);
  expect(visibleNodes(nodes, ['child']).map((n) => n.id)).toEqual(['root', 'a', 'b', 'child']);
  expect(visibleNodes(nodes, ['root']).map((n) => n.id)).toEqual(['root']);
  expect(nodes).toEqual(original);
});
it('drops deleted/foreign/duplicate ids and finds the visible ancestor of a hidden selection', () => {
  expect(cleanCollapsed(nodes, ['deleted', 'a', 'a', 'child'])).toEqual(['a', 'child']);
  expect(visibleAncestor(nodes, visibleNodes(nodes, ['a']), 'grandchild')).toBe('a');
  expect(visibleAncestor(nodes, visibleNodes(nodes, ['root']), 'grandchild')).toBe('root');
  expect(visibleAncestor(nodes, visibleNodes(nodes, []), 'grandchild')).toBe('grandchild');
});
