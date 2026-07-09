import type { Document, NodeId } from '@strata/scene';
import { buildParentIndexMap, isContainer } from '@strata/scene';
import { nodeWorldBounds } from './world';

const CELL_SIZE = 64;

export interface SpatialIndex {
  grid: Map<string, Set<NodeId>>;
  docRef: Document;
}

/**
 * Frame/group-only spatial index with fingerprint-based invalidation.
 * Used for efficient frame containment queries during drag operations.
 * The fingerprint avoids rebuilding the index when only non-container nodes move.
 */
export interface FrameSpatialIndex {
  grid: Map<string, Set<NodeId>>;
  fingerprint: string;
}

/**
 * Compute a fingerprint of frame/group nodes for cache invalidation.
 * Only changes to frame/group count or their bounds trigger a rebuild.
 */
export function computeFrameFingerprint(doc: Document): string {
  const parentIndex = buildParentIndexMap(doc);
  const parts: string[] = [];
  let count = 0;

  for (const [id, node] of Object.entries(doc.nodes)) {
    if (isContainer(node)) {
      count++;
      const bounds = nodeWorldBounds(doc, id as NodeId, parentIndex);
      if (bounds) {
        parts.push(`${id}:${bounds.x}:${bounds.y}:${bounds.w}:${bounds.h}`);
      }
    }
  }

  return `${count}:${parts.join('|')}`;
}

/**
 * Get grid cell key for a position.
 */
export function cellKey(x: number, y: number): string {
  const cx = Math.floor(x / CELL_SIZE);
  const cy = Math.floor(y / CELL_SIZE);
  return `${cx},${cy}`;
}

/**
 * Get all cell keys that a bounding rect overlaps.
 */
export function rectCells(rect: { x: number; y: number; w: number; h: number }): string[] {
  const keys: string[] = [];
  const startCx = Math.floor(rect.x / CELL_SIZE);
  const endCx = Math.floor((rect.x + rect.w) / CELL_SIZE);
  const startCy = Math.floor(rect.y / CELL_SIZE);
  const endCy = Math.floor((rect.y + rect.h) / CELL_SIZE);
  for (let cx = startCx; cx <= endCx; cx++) {
    for (let cy = startCy; cy <= endCy; cy++) {
      keys.push(`${cx},${cy}`);
    }
  }
  return keys;
}

/**
 * Build or rebuild a spatial index from a document.
 */
export function buildSpatialIndex(doc: Document): SpatialIndex {
  const grid = new Map<string, Set<NodeId>>();
  const parentIndex = buildParentIndexMap(doc);

  for (const id of Object.keys(doc.nodes)) {
    const bounds = nodeWorldBounds(doc, id as NodeId, parentIndex);
    if (!bounds) continue;
    const cells = rectCells(bounds);
    for (const key of cells) {
      if (!grid.has(key)) grid.set(key, new Set());
      grid.get(key)?.add(id as NodeId);
    }
  }

  return { grid, docRef: doc };
}

/**
 * Get or reuse a spatial index.
 */
export function getOrCreateSpatialIndex(
  doc: Document,
  existing?: SpatialIndex | null,
): SpatialIndex {
  if (existing && existing.docRef === doc) return existing;
  return buildSpatialIndex(doc);
}

interface GridIndex {
  grid: Map<string, Set<NodeId>>;
}

/**
 * Query nodes near a point (within CELL_SIZE radius for tolerance).
 * Returns candidate NodeIds from the cell containing the point.
 */
export function queryPoint(index: GridIndex, x: number, y: number): Set<NodeId> {
  const key = cellKey(x, y);
  return index.grid.get(key) ?? new Set();
}

/**
 * Query nodes overlapping a rect.
 * Returns candidate NodeIds from all cells the rect touches.
 */
export function queryRect(
  index: GridIndex,
  rect: { x: number; y: number; w: number; h: number },
): Set<NodeId> {
  const result = new Set<NodeId>();
  const cells = rectCells(rect);
  for (const key of cells) {
    const ids = index.grid.get(key);
    if (ids) {
      for (const id of ids) result.add(id);
    }
  }
  return result;
}

/**
 * Invalidate the index (force rebuild on next access).
 */
export function invalidateSpatialIndex(): null {
  return null;
}

/**
 * Build a frame/group-only spatial index from a document.
 * Only indexes frame and group nodes for containment queries.
 */
export function buildFrameSpatialIndex(doc: Document): FrameSpatialIndex {
  const grid = new Map<string, Set<NodeId>>();
  const parentIndex = buildParentIndexMap(doc);

  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!isContainer(node)) continue;
    const bounds = nodeWorldBounds(doc, id as NodeId, parentIndex);
    if (!bounds) continue;
    const cells = rectCells(bounds);
    for (const key of cells) {
      if (!grid.has(key)) grid.set(key, new Set());
      grid.get(key)?.add(id as NodeId);
    }
  }

  return { grid, fingerprint: computeFrameFingerprint(doc) };
}

/**
 * Get or reuse a frame spatial index based on fingerprint.
 * Rebuilds only when frame/group structure or bounds change.
 */
export function getOrCreateFrameSpatialIndex(
  doc: Document,
  existing?: FrameSpatialIndex | null,
): FrameSpatialIndex {
  const currentFingerprint = computeFrameFingerprint(doc);
  if (existing && existing.fingerprint === currentFingerprint) {
    return existing;
  }
  return buildFrameSpatialIndex(doc);
}
