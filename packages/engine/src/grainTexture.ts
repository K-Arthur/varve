/**
 * Decoded grain textures.
 *
 * Grain is sampled once per painted pixel, so the sampler must be able to read
 * a texel with a single array index. Decoding happens once per texture into a
 * flat 8-bit luminance plane; the previous implementation issued a `drawImage`
 * plus `getImageData` for *every pixel of every dab*, which is roughly 31,000
 * canvas readbacks for one 100px dab and made textured brushes unusable.
 *
 * The cache is bounded by decoded bytes and evicts least-recently-used entries,
 * so importing a large grain library does not pin every texture in memory for
 * the lifetime of the session.
 */

export interface GrainPlane {
  width: number;
  height: number;
  /** Row-major 8-bit luminance. */
  data: Uint8Array;
}

export type GrainSource = HTMLImageElement | ImageBitmap | OffscreenCanvas | HTMLCanvasElement;

/** Default decoded-byte budget (~32 MB of luminance planes). */
export const DEFAULT_GRAIN_CACHE_BYTES = 32 * 1024 * 1024;

/**
 * Largest texture side we will decode. Bigger textures are downsampled rather
 * than refused: a 16k grain scan is legitimate input, but decoding it whole
 * would cost 256 MB for a texture nobody can perceive at that resolution.
 */
export const MAX_GRAIN_DIMENSION = 2048;

interface CacheEntry {
  plane: GrainPlane;
  bytes: number;
  lastUsed: number;
}

export class GrainTextureCache {
  private entries = new Map<string, CacheEntry>();
  private bytes = 0;
  private clock = 0;

  constructor(private budgetBytes: number = DEFAULT_GRAIN_CACHE_BYTES) {}

  get decodedBytes(): number {
    return this.bytes;
  }

  get size(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Decoded plane for `id`, or null when it has not been decoded yet. */
  get(id: string): GrainPlane | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    entry.lastUsed = ++this.clock;
    return entry.plane;
  }

  /** Decode `source` into a luminance plane and cache it under `id`. */
  put(id: string, source: GrainSource): GrainPlane | null {
    const plane = decodeGrainPlane(source);
    if (!plane) return null;
    this.putPlane(id, plane);
    return plane;
  }

  putPlane(id: string, plane: GrainPlane): void {
    this.evictEntry(id);
    const bytes = plane.data.byteLength;
    this.entries.set(id, { plane, bytes, lastUsed: ++this.clock });
    this.bytes += bytes;
    this.trim();
  }

  delete(id: string): void {
    this.evictEntry(id);
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  /** Drop entries until the budget is met, oldest first. */
  private trim(): void {
    if (this.bytes <= this.budgetBytes) return;
    const byAge = [...this.entries.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [id] of byAge) {
      if (this.bytes <= this.budgetBytes) break;
      this.evictEntry(id);
    }
  }

  private evictEntry(id: string): void {
    const existing = this.entries.get(id);
    if (!existing) return;
    this.bytes -= existing.bytes;
    this.entries.delete(id);
  }
}

/**
 * Read a drawable image into a luminance plane.
 *
 * Returns null when there is no canvas implementation available (e.g. a worker
 * without OffscreenCanvas) so callers can fall back rather than throw.
 */
export function decodeGrainPlane(source: GrainSource): GrainPlane | null {
  const srcW = source.width;
  const srcH = source.height;
  if (!srcW || !srcH) return null;

  const scale = Math.min(1, MAX_GRAIN_DIMENSION / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const ctx = createContext(width, height);
  if (!ctx) return null;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source as CanvasImageSource, 0, 0, srcW, srcH, 0, 0, width, height);

  let rgba: Uint8ClampedArray;
  try {
    rgba = ctx.getImageData(0, 0, width, height).data;
  } catch {
    // Tainted canvas (cross-origin texture) — refuse rather than sample noise.
    return null;
  }

  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    // Rec. 601 luma: grain is a brightness modulation, not a colour.
    data[i] = (rgba[p]! * 299 + rgba[p + 1]! * 587 + rgba[p + 2]! * 114) / 1000;
  }
  return { width, height, data };
}

function createContext(
  width: number,
  height: number,
): (CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    return canvas.getContext('2d', { willReadFrequently: true });
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas.getContext('2d', { willReadFrequently: true });
  }
  return null;
}

export type GrainWrapMode = 'repeat' | 'mirror' | 'clamp';

/**
 * Sample a plane at a texel coordinate, 0-1.
 *
 * Coordinates may be negative or far outside the plane — canvas-anchored grain
 * addresses world space — so wrapping is done with a floored modulo rather than
 * `%`, which would mirror the texture across the origin.
 */
export function samplePlane(
  plane: GrainPlane,
  x: number,
  y: number,
  wrap: GrainWrapMode = 'repeat',
): number {
  const px = wrapCoord(Math.floor(x), plane.width, wrap);
  const py = wrapCoord(Math.floor(y), plane.height, wrap);
  if (px < 0 || py < 0) return 0;
  return plane.data[py * plane.width + px]! / 255;
}

function wrapCoord(v: number, size: number, wrap: GrainWrapMode): number {
  if (size <= 0) return -1;
  switch (wrap) {
    case 'clamp':
      return Math.max(0, Math.min(size - 1, v));
    case 'mirror': {
      const period = size * 2;
      let m = ((v % period) + period) % period;
      if (m >= size) m = period - 1 - m;
      return m;
    }
    default:
      return ((v % size) + size) % size;
  }
}

let globalGrainCache: GrainTextureCache | null = null;

export function getGrainTextureCache(): GrainTextureCache {
  if (!globalGrainCache) globalGrainCache = new GrainTextureCache();
  return globalGrainCache;
}

/** Test seam. */
export function resetGrainTextureCache(): void {
  globalGrainCache = null;
}
