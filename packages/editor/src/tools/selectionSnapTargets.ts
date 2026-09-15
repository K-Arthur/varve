import { type Document, getGuidesForPage, type NodeId, pageBoundsInWorld } from '@varve/scene';
import { applyAffine } from '@varve/shared';
import { resolveLayoutGuideGeometry } from '../canvas/layoutGridGeometry';
import { nodeWorldBounds, nodeWorldTransform } from '../scene/world';
import type { SnapLineTarget } from './snapping';

export interface SelectionSnapTargetOptions {
  includePages: boolean;
  includeGuides: boolean;
}

function addRectEdges(
  targets: SnapLineTarget[],
  bounds: { x: number; y: number; w: number; h: number },
  id: string,
  type: SnapLineTarget['type'],
): void {
  const right = bounds.x + bounds.w;
  const bottom = bounds.y + bounds.h;
  targets.push(
    { axis: 'vertical', position: bounds.x, id: `${id}:left`, type },
    { axis: 'vertical', position: right, id: `${id}:right`, type },
    { axis: 'horizontal', position: bounds.y, id: `${id}:top`, type },
    { axis: 'horizontal', position: bottom, id: `${id}:bottom`, type },
  );
}

function addLayoutGuideLines(targets: SnapLineTarget[], doc: Document, frameId: NodeId): void {
  const frame = doc.nodes[frameId];
  if (frame?.kind !== 'frame') return;
  const world = nodeWorldTransform(doc, frameId);
  if (!Number.isFinite(world[0]) || !Number.isFinite(world[3])) return;
  // Layout guide coordinates are frame-local. A rotated/sheared frame needs a
  // proper oriented-line projection, which this axis-aligned handle solver
  // does not promise; movement has the same deliberate boundary.
  if (Math.abs(world[1]) >= 1e-8 || Math.abs(world[2]) >= 1e-8) return;
  const authored = doc.gridSettings?.layoutGrids?.[frameId] ?? [];
  const grids = Array.isArray(authored) ? authored : [authored];
  for (const grid of grids) {
    if (!grid.snapEnabled) continue;
    const geometry = resolveLayoutGuideGeometry(grid, frame.w, frame.h);
    if (!geometry.valid) continue;
    for (const x of geometry.vertical) {
      const worldPoint = applyAffine(world, [x, 0]);
      targets.push({
        axis: 'vertical',
        position: worldPoint[0],
        id: `layout-grid:${frameId}:vertical:${x}`,
        type: 'layout-grid',
      });
    }
    for (const y of geometry.horizontal) {
      const worldPoint = applyAffine(world, [0, y]);
      targets.push({
        axis: 'horizontal',
        position: worldPoint[1],
        id: `layout-grid:${frameId}:horizontal:${y}`,
        type: 'layout-grid',
      });
    }
  }
}

/**
 * Build the non-object line targets used by selection-handle transforms.
 * Object geometry remains in `otherBounds`; keeping these categories separate
 * prevents a page edge from becoming a size-match target.
 */
export function buildSelectionSnapLineTargets(
  doc: Document,
  selection: readonly NodeId[],
  parentIndex: ReadonlyMap<NodeId, NodeId | null>,
  options: SelectionSnapTargetOptions,
): SnapLineTarget[] {
  const targets: SnapLineTarget[] = [];
  if (options.includePages) {
    for (const page of doc.pages ?? []) {
      const bounds = pageBoundsInWorld(doc, page.id);
      if (bounds) addRectEdges(targets, bounds, `page:${page.id}`, 'edge');
    }
    const parentId = selection[0] ? (parentIndex.get(selection[0]) ?? null) : null;
    const parent = parentId ? doc.nodes[parentId] : undefined;
    if (parentId && parent?.kind === 'frame') {
      const bounds = nodeWorldBounds(doc, parentId);
      if (bounds) addRectEdges(targets, bounds, `frame:${parentId}`, 'edge');
    }
  }

  if (!options.includeGuides) return targets;
  for (const guide of getGuidesForPage(doc, doc.activePageId)) {
    if (!Number.isFinite(guide.position)) continue;
    targets.push({
      axis: guide.axis,
      position: guide.position,
      id: `guide:${guide.id}`,
      type: 'guide',
    });
  }
  const parentId = selection[0] ? (parentIndex.get(selection[0]) ?? null) : null;
  if (parentId) addLayoutGuideLines(targets, doc, parentId);
  return targets;
}
