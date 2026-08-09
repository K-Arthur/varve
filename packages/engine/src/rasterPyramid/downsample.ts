/**
 * Raster pyramid — deterministic, premultiplied-alpha-aware downsampling.
 *
 * Generates a 128x128 parent tile at level L from its four child tiles at
 * level L-1 (cascade, ADR-0214 D7). A 2x2 box in premultiplied-alpha space:
 * colour channels are averaged weighted by alpha, alpha is averaged
 * straight, and the result is unpremultiplied. Averaging straight RGBA
 * would darken antialiased edges (dark/bright halos); averaging
 * premultiplied values preserves edge coverage and transparency (brief §17).
 *
 * Determinism: only integer indexing and the same float operations on the
 * same operands — bit-identical across realms, browsers, and runs. This is
 * the semantic contract any future native provider must match (§39).
 *
 * Out-of-bounds sampling clamps to the child level's edge texel
 * (edge replication), so odd child dimensions do not dim the parent's last
 * row/column; missing child tiles (sparse holes) sample as transparent.
 */
import {
  PYRAMID_TILE_SIZE,
  type RasterLevelDims,
  type RasterTileCoord,
  tileContentSize,
} from './pyramid';

export interface ChildTileSource {
  /** Child tile coordinates at level L-1. */
  readonly coord: RasterTileCoord;
  /** RGBA pixels, PYRAMID_TILE_SIZE x PYRAMID_TILE_SIZE x 4. Absent -> transparent. */
  readonly pixels?: Uint8ClampedArray | ArrayLike<number>;
}

export interface DownsampleInput {
  /** Child-level dimensions (ceil of parent dims x 2), for edge clamping. */
  readonly childLevel: RasterLevelDims;
  /** Four child tiles; up to 4 may be absent (transparent). */
  readonly children: readonly ChildTileSource[];
  /** The parent tile being generated (col/row in level L coordinates). */
  readonly parent: RasterTileCoord;
  readonly tileSize?: number;
}

function sampleChannel(
  children: readonly ChildTileSource[],
  childLevel: RasterLevelDims,
  srcX: number,
  srcY: number,
  tileSize: number,
): number[] {
  const x = Math.min(srcX, childLevel.width - 1);
  const y = Math.min(srcY, childLevel.height - 1);
  const col = Math.floor(x / tileSize);
  const row = Math.floor(y / tileSize);
  for (const child of children) {
    if (child.coord.col !== col || child.coord.row !== row) continue;
    const px = child.pixels;
    if (!px) break;
    const tx = x - col * tileSize;
    const ty = y - row * tileSize;
    const i = (ty * tileSize + tx) * 4;
    return [px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0, px[i + 3] ?? 0];
  }
  return [0, 0, 0, 0];
}

/**
 * Box-downsample the parent tile's source region into a fresh
 * Uint8ClampedArray of tileSize x tileSize x 4 (padded to full tile size;
 * content beyond the parent level's edge stays transparent).
 */
export function downsampleParentTile(input: DownsampleInput): Uint8ClampedArray {
  const tileSize = input.tileSize ?? PYRAMID_TILE_SIZE;
  const parentDims = {
    width: Math.ceil(input.childLevel.width / 2),
    height: Math.ceil(input.childLevel.height / 2),
  };
  const parentW = Math.max(0, parentDims.width - input.parent.col * tileSize);
  const parentH = Math.max(0, parentDims.height - input.parent.row * tileSize);
  const contentW = Math.min(tileSize, parentW);
  const contentH = Math.min(tileSize, parentH);
  const out = new Uint8ClampedArray(tileSize * tileSize * 4);
  const baseX = input.parent.col * tileSize * 2;
  const baseY = input.parent.row * tileSize * 2;
  for (let y = 0; y < contentH; y++) {
    for (let x = 0; x < contentW; x++) {
      let sumA = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const [r = 0, g = 0, b = 0, a = 0] = sampleChannel(
            input.children,
            input.childLevel,
            baseX + x * 2 + dx,
            baseY + y * 2 + dy,
            tileSize,
          );
          const af = a / 255;
          sumA += af;
          sumR += r * af;
          sumG += g * af;
          sumB += b * af;
        }
      }
      const i = (y * tileSize + x) * 4;
      if (sumA === 0) {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        out[i + 3] = 0;
      } else {
        out[i] = Math.round(Math.min(255, Math.max(0, sumR / sumA)));
        out[i + 1] = Math.round(Math.min(255, Math.max(0, sumG / sumA)));
        out[i + 2] = Math.round(Math.min(255, Math.max(0, sumB / sumA)));
        out[i + 3] = Math.round((sumA / 4) * 255);
      }
    }
  }
  return out;
}

/** Content size of the generated parent tile (edge tiles are partial). */
export function parentTileContentSize(
  childLevel: RasterLevelDims,
  parent: RasterTileCoord,
  tileSize = PYRAMID_TILE_SIZE,
): RasterLevelDims {
  const parentDims = {
    width: Math.ceil(childLevel.width / 2),
    height: Math.ceil(childLevel.height / 2),
  };
  return tileContentSize(parentDims, parent, tileSize);
}

/**
 * Convert a flat Uint8ClampedArray RGBA buffer into the tile grid layout the
 * scene model uses (sparse, per-tile buffers). Helper for tests and for
 * feeding the pyramid from whole-image sources.
 */
export function splitIntoTiles(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  tileSize = PYRAMID_TILE_SIZE,
): Map<string, Uint8ClampedArray> {
  const out = new Map<string, Uint8ClampedArray>();
  const cols = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tile = new Uint8ClampedArray(tileSize * tileSize * 4);
      const w = Math.min(tileSize, width - col * tileSize);
      const h = Math.min(tileSize, height - row * tileSize);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const si = ((row * tileSize + y) * width + (col * tileSize + x)) * 4;
          const ti = (y * tileSize + x) * 4;
          tile[ti] = pixels[si] ?? 0;
          tile[ti + 1] = pixels[si + 1] ?? 0;
          tile[ti + 2] = pixels[si + 2] ?? 0;
          tile[ti + 3] = pixels[si + 3] ?? 0;
        }
      }
      out.set(`${col}:${row}`, tile);
    }
  }
  return out;
}
