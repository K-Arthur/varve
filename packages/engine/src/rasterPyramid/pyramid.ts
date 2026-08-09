/**
 * Multi-resolution tiled raster pyramid — level math and tile geometry.
 *
 * Pure functions over level/tile coordinates. No DOM, no cache, no state.
 * The pyramid is a derived, disposable render acceleration structure over
 * the authoritative scene raster tiles (ADR-0214 D1/D2); this module only
 * answers "which tiles exist at which level and which ancestors does an edit
 * touch".
 *
 * Conventions:
 * - Level 0 is the 1:1 source; level L has dimensions ceil(w / 2^L) x
 *   ceil(h / 2^L), each level tiled at PYRAMID_TILE_SIZE.
 * - Tile coords are non-negative integers (the scene model has no negative
 *   tile coordinates; content begins at the layer origin).
 * - Rectangles are half-open [x0, x1) with integer tile coordinates.
 */

export const PYRAMID_TILE_SIZE = 128;

export interface RasterLevelDims {
  readonly width: number;
  readonly height: number;
}

export interface RasterTileCoord {
  readonly col: number;
  readonly row: number;
}

/** Dimensions of level L: ceil(w / 2^L) x ceil(h / 2^L). */
export function levelDimensions(width: number, height: number, level: number): RasterLevelDims {
  const f = 2 ** level;
  return { width: Math.ceil(width / f), height: Math.ceil(height / f) };
}

/**
 * Highest level with at least one texel. A 1x1 layer has one level (L0);
 * a 16384^2 layer has levels 0..14 (L14 is 1x1).
 */
export function maxPyramidLevel(width: number, height: number): number {
  const m = Math.max(width, height);
  return m <= 1 ? 0 : Math.ceil(Math.log2(m));
}

export interface TileGrid {
  readonly cols: number;
  readonly rows: number;
}

/** Number of tiles along each axis of a level of the given dimensions. */
export function levelTileCount(dims: RasterLevelDims, tileSize = PYRAMID_TILE_SIZE): TileGrid {
  return {
    cols: Math.ceil(dims.width / tileSize),
    rows: Math.ceil(dims.height / tileSize),
  };
}

/** Valid pixel extent of a tile, clamped to the level's dimensions (edge tiles are partial). */
export function tileContentSize(
  dims: RasterLevelDims,
  coord: RasterTileCoord,
  tileSize = PYRAMID_TILE_SIZE,
): RasterLevelDims {
  return {
    width: Math.min(tileSize, dims.width - coord.col * tileSize),
    height: Math.min(tileSize, dims.height - coord.row * tileSize),
  };
}

/** Parent of a tile at the next coarser level: floor(col/2), floor(row/2). */
export function parentCoord(coord: RasterTileCoord): RasterTileCoord {
  return { col: Math.floor(coord.col / 2), row: Math.floor(coord.row / 2) };
}

/**
 * Ancestor of a tile at a coarser level (targetLevel >= level). A tile at
 * level L covers a region at finer levels; going coarser is unambiguous:
 * floor(coord / 2^(targetLevel - level)).
 */
export function ancestorAtLevel(
  coord: RasterTileCoord,
  level: number,
  targetLevel: number,
): RasterTileCoord {
  const shift = targetLevel - level;
  return {
    col: Math.floor(coord.col / 2 ** shift),
    row: Math.floor(coord.row / 2 ** shift),
  };
}

/** 2x2 children of a parent tile, in child-level coordinates (may exceed child dims at edges). */
export function childCoordsAt(level: number, coord: RasterTileCoord): RasterTileCoord[] {
  const f = 2 ** level;
  const col = coord.col * f;
  const row = coord.row * f;
  return [
    { col, row },
    { col: col + 1, row },
    { col, row: row + 1 },
    { col: col + 1, row: row + 1 },
  ];
}

export interface TileRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Clamp a tile rect to a level's tile grid (half-open). Empty rect if disjoint. */
export function clampTileRect(
  rect: TileRect,
  dims: RasterLevelDims,
  tileSize = PYRAMID_TILE_SIZE,
): TileRect {
  const grid = levelTileCount(dims, tileSize);
  return {
    x0: Math.max(0, Math.min(rect.x0, grid.cols)),
    y0: Math.max(0, Math.min(rect.y0, grid.rows)),
    x1: Math.max(0, Math.min(rect.x1, grid.cols)),
    y1: Math.max(0, Math.min(rect.y1, grid.rows)),
  };
}

/**
 * Dirty propagation: a tile rect at `level` invalidates exactly the ancestors
 * at each coarser level up to `maxLevel`. A child col c maps to parent
 * floor(c/2), so a half-open rect [x0, x1) maps to [floor(x0/2), ceil(x1/2)).
 * At most one ancestor per (level, axis), growing as the region does —
 * unrelated ancestors are never touched (ADR-0214 D3).
 */
export function invalidateAncestorRects(
  rect: TileRect,
  level: number,
  maxLevel: number,
): TileRect[] {
  const out: TileRect[] = [];
  let r = rect;
  for (let l = level + 1; l <= maxLevel; l++) {
    r = {
      x0: Math.floor(r.x0 / 2),
      y0: Math.floor(r.y0 / 2),
      x1: Math.ceil(r.x1 / 2),
      y1: Math.ceil(r.y1 / 2),
    };
    out.push(r);
  }
  return out;
}

/**
 * Pixel-rect -> tile rect on a level of the given dimensions.
 * Conservative: any tile whose grid cell intersects the rect is included.
 * The caller supplies the rect already converted to level-local pixels.
 */
export function tileRectForPixelRect(
  rect: { x: number; y: number; width: number; height: number },
  dims: RasterLevelDims,
  tileSize = PYRAMID_TILE_SIZE,
): TileRect {
  if (rect.width <= 0 || rect.height <= 0) {
    return { x0: 0, y0: 0, x1: 0, y1: 0 };
  }
  const tileW = Math.max(0, rect.x + rect.width);
  const tileH = Math.max(0, rect.y + rect.height);
  return clampTileRect(
    {
      x0: Math.floor(rect.x / tileSize),
      y0: Math.floor(rect.y / tileSize),
      x1: Math.ceil(tileW / tileSize),
      y1: Math.ceil(tileH / tileSize),
    },
    dims,
    tileSize,
  );
}

/** Enumerate all tile coords in a (clamped, half-open) tile rect. */
export function tilesInRect(rect: TileRect): RasterTileCoord[] {
  const out: RasterTileCoord[] = [];
  for (let row = rect.y0; row < rect.y1; row++) {
    for (let col = rect.x0; col < rect.x1; col++) {
      out.push({ col, row });
    }
  }
  return out;
}
