/**
 * CoordinateService — the single source of truth for all scene-graph
 * coordinate conversions in Strata.
 *
 * Coordinate space hierarchy:
 *
 *   Object-local   — geometry before transform (shape coords, frame w/h)
 *       ↓  node.transform (+ rotation)
 *   Parent-local   — node origin in parent's coordinate frame
 *       ↓  ancestor chain composition
 *   World          — global document space (renderer, hit-test, snap)
 *       ↓  camera (pan/zoom/rotation)
 *   Viewport       — canvas-area CSS pixels
 *       ↓  DPR
 *   Screen         — device pixels
 *
 * Artboard-local space is a sub-case of world space: the world coordinates
 * of a frame that sits at the page root, with an optional ruler origin
 * offset. Children of an artboard are already stored parent-relative, so
 * artboard-local = parent-local when the parent is an artboard.
 *
 * Research basis: Figma relativeTransform model, Unity/Godot scene-graph
 * composition, Penpot matrix conventions, kurbo Affine, HTML Canvas CTM.
 */

import type { Affine, Point, Rect } from '@varve/shared';
import {
  transformRect as affineTransformRect,
  applyAffine,
  identity,
  multiplyAffine,
  rotateDeg,
  tryInvertAffine,
} from '@varve/shared';
import type { Document } from './document';
import { buildParentIndexMap, getParent } from './document';
import { nodeLocalBounds } from './nodeBounds';
import { resolvePagePlacement, resolveSpreadPlacement } from './pasteboardLayout';
import type { NodeId, SceneNode } from './types';

// ── Re-exports (canonical location) ──────────────────────────────────────────

export { nodeLocalBounds } from './nodeBounds';

// ── World transform composition ──────────────────────────────────────────────

/**
 * Walk the ancestor chain from `id` up to the root, composing local→parent
 * transforms into a single world affine.
 *
 * Composition order: for parent transforms P₁, P₂, …, Pₙ where P₁ is the
 * root ancestor, the world transform is Pₙ · … · P₂ · P₁ · node.transform.
 *
 * @param parentIndex Pre-built O(1) parent map (recommended for hot paths).
 *                    Use {@link buildParentIndexMap} to create one.
 *
 * Cycle safety: the ancestor walk terminates even on a malformed cyclic
 * parent graph (visited-set guard + depth ceiling), so a corrupt document
 * can never hang the renderer or hit-tester.
 */
const MAX_WORLD_TRANSFORM_DEPTH = 256;

export function nodeWorldTransform(
  doc: Document,
  id: NodeId,
  parentIndex?: Map<NodeId, NodeId>,
): Affine {
  const node = doc.nodes[id];
  if (!node) return identity;

  const nodeTransform = node.transform as Affine;
  const rot = node.rotation ?? 0;
  const combined = rot !== 0 ? multiplyAffine(nodeTransform, rotateDeg(rot)) : nodeTransform;
  const chain: Affine[] = [combined];

  const getParentFn = parentIndex
    ? (_d: Document, childId: NodeId) => parentIndex.get(childId) ?? null
    : getParent;
  const visited = new Set<NodeId>([id]);
  let parentId = getParentFn(doc, id);
  let depth = 0;
  while (parentId) {
    if (visited.has(parentId) || depth >= MAX_WORLD_TRANSFORM_DEPTH) break;
    visited.add(parentId);
    depth++;
    const parent = doc.nodes[parentId];
    if (!parent) break;
    const parentRot = parent.rotation ?? 0;
    const parentTransform = parent.transform as Affine;
    chain.push(
      parentRot !== 0 ? multiplyAffine(parentTransform, rotateDeg(parentRot)) : parentTransform,
    );
    parentId = getParentFn(doc, parentId);
  }

  let world: Affine = identity;
  for (let i = chain.length - 1; i >= 0; i--) {
    const m = chain[i];
    if (!m) continue;
    world = multiplyAffine(world, m);
  }
  return world;
}

/**
 * World-space bounds for a group node — union of all children's world bounds.
 * Groups have no own geometry.
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
 * Canonical world-space bounding box for any node. Used by selection overlay,
 * reveal, zoom-to-fit, and snapping. Groups return the union of children.
 */
export function nodeWorldBounds(
  doc: Document,
  id: NodeId,
  parentIndex?: Map<NodeId, NodeId>,
): Rect | null {
  const node = doc.nodes[id];
  if (!node) return null;
  if (node.kind === 'group') return groupWorldBounds(doc, id, parentIndex);
  const local = nodeLocalBounds(node, doc);
  if (!local) return null;
  const worldMat = nodeWorldTransform(doc, id, parentIndex);
  return affineTransformRect(worldMat, local);
}

