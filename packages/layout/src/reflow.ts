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
 * Nested layout: the pass is two-phase per call —
 *
 *   1. Bottom-up: `resolveIntrinsicSizes` recomputes every hug-sized frame's
 *      own box in `parentId`'s subtree from its (already-resolved) children,
 *      deepest first.
 *   2. Top-down: `parentId` is laid out against its (possibly now hug-
 *      resolved) box, then any child that is itself a layout frame is
 *      reflowed recursively against ITS newly finalized box.
 *
 * If step 1 changed `parentId`'s own size (it hugs), that invalidates its
 * own parent's flow/hug measurement, so step 3 reflows the grandparent too.
 * Recursion is bounded by tree depth — no fixed-point loop is needed because
 * a fill child never contributes its own size to a hug measurement (see
 * intrinsicSize.ts), so a hug-parent/fill-child pair can't oscillate.
 *
 * Positions are always layout-owned; dimensions are applied per axis only
 * when that axis's sizing isn't 'fixed' — hug axes re-apply their own
 * (unchanged) intrinsic size, fill/grow axes take the layout result.
 */
import type { Affine } from '@varve/engine';
import type { Document, NodeId, SceneNode } from '@varve/scene';
import { getParent } from '@varve/scene';
import { computeFlexLayout } from './computeFlexLayout';
import { applyGridLayout } from './computeGridLayout';
import { resolveIntrinsicSizes } from './intrinsicSize';
import { axisSizing } from './measure';
import { resizeNodeGeometry } from './resizeGeometry';

/** Reflow a layout frame's children against the frame's current dimensions. */
export function reflowLayoutChildren(doc: Document, parentId: NodeId | null | undefined): Document {
  if (!parentId) return doc;
  const parent = doc.nodes[parentId];
  if (parent?.kind !== 'frame' || !parent.layoutStyle) return doc;

  const beforeW = parent.w;
  const beforeH = parent.h;

  // 1. Bottom-up: resolve hug sizes across this frame's whole subtree.
  let next = resolveIntrinsicSizes(doc, parentId);
  const resolvedParent = next.nodes[parentId];
  if (resolvedParent?.kind !== 'frame' || !resolvedParent.layoutStyle) return next;

  // 2. Top-down: lay out this frame's own children against its box.
  if (resolvedParent.layoutStyle.mode === 'grid') {
    next = applyGridLayout(next, parentId);
  } else {
    const childNodes = resolvedParent.children
      .map((cid) => next.nodes[cid])
      .filter((n): n is SceneNode => Boolean(n));
    const results = computeFlexLayout(resolvedParent, childNodes);
    if (results.length > 0) {
      const nodes = { ...next.nodes };
      for (const r of results) {
        const child = nodes[r.id];
        if (!child) continue;
        let updated: SceneNode = {
          ...child,
          transform: [1, 0, 0, 1, r.x, r.y] as Affine,
        } as SceneNode;
        const cur = nodeSize(updated);
        const wantW = axisSizing(child, 'width') === 'fixed' ? cur.w : r.w;
        const wantH = axisSizing(child, 'height') === 'fixed' ? cur.h : r.h;
        if (Math.abs(cur.w - wantW) > 0.001 || Math.abs(cur.h - wantH) > 0.001) {
          updated = resizeNodeGeometry(updated, wantW, wantH);
        }
        nodes[r.id] = updated;
      }
      next = { ...next, nodes };
    }
  }

  // 3. Recurse into child frames that are themselves layout containers, now
  //    that their box has been finalized by this pass.
  const finalParent = next.nodes[parentId];
  if (finalParent?.kind === 'frame') {
    for (const childId of finalParent.children) {
      const child = next.nodes[childId];
      if (child?.kind === 'frame' && child.layoutStyle) {
        next = reflowLayoutChildren(next, childId);
      }
    }
  }

  // 4. Upward propagation: if this frame's own size changed (it hugs), its
  //    parent's measurement is stale — reflow the grandparent too.
  const grownParent = next.nodes[parentId];
  if (grownParent?.kind === 'frame' && (grownParent.w !== beforeW || grownParent.h !== beforeH)) {
    const grandparentId = getParent(next, parentId);
    const grandparent = grandparentId ? next.nodes[grandparentId] : undefined;
    if (grandparentId && grandparent?.kind === 'frame' && grandparent.layoutStyle) {
      next = reflowLayoutChildren(next, grandparentId);
    }
  }

  return next;
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
