/**
 * Liquify resampling — output→source gather by the deformation field.
 *
 * Conventions
 * -----------
 * - Pixel centers: output pixel `(x, y)` covers `[x, x+1) × [y, y+1)` and its
 *   center `(x+0.5, y+0.5)` is transformed by the field.
 * - Sampling: bilinear in premultiplied space, matching `sampleTilesBilinear`.
 * - Border policy: `transparent` (default) resolves out-of-bounds samples to
 *   transparent black — vacated regions must never reveal an undeformed copy
 *   of the source. `clamp` repeats the edge texel (the classic clamp-to-edge
 *   behavior); it is opt-in because it silently smears edge pixels.
 * - Alpha is resampled with the same weights, separately from color, so
 *   semitransparent content cannot develop dark fringes.
 *
 * The identity field short-circuits to a bit-exact copy of the source.
 */

import {
  createLiquifyField,
  isIdentityLiquifyField,
  type LiquifyField,
  sampleLiquifyDisplacement,
  validateLiquifyField,
} from './field';

export type LiquifyBorderPolicy = 'transparent' | 'clamp';

export interface LiquifyWarpOptions {
  border?: LiquifyBorderPolicy;
  /** Output dimensions. Default to the source dimensions. */
  outputWidth?: number;
  outputHeight?: number;
}

/**
 * Maximum temporary output allocation for a CPU warp. This matches the
 * editor's conservative 32-Mi-pixel raster-surface policy. Callers that need
 * larger artwork must use the tiled renderer; a hostile output request falls
 * back to the source extent instead of attempting an unbounded allocation.
 */
export const MAX_LIQUIFY_WARP_PIXELS = 33_554_432;

export interface SampledRgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Bilinear premultiplied sample. Returns transparent black outside bounds. */
export function sampleImageDataBilinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  border: LiquifyBorderPolicy,
): SampledRgba {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    data.length < width * height * 4
  ) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const x0f = Math.floor(x);
  const y0f = Math.floor(y);
  const fx = x - x0f;
  const fy = y - y0f;

  const fetch = (px: number, py: number): SampledRgba => {
    let sx = px;
    let sy = py;
    if (border === 'clamp') {
      sx = Math.max(0, Math.min(width - 1, sx));
      sy = Math.max(0, Math.min(height - 1, sy));
    } else if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const index = (sy * width + sx) * 4;
    if (index < 0 || index + 3 >= data.length) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    return { r: data[index]!, g: data[index + 1]!, b: data[index + 2]!, a: data[index + 3]! };
  };

  const p00 = fetch(x0f, y0f);
  const p10 = fetch(x0f + 1, y0f);
  const p01 = fetch(x0f, y0f + 1);
  const p11 = fetch(x0f + 1, y0f + 1);

  let r = 0;
  let g = 0;
  let b = 0;
  let alpha = 0;
  const accumulate = (p: SampledRgba, w: number) => {
    if (w <= 0) return;
    const a = p.a / 255;
    alpha += a * w;
    r += p.r * a * w;
    g += p.g * a * w;
    b += p.b * a * w;
  };
  accumulate(p00, (1 - fx) * (1 - fy));
  accumulate(p10, fx * (1 - fy));
  accumulate(p01, (1 - fx) * fy);
  accumulate(p11, fx * fy);

  if (alpha <= 1e-8) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: r / alpha,
    g: g / alpha,
    b: b / alpha,
    a: Math.max(0, Math.min(255, alpha * 255)),
  };
}

/**
 * Warp a full source buffer through the field.
 *
 * Identity is a bit-exact copy. Otherwise this is a gather: for each output
 * pixel the field gives a source offset in *reference* units, scaled to the
 * source extent so a resized layer keeps its relative deformation.
 */
export function warpImageDataByField(
  source: ImageData,
  field: LiquifyField,
  options: LiquifyWarpOptions = {},
): ImageData {
  const [outW, outH] = safeOutputDimensions(
    options.outputWidth,
    options.outputHeight,
    source.width,
    source.height,
  );
  const safeField = validateLiquifyField(field) ?? createLiquifyField(source.width, source.height);

  if (outW === source.width && outH === source.height && isIdentityLiquifyField(safeField)) {
    return source;
  }

  // A valid document may contain a raster larger than the temporary CPU
  // surface budget. Keeping the source authoritative is safer than asking a
  // browser/native ImageData implementation for an allocation it cannot
  // honour. The tiled render path can replace this early return later without
  // changing the persisted field contract.
  if (source.width * source.height > MAX_LIQUIFY_WARP_PIXELS) {
    return source;
  }

  const border = options.border ?? 'transparent';
  const scaleX = source.width / safeField.referenceWidth;
  const scaleY = source.height / safeField.referenceHeight;
  const srcData = source.data;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const offset: [number, number] = [0, 0];

  for (let y = 0; y < outH; y++) {
    const v = (y + 0.5) / outH;
    for (let x = 0; x < outW; x++) {
      const u = (x + 0.5) / outW;
      sampleLiquifyDisplacement(safeField, u, v, offset);
      const sx = ((x + 0.5) / outW) * source.width - 0.5 + offset[0] * scaleX;
      const sy = ((y + 0.5) / outH) * source.height - 0.5 + offset[1] * scaleY;
      const sample = sampleImageDataBilinear(srcData, source.width, source.height, sx, sy, border);
      const index = (y * outW + x) * 4;
      out[index] = sample.r;
      out[index + 1] = sample.g;
      out[index + 2] = sample.b;
      out[index + 3] = sample.a;
    }
  }
  return new ImageData(out, outW, outH);
}

