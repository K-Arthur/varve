/**
 * reflowLayoutChildren — recompute layout-owned child positions (and, for
 * fill/grow children, dimensions) of a flex or grid frame against the
 * frame's current box.
 *
 * This is the single entry point for "the frame changed size (or its
 * children changed) — re-layout", shared by:
 *
 * - inspector W/H edits (`setSelectedW`/`setSelectedH` in context.tsx)
 * - canvas resize commits (`TransformEngine.bakeNode`)
 * - insert/delete/reparent reflows (`applyFrameLayout` in context.tsx)
 *
 * Without this, resizing a flex/grid frame left its children exactly where
 * they were — only constraint-based frames reflowed. Positions are always
 * layout-owned; dimensions are applied only to children whose sizing asks
 * for it (`layoutSizing: 'fill'` or `grow > 0`), so hug/fixed children keep
 * their natural size.
 */
import type { Affine } from '@varve/engine';
import type { Document, NodeId, SceneNode } from '@varve/scene';
import { resizeNodeGeometry } from '../scene/resizeGeometry';
import { computeFlexLayout } from './computeFlexLayout';
import { applyGridLayout } from './computeGridLayout';

/**
 * True when the node participates in its parent's layout size negotiation
 * (fill or grow) — its box must track the layout result's dimensions.
 */
function participatesInSizing(child: SceneNode): boolean {
  if (child.layoutSizing === 'fill') return true;
  const grow = (child as { layoutStyle?: { grow?: number } }).layoutStyle?.grow ?? 0;
  return grow > 0;
}

/** Reflow a layout frame's children against the frame's current dimensions. */
export function reflowLayoutChildren(doc: Document, parentId: NodeId | null | undefined): Document {
  if (!parentId) return doc;
  const parent = doc.nodes[parentId];
  if (parent?.kind !== 'frame' || !parent.layoutStyle) return doc;
  if (parent.layoutStyle.mode === 'grid') return applyGridLayout(doc, parentId);

  const childNodes = parent.children
    .map((cid) => doc.nodes[cid])
    .filter((n): n is SceneNode => Boolean(n));
  const results = computeFlexLayout(parent, childNodes);
  if (results.length === 0) return doc;

  const nodes = { ...doc.nodes };
  for (const r of results) {
    const child = nodes[r.id];
    if (!child) continue;
    // Position is layout-owned, always.
    let updated: SceneNode = { ...child, transform: [1, 0, 0, 1, r.x, r.y] as Affine } as SceneNode;
    // Dimensions follow the layout result only for fill/grow children.
    if (participatesInSizing(child)) {
      const cur = nodeSize(updated);
      const wants = { w: r.w, h: r.h };
      if (Math.abs((cur.w ?? 0) - wants.w) > 0.001 || Math.abs((cur.h ?? 0) - wants.h) > 0.001) {
        updated = resizeNodeGeometry(updated, wants.w, wants.h);
      }
    }
    nodes[r.id] = updated;
  }
  return { ...doc, nodes };
}

/** Current rendered size of a node (geometry-based, ignoring transforms). */
function nodeSize(n: SceneNode): { w: number; h: number } {
  if (n.kind === 'shape') {
    const s = n.shape;
    if (s.kind === 'rect') return { w: s.w, h: s.h };
    if (s.kind === 'ellipse') return { w: s.rx * 2, h: s.ry * 2 };
    if (s.kind === 'circle') return { w: s.r * 2, h: s.r * 2 };
  }
  if (n.kind === 'frame') return { w: n.w ?? 0, h: n.h ?? 0 };
  if (n.kind === 'text') return { w: n.w ?? 0, h: n.h ?? 0 };
  return { w: 0, h: 0 };
}
