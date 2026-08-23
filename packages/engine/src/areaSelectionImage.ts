/**
 * Phase 7 (Image-Derived Selections).
 *
 * Produces area selections from raster sources: alpha/luminance coverage
 * (7.1) and OKLab colour-range "magic wand" selection in global or contiguous
 * mode (7.2). Sources are plain RGBA8 buffers — decoding stays with the
 * caller — and every working plane goes through `boundedPlaneSize`, so a huge
 * image scales into the selection memory budget instead of throwing.
 */
import { linearSrgbToOklab, srgbToLinearUnit } from '@varve/shared';
import {
  boundedPlaneSize,
  maskAreaSelectionFromPlane,
  type AreaSelection,
} from './areaSelection';

export interface ImageRgbaSource {
  /** Row-major RGBA8 bytes; length must equal width*height*4. */
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface ImageCoverageOptions {
  /** Document-space origin of the produced selection. Defaults to (0, 0). */
  originX?: number;
  originY?: number;
  /** Working-plane dimension cap. Defaults to `MAX_AREA_SELECTION_DIMENSION`. */
  resolution?: number;
  /** Binarize: coverage >= threshold selects fully, everything else drops. */
  threshold?: number;
  /** Invert the derived coverage before thresholding. */
  invert?: boolean;
}

export interface ColorRangeOptions extends ImageCoverageOptions {
  /** Maximum OKLab distance that stays fully selected (> 0). */
  tolerance: number;
  /**
   * Band beyond `tolerance` where coverage ramps linearly to 0. Default 0
   * (hard edge).
   */
  feather?: number;
  /**
   * `global` selects every similar pixel; `contiguous` grows through the
   * image from the seed only across pixels within tolerance + feather.
   */
  mode?: 'global' | 'contiguous';
  /** Required seed in document space when `mode` is `'contiguous'`. */
  seed?: { x: number; y: number };
}

function validSource(source: ImageRgbaSource): boolean {
  return (
    Number.isInteger(source.width) &&
    Number.isInteger(source.height) &&
    source.width > 0 &&
    source.height > 0 &&
    source.data.length === source.width * source.height * 4
  );
}

function encodeCoverage(coverage: number, options: ImageCoverageOptions): number {
  let value = options.invert ? 1 - coverage : coverage;
  if (options.threshold !== undefined) value = value >= options.threshold ? 1 : 0;
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

/** Nearest-neighbour sample of one channel from the source into the plane grid. */
function sampleChannel(
  source: ImageRgbaSource,
  planeWidth: number,
  planeHeight: number,
  offset: number,
): Uint8Array {
  const out = new Uint8Array(planeWidth * planeHeight);
  const scaleX = source.width / planeWidth;
  const scaleY = source.height / planeHeight;
  for (let py = 0; py < planeHeight; py += 1) {
    const srcY = Math.min(source.height - 1, Math.floor(py * scaleY));
    for (let px = 0; px < planeWidth; px += 1) {
      const srcX = Math.min(source.width - 1, Math.floor(px * scaleX));
      out[py * planeWidth + px] = source.data[(srcY * source.width + srcX) * 4 + offset]!;
    }
  }
  return out;
}

function wrapPlane(
  data: Uint8Array,
  planeWidth: number,
  planeHeight: number,
  source: ImageRgbaSource,
  options: ImageCoverageOptions,
): AreaSelection | null {
  return maskAreaSelectionFromPlane(
    { data, width: planeWidth, height: planeHeight },
    {
      x: options.originX ?? 0,
      y: options.originY ?? 0,
      w: source.width,
      h: source.height,
    },
  );
}

function alphaSelection(
  source: ImageRgbaSource,
  options: ImageCoverageOptions,
): AreaSelection | null {
  if (!validSource(source)) return null;
  const size = boundedPlaneSize(source.width, source.height, options.resolution ?? Number.POSITIVE_INFINITY);
  const alpha = sampleChannel(source, size.width, size.height, 3);
  for (let i = 0; i < alpha.length; i += 1) {
    alpha[i] = encodeCoverage(alpha[i]! / 255, options);
  }
  return wrapPlane(alpha, size.width, size.height, source, options);
}

/**
 * Phase 7.1 — select by pixel alpha. Semi-transparent pixels become partial
 * coverage unless a hard `threshold` is given.
 */
export function areaSelectionFromImageAlpha(
  source: ImageRgbaSource,
  options: ImageCoverageOptions = {},
): AreaSelection | null {
  return alphaSelection(source, options);
}

/**
 * Phase 7.1 — select by Rec.709 luma of the gamma-encoded pixels. Pure black
 * yields zero coverage and pure white full coverage; combine with `invert` or
 * `threshold` for luminosity masks.
 */
export function areaSelectionFromImageLuminance(
  source: ImageRgbaSource,
  options: ImageCoverageOptions = {},
): AreaSelection | null {
  if (!validSource(source)) return null;
  const size = boundedPlaneSize(source.width, source.height, options.resolution ?? Number.POSITIVE_INFINITY);
  const r = sampleChannel(source, size.width, size.height, 0);
  const g = sampleChannel(source, size.width, size.height, 1);
  const b = sampleChannel(source, size.width, size.height, 2);
  const plane = new Uint8Array(size.width * size.height);
  for (let i = 0; i < plane.length; i += 1) {
    const luma = (0.2126 * r[i]! + 0.7152 * g[i]! + 0.0722 * b[i]!) / 255;
    plane[i] = encodeCoverage(luma, options);
  }
  return wrapPlane(plane, size.width, size.height, source, options);
}

function oklabOf(r: number, g: number, b: number): [number, number, number] {
  return linearSrgbToOklab([
    srgbToLinearUnit(r / 255),
    srgbToLinearUnit(g / 255),
    srgbToLinearUnit(b / 255),
  ]);
}

function oklabDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/**
 * Phase 7.2 — OKLab colour-range selection. Distance is perceptual (Oklab),
 * transparent pixels contribute no coverage, and `contiguous` mode restricts
 * the result to the region reachable from the seed through similar pixels.
 */
export function areaSelectionFromColorRange(
  source: ImageRgbaSource,
  target: { r: number; g: number; b: number },
  options: ColorRangeOptions,
): AreaSelection | null {
  if (
    !validSource(source) ||
    !Number.isFinite(options.tolerance) ||
    options.tolerance <= 0 ||
    (options.feather !== undefined && (!Number.isFinite(options.feather) || options.feather < 0))
  ) {
    return null;
  }
  const feather = options.feather ?? 0;
  const reach = options.tolerance + feather;

  const size = boundedPlaneSize(source.width, source.height, options.resolution ?? Number.POSITIVE_INFINITY);
  const planeW = size.width;
  const planeH = size.height;
  const scaleX = source.width / planeW;
  const scaleY = source.height / planeH;

  const targetLab = oklabOf(target.r, target.g, target.b);
  const coverage = new Uint8Array(planeW * planeH);
  const near = new Uint8Array(planeW * planeH);

  for (let py = 0; py < planeH; py += 1) {
    const srcY = Math.min(source.height - 1, Math.floor(py * scaleY));
    for (let px = 0; px < planeW; px += 1) {
      const srcX = Math.min(source.width - 1, Math.floor(px * scaleX));
      const idx = srcY * source.width + srcX;
      const base = idx * 4;
      const alpha = source.data[base + 3]! / 255;
      const distance = oklabDistance(targetLab, oklabOf(
        source.data[base]!,
        source.data[base + 1]!,
        source.data[base + 2]!,
      ));
      let amount = 0;
      if (alpha > 0 && distance <= reach) {
        amount = distance <= options.tolerance
          ? 1
          : feather > 0
            ? 1 - (distance - options.tolerance) / feather
            : 0;
        amount *= alpha;
      }
      if (distance <= reach) near[py * planeW + px] = 1;
      coverage[py * planeW + px] = encodeCoverage(amount, options);
    }
  }

  if ((options.mode ?? 'global') === 'global') {
    return wrapPlane(coverage, planeW, planeH, source, options);
  }

  // Contiguous: flood fill from the seed through any pixel inside `reach`.
  if (!options.seed || !Number.isFinite(options.seed.x) || !Number.isFinite(options.seed.y)) {
    return null;
  }
  const seedPx = Math.floor(((options.seed.x - (options.originX ?? 0)) / source.width) * planeW);
  const seedPy = Math.floor(((options.seed.y - (options.originY ?? 0)) / source.height) * planeH);
  if (seedPx < 0 || seedPy < 0 || seedPx >= planeW || seedPy >= planeH) {
    return maskAreaSelectionFromPlane(
      { data: new Uint8Array(planeW * planeH), width: planeW, height: planeH },
      { x: options.originX ?? 0, y: options.originY ?? 0, w: source.width, h: source.height },
    );
  }

  const visited = new Uint8Array(planeW * planeH);
  const queue = new Int32Array(planeW * planeH);
  let head = 0;
  let tail = 0;
  const seedIdx = seedPy * planeW + seedPx;
  if (near[seedIdx] === 0) {
    visited[seedIdx] = 1;
  } else {
    queue[tail++] = seedIdx;
    visited[seedIdx] = 1;
  }
  while (head < tail) {
    const current = queue[head++]!;
    const cx = current % planeW;
    const cy = (current - cx) / planeW;
    const neighbours = [
      cx > 0 ? current - 1 : -1,
      cx < planeW - 1 ? current + 1 : -1,
      cy > 0 ? current - planeW : -1,
      cy < planeH - 1 ? current + planeW : -1,
    ];
    for (const next of neighbours) {
      if (next >= 0 && visited[next] === 0 && near[next] === 1) {
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
  }

  const selected = new Uint8Array(planeW * planeH);
  for (let i = 0; i < selected.length; i += 1) {
    selected[i] = visited[i] === 1 ? coverage[i]! : 0;
  }
  return wrapPlane(selected, planeW, planeH, source, options);
}