function safeOutputDimensions(
  widthValue: number | undefined,
  heightValue: number | undefined,
  fallbackWidth: number,
  fallbackHeight: number,
): [number, number] {
  const width = safeDimension(widthValue, fallbackWidth);
  const height = safeDimension(heightValue, fallbackHeight);
  if (
    width > Math.floor(Number.MAX_SAFE_INTEGER / Math.max(1, height)) ||
    width * height > MAX_LIQUIFY_WARP_PIXELS
  ) {
    return [fallbackWidth, fallbackHeight];
  }
  return [width, height];
}

function safeDimension(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0) return fallback;
  return value;
}

/** Compose raster tiles into a single RGBA buffer (transparent where absent). */
export function rasterTilesToImageData(
  tiles: ReadonlyMap<string, { pixels: Uint8ClampedArray }>,
  width: number,
  height: number,
  tileSize: number,
): ImageData {
  const out = new Uint8ClampedArray(width * height * 4);
  for (const [key, tile] of tiles) {
    const [colText, rowText] = key.split(':');
    const col = Number(colText);
    const row = Number(rowText);
    if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
    const originX = col * tileSize;
    const originY = row * tileSize;
    for (let py = 0; py < tileSize; py++) {
      const y = originY + py;
      if (y < 0 || y >= height) continue;
      for (let px = 0; px < tileSize; px++) {
        const x = originX + px;
        if (x < 0 || x >= width) continue;
        const si = (py * tileSize + px) * 4;
        const di = (y * width + x) * 4;
        out[di] = tile.pixels[si]!;
        out[di + 1] = tile.pixels[si + 1]!;
        out[di + 2] = tile.pixels[si + 2]!;
        out[di + 3] = tile.pixels[si + 3]!;
      }
    }
  }
  return new ImageData(out, width, height);
}

/** Split an RGBA buffer back into sparse tiles, omitting fully transparent ones. */
export function imageDataToRasterTiles(
  data: ImageData,
  tileSize: number,
): Map<string, { pixels: Uint8ClampedArray; version: number }> {
  const tiles = new Map<string, { pixels: Uint8ClampedArray; version: number }>();
  const cols = Math.ceil(data.width / tileSize);
  const rows = Math.ceil(data.height / tileSize);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const pixels = new Uint8ClampedArray(tileSize * tileSize * 4);
      let hasContent = false;
      for (let py = 0; py < tileSize; py++) {
        const y = row * tileSize + py;
        if (y >= data.height) break;
        for (let px = 0; px < tileSize; px++) {
          const x = col * tileSize + px;
          if (x >= data.width) break;
          const si = (y * data.width + x) * 4;
          const di = (py * tileSize + px) * 4;
          pixels[di] = data.data[si]!;
          pixels[di + 1] = data.data[si + 1]!;
          pixels[di + 2] = data.data[si + 2]!;
          pixels[di + 3] = data.data[si + 3]!;
          if (data.data[si + 3]! > 0) hasContent = true;
        }
      }
      if (hasContent) tiles.set(`${col}:${row}`, { pixels, version: 1 });
    }
  }
  return tiles;
}

/**
 * Tile-budget guard for a warp: a field can pull content into every output
 * tile the source box expands to. Returns the output tile keys that may
 * receive content, so callers can bound an allocation before starting.
 */
export function liquifyOutputTileKeys(
  sourceTileKeys: Iterable<string>,
  width: number,
  height: number,
  field: LiquifyField,
  tileSize: number,
): string[] {
  const maxDx = field.referenceWidth * 0.5 * (width / field.referenceWidth);
  const maxDy = field.referenceHeight * 0.5 * (height / field.referenceHeight);
  const keys = new Set<string>();
  for (const key of sourceTileKeys) {
    const [colText, rowText] = key.split(':');
    const col = Number(colText);
    const row = Number(rowText);
    if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
    const minX = col * tileSize - maxDx;
    const maxX = (col + 1) * tileSize + maxDx;
    const minY = row * tileSize - maxDy;
    const maxY = (row + 1) * tileSize + maxDy;
    const minCol = Math.max(0, Math.floor(minX / tileSize));
    const maxCol = Math.min(Math.ceil(width / tileSize) - 1, Math.floor(maxX / tileSize));
    const minRow = Math.max(0, Math.floor(minY / tileSize));
    const maxRow = Math.min(Math.ceil(height / tileSize) - 1, Math.floor(maxY / tileSize));
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) keys.add(`${c}:${r}`);
    }
  }
  return [...keys];
}
