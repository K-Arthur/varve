/**
 * World-space transform and bounds helpers for the editor.
 *
 * These are the single source of truth for converting between a node's local
 * coordinate space and the world coordinate space used by the renderer,
 * hit-tester, selection overlay, and reveal logic.
 *
 * Canonical implementations live in @varve/scene's coordinateService. This
 * file re-exports them for backward compatibility, wrapping them so that
 * page placement (ADR-0123) is applied: the editor's world space is the
 * pasteboard, so page-owned nodes carry their containing page's placement
 * translation. Pasteboard/global items are unaffected.
 *
 * Research basis: scene-graph transform composition (standard affine chain).
 * Each node's `transform` is a local→parent affine; the world matrix is the
 * product of all ancestor transforms left-multiplied by the node's own.
 */

import type { Document, NodeId } from '@varve/scene';
import {
  getParent,
  isLiveBooleanNode,
  nodeWorldBounds as sceneNodeWorldBounds,
  nodeWorldTransform as sceneNodeWorldTransform,
} from '@varve/scene';
import type { Affine, Point, Rect } from '@varve/shared';
import { applyAffine, multiplyAffine, tryInvertAffine } from '@varve/shared';
import { placedLiveBooleanBounds, resolvePlacedLiveBoolean } from './liveBooleanGeometry';
import type { PagePlacementMap } from './pagePlacement';
import { buildPagePlacementMap, pagePlacementForNode } from './pagePlacement';

/**
 * True when a node cannot be edited or restructured — either it is locked
 * itself, or any ancestor is. Lock inherits down the hierarchy, so a check
 * that only reads a node's own `locked` flag disagrees with what
 * `reparentNode` and the mutation pipeline actually enforce.
 */
export function isNodeEffectivelyLocked(doc: Document, nodeId: NodeId): boolean {
  let current: NodeId | null = nodeId;
  while (current) {
    if (doc.nodes[current]?.locked === true) return true;
    current = getParent(doc, current);
  }
  return false;
}

/**
 * Convert a placed-world point into a parent's local space via the full
 * inverse parent world transform. Returns null when the parent is
 * non-invertible.
 *
 * Canonical single entry point for the editor's world→parent conversion —
 * tools and command handlers must call this instead of inlining
 * `invertAffine(nodeWorldTransform(...))` per call site (historically five
 * parallel implementations drifted apart).
 */
export function worldToParent(
  doc: Document,
  parentId: NodeId,
  point: Point,
  parentIndex?: Map<NodeId, NodeId>,
): Point | null {
  const pWorld = nodeWorldTransform(doc, parentId, parentIndex);
  const pInv = tryInvertAffine(pWorld);
  if (!pInv) return null;
  return applyAffine(pInv, point);
}

/**
 * Placed-world variant of {@link @varve/scene!computeReparentTransform}:
 * the new local transform that preserves a node's placed-world pose after
 * reparenting. `newParentId = null` moves to the document root (local =
 * world). Returns null when the new parent is non-invertible.
 */
export function reparentLocalTransform(
  doc: Document,
  nodeId: NodeId,
  newParentId: NodeId | null,
  parentIndex?: Map<NodeId, NodeId>,
): Affine | null {
  const oldWorld = nodeWorldTransform(doc, nodeId, parentIndex);
  if (!newParentId) return oldWorld;
  const pWorld = nodeWorldTransform(doc, newParentId, parentIndex);
  const pInv = tryInvertAffine(pWorld);
  if (!pInv) return null;
  return multiplyAffine(pInv, oldWorld);
}

/**
 * Rebase an absolute world transform into a parent's local space, preserving
 * the world pose: newLocal = parentWorld⁻¹ · worldTransform.
 *
 * The canonical `computeReparentTransform` in @varve/scene derives the world
 * transform from the document's own hierarchy; this variant accepts an
 * explicit world transform (e.g. a clipboard world anchor recorded at copy
 * time) so pasted/imported content can be placed at its original world pose
 * inside a destination frame. Both inputs must be in the same placed-world
 * space. Returns null when the parent is non-invertible.
 */
export function rebaseWorldTransformToParent(
  parentWorld: Affine,
  worldTransform: Affine,
): Affine | null {
  const inv = tryInvertAffine(parentWorld);
  if (!inv) return null;
  return multiplyAffine(inv, worldTransform);
}

