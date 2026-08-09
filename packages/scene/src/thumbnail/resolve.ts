/**
 * Canonical thumbnail source resolution — maps a `ThumbnailSourceSpec`
 * (automatic / page / frame / selection / region) onto the concrete scene
 * nodes that represent it.
 *
 * Pure document-domain logic: no rendering, no platform, no React. The
 * render layer (editor service / engine) consumes the returned node ids and
 * an optional world frame override.
 *
 * Automatic selection (§8 of the thumbnail spec) is deterministic:
 *   1. active page (when the document has pages);
 *   2. otherwise the largest top-level frame/group with renderable content;
 *   3. otherwise all root content;
 *   4. an empty document yields `{ isEmpty: true }` so callers render a
 *      proper empty placeholder instead of transparent pixels.
 *
 * Guides, rulers, selections, handles, collab cursors, and debug overlays
 * are never scene nodes, so they are excluded structurally. Hidden nodes
 * are excluded explicitly.
 */

import type { ThumbnailRegion, ThumbnailSourceSpec } from '@varve/shared';
import { type Affine, multiplyAffine, type Rect } from '@varve/shared';
import { nodeLocalBounds } from '../coordinateService';
import type { Document } from '../document';
import { activePageNodesWithMaster } from '../document-components';
import type { NodeId, SceneNode } from '../types';

export interface ThumbnailSelection {
  /** Node ids to render, in paint order (root first, then depth-first). */
  ids: NodeId[];
  /** World-space frame the thumbnail must show (crop/fit target). */
  worldFrame: Rect | null;
  /** Whether the requested source still exists in the document. */
  validity: 'valid' | 'missing-source' | 'empty';
}

/** Re-export for consumers that resolve preferences (platform persisted form). */
export type { ThumbnailSourceSpec } from '@varve/shared';

/** A node is content-bearing for thumbnail purposes. */
function isRenderable(node: SceneNode): boolean {
  if (!node || node.visible === false) return false;
  return node.kind !== 'adjustment';
}

function isContainerLike(node: SceneNode): boolean {
  return node.kind === 'frame' || node.kind === 'group' || node.kind === 'table';
}

/** Depth-first ids of a node and its descendants (skipping hidden nodes). */
function subtreeIds(doc: Document, id: NodeId, out: NodeId[]): void {
  const node = doc.nodes[id];
  if (!node || node.visible === false) return;
  out.push(id);
  if ('children' in node) {
    for (const childId of node.children ?? []) subtreeIds(doc, childId, out);
  }
}

function pageContentIds(doc: Document, pageId: NodeId): NodeId[] {
  const page = doc.pages?.find((p) => p.id === pageId);
  if (!page) return [];
  // Master-aware projection: global children + master content (with overrides)
  // + page-local content, matching what the canvas renders on that page.
  return activePageNodesWithMaster(doc, pageId);
}

/**
 * World-space bounds of a node, including descendants (so a frame's size is
 * its content extent, not just its declared w/h box). Returns null when the
 * node has no measurable geometry.
 */
