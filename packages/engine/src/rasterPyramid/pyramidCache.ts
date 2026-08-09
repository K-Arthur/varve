/**
 * Raster pyramid — cascade generation with revision safety.
 *
 * Ties the pure modules together: reads authoritative L0 scene tiles,
 * generates derived levels (L(n) from L(n-1)), stores them in a residency
 * store, and enforces ADR-0214 D4 — a result whose source state changed
 * while it was being generated is never committed.
 *
 * Generation is incremental by construction: the revision snapshot of a tile
 * at level n is a deterministic function of the source versions it reads
 * (level 1 reads L0 versions directly; deeper levels chain through their
 * children's snapshots). A tile whose snapshot is unchanged is never
 * regenerated; an edit to one base tile changes exactly the ancestor chain
 * above it, nothing else.
 *
 * Sparse layers: a derived tile whose source region is fully transparent is
 * not stored at all — resolving it returns null and renderers treat missing
 * tiles as transparent (brief §26: no dense allocation for sparse layers).
 */
import { type ChildTileSource, downsampleParentTile } from './downsample';
import { levelDimensions, maxPyramidLevel, PYRAMID_TILE_SIZE } from './pyramid';
import type { PyramidResidency, PyramidTileEntry } from './residency';
import { childCoords, derivedSnapshot, l0Snapshot, pyramidTileKey, sourceTileKey } from './tileKey';

export interface PyramidSourceTileData {
  readonly version: number;
  readonly pixels?: Uint8ClampedArray | ArrayLike<number>;
}

/** Accepts either the scene Map or the engine-IR Record form. */
export type PyramidSourceTiles =
  | ReadonlyMap<string, PyramidSourceTileData>
  | Readonly<Record<string, PyramidSourceTileData>>;

export interface PyramidLayerSource {
  readonly layerId: string;
  readonly width: number;
  readonly height: number;
  readonly pixelMode: boolean;
  readonly tiles: PyramidSourceTiles;
  /** Tile edge in px; scene layers use 128. Tests use smaller grids. */
  readonly tileSize?: number;
}

export interface PyramidTileResult {
  readonly key: string;
  readonly snapshot: string;
  readonly pixels: Uint8ClampedArray;
}

function readTile(source: PyramidLayerSource, key: string): PyramidSourceTileData | null {
  const t = source.tiles;
  if (t instanceof Map) {
    return t.get(key) ?? null;
  }
  const rec = t as Record<string, PyramidSourceTileData>;
  return rec[key] ?? null;
}

/** Current revision snapshot for a tile (before it exists in the store). */
export function currentSnapshot(
  source: PyramidLayerSource,
  level: number,
  col: number,
  row: number,
): string {
  if (level === 1) {
    return l0Snapshot(childCoords(col, row), source.tiles);
  }
  const children = childCoords(col, row);
  const snaps = new Map<string, string>();
  for (const c of children) {
    const childSnapshot = currentSnapshot(source, level - 1, c.col, c.row);
    snaps.set(`${c.col}:${c.row}`, childSnapshot);
  }
  return derivedSnapshot(level, col, row, snaps);
}

/**
 * Read-only resolve: the resident entry for a tile if it exists and its
 * snapshot matches the current source state; null when missing or stale.
 * This is the hot-path accessor — it never allocates or generates.
 */
export function resolveTile(
  source: PyramidLayerSource,
  level: number,
  col: number,
  row: number,
  store: PyramidResidency,
): PyramidTileEntry | null {
  const key = pyramidTileKey({
    layerId: source.layerId,
    level,
    col,
    row,
    pixelMode: source.pixelMode,
    resamplerVersion: 1,
  });
  const entry = store.get(key);
  if (!entry) return null;
  const expected = currentSnapshot(source, level, col, row);
  if (entry.snapshot !== expected) return null;
  return entry;
}

function isFullyTransparent(pixels: Uint8ClampedArray): boolean {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 0) return false;
  }
  return true;
}

/**
 * Generate a derived tile synchronously from the source. Level 1 reads L0
 * scene tiles directly; deeper levels read their children from `store`
 * (generating them first if absent or stale). Returns null when the source
 * region is empty (nothing to store). This is the function the scheduler's
 * run closure calls — the caller is responsible for the commit-time
 * revision check via {@link commitIfCurrent}.
 */
export function generatePyramidTile(
  source: PyramidLayerSource,
  level: number,
  col: number,
  row: number,
  store: PyramidResidency,
): PyramidTileResult | null {
  if (level < 1) return null;
  const tileSize = source.tileSize ?? PYRAMID_TILE_SIZE;
  const childLevel = levelDimensions(source.width, source.height, level - 1);
  const children: ChildTileSource[] = [];
  if (level === 1) {
    for (const c of childCoords(col, row)) {
      const key = sourceTileKey(c.col, c.row);
      const tile = readTile(source, key);
      children.push({ coord: c, pixels: tile?.pixels });
    }
  } else {
    for (const c of childCoords(col, row)) {
      const child = ensurePyramidTile(source, level - 1, c.col, c.row, store);
      children.push({ coord: c, pixels: child?.pixels });
    }
  }
  const pixels = downsampleParentTile({
    childLevel,
    children,
    parent: { col, row },
    tileSize,
  });
  if (isFullyTransparent(pixels)) return null;
  const snapshot = currentSnapshot(source, level, col, row);
  const key = pyramidTileKey({
    layerId: source.layerId,
    level,
    col,
    row,
    pixelMode: source.pixelMode,
    resamplerVersion: 1,
  });
  return { key, snapshot, pixels };
}

/**
 * Commit-time revision guard (ADR-0214 D4): true only when the source state
 * still matches the snapshot the generation was computed from. A stale
 * generation that finished after a newer edit is discarded — the newer state
 * regenerates on the next demand.
 */
export function commitIfCurrent(
  source: PyramidLayerSource,
  level: number,
  col: number,
  row: number,
  snapshot: string,
): boolean {
  return currentSnapshot(source, level, col, row) === snapshot;
}

/** Convenience: generate and commit atomically; returns the resident entry or null. */
export function ensurePyramidTile(
  source: PyramidLayerSource,
  level: number,
  col: number,
  row: number,
  store: PyramidResidency,
): PyramidTileEntry | null {
  const resident = resolveTile(source, level, col, row, store);
  if (resident) return resident;
  const result = generatePyramidTile(source, level, col, row, store);
  if (!result) return null;
  if (!commitIfCurrent(source, level, col, row, result.snapshot)) return null;
  return store.put({
    key: result.key,
    layerId: source.layerId,
    level,
    col,
    row,
    snapshot: result.snapshot,
    pixels: result.pixels,
    bytes: result.pixels.byteLength,
  });
}

/** Level ceiling for a source layer (cached helper for LOD selection). */
export function pyramidMaxLevel(source: PyramidLayerSource): number {
  return maxPyramidLevel(source.width, source.height);
}
