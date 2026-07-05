import type { Document, NodeId } from '@strata/scene';
import { buildParentIndexMap } from '@strata/scene';
import { nodeWorldBounds } from './world';

const CELL_SIZE = 64;

export interface SpatialIndex {
  grid: Map<string, Set<NodeId>>;
  docRef: Document;
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
      grid.get(key)!.add(id as NodeId);
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

/**
 * Query nodes near a point (within CELL_SIZE radius for tolerance).
 * Returns candidate NodeIds from the cell containing the point.
 */
export function queryPoint(index: SpatialIndex, x: number, y: number): Set<NodeId> {
  const key = cellKey(x, y);
  return index.grid.get(key) ?? new Set();
}

/**
 * Query nodes overlapping a rect.
 * Returns candidate NodeIds from all cells the rect touches.
 */
export function queryRect(
  index: SpatialIndex,
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