function nodeWorldBounds(doc: Document, id: NodeId): Rect | null {
  const node = doc.nodes[id];
  if (!node) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  const visit = (nid: NodeId, world: Affine): void => {
    const n = doc.nodes[nid];
    if (!n || n.visible === false) return;
    const local = nodeLocalBounds(n);
    const rotate = n.rotation ?? 0;
    const transform: Affine =
      rotate !== 0
        ? multiplyAffine(
            world,
            multiplyAffine(n.transform ?? [1, 0, 0, 1, 0, 0], rotateDeg(rotate)),
          )
        : multiplyAffine(world, n.transform ?? [1, 0, 0, 1, 0, 0]);

    if (local) {
      const corners: Array<[number, number]> = [
        [local.x, local.y],
        [local.x + local.w, local.y],
        [local.x, local.y + local.h],
        [local.x + local.w, local.y + local.h],
      ];
      for (const [x, y] of corners) {
        const wx = transform[0] * x + transform[2] * y + transform[4];
        const wy = transform[1] * x + transform[3] * y + transform[5];
        minX = Math.min(minX, wx);
        minY = Math.min(minY, wy);
        maxX = Math.max(maxX, wx);
        maxY = Math.max(maxY, wy);
      }
      found = true;
    }
    if ('children' in n) {
      for (const childId of n.children ?? []) visit(childId, transform);
    }
  };

  visit(id, [1, 0, 0, 1, 0, 0]);
  if (!found) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function rotateDeg(deg: number): Affine {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

/**
 * Count of renderable descendants (not counting hidden or adjustment nodes).
 */
function populatedCount(doc: Document, id: NodeId): number {
  const node = doc.nodes[id];
  if (!node || node.visible === false) return 0;
  let count = 1;
  if ('children' in node) {
    for (const childId of node.children ?? []) count += populatedCount(doc, childId);
  }
  return count;
}

/** True when the node paints something of its own (fills/strokes/effects). */
function hasOwnPaint(node: SceneNode): boolean {
  if (node.kind === 'text') return true;
  const fills = 'fills' in node ? (node.fills ?? []) : [];
  if (fills.length > 0) return true;
  const strokes = 'strokes' in node ? (node.strokes ?? []) : [];
  if (strokes.length > 0) return true;
  const effects = 'effects' in node ? (node.effects ?? []) : [];
  return effects.length > 0;
}

/**
 * Deterministic automatic source:
 *  - pages → the active page;
 *  - no pages → the largest top-level frame/group with content, if any;
 *  - otherwise all root content (empty painted containers excluded).
 */
function automaticSelection(doc: Document): {
  ids: NodeId[];
  worldFrame: Rect | null;
  validity: 'valid' | 'empty';
} {
  if (doc.pages && doc.pages.length > 0) {
    const active = doc.activePageId ?? doc.pages[0]?.id;
    if (active) {
      const ids = pageContentIds(doc, active);
      // The active page is the subject even when empty (page geometry,
      // backgrounds, and masters still render).
      return { ids, worldFrame: null, validity: 'valid' };
    }
  }

  const roots = doc.rootChildren ?? [];

  let best: { id: NodeId; bounds: Rect; count: number } | null = null;
  for (const rootId of roots) {
    const node = doc.nodes[rootId];
    if (!node || !isRenderable(node)) continue;
    if (!isContainerLike(node)) continue;
    const count = populatedCount(doc, rootId);
    if (count <= 1) continue; // an empty container is not a meaningful cover
    const bounds = nodeWorldBounds(doc, rootId);
    if (!bounds || bounds.w <= 0 || bounds.h <= 0) continue;
    if (!best || bounds.w * bounds.h > best.bounds.w * best.bounds.h) {
      best = { id: rootId, bounds, count };
    }
  }

  if (best) {
    const ids: NodeId[] = [];
    subtreeIds(doc, best.id, ids);
    return { ids, worldFrame: null, validity: 'valid' };
  }

  // Fallback: all root content, dropping containers that neither contain
  // visible content nor paint anything of their own (a blank box with no
  // children is not a meaningful cover).
  const ids = roots.filter((id: NodeId) => {
    const node = doc.nodes[id];
    if (!node || !isRenderable(node)) return false;
    if (isContainerLike(node)) {
      return populatedCount(doc, id) > 1 || hasOwnPaint(node);
    }
    return true;
  });
  return { ids, worldFrame: null, validity: ids.length > 0 ? 'valid' : 'empty' };
}

/**
 * Resolve a thumbnail source spec against a document.
 * Never throws; a missing target degrades to a documented fallback so
 * thumbnails can never produce a permanently broken cover.
 */
export function resolveThumbnailSource(
  doc: Document,
  source: ThumbnailSourceSpec,
): ThumbnailSelection {
  switch (source.type) {
    case 'automatic': {
      const auto = automaticSelection(doc);
      return { ...auto, validity: auto.validity };
    }

    case 'page': {
      const page = doc.pages?.find((p) => p.id === source.pageId);
      if (!page) return { ids: [], worldFrame: null, validity: 'missing-source' };
      const ids = pageContentIds(doc, source.pageId);
      // A page exists even when empty: it has geometry, background, and
      // master projections, so it is a valid subject.
      return {
        ids,
        worldFrame: { x: 0, y: 0, w: page.width, h: page.height },
        validity: 'valid',
      };
    }

    case 'frame': {
      const node = doc.nodes[source.nodeId];
      if (!node || node.visible === false) {
        return { ids: [], worldFrame: null, validity: 'missing-source' };
      }
      const ids: NodeId[] = [];
      subtreeIds(doc, source.nodeId, ids);
      const bounds = nodeWorldBounds(doc, source.nodeId);
      return {
        ids,
        worldFrame: bounds,
        // A visible frame is a valid subject even with no children (its own
        // fill/strokes still render).
        validity: 'valid',
      };
    }

    case 'selection': {
      const ids = source.nodeIds.filter((id) => {
        const node = doc.nodes[id];
        return node && isRenderable(node);
      });
      if (ids.length === 0) return { ids: [], worldFrame: null, validity: 'missing-source' };
      const boxes: Rect[] = [];
      for (const id of ids) {
        const b = nodeWorldBounds(doc, id);
        if (b) boxes.push(b);
      }
      const worldFrame = unionOf(boxes);
      return { ids, worldFrame, validity: 'valid' };
    }

    case 'region': {
      // Region crops the underlying content to a user-defined rect. The
      // content scope follows the automatic selection; rendering crops to
      // the region (see render layer).
      const auto = automaticSelection(doc);
      return {
        ids: auto.ids,
        worldFrame: normalizeRegion(source.region),
        validity: auto.validity,
      };
    }

    default:
      return { ids: [], worldFrame: null, validity: 'empty' };
  }
}

function unionOf(boxes: Rect[]): Rect | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function normalizeRegion(region: ThumbnailRegion): Rect {
  const x = Math.min(region.x, region.x + region.w);
  const y = Math.min(region.y, region.y + region.h);
  return { x, y, w: Math.abs(region.w), h: Math.abs(region.h) };
}

/** Number of renderable nodes in the whole document (cheap emptiness check). */
export function hasRenderableContent(doc: Document): boolean {
  for (const node of Object.values(doc.nodes)) {
    if (isRenderable(node)) return true;
  }
  return false;
}

/** Validate a persisted preference against a document without rendering. */
export function validateThumbnailSource(
  doc: Document,
  source: ThumbnailSourceSpec,
): 'valid' | 'missing-source' | 'empty' {
  return resolveThumbnailSource(doc, source).validity;
}
