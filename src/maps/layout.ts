import { siblingOrder } from './structure';
import { stratify, tree } from 'd3-hierarchy';
import type { MapNode } from './api';

export const NODE_WIDTH = 240;
export const COLUMN_GAP = 320;
export const ROW_GAP = 32;
export const DEFAULT_NODE_HEIGHT = 100;
export type NodeHeights = Readonly<Record<string, number>>;

// d3 positions node centers. Separation accounts for both rendered heights,
// including cousins at the contours of adjacent subtrees.
export function layoutMap(nodes: MapNode[], heights: NodeHeights = {}) {
  if (nodes.length === 0) return [];
  const height = (id: string) => heights[id] ?? DEFAULT_NODE_HEIGHT;
  const root = stratify<MapNode>()
    .id((node) => node.id)
    .parentId((node) => node.parentId)(nodes);
  root.sort((a, b) => siblingOrder(a.data, b.data));
  tree<MapNode>()
    .nodeSize([1, COLUMN_GAP])
    .separation((a, b) => (height(a.id!) + height(b.id!)) / 2 + ROW_GAP)(root);
  return root.descendants().map((entry) => ({
    node: entry.data,
    x: entry.y ?? 0,
    y: (entry.x ?? 0) - height(entry.id!) / 2 + height(root.id!) / 2,
  }));
}

// Reveal a new child with the smallest translation; never change the user's zoom.
export function revealNodeViewport(
  viewport: { x: number; y: number; zoom: number },
  node: { x: number; y: number; height: number },
  size: { width: number; height: number },
) {
  const shift = (start: number, length: number, available: number) => {
    const padding = 64;
    if (length > available - padding * 2) return available / 2 - (start + length / 2);
    if (start < padding) return padding - start;
    if (start + length > available - padding) return available - padding - start - length;
    return 0;
  };
  return {
    ...viewport,
    x: viewport.x + shift(node.x * viewport.zoom + viewport.x, NODE_WIDTH * viewport.zoom, size.width),
    y: viewport.y + shift(node.y * viewport.zoom + viewport.y, node.height * viewport.zoom, size.height),
  };
}
