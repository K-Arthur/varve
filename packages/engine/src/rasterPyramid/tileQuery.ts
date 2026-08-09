/**
 * Raster pyramid — visible tile selection.
 *
 * Given a layer-local pixel rect (the viewport transformed into the layer's
 * own pixel space — the caller inverts the world transform, which the shared
 * camera/affine math already provides) and a level, returns the conservative
 * set of tiles that intersect it. Conservative is safe: missing visible
 * pixels are not acceptable, extra tiles only cost a draw (brief §9).
 *
 * The layer-local rect may be an AABB of a rotated/skewed visible region —
 * that over-covers, which is fine. The rect may extend beyond the layer
 * (pan over the infinite canvas): tiles are clamped to the level grid.
 */
import {
  clampTileRect,
  levelTileCount,
  type RasterLevelDims,
  type RasterTileCoord,
  tileRectForPixelRect,
  tilesInRect,
} from './pyramid';

export interface LevelPixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface VisibleTiles {
  readonly level: number;
  readonly dims: RasterLevelDims;
  readonly rect: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
  readonly tiles: readonly RasterTileCoord[];
}

/**
 * Tiles of `level` intersecting `rect` (in level-local pixels). Clamped to
 * the level's grid; a rect fully outside the level yields an empty list.
 */
export function visibleTilesAtLevel(
  level: number,
  rect: LevelPixelRect,
  dims: RasterLevelDims,
  tileSize = 128,
): VisibleTiles {
  const f = 2 ** level;
  const levelDims: RasterLevelDims = {
    width: Math.ceil(dims.width / f),
    height: Math.ceil(dims.height / f),
  };
  const levelRect = tileRectForPixelRect(rect, levelDims, tileSize);
  const grid = levelTileCount(levelDims, tileSize);
  const clamped = clampTileRect(levelRect, levelDims, tileSize);
  return {
    level,
    dims: levelDims,
    rect: clamped,
    tiles: tilesInRect(clamped).filter((c) => c.col < grid.cols && c.row < grid.rows),
  };
}

/** Number of visible tiles (for diagnostics without allocating the list). */
export function visibleTileCountAtLevel(
  level: number,
  rect: LevelPixelRect,
  dims: RasterLevelDims,
  tileSize = 128,
): number {
  const f = 2 ** level;
  const levelDims: RasterLevelDims = {
    width: Math.ceil(dims.width / f),
    height: Math.ceil(dims.height / f),
  };
  const r = clampTileRect(tileRectForPixelRect(rect, levelDims, tileSize), levelDims, tileSize);
  return Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
}
