import { applyAffine, invertAffine, rectContains } from '@varve/engine';
import {
  buildParentIndexMap,
  type Document,
  type GroupNode,
  activePageNodes as getActivePageNodes,
  type NodeId,
  walkNodes,
  worldToPageAtPoint,
} from '@varve/scene';
import { type Affine, transformRect } from '@varve/shared';
import type { FrameSpatialIndex } from './spatialIndex';
import { nodeLocalBounds, nodeWorldTransform } from './world';

export interface FindContainingSurfaceOptions {
  /**
   * Fall back to the page under the point when no frame or group contains it.
   *
   * Off by default, deliberately. Every caller shares this resolver, including
   * draw-to-create, and `createDocument` always yields a page — so defaulting
   * this on would silently reparent every newly drawn shape in every document
   * into a page content root. That is a much larger semantic change than the
   * drag-drop adoption it exists for, and it belongs to whichever call sites
   * opt in.
   */
  adoptIntoPage?: boolean;
}

/**
 * Deepest containing surface at the given world point.
 *
 * A frame or group containing the point always wins (deepest first). With
 * `adoptIntoPage`, a point over a page with no frame under it resolves to that
 * page's content root, so dropping onto a page makes the page the owner and
 * the node exports with the page it visually belongs to. Otherwise the result
 * is null and the caller parents to the document root — which is what keeps
 * bare pasteboard placement working.
 *
 * A frame is never invented for a bare drop: neither Figma nor Illustrator
 * does that, and a surprise container breaks later transforms and export
 * membership.
 *
 * Locked and hidden nodes are skipped.
 */
export function findContainingFrameInDoc(
  doc: Document,
  world: { x: number; y: number },
  frameIndex?: FrameSpatialIndex | null,
  options: FindContainingSurfaceOptions = {},
): NodeId | null {
  let deepest: NodeId | null = null;
  let deepestDepth = -1;

  // Scoped to the active page: an unscoped walk here would let a newly
  // drawn shape silently auto-parent into a frame that belongs to a
  // different (invisible) page, making the shape vanish from the canvas.
  const entries = walkNodes(doc, getActivePageNodes(doc));
  // This runs on every pointer move during a drag (SelectTool.onDragMove's
  // drop-target-frame check). nodeWorldTransform falls back to an O(n)
  // linear scan (getParent) per call when no parentIndex is passed, so
  // checking F candidate frames/groups cost O(F*n) per pointer move.
  // buildParentIndexMap is one O(n) pass; reusing it below makes the
  // per-candidate lookup O(1).
  const parentIndex = buildParentIndexMap(doc);

  // If a frame index is provided, use it to filter candidates first
  const candidates = frameIndex
    ? (() => {
        const cellKey = `${Math.floor(world.x / 64)},${Math.floor(world.y / 64)}`;
        return frameIndex.grid.get(cellKey) ?? new Set();
      })()
    : null;

  for (const [nid, entry] of entries) {
    const n = entry.node;
    if (n.locked || n.visible === false) continue;
    if (n.kind !== 'frame' && n.kind !== 'group') continue;

    // Skip if frame index is provided and this node isn't in the candidate set
    if (candidates && !candidates.has(nid)) continue;

    if (n.kind === 'frame') {
      // Inverse-transform the world point into the frame's local space so
      // containment is correct for rotated/scaled frames (not just AABB).
      const frameWorld = nodeWorldTransform(doc, nid, parentIndex);
      const frameLocal = invertAffine(frameWorld);
      const localPt = applyAffine(frameLocal, [world.x, world.y]);
      if (localPt[0] >= 0 && localPt[0] <= n.w && localPt[1] >= 0 && localPt[1] <= n.h) {
        if (entry.depth > deepestDepth) {
          deepest = nid;
          deepestDepth = entry.depth;
        }
      }
    } else {
      // Inverse-transform the world point into group-local space and
      // check each child's local bounds (transformed by the child's own
      // transform). This avoids false positives from AABB-only checks
      // on rotated/scaled groups (matching the frame logic above).
      const groupWorld = nodeWorldTransform(doc, nid, parentIndex);
      const groupInv = invertAffine(groupWorld);
      const localPt = applyAffine(groupInv, [world.x, world.y]);
      const groupNode = doc.nodes[nid] as GroupNode;
      if (!groupNode?.children) continue;
      for (const childId of groupNode.children) {
        const child = doc.nodes[childId];
        if (!child) continue;
        const childLocal = nodeLocalBounds(child, doc);
        if (!childLocal) continue;
        // Transform child's own local bounds by its transform to get
        // bounds in group-space, then check if the local point is inside
        const childBoundsInGroup = transformRect(
          (child.transform ?? [1, 0, 0, 1, 0, 0]) as Affine,
          childLocal,
        );
        if (rectContains(childBoundsInGroup, [localPt[0], localPt[1]])) {
          if (entry.depth > deepestDepth) {
            deepest = nid;
            deepestDepth = entry.depth;
          }
          break;
        }
      }
    }
  }
  if (deepest) return deepest;
  if (!options.adoptIntoPage) return null;

  // No frame or group under the point. On a page-based document the page
  // itself is a surface that can adopt content, so fall back to its content
  // root. Off every page this returns null and the caller uses the document
  // root (the pasteboard), which is what keeps bare canvas placement working.
  const page = worldToPageAtPoint(doc, world);
  if (!page) return null;
  const owner = doc.pages?.find((p) => p.id === page.pageId);
  const contentRoot = owner ? doc.nodes[owner.contentRoot] : undefined;
  if (!contentRoot || contentRoot.locked || contentRoot.visible === false) return null;
  return owner ? owner.contentRoot : null;
}
