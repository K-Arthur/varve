/**
 * Raster pyramid — tile identity and revision snapshots.
 *
 * A pyramid tile's cache identity must include enough context to avoid
 * collisions (ADR-0214 D2): layer id + level + col/row + resampler version +
 * pixel mode. Bare node ids or bare coordinates are never cache keys.
 *
 * Correctness is keyed on the *source revision*: a derived tile is valid only
 * while the versions of every source tile it was generated from are
 * unchanged. Generation is cascade (L(n) from L(n-1), ADR-0214 D7), so the
 * revision of a tile at level n is a deterministic string built from the
 * revisions of its four children at level n-1; for level 1 the children are
 * the authoritative L0 scene tiles and their versions are read directly.
 * A cache entry stores its snapshot string and a lookup compares it.
 */

export const PYRAMID_RESAMPLER_VERSION = 1;

/**
 * Gutter tiles (brief §20) carry one ring of neighbour texels and are keyed
 * with a distinct suffix so plain and gutter versions never collide.
 */
export const PYRAMID_GUTTER_TEXELS = 1;
export const PYRAMID_GUTTER_KEY_SUFFIX = ':g1';

export interface RasterPyramidTileId {
  readonly layerId: string;
  readonly level: number;
  readonly col: number;
  readonly row: number;
  readonly pixelMode: boolean;
  readonly resamplerVersion: number;
}

/** Composite cache key for a derived pyramid tile. */
export function pyramidTileKey(id: RasterPyramidTileId): string {
  return (
    `${id.layerId}@L${id.level}:${id.col}:${id.row}` +
    `${id.pixelMode ? ':pixel' : ':image'}:r${id.resamplerVersion}`
  );
}

/** Base-tile source key: the L0 tile a level-1 tile reads from (bare grid key, matching the scene model's "col:row" map keys). */
export function sourceTileKey(col: number, row: number): string {
  return `${col}:${row}`;
}

export interface PyramidSourceTile {
  readonly version: number;
  readonly pixels?: Uint8ClampedArray | ArrayLike<number>;
}

/** Accepts either the scene Map or the engine-IR Record form of a tile table. */
export type PyramidSourceTiles =
  | ReadonlyMap<string, PyramidSourceTile>
  | Readonly<Record<string, PyramidSourceTile>>;

function readVersion(tiles: PyramidSourceTiles, key: string): number {
  if (tiles instanceof Map) {
    return tiles.get(key)?.version ?? 0;
  }
  const t = (tiles as Record<string, PyramidSourceTile>)[key];
  return t?.version ?? 0;
}

/**
 * Deterministic revision for a level-1 tile: the sorted versions of its four
 * L0 children. Missing L0 tiles read as version 0 — a missing tile is a
 * transparent tile, and allocating it without painting is a version no-op.
 */
export function l0Snapshot(
  children: readonly { col: number; row: number }[],
  tiles: PyramidSourceTiles,
): string {
  const entries = children.map((c) => {
    const key = sourceTileKey(c.col, c.row);
    const v = readVersion(tiles, key);
    return `${c.col}:${c.row}:${v}`;
  });
  return entries.sort().join(';');
}

/**
 * Four immediate children of a tile at the next finer level (level-1):
 * the 2x2 block (2c,2r)..(2c+1,2r+1). Independent of the tile's level — a
 * tile spans exactly 2 child tiles per axis at every level.
 */
export function childCoords(col: number, row: number): Array<{ col: number; row: number }> {
  const cx = col * 2;
  const cy = row * 2;
  return [
    { col: cx, row: cy },
    { col: cx + 1, row: cy },
    { col: cx, row: cy + 1 },
    { col: cx + 1, row: cy + 1 },
  ];
}

/**
 * Deterministic revision for a level-n tile (n >= 2): the sorted snapshots of
 * its four children at level n-1. The chain bottoms out at L0 versions, so
 * any edit under the tile changes every ancestor snapshot (and only
 * ancestors — sibling tiles are untouched).
 */
export function derivedSnapshot(
  col: number,
  row: number,
  children: ReadonlyMap<string, string>,
): string {
  const entries: string[] = [];
  for (const c of childCoords(col, row)) {
    const v = children.get(`${c.col}:${c.row}`) ?? '';
    entries.push(`${c.col}:${c.row}:${v}`);
  }
  return entries.sort().join(';');
}
