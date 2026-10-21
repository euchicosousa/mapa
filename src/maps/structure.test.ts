import { expect, it } from 'vitest';
import type { MapNode } from './api';
import { reorganize } from './structure';
const n = (id: string, parentId: string | null, sortOrder = 0): MapNode => ({ id, parentId, sortOrder, text: id, createdBy: 'creator', updatedBy: 'creator', source: 'manual' });
const tree = [n('root', null), n('a','root',3), n('b','root',7), n('c','root',9), n('child','a'), n('grandchild','child'), n('dest-child','b',5)];
it('moves a whole branch, normalizes both groups and preserves immutable authorship', () => {
  const moved = reorganize(tree,'a','b',0,'editor')!;
  expect(moved.find((n) => n.id==='a')).toMatchObject({ parentId:'b',sortOrder:0,createdBy:'creator',updatedBy:'editor' });
  expect(moved.find((n) => n.id==='dest-child')?.sortOrder).toBe(1);
  expect(moved.find((n) => n.id==='b')?.sortOrder).toBe(0);
  expect(moved.find((n) => n.id==='c')?.sortOrder).toBe(1);
  expect(moved.filter((n) => ['child','grandchild'].includes(n.id))).toEqual(tree.filter((n) => ['child','grandchild'].includes(n.id)));
});
it('orders first/last deterministically and rejects invalid final indices', () => {
  const moved = reorganize(tree,'c','root',0,'editor')!;
  expect(moved.filter((n) => n.parentId==='root').sort((a,b) => a.sortOrder-b.sortOrder).map((n) => n.id)).toEqual(['c','a','b']);
  const back = reorganize(moved,'c','root',2,'editor')!;
  expect(back.find((n) => n.id==='c')?.sortOrder).toBe(2);
  for (const index of [-1,3,0.5,NaN]) expect(reorganize(tree,'a','root',index,'editor')).toBeNull();
});
it('rejects root, cycles, foreign parents and depth overflow without changing input', () => {
  const saved = structuredClone(tree);
  for (const [id,parent] of [['root','b'],['a','a'],['a','grandchild'],['a','foreign']]) expect(reorganize(tree,id,parent,0,'editor')).toBeNull();
  const deep = [n('root',null),...Array.from({length:30},(_,i)=>n(`d${i+1}`,i===0?'root':`d${i}`)),n('branch','root'),n('leaf','branch')];
  expect(reorganize(deep,'branch','d29',0,'editor')).toBeNull();
  expect(reorganize(deep,'branch','d28',0,'editor')).not.toBeNull();
  expect(tree).toEqual(saved);
});

it('counts every descendant in arbitrary order, preserving tree data through 500 nodes and depth 30', async () => {
  const { descendantCounts, subtreeIds } = await import('./structure');
  const { performanceBackup } = await import('../../tests/performance/fixture');
  for (const nodes of [tree, performanceBackup(500).nodes.map(node => ({ ...node, createdBy: 'creator', updatedBy: 'creator', source: 'manual' as const })), [n('r', null), ...Array.from({ length: 30 }, (_, i) => n(`d${i}`, i ? `d${i - 1}` : 'r'))]]) {
    const saved = structuredClone(nodes);
    const counts = descendantCounts([...nodes].reverse());
    for (const node of nodes) expect(counts.get(node.id)).toBe(subtreeIds(nodes, node.id).size - 1);
    expect(nodes).toEqual(saved);
  }
});
