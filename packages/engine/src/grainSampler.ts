/**
 * Grain texture sampling for brush strokes.
 *
 * Supports two modes:
 * 1. Procedural grain — deterministic hash function (no external assets)
 * 2. Image-based grain — texture loaded via ImageCache, sampled with
 *    configurable scale/rotation/offset/contrast/invert
 *
 * Research basis: MyPaint brush grain, Procreate texture brushes,
 *                 Adobe Photoshop brush texture engine.
 *
 * Architecture:
 * - Procedural grain uses a seeded position hash for deterministic output.
 * - Image grain samples an HTMLImageElement/ImageBitmap at the given
 *   position with transformation applied, wrapping at texture edges.
 * - Both paths return a value in [0, 1] that modulates dab opacity.
 */

import { getImageCache } from './imageCache';

export type GrainAnchor = 'brush' | 'canvas' | 'stroke';

export interface GrainSampleParams {
  /** Scale factor (1.0 = texture at 1:1 with canvas pixels). */
  scale: number;
  /** Rotation in radians. */
  rotation: number;
  /** Offset relative to brush/canvas origin. */
  offsetX: number;
  offsetY: number;
  /** Contrast adjustment (1.0 = identity). */
  contrast: number;
  /** Invert grain (1 - value). */
  invert: boolean;
  /** Anchor mode. */
  anchor: GrainAnchor;
  /** Stroke progress (0-1) for stroke-anchored grain. */
  strokeT: number;
  /** Brush seed for deterministic hash-based grain. */
  seed?: number;
}

/**
 * Sample procedural grain at a given position.
 * Uses a hash function seeded by position + seed for deterministic output.
 * Deterministic across replay: same position + same seed → same value.
 */
export function sampleProceduralGrain(x: number, y: number, seed: number = 0): number {
  let h = seed | 1;
  h = ((h + x * 7919) * (h + y * 6271)) ^ (h * 104729);
  h = ((h << 13) ^ h) >>> 0;
  return (h & 0xffff) / 65536;
}

/**
 * Sample image-based grain texture.
 * Returns 0-1 grain value. Returns 0.5 if texture cannot be sampled
 * (e.g., OffscreenCanvas unavailable).
 */
export function sampleImageGrain(
  texture: HTMLImageElement | ImageBitmap | OffscreenCanvas,
  x: number,
  y: number,
  params: GrainSampleParams,
): number {
  if (texture.width === 0 || texture.height === 0) return 0.5;

  const cx = texture.width / 2;
  const cy = texture.height / 2;
  const cosA = Math.cos(params.rotation);
  const sinA = Math.sin(params.rotation);
  const s = Math.max(0.001, params.scale);

  const sx = ((x + params.offsetX) / s - cx) * cosA - ((y + params.offsetY) / s - cy) * sinA + cx;
  const sy = ((x + params.offsetX) / s - cx) * sinA + ((y + params.offsetY) / s - cy) * cosA + cy;

  const tx = ((sx % texture.width) + texture.width) % texture.width;
  const ty = ((sy % texture.height) + texture.height) % texture.height;

  const ctx = getSampleCtx();
  if (!ctx) return 0.5;

  ctx.drawImage(texture, tx, ty, 1, 1, 0, 0, 1, 1);
  const data = ctx.getImageData(0, 0, 1, 1).data;
  const gray = data[0]! / 255;

  // Raw gray value — resolveGrainValueSync applies invert/contrast
  return gray;
}

let _sampleCanvas: OffscreenCanvas | null = null;
let _sampleCtx: OffscreenCanvasRenderingContext2D | null = null;

function getSampleCtx(): OffscreenCanvasRenderingContext2D | null {
  if (!_sampleCanvas) {
    if (typeof OffscreenCanvas === 'undefined') return null;
    _sampleCanvas = new OffscreenCanvas(1, 1);
    _sampleCtx = _sampleCanvas.getContext('2d', { willReadFrequently: true });
  }
  return _sampleCtx;
}

/**
 * Resolve grain value asynchronously — tries image texture first,
 * falls back to procedural.
 */
export async function resolveGrainValue(
  grainId: string | null | undefined,
  x: number,
  y: number,
  params: GrainSampleParams,
): Promise<number> {
  if (grainId) {
    const cache = getImageCache();
    const img = cache.getImage(grainId);
    if (img) {
      return sampleImageGrain(img, x, y, params);
    }
    try {
      const loaded = await cache.load(grainId);
      return sampleImageGrain(loaded, x, y, params);
    } catch {
      // Fall through to procedural
    }
  }
  return sampleProceduralGrain(x, y, params.seed ?? 0);
}

/**
 * Synchronous grain value — use when texture is guaranteed loaded or
 * procedural grain is acceptable.
 */
export function resolveGrainValueSync(
  grainId: string | null | undefined,
  x: number,
  y: number,
  params: GrainSampleParams,
): number {
  let value: number;
  if (grainId) {
    const cache = getImageCache();
    const img = cache.getImage(grainId);
    if (img) {
      value = sampleImageGrain(img, x, y, params);
    } else {
      value = sampleProceduralGrain(x, y, params.seed ?? 0);
    }
  } else {
    value = sampleProceduralGrain(x, y, params.seed ?? 0);
  }

  // Apply contrast and invert to whatever grain value we got
  let result = params.invert ? 1 - value : value;
  result = result ** (1 / Math.max(0.01, params.contrast));
  return Math.max(0, Math.min(1, result));
}
