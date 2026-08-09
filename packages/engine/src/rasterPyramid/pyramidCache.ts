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
import { type ChildTileSource, downsampleParentTile, downsampleWindow } from './downsample';
import { levelDimensions, maxPyramidLevel, PYRAMID_TILE_SIZE } from './pyramid';
import type { PyramidResidency, PyramidTileEntry } from './residency';
import {
  childCoords,
  derivedSnapshot,
  l0Snapshot,
  PYRAMID_GUTTER_KEY_SUFFIX,
  PYRAMID_GUTTER_TEXELS,
  type PyramidSourceTile,
  type PyramidSourceTiles,
  pyramidTileKey,
  sourceTileKey,
} from './tileKey';

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

function readTile(source: PyramidLayerSource, key: string): PyramidSourceTile | null {
  const t = source.tiles;
  if (t instanceof Map) {
    return t.get(key) ?? null;
  }
  const rec = t as Record<string, PyramidSourceTile>;
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
  return derivedSnapshot(col, row, snaps);
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

/**
 * Gutter generation (brief §20): derived tiles carry one ring of extra
 * texels sampled from real neighbour data, so minification at tile
 * boundaries reads neighbours instead of replicated edges — no hairline
 * seams. Gutter tiles are keyed with a ':g1' suffix; their snapshot covers
 * the 3x3 child block.
 */

function childGrid(source: PyramidLayerSource, level: number): { cols: number; rows: number } {
  const dims = levelDimensions(source.width, source.height, level - 1);
  return {
    cols: Math.ceil(dims.width / PYRAMID_TILE_SIZE),
    rows: Math.ceil(dims.height / PYRAMID_TILE_SIZE),
  };
}

/**
 * Child block covered by a gutter tile's sampling window: child pixel range
 * [(col*T - g)*2, (col*T + T + g)*2), mapped to child tile columns. For
 * T=128, g=1 this is the 4x4 block (2c-1..2c+2), clamped to the grid.
 */
export function gutterChildCoords(
  col: number,
  row: number,
  grid: { cols: number; rows: number },
  tileSize = PYRAMID_TILE_SIZE,
  gutter = PYRAMID_GUTTER_TEXELS,
): Array<{ col: number; row: number }> {
  const spanX0 = col * tileSize * 2 - gutter * 2;
  const spanX1 = col * tileSize * 2 + tileSize * 2 + gutter * 2 - 1;
  const spanY0 = row * tileSize * 2 - gutter * 2;
  const spanY1 = row * tileSize * 2 + tileSize * 2 + gutter * 2 - 1;
  const firstCol = Math.max(0, Math.min(Math.floor(spanX0 / tileSize), grid.cols - 1));
  const lastCol = Math.max(0, Math.min(Math.floor(spanX1 / tileSize), grid.cols - 1));
  const firstRow = Math.max(0, Math.min(Math.floor(spanY0 / tileSize), grid.rows - 1));
  const lastRow = Math.max(0, Math.min(Math.floor(spanY1 / tileSize), grid.rows - 1));
  const out: Array<{ col: number; row: number }> = [];
  for (let r = firstRow; r <= lastRow; r++) {
    for (let c = firstCol; c <= lastCol; c++) {
      out.push({ col: c, row: r });
    }
  }
  return out;
}

/**
 * Revision snapshot for a gutter tile: the child block's state. Level 1
 * reads L0 versions directly; deeper levels chain through children
 * snapshots (missing children contribute '').
 */
export function currentGutterSnapshot(
  source: PyramidLayerSource,
  level: number,
  col: number,
  row: number,
): string {
  const tileSize = source.tileSize ?? PYRAMID_TILE_SIZE;
  const grid = childGrid(source, level);
  const block = gutterChildCoords(col, row, grid, tileSize, PYRAMID_GUTTER_TEXELS);
  if (level === 1) {
    return l0Snapshot(block, source.tiles);
  }
  const snaps = new Map<string, string>();
  for (const c of block) {
    const childSnapshot = currentSnapshot(source, level - 1, c.col, c.row);
    snaps.set(`${c.col}:${c.row}`, childSnapshot);
  }
  return derivedSnapshot(col, row, snaps);
}

/** Read-only resolve for a gutter tile; null when missing or stale. */
export function resolveGutterTile(
  source: PyramidLayerSource,
  level: number,
  col: number,
  row: number,
  store: PyramidResidency,
): PyramidTileEntry | null {
  const key =
    pyramidTileKey({
      layerId: source.layerId,
      level,
      col,
      row,
      pixelMode: source.pixelMode,
      resamplerVersion: 1,
    }) + PYRAMID_GUTTER_KEY_SUFFIX;
  const entry = store.get(key);
  if (!entry) return null;
  const expected = currentGutterSnapshot(source, level, col, row);
  if (entry.snapshot !== expected) return null;
  return entry;
}

/**
 * Generate a gutter tile synchronously: the (T+2g)x(T+2g) downsample of the
 * 3x3 child block window. The interior (g..T+g) matches the plain tile
 * exactly. Returns null when the window is fully transparent.
 */
export function generateGutterTile(
  source: PyramidLayerSource,
  level: number,
  col: number,
  row: number,
  store: PyramidResidency,
  gutter = PYRAMID_GUTTER_TEXELS,
): PyramidTileResult | null {
  if (level < 1) return null;
  const tileSize = source.tileSize ?? PYRAMID_TILE_SIZE;
  const grid = childGrid(source, level);
  const block = gutterChildCoords(col, row, grid, tileSize, gutter);
  const children: ChildTileSource[] = [];
  if (level === 1) {
    for (const c of block) {
      const key = sourceTileKey(c.col, c.row);
      const tile = readTile(source, key);
      children.push({ coord: c, pixels: tile?.pixels });
    }
  } else {
    for (const c of block) {
      const child = ensurePyramidTile(source, level - 1, c.col, c.row, store);
      children.push({ coord: c, pixels: child?.pixels });
    }
  }
  const baseX = col * tileSize * 2 - gutter * 2;
  const baseY = row * tileSize * 2 - gutter * 2;
  const span = tileSize * 2 + gutter * 4;
  const pixels = downsampleWindow(
    {
      childLevel: levelDimensions(source.width, source.height, level - 1),
      children,
      parent: { col, row },
      tileSize,
    },
    { x: baseX, y: baseY, w: span, h: span },
  );
  if (isFullyTransparent(pixels)) return null;
  const snapshot = currentGutterSnapshot(source, level, col, row);
  const key =
    pyramidTileKey({
      layerId: source.layerId,
      level,
      col,
      row,
      pixelMode: source.pixelMode,
      resamplerVersion: 1,
    }) + PYRAMID_GUTTER_KEY_SUFFIX;
  return { key, snapshot, pixels };
}

/** Generate and commit a gutter tile if still current; returns the entry or null. */
export function ensureGutterTile(
  source: PyramidLayerSource,
  level: number,
  col: number,
  row: number,
  store: PyramidResidency,
): PyramidTileEntry | null {
  const resident = resolveGutterTile(source, level, col, row, store);
  if (resident) return resident;
  const result = generateGutterTile(source, level, col, row, store);
  if (!result) return null;
  if (currentGutterSnapshot(source, level, col, row) !== result.snapshot) return null;
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
