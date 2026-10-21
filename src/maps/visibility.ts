import type { MapNode } from './api';
import { subtreeIds } from './structure';

export function cleanCollapsed(nodes: MapNode[], ids: string[]): string[] {
  const existing = new Set(nodes.map((node) => node.id));
  return [...new Set(ids)].filter((id) => existing.has(id));
}
export function visibleNodes(nodes: MapNode[], collapsedIds: string[]): MapNode[] {
  const collapsed = new Set(collapsedIds);
  const children = new Map<string, string[]>();
  for (const node of nodes) if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
  const visible = new Set<string>();
  const visit = (id: string) => {
    if (visible.has(id)) return;
    visible.add(id);
    if (!collapsed.has(id)) for (const child of children.get(id) ?? []) visit(child);
  };
  for (const root of nodes.filter((node) => node.parentId === null)) visit(root.id);
  return nodes.filter((node) => visible.has(node.id));
}
export const hiddenCount = (nodes: MapNode[], id: string) => subtreeIds(nodes, id).size - 1;
export function visibleAncestor(nodes: MapNode[], visible: MapNode[], selectedId: string): string | null {
  const shown = new Set(visible.map((node) => node.id));
  const byId = new Map(nodes.map((node) => [node.id,node]));
  let id: string | null = selectedId;
  for (let depth=0; id && depth<=30; depth++) {
    if (shown.has(id)) return id;
    id = byId.get(id)?.parentId ?? null;
  }
  return null;
}