// ── Point conversions ────────────────────────────────────────────────────────

/**
 * Apply a node's world transform to a point in object-local space,
 * producing a world-space point.
 */
export function localToWorld(
  doc: Document,
  nodeId: NodeId,
  point: Point,
  parentIndex?: Map<NodeId, NodeId>,
): Point {
  const world = nodeWorldTransform(doc, nodeId, parentIndex);
  return applyAffine(world, point);
}

/**
 * Convert a world-space point to a node's object-local space.
 * Returns null if the world transform is non-invertible (zero-scale).
 */
export function worldToLocal(
  doc: Document,
  nodeId: NodeId,
  point: Point,
  parentIndex?: Map<NodeId, NodeId>,
): Point | null {
  const world = nodeWorldTransform(doc, nodeId, parentIndex);
  const inv = tryInvertAffine(world);
  if (!inv) return null;
  return applyAffine(inv, point);
}

/**
 * Apply a parent node's world transform to a point in parent-local space.
 */
export function parentToWorld(
  doc: Document,
  parentId: NodeId,
  point: Point,
  parentIndex?: Map<NodeId, NodeId>,
): Point {
  const world = nodeWorldTransform(doc, parentId, parentIndex);
  return applyAffine(world, point);
}

/**
 * Convert a world-space point to a parent's local space.
 * Returns null if non-invertible.
 */
export function worldToParent(
  doc: Document,
  parentId: NodeId,
  point: Point,
  parentIndex?: Map<NodeId, NodeId>,
): Point | null {
  const world = nodeWorldTransform(doc, parentId, parentIndex);
  const inv = tryInvertAffine(world);
  if (!inv) return null;
  return applyAffine(inv, point);
}

// ── Rectangle conversions ─────────────────────────────────────────────────────

/** Transform a local-space rect to world space (AABB of transformed corners). */
export function localRectToWorld(
  doc: Document,
  nodeId: NodeId,
  rect: Rect,
  parentIndex?: Map<NodeId, NodeId>,
): Rect {
  const world = nodeWorldTransform(doc, nodeId, parentIndex);
  return affineTransformRect(world, rect);
}

/** Convert a world-space rect to a node's local space (may be non-invertible). */
export function worldRectToLocal(
  doc: Document,
  nodeId: NodeId,
  rect: Rect,
  parentIndex?: Map<NodeId, NodeId>,
): Rect | null {
  const world = nodeWorldTransform(doc, nodeId, parentIndex);
  const inv = tryInvertAffine(world);
  if (!inv) return null;
  return affineTransformRect(inv, rect);
}

// ── Relative transform between nodes ─────────────────────────────────────────

/**
 * Compute the transform that maps points from `fromNode`'s local space to
 * `toNode`'s local space. Useful for drag-and-drop between containers.
 *
 * Formula: toWorld⁻¹ × fromWorld
 * Returns null if either world transform is non-invertible.
 */
export function localSpaceTransform(
  doc: Document,
  fromNode: NodeId,
  toNode: NodeId,
  parentIndex?: Map<NodeId, NodeId>,
): Affine | null {
  const fromWorld = nodeWorldTransform(doc, fromNode, parentIndex);
  const toWorld = nodeWorldTransform(doc, toNode, parentIndex);
  const toInv = tryInvertAffine(toWorld);
  if (!toInv) return null;
  return multiplyAffine(toInv, fromWorld);
}

// ── Artboard coordinate space ─────────────────────────────────────────────────

/**
 * An artboard is a FrameNode that is a direct child of a page content root
 * (or rootChildren in flat/no-page mode). Artboards establish a local
 * coordinate space with an optional ruler origin offset.
 *
 * This matches Figma's convention: top-level frames are artboards, nested
 * frames are regular containers.
 */
export function isArtboard(doc: Document, nodeId: NodeId): boolean {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'frame') return false;

  const parentId = getParent(doc, nodeId);
  if (!parentId) {
    // Root-level frame (directly in rootChildren) = artboard
    return true;
  }
  const parent = doc.nodes[parentId];
  if (!parent) return false;

  // In page mode, a frame whose parent is a page content root group is an artboard
  if (parent.kind === 'group' && doc.pages) {
    for (const page of doc.pages) {
      if (page.contentRoot === parentId) return true;
    }
  }

  return false;
}

/**
 * Walk up the ancestor chain to find the nearest artboard ancestor.
 * Returns null if the node is not inside any artboard.
 */
export function findArtboardForNode(doc: Document, nodeId: NodeId): NodeId | null {
  let current: NodeId | null = nodeId;
  const visited = new Set<NodeId>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (isArtboard(doc, current)) return current;
    current = getParent(doc, current);
  }
  return null;
}

