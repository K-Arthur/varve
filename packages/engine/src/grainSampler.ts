/**
 * Grain texture sampling for brush strokes.
 *
 * Two sources:
 * 1. Procedural grain — a deterministic position hash, no assets required.
 * 2. Image grain — a texture decoded once into a luminance plane
 *    (`grainTexture.ts`) and then read with a single array index per pixel.
 *
 * Anchoring is explicit rather than incidental. Where the texture "lives"
 * decides whether grain crawls across the artwork when the view moves, and
 * getting it wrong is the classic textured-brush bug, so each mode states its
 * coordinate space:
 *
 * - `canvas` / `layer` — the texture is nailed to layer pixel space. Panning or
 *   zooming changes nothing, and repainting the same spot reuses the same
 *   texels.
 * - `brush` — the texture travels with each dab, so every stamp shows the same
 *   part of the texture.
 * - `stroke` — the texture is fixed relative to the stroke's origin and slides
 *   along it with distance travelled.
 *
 * Research basis: MyPaint brush grain, Procreate texture brushes,
 *                 Adobe Photoshop brush texture engine.
 */

import {
  type GrainPlane,
  type GrainWrapMode,
  getGrainTextureCache,
  samplePlane,
} from './grainTexture';
import { getImageCache } from './imageCache';

export type GrainAnchor = 'brush' | 'canvas' | 'stroke' | 'layer';

export interface GrainSampleParams {
  /** Scale factor (1.0 = texture at 1:1 with layer pixels). */
  scale: number;
  /** Rotation in radians. */
  rotation: number;
  /** Offset relative to the anchor origin. */
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
  /** Centre of the current dab, required by 'brush' anchoring. */
  dabX?: number;
  dabY?: number;
  /** Distance along the stroke, used by 'stroke' anchoring. */
  strokeDistance?: number;
  /** Direction the dab is travelling, for direction-following grain. */
  direction?: number;
  /** Rotate the texture with the stroke direction. */
  followDirection?: boolean;
  /** Edge behaviour outside the texture rectangle. */
  wrap?: GrainWrapMode;
}

/**
 * Sample procedural grain at a given position.
 * Deterministic across replay: same position + same seed → same value.
 */
export function sampleProceduralGrain(x: number, y: number, seed: number = 0): number {
  let h = seed | 1;
  h = ((h + x * 7919) * (h + y * 6271)) ^ (h * 104729);
  h = ((h << 13) ^ h) >>> 0;
  return (h & 0xffff) / 65536;
}

/**
 * Map a layer-space pixel into texture space according to the anchor mode.
 * Exported so tests can assert anchoring behaviour without rendering.
 */
export function grainTextureCoords(
  x: number,
  y: number,
  params: GrainSampleParams,
): { u: number; v: number } {
  const scale = Math.max(0.001, params.scale);

  let ax = x;
  let ay = y;
  switch (params.anchor) {
    case 'brush':
      // Relative to the dab centre: every stamp shows the same texels.
      ax = x - (params.dabX ?? 0);
      ay = y - (params.dabY ?? 0);
      break;
    case 'stroke':
      // Fixed to the stroke, sliding along it as the stroke advances.
      ax = x - (params.strokeDistance ?? 0);
      ay = y;
      break;
    default:
      // 'canvas' and 'layer' both address layer pixel space directly, which is
      // what keeps the texture still while the viewport moves.
      break;
  }

  ax += params.offsetX;
  ay += params.offsetY;

  const rotation = params.rotation + (params.followDirection ? (params.direction ?? 0) : 0);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const rx = ax * cos - ay * sin;
  const ry = ax * sin + ay * cos;

  return { u: rx / scale, v: ry / scale };
}

/** Sample a decoded plane through the anchoring transform. Returns raw 0-1. */
export function sampleGrainPlane(
  plane: GrainPlane,
  x: number,
  y: number,
  params: GrainSampleParams,
): number {
  const { u, v } = grainTextureCoords(x, y, params);
  return samplePlane(plane, u, v, params.wrap ?? 'repeat');
}

/** Apply invert and contrast to a raw 0-1 grain value. */
export function shapeGrainValue(value: number, params: GrainSampleParams): number {
  let result = params.invert ? 1 - value : value;
  result = result ** (1 / Math.max(0.01, params.contrast));
  return Math.max(0, Math.min(1, result));
}

/**
 * Look up a decoded plane for `grainId`, decoding from the image cache on
 * first use. Returns null when the texture is not available.
 */
export function resolveGrainPlane(grainId: string): GrainPlane | null {
  const cache = getGrainTextureCache();
  const cached = cache.get(grainId);
  if (cached) return cached;
  const img = getImageCache().getImage(grainId);
  if (!img) return null;
  return cache.put(grainId, img as unknown as Parameters<typeof cache.put>[1]);
}

/**
 * Grain ids that are procedural rather than backed by a texture asset.
 * `undefined`/empty also means procedural.
 */
export const PROCEDURAL_GRAIN_ID = 'procedural';

export function isProceduralGrain(grainId: string | null | undefined): boolean {
  return !grainId || grainId === PROCEDURAL_GRAIN_ID;
}

export interface GrainResolution {
  value: number;
  /** True when the requested texture could not be resolved. */
  missing: boolean;
}

/**
 * Resolve a grain value, reporting whether the requested texture was missing.
 *
 * A missing texture returns full coverage (1) rather than silently swapping in
 * procedural noise: substituting a different texture would change the artwork
 * without telling anyone, whereas painting unmodulated is obviously "the grain
 * is not applied" and pairs with a visible missing-resource warning in the UI.
 */
export function resolveGrainDetailed(
  grainId: string | null | undefined,
  x: number,
  y: number,
  params: GrainSampleParams,
): GrainResolution {
  if (isProceduralGrain(grainId)) {
    const { u, v } = grainTextureCoords(x, y, params);
    const raw = sampleProceduralGrain(Math.floor(u), Math.floor(v), params.seed ?? 0);
    return { value: shapeGrainValue(raw, params), missing: false };
  }
  const plane = resolveGrainPlane(grainId as string);
  if (!plane) return { value: 1, missing: true };
  return { value: shapeGrainValue(sampleGrainPlane(plane, x, y, params), params), missing: false };
}

/**
 * Synchronous grain value — use when the texture is guaranteed decoded or an
 * unmodulated dab is acceptable.
 */
export function resolveGrainValueSync(
  grainId: string | null | undefined,
  x: number,
  y: number,
  params: GrainSampleParams,
): number {
  return resolveGrainDetailed(grainId, x, y, params).value;
}

/** Ensure a grain texture is decoded and ready for synchronous sampling. */
export async function prepareGrain(grainId: string | null | undefined): Promise<boolean> {
  if (isProceduralGrain(grainId)) return true;
  const id = grainId as string;
  if (getGrainTextureCache().has(id)) return true;
  try {
    const loaded = await getImageCache().load(id);
    return (
      getGrainTextureCache().put(
        id,
        loaded as unknown as Parameters<ReturnType<typeof getGrainTextureCache>['put']>[1],
      ) !== null
    );
  } catch {
    return false;
  }
}

/**
 * Resolve grain asynchronously — decodes the texture if needed.
 * @deprecated Prefer `prepareGrain` once, then `resolveGrainValueSync`.
 */
export async function resolveGrainValue(
  grainId: string | null | undefined,
  x: number,
  y: number,
  params: GrainSampleParams,
): Promise<number> {
  await prepareGrain(grainId);
  return resolveGrainValueSync(grainId, x, y, params);
}
