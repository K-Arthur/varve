/**
 * Auto-arrange selected nodes within a bounding area.
 * Delegates to existing layout engines (flex, grid, circle, force).
 */
import type { Document, NodeId, SceneNode } from '@strata/scene';
import { computeCircleLayout } from './computeCircleLayout';
import { computeForceLayout } from './computeForceLayout';

export type ArrangeLayoutType = 'grid' | 'circle' | 'flow' | 'flex-row' | 'flex-column';

export interface AutoArrangeOptions {
  layoutType: ArrangeLayoutType;
  gap: number;
  padding: number;
  radius?: number;
  startAngle?: number;
  rotateItems?: boolean;
  idealLength?: number;
}

function nodeSize(n: SceneNode): { width: number; height: number } {
  if (n.kind === 'shape') {
    const s = n.shape;
    if (s.kind === 'rect') return { width: s.w, height: s.h };
    if (s.kind === 'ellipse') return { width: s.rx * 2, height: s.ry * 2 };
    if (s.kind === 'circle') return { width: s.r * 2, height: s.r * 2 };
    if (s.kind === 'line' || s.kind === 'arrow')
      return { width: Math.abs(s.to[0] - s.from[0]), height: Math.abs(s.to[1] - s.from[1]) };
  }
  if (n.kind === 'frame') return { width: n.w, height: n.h };
  if (n.kind === 'text') return { width: n.w ?? 100, height: n.h ?? 24 };
  return { width: 100, height: 100 };
}

function defaultBoundsForNodes(nodes: Array<{ id: string; width: number; height: number }>): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, 0);
    minY = Math.min(minY, 0);
    maxX = Math.max(maxX, n.width);
    maxY = Math.max(maxY, n.height);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 400, height: 400 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function computeAutoArrange(
  nodes: Array<{ id: string; width: number; height: number }>,
  bounds: { x: number; y: number; width: number; height: number },
  options: AutoArrangeOptions,
  edges?: Array<{ source: string; target: string }>,
): Map<string, { x: number; y: number; rotation?: number }> {
  const result = new Map<string, { x: number; y: number; rotation?: number }>();
  if (nodes.length === 0) return result;

  const { gap, padding } = options;

  switch (options.layoutType) {
    case 'grid': {
      const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
      nodes.forEach((node, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        result.set(node.id, {
          x: bounds.x + padding + col * (node.width + gap),
          y: bounds.y + padding + row * (node.height + gap),
        });
      });
      break;
    }
    case 'circle': {
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;
      const circleResults = computeCircleLayout(
        nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
        {
          centerX,
          centerY,
          radius: options.radius ?? Math.min(bounds.width, bounds.height) * 0.4,
          startAngle: options.startAngle ?? -Math.PI / 2,
          rotateItems: options.rotateItems ?? false,
        },
      );
      for (const r of circleResults) {
        result.set(r.id, { x: r.x, y: r.y, rotation: r.rotation });
      }
      break;
    }
    case 'flow': {
      const forceResults = computeForceLayout(nodes, edges ?? [], {
        width: bounds.width - padding * 2,
        height: bounds.height - padding * 2,
        idealLength: options.idealLength ?? 100,
        repulsion: 100,
        attraction: 0.01,
        maxIterations: 100,
        convergenceThreshold: 1,
      });
      for (const r of forceResults) {
        result.set(r.id, { x: bounds.x + padding + r.x, y: bounds.y + padding + r.y });
      }
      break;
    }
    case 'flex-row':
    case 'flex-column': {
      const isRow = options.layoutType === 'flex-row';
      let cursor = isRow ? bounds.x + padding : bounds.y + padding;
      for (const node of nodes) {
        const x = isRow ? cursor : bounds.x + padding;
        const y = isRow ? bounds.y + padding : cursor;
        result.set(node.id, { x, y });
        cursor += (isRow ? node.width : node.height) + gap;
      }
      break;
    }
  }

  return result;
}

export function applyAutoArrange(
  doc: Document,
  nodeIds: NodeId[],
  options: AutoArrangeOptions,
): Document {
  const sceneNodes = nodeIds.map((id) => doc.nodes[id]).filter((n): n is SceneNode => n != null);
  if (sceneNodes.length === 0) return doc;

  const items = sceneNodes.map((n) => ({
    id: n.id,
    ...nodeSize(n),
  }));

  const bounds = defaultBoundsForNodes(items);

  const layout = computeAutoArrange(items, bounds, options);

  const nodes: Record<NodeId, SceneNode> = {};
  for (const [id, n] of Object.entries(doc.nodes)) {
    nodes[id] = n;
  }

  for (const [id, pos] of layout) {
    const existing = nodes[id];
    if (existing) {
      nodes[id] = { ...existing, transform: [1, 0, 0, 1, pos.x, pos.y] };
    }
  }

  return { ...doc, nodes };
}