/**
 * Get the artboard's world-space origin (top-left corner in world coords).
 */
export function getArtboardWorldOrigin(doc: Document, artboardId: NodeId): Point {
  const node = doc.nodes[artboardId];
  if (!node) return [0, 0];
  const world = nodeWorldTransform(doc, artboardId);
  return applyAffine(world, [0, 0]);
}

/**
 * Get the artboard's world-space bounding rect.
 */
export function getArtboardWorldRect(doc: Document, artboardId: NodeId): Rect | null {
  const node = doc.nodes[artboardId];
  if (node?.kind !== 'frame') return null;
  const world = nodeWorldTransform(doc, artboardId);
  const w = 'w' in node ? node.w : 100;
  const h = 'h' in node ? node.h : 100;
  return affineTransformRect(world, { x: 0, y: 0, w, h });
}

/**
 * Convert a world-space point to artboard-local coordinates.
 * Uses the full inverse world transform (handles rotation, scale).
 */
export function worldToArtboardLocal(
  doc: Document,
  artboardId: NodeId,
  point: Point,
): Point | null {
  return worldToLocal(doc, artboardId, point);
}

/**
 * Convert an artboard-local point to world coordinates.
 */
export function artboardLocalToWorld(doc: Document, artboardId: NodeId, point: Point): Point {
  return localToWorld(doc, artboardId, point);
}

/**
 * Convert a world-space rect to artboard-local space.
 */
export function worldRectToArtboardLocal(
  doc: Document,
  artboardId: NodeId,
  rect: Rect,
): Rect | null {
  return worldRectToLocal(doc, artboardId, rect);
}

/**
 * Convert an artboard-local rect to world space.
 */
export function artboardRectToWorld(doc: Document, artboardId: NodeId, rect: Rect): Rect {
  return localRectToWorld(doc, artboardId, rect);
}

/**
 * Get all artboards in the document.
 */
export function getAllArtboards(doc: Document): NodeId[] {
  const artboards: NodeId[] = [];
  for (const id of doc.rootChildren) {
    if (isArtboard(doc, id)) artboards.push(id);
  }
  if (doc.pages) {
    for (const page of doc.pages) {
      const contentRoot = doc.nodes[page.contentRoot];
      if (contentRoot && 'children' in contentRoot) {
        for (const childId of contentRoot.children) {
          if (isArtboard(doc, childId)) artboards.push(childId);
        }
      }
    }
  }
  return artboards;
}

// ── Migration helpers ─────────────────────────────────────────────────────────

/**
 * Return a copy of the node with its rotation baked into the transform tuple.
 * After baking, `rotation` is set to 0 and the transform encodes the full
 * rotation+scale+translation.
 *
 * This eliminates the inconsistency of rotation being stored separately from
 * transform, which caused `nodeLocalBounds` to return un-rotated bounds while
 * the renderer applied rotation.
 */
export function bakeRotationIntoTransform(node: SceneNode): SceneNode {
  const rot = node.rotation ?? 0;
  if (rot === 0) return node;
  const transform = node.transform as Affine;
  const baked = multiplyAffine(transform, rotateDeg(rot));
  return { ...node, transform: baked, rotation: 0 };
}

/**
 * Migrate all nodes in a document to bake rotation into transform.
 * Returns a new document with all rotations baked and the rotation field
 * cleared.
 */
export function migrateRotationToTransform(doc: Document): Document {
  const newNodes: Record<NodeId, SceneNode> = {};
  for (const [id, node] of Object.entries(doc.nodes)) {
    newNodes[id] = bakeRotationIntoTransform(node);
  }
  return { ...doc, nodes: newNodes };
}

/**
 * Validate that all transforms in the document are finite and invertible
 * (for non-zero-scale nodes). Returns a list of validation errors.
 */
export function validateDocumentTransforms(doc: Document): string[] {
  const errors: string[] = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    const t = node.transform as Affine;
    for (let i = 0; i < 6; i++) {
      if (!Number.isFinite(t[i])) {
        errors.push(`Node ${id}: transform[${i}] = ${t[i]} (non-finite)`);
      }
    }
    const rot = node.rotation ?? 0;
    if (!Number.isFinite(rot)) {
      errors.push(`Node ${id}: rotation = ${rot} (non-finite)`);
    }
    const combined = rot !== 0 ? multiplyAffine(t, rotateDeg(rot)) : t;
    const det = combined[0] * combined[3] - combined[1] * combined[2];
    if (Math.abs(det) < 1e-12) {
      errors.push(`Node ${id}: zero-scale transform (det=${det})`);
    }
  }
  return errors;
}