export { nodeLocalBounds } from './nodeBounds';

const translate = (x: number, y: number): Affine => [1, 0, 0, 1, x, y];

// Module-level memo of the node -> placement map, keyed by the pages-array
// identity. Documents are immutable with structural sharing, so a fresh
// `doc.pages` reference is the sole signal that the map could be stale.
let placementMemoPages: unknown;
let placementMemoMap: PagePlacementMap = { nodes: new Map(), contentRoots: new Set() };

function placementMapFor(doc: Document): PagePlacementMap {
  if (placementMemoPages !== doc.pages) {
    placementMemoPages = doc.pages;
    placementMemoMap = buildPagePlacementMap(doc);
  }
  return placementMemoMap;
}

/**
 * Placed-world transform: the composed scene transform plus the containing
 * page's placement translation (identity for pasteboard/global items).
 */
export function nodeWorldTransform(
  doc: Document,
  id: NodeId,
  parentIndex?: Map<NodeId, NodeId>,
): Affine {
  const world = sceneNodeWorldTransform(doc, id, parentIndex);
  const placement = pagePlacementForNode(placementMapFor(doc), id);
  return placement ? multiplyAffine(translate(placement.x, placement.y), world) : world;
}

/**
 * Placed-world group bounds: union of children's placed-world bounds
 * (groups have no own geometry). Implemented here rather than delegated to
 * the scene so the union includes each child's placement.
 */
export function groupWorldBounds(
  doc: Document,
  groupId: NodeId,
  parentIndex?: Map<NodeId, NodeId>,
): Rect | null {
  const node = doc.nodes[groupId];
  if (node?.kind !== 'group') return null;
  let union: Rect | null = null;
  for (const childId of node.children) {
    const b = nodeWorldBounds(doc, childId, parentIndex);
    if (!b) continue;
    if (!union) {
      union = { x: b.x, y: b.y, w: b.w, h: b.h };
    } else {
      const minX = Math.min(union.x, b.x);
      const minY = Math.min(union.y, b.y);
      const maxX = Math.max(union.x + union.w, b.x + b.w);
      const maxY = Math.max(union.y + union.h, b.y + b.h);
      union = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }
  return union;
}

/**
 * Placed-world bounds for any node: the scene bounds shifted by the
 * containing page's placement (pasteboard items keep scene bounds).
 */
export function nodeWorldBounds(
  doc: Document,
  id: NodeId,
  parentIndex?: Map<NodeId, NodeId>,
): Rect | null {
  const node = doc.nodes[id];
  if (node && isLiveBooleanNode(node)) {
    const resolved = resolvePlacedLiveBoolean(
      doc,
      id,
      nodeWorldTransform(doc, id, parentIndex),
      parentIndex,
    );
    return resolved ? placedLiveBooleanBounds(resolved) : null;
  }
  const bounds = sceneNodeWorldBounds(doc, id, parentIndex);
  if (!bounds) return null;

  // Path text paints in the referenced path's world space, not inside the
  // text node's original w/h rectangle. Keep a conservative bound around the
  // path so selection, hit testing, spatial indexing, and reveal/fit helpers
  // continue to follow the pixels after attachment. The bound is deliberately
  // conservative: the exact glyph interval depends on shaping and is owned by
  // the engine painter, while a broad bound never drops a visible glyph.
  if (node?.kind === 'text' && node.textMode === 'path' && node.pathTextSettings) {
    const pathBounds = nodeWorldBounds(doc, node.pathTextSettings.pathNodeId, parentIndex);
    if (pathBounds) {
      const fontSize = Number.isFinite(node.fontSize) ? Math.max(1, node.fontSize) : 16;
      const baselineShift = Number.isFinite(node.pathTextSettings.baselineShift)
        ? Math.abs(node.pathTextSettings.baselineShift ?? 0)
        : 0;
      const padding = Math.max(fontSize * 1.25, baselineShift + fontSize);
      return {
        x: pathBounds.x - padding,
        y: pathBounds.y - padding,
        w: pathBounds.w + padding * 2,
        h: pathBounds.h + padding * 2,
      };
    }
  }

  const placement = pagePlacementForNode(placementMapFor(doc), id);
  if (!placement) return bounds;
  return { x: bounds.x + placement.x, y: bounds.y + placement.y, w: bounds.w, h: bounds.h };
}
