import type { MapNode } from './api';
import { MAP_DEPTH_MAX } from './limits';

export const siblingOrder = (a: MapNode, b: MapNode) =>
  a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export function subtreeIds(nodes: MapNode[], nodeId: string): Set<string> {
  const ids = new Set([nodeId]);
  for (let previous = -1; previous !== ids.size;) {
    previous = ids.size;
    for (const node of nodes) if (node.parentId && ids.has(node.parentId)) ids.add(node.id);
  }
  return ids;
}

// One postorder pass for every collapse badge; input is the server-validated tree.
export function descendantCounts(nodes: MapNode[]): Map<string, number> {
  const children = new Map<string, string[]>();
  for (const node of nodes)
    if (node.parentId) {
      const group = children.get(node.parentId);
      if (group) group.push(node.id);
      else children.set(node.parentId, [node.id]);
    }
  const counts = new Map<string, number>();
  const visit = (id: string): number => {
    const existing = counts.get(id);
    if (existing !== undefined) return existing;
    const count = (children.get(id) ?? []).reduce((total, child) => total + 1 + visit(child), 0);
    counts.set(id, count);
    return count;
  };
  for (const node of nodes) visit(node.id);
  return counts;
}

// Optimistic projection only. The RPC independently validates and assigns canonical orders.
export function reorganize(
  nodes: MapNode[],
  nodeId: string,
  parentId: string,
  targetIndex: number,
  actor: string,
): MapNode[] | null {
  const moving = nodes.find((node) => node.id === nodeId);
  if (!moving?.parentId || !nodes.some((node) => node.id === parentId) || subtreeIds(nodes, nodeId).has(parentId))
    return null;
  const siblings = nodes.filter((node) => node.parentId === parentId && node.id !== nodeId).sort(siblingOrder);
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > siblings.length) return null;
  siblings.splice(targetIndex, 0, moving);
  const orders = new Map(siblings.map((node, index) => [node.id, { parentId, sortOrder: index }]));
  if (moving.parentId !== parentId)
    nodes
      .filter((node) => node.parentId === moving.parentId && node.id !== nodeId)
      .sort(siblingOrder)
      .forEach((node, index) => orders.set(node.id, { parentId: moving.parentId!, sortOrder: index }));
  const result = nodes.map((node) => {
    const patch = orders.get(node.id);
    return patch && (patch.parentId !== node.parentId || patch.sortOrder !== node.sortOrder)
      ? { ...node, ...patch, updatedBy: actor }
      : node;
  });
  const byId = new Map(result.map((node) => [node.id, node]));
  for (const node of result) {
    let current: MapNode | undefined = node;
    let depth = 0;
    while (current?.parentId) {
      current = byId.get(current.parentId);
      if (!current || ++depth > MAP_DEPTH_MAX) return null;
    }
  }
  return result;
}
