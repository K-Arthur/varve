import type { Document, NodeId } from '@varve/scene';
import { buildParentIndexMap, isContainer } from '@varve/scene';
import { nodeWorldBounds } from './world';

const CELL_SIZE = 64;

export interface SpatialIndex {
  grid: Map<string, Set<NodeId>>;
  docRef: Document;
  /**
   * Cells each indexed node currently occupies. Removing a node from the grid
   * needs its *previous* footprint, which cannot be recomputed from the new
   * document — so it is retained here rather than rediscovered by scanning
   * every cell.
   */
  cellsByNode: Map<NodeId, string[]>;
  /**
   * Parent map captured at build time, so an incremental update resolves world
   * bounds without falling back to `getParent`'s O(n) scan per ancestor hop.
   * Valid only while the hierarchy is unchanged — see
   * {@link updateSpatialIndexNodes}.
   */
  parentIndex: Map<NodeId, NodeId>;
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
  const cellsByNode = new Map<NodeId, string[]>();
  const parentIndex = buildParentIndexMap(doc);

  for (const id of Object.keys(doc.nodes)) {
    const bounds = nodeWorldBounds(doc, id as NodeId, parentIndex);
    if (!bounds) continue;
    const cells = rectCells(bounds);
    cellsByNode.set(id as NodeId, cells);
    for (const key of cells) {
      if (!grid.has(key)) grid.set(key, new Set());
      grid.get(key)?.add(id as NodeId);
    }
  }

  return { grid, docRef: doc, cellsByNode, parentIndex };
}

/** Drop a node from every cell it currently occupies, pruning emptied cells. */
function removeFromCells(index: SpatialIndex, id: NodeId): void {
  const previous = index.cellsByNode.get(id);
  if (!previous) return;
  for (const key of previous) {
    const cell = index.grid.get(key);
    if (!cell) continue;
    cell.delete(id);
    // An emptied cell is deleted rather than kept: a long drag sweeps across
    // many cells, and retaining an empty Set per visited cell is a slow leak
    // that also inflates the occupied-cell scan `queryRect` falls back to.
    if (cell.size === 0) index.grid.delete(key);
  }
  index.cellsByNode.delete(id);
}

/**
 * Re-index only the nodes that changed, in place.
 *
 * The snap broad phase holds one index across a whole gesture. Rebuilding it
 * per pointer move is O(document); leaving it alone is incorrect, because a
 * node that moves into the query area is absent from the queried cells and
 * silently stops being a snap target. This updates the moved nodes and nothing
 * else, so per-frame cost tracks the edit rather than the document.
 *
 * `changedIds` may include deleted ids — those are removed. `docRef` is
 * advanced so a subsequent `getOrCreateSpatialIndex` for the same document
 * reuses this index instead of rebuilding it.
 *
 * **Contract:** the retained parent map is refreshed only when a node the
 * index has never seen appears, which covers insertions. It is *not* refreshed
 * for a node that is merely reparented, because that node is already indexed
 * and looks like an ordinary move — after a reparent the caller must rebuild
 * via {@link buildSpatialIndex}. `CanvasArea` does exactly that: reparenting
 * is classified structural by `computeInvalidationPlan`, and the structural
 * branch drops the index.
 */
export function updateSpatialIndexNodes(
  index: SpatialIndex,
  doc: Document,
  changedIds: Iterable<NodeId>,
): void {
  const ids = [...changedIds];
  // A node the index has never seen may have been added inside a container,
  // and the retained parent map would resolve it as root — placing it in the
  // wrong cells. Refresh the map once when that happens. A node already in the
  // index (the dragged node, every frame) never triggers this, so the drag
  // path keeps its O(changed) cost.
  if (ids.some((id) => !index.cellsByNode.has(id) && doc.nodes[id])) {
    index.parentIndex = buildParentIndexMap(doc);
  }
  for (const id of ids) {
    removeFromCells(index, id);
    if (!doc.nodes[id]) continue;
    const bounds = nodeWorldBounds(doc, id, index.parentIndex);
    if (!bounds) continue;
    const cells = rectCells(bounds);
    index.cellsByNode.set(id, cells);
    for (const key of cells) {
      let cell = index.grid.get(key);
      if (!cell) {
        cell = new Set();
        index.grid.set(key, cell);
      }
      cell.add(id);
    }
  }
  index.docRef = doc;
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
  const startCx = Math.floor(rect.x / CELL_SIZE);
  const endCx = Math.floor((rect.x + rect.w) / CELL_SIZE);
  const startCy = Math.floor(rect.y / CELL_SIZE);
  const endCy = Math.floor((rect.y + rect.h) / CELL_SIZE);
  const queryCellCount = (endCx - startCx + 1) * (endCy - startCy + 1);

  // Zoomed-out viewports can cover millions of mostly empty cells. Once the
  // theoretical query grid is larger than the occupied index, scan occupied
  // cells instead; both paths return the same cell-level candidate union.
  if (queryCellCount > index.grid.size) {
    for (const [key, ids] of index.grid) {
      const separator = key.indexOf(',');
      const cx = Number(key.slice(0, separator));
      const cy = Number(key.slice(separator + 1));
      if (cx < startCx || cx > endCx || cy < startCy || cy > endCy) continue;
      for (const id of ids) result.add(id);
    }
    return result;
  }

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
