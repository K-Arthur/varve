/**
 * Wet-paint simulation for brush strokes.
 *
 * Architecture:
 * - Wet state is an ephemeral per-layer buffer (not persisted in documents).
 * - Each pixel has: wetness (0-1), accumulated color (RGBA premultiplied).
 * - Drying is time-based: wetness -= dt * dryingRate.
 * - New paint mixes with existing wet paint based on mixStrength.
 * - Wet edge darkens the edge of brush strokes.
 *
 * The wet buffer is reconstructed from layer parameters after save/load.
 * Since it is ephemeral, after reload the buffer starts empty — consistent
 * with how real wet paint does not survive closing an application.
 *
 * Research basis: Corel Painter wet paint, Rebelle watercolor engine,
 *                 oil-paint physical simulation principles (Curtis et al. 1997).
 */

export interface WetPixel {
  /** Wetness 0-1 (0 = dry, 1 = fully wet). */
  wetness: number;
  /** Premultiplied accumulated color red 0-1. */
  r: number;
  /** Premultiplied accumulated color green 0-1. */
  g: number;
  /** Premultiplied accumulated color blue 0-1. */
  b: number;
  /** Premultiplied alpha 0-1. */
  a: number;
}

export interface WetProperties {
  enabled: boolean;
  wetEdge: boolean;
  wetEdgeSize: number;
  wetEdgeDarken: number;
  mixStrength: number;
  dryingRate: number;
}

export const DEFAULT_WET_PROPERTIES: WetProperties = {
  enabled: false,
  wetEdge: false,
  wetEdgeSize: 0.15,
  wetEdgeDarken: 0.3,
  mixStrength: 0.5,
  dryingRate: 0.05,
};

/**
 * Wet buffer — per-pixel wet state for a single raster layer.
 * Stores premultiplied RGBA (0-255) + wetness Float32Array.
 */
export class WetBuffer {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
  readonly wetness: Float32Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.wetness = new Float32Array(width * height);
  }

  /** Get wet state at pixel (x, y). Returns null if out of bounds. */
  get(x: number, y: number): WetPixel | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    const idx = (y * this.width + x) * 4;
    return {
      wetness: this.wetness[y * this.width + x]!,
      r: this.pixels[idx]! / 255,
      g: this.pixels[idx + 1]! / 255,
      b: this.pixels[idx + 2]! / 255,
      a: this.pixels[idx + 3]! / 255,
    };
  }

  /** Set wet state at pixel (x, y). */
  set(x: number, y: number, pixel: WetPixel): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = (y * this.width + x) * 4;
    this.wetness[y * this.width + x] = pixel.wetness;
    this.pixels[idx] = clamp255(pixel.r * 255);
    this.pixels[idx + 1] = clamp255(pixel.g * 255);
    this.pixels[idx + 2] = clamp255(pixel.b * 255);
    this.pixels[idx + 3] = clamp255(pixel.a * 255);
  }

  /**
   * Add paint to a pixel. Mixes with existing wet paint when present.
   *
   * @param x - Pixel X
   * @param y - Pixel Y
   * @param color - RGBA 0-255
   * @param amount - Amount of wetness added (0-1)
   * @param mixStrength - How much new paint mixes with existing (0-1)
   */
  addPaint(
    x: number,
    y: number,
    color: [number, number, number, number],
    amount: number,
    mixStrength: number,
  ): void {
    const existing = this.get(x, y);
    if (!existing) return;

    const r = color[0]! / 255;
    const g = color[1]! / 255;
    const b = color[2]! / 255;
    const a = color[3]! / 255;

    let newR: number;
    let newG: number;
    let newB: number;
    let newA: number;

    if (existing.wetness > 0 && mixStrength > 0) {
      const mix = Math.min(existing.wetness, mixStrength);
      newR = r * (1 - mix) + existing.r * mix;
      newG = g * (1 - mix) + existing.g * mix;
      newB = b * (1 - mix) + existing.b * mix;
      newA = a * (1 - mix) + existing.a * mix;
    } else {
      newR = r;
      newG = g;
      newB = b;
      newA = a;
    }

    const newWetness = Math.min(1, existing.wetness + amount);

    this.set(x, y, {
      wetness: newWetness,
      r: newR * newA,
      g: newG * newA,
      b: newB * newA,
      a: newA,
    });
  }

  /**
   * Apply time-based drying to all pixels.
   * Reduces wetness by dt * dryingRate per pixel.
   */
  dry(dtSeconds: number, dryingRate: number): void {
    if (dryingRate <= 0) return;
    const decay = Math.min(1, dtSeconds * dryingRate);
    const len = this.wetness.length;
    for (let i = 0; i < len; i++) {
      const w = this.wetness[i]!;
      if (w <= 0) continue;
      const newW = Math.max(0, w - decay);
      this.wetness[i] = newW;
      if (newW <= 0) {
        this.pixels[i * 4] = 0;
        this.pixels[i * 4 + 1] = 0;
        this.pixels[i * 4 + 2] = 0;
        this.pixels[i * 4 + 3] = 0;
      }
    }
  }

  /** Reset all pixels to dry. */
  clear(): void {
    this.pixels.fill(0);
    this.wetness.fill(0);
  }
}

function clamp255(v: number): number {
  return Math.round(Math.max(0, Math.min(255, v)));
}

/**
 * Get the wet edge darkening factor for a pixel at a given distance from
 * the brush center, as a fraction of brush radius.
 *
 * @param distRatio - Distance from brush center / radius (0-1)
 * @param edgeSize - Edge region as fraction of radius
 * @param darkenAmount - Maximum darkening (0-1)
 * @returns Darkening multiplier (0 = no effect, higher = darker)
 */
export function wetEdgeDarkening(
  distRatio: number,
  edgeSize: number,
  darkenAmount: number,
): number {
  if (distRatio < 1 - edgeSize) return 0;
  if (distRatio >= 1) return 0;
  return (1 - (1 - distRatio) / edgeSize) * darkenAmount;
}
