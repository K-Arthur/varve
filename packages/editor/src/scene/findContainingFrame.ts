import { applyAffine, invertAffine, rectContains } from '@strata/engine';
import {
  type Document,
  type GroupNode,
  activePageNodes as getActivePageNodes,
  type NodeId,
  walkNodes,
} from '@strata/scene';
import { type Affine, transformRect } from '@strata/shared';
import type { FrameSpatialIndex } from './spatialIndex';
import { nodeLocalBounds, nodeWorldTransform } from './world';

/** Deepest containing frame/group at the given world point. Skips locked/hidden. */
export function findContainingFrameInDoc(
  doc: Document,
  world: { x: number; y: number },
  frameIndex?: FrameSpatialIndex | null,
): NodeId | null {
  let deepest: NodeId | null = null;
  let deepestDepth = -1;

  // Scoped to the active page: an unscoped walk here would let a newly
  // drawn shape silently auto-parent into a frame that belongs to a
  // different (invisible) page, making the shape vanish from the canvas.
  const entries = walkNodes(doc, getActivePageNodes(doc));

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
      const frameWorld = nodeWorldTransform(doc, nid);
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
      const groupWorld = nodeWorldTransform(doc, nid);
      const groupInv = invertAffine(groupWorld);
      const localPt = applyAffine(groupInv, [world.x, world.y]);
      const groupNode = doc.nodes[nid] as GroupNode;
      if (!groupNode?.children) continue;
      for (const childId of groupNode.children) {
        const child = doc.nodes[childId];
        if (!child) continue;
        const childLocal = nodeLocalBounds(child);
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
  return deepest;
}