// ── Reparenting helpers ───────────────────────────────────────────────────────

/**
 * Compute the new local transform for a node that is being reparented,
 * such that its world position is preserved.
 *
 * Standard scene-graph formula: newLocal = newParent.worldMatrix⁻¹ × oldWorld
 *
 * @param doc The document
 * @param nodeId The node being reparented
 * @param newParentId The target parent (null for root level)
 * @param parentIndex Optional pre-built parent index
 * @returns The new local transform, or null if the new parent's world
 *          transform is non-invertible.
 */
export function computeReparentTransform(
  doc: Document,
  nodeId: NodeId,
  newParentId: NodeId | null,
  parentIndex?: Map<NodeId, NodeId>,
): Affine | null {
  const oldWorld = nodeWorldTransform(doc, nodeId, parentIndex);

  if (!newParentId) {
    return oldWorld;
  }

  const newParentWorld = nodeWorldTransform(doc, newParentId, parentIndex);
  const newParentInv = tryInvertAffine(newParentWorld);
  if (!newParentInv) return null;

  return multiplyAffine(newParentInv, oldWorld);
}

/**
 * Compute the new local position (translation components) for reparenting,
 * preserving world position. Convenience wrapper that extracts [e, f] from
 * the full reparent transform.
 */
export function computeReparentPosition(
  doc: Document,
  nodeId: NodeId,
  newParentId: NodeId | null,
  parentIndex?: Map<NodeId, NodeId>,
): Point | null {
  const newTransform = computeReparentTransform(doc, nodeId, newParentId, parentIndex);
  if (!newTransform) return null;
  return [newTransform[4], newTransform[5]];
}

// ── Page and spread coordinate spaces (ADR-0123) ──────────────────────────────

// Bounds helpers are canonical in pasteboardLayout (placement module);
// re-exported here so all coordinate conversions live under one namespace.
export { pageBoundsInWorld, spreadBoundsInWorld } from './pasteboardLayout';

/**
 * Convert a point in page-local coordinates (page trim origin at 0,0) to
 * world/pasteboard coordinates. Uses the page's resolved placement; page
 * placement is a translation only.
 *
 * Returns null when the page does not exist.
 */
export function pageToWorld(doc: Document, pageId: NodeId, point: Point): Point | null {
  const placement = resolvePagePlacement(doc, pageId);
  if (!placement) return null;
  return [point[0] + placement.x, point[1] + placement.y];
}

/**
 * Convert a world/pasteboard point to page-local coordinates. Inverse of
 * {@link pageToWorld}. Returns null when the page does not exist.
 */
export function worldToPage(doc: Document, pageId: NodeId, point: Point): Point | null {
  const placement = resolvePagePlacement(doc, pageId);
  if (!placement) return null;
  return [point[0] - placement.x, point[1] - placement.y];
}

/**
 * Convert a point in spread-local coordinates (spread origin at 0,0) to
 * world/pasteboard coordinates. The spread origin is the spread's explicit
 * placement, or the first member page's placement.
 *
 * Spread ids fall back to single-page spreads: when no spread with the given
 * id exists, the id is treated as a page id (pre-spread documents).
 *
 * Returns null when neither a spread nor a page matches.
 */
export function spreadToWorld(doc: Document, spreadId: NodeId, point: Point): Point | null {
  const placement = resolveSpreadPlacement(doc, spreadId);
  if (placement) return [point[0] + placement.x, point[1] + placement.y];
  return pageToWorld(doc, spreadId, point);
}

/**
 * Convert a world/pasteboard point to spread-local coordinates. Inverse of
 * {@link spreadToWorld}.
 */
export function worldToSpread(doc: Document, spreadId: NodeId, point: Point): Point | null {
  const placement = resolveSpreadPlacement(doc, spreadId);
  if (placement) return [point[0] - placement.x, point[1] - placement.y];
  return worldToPage(doc, spreadId, point);
}

/**
 * World-space bounds of a node that sits inside a page's content root,
 * equivalent to `nodeWorldBounds` on the placed scene (page placement is a
 * pure translation, so content world bounds shift by the placement).
 */
export function nodeBoundsOnPage(
  doc: Document,
  pageId: NodeId,
  nodeId: NodeId,
  parentIndex?: Map<NodeId, NodeId>,
): { x: number; y: number; w: number; h: number } | null {
  const bounds = nodeWorldBounds(doc, nodeId, parentIndex);
  if (!bounds) return null;
  const placement = resolvePagePlacement(doc, pageId);
  if (!placement) return bounds;
  return { x: bounds.x + placement.x, y: bounds.y + placement.y, w: bounds.w, h: bounds.h };
}
