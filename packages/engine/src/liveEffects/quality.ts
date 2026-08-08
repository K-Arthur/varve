/**
 * Render quality tiers for live effects.
 *
 * Three tiers with a strict contract:
 *   interactive — reduced internal resolution / sample counts. Only used while
 *                 the user is actively dragging a control; never persisted.
 *   normal      — full resolution, standard samples. Live-canvas default.
 *   export      — full resolution, maximum samples. Forced on all export paths.
 *
 * The serialized `quality` parameter on an effect is one of
 * 'auto' | 'interactive' | 'normal' | 'export'. 'auto' resolves to the
 * caller-provided tier, so documents that never set an explicit tier still
 * export at full quality and preview at normal quality. A user-selected tier
 * is honoured in preview but never degrades export (export callers always
 * pass 'export').
 */

export type EffectQuality = 'interactive' | 'normal' | 'export';

export type EffectQualityParam = 'auto' | 'interactive' | 'normal' | 'export';

/** Resolve a serialized quality param against the caller's tier. */
export function resolveEffectQuality(
  param: EffectQualityParam | undefined,
  caller: EffectQuality,
): EffectQuality {
  if (param && param !== 'auto') return param;
  return caller;
}

/** Internal resolution factor for an effective tier (1 = full res). */
export function qualityResolutionFactor(quality: EffectQuality): number {
  switch (quality) {
    case 'interactive':
      return 0.5;
    case 'normal':
    case 'export':
      return 1;
  }
}

/** Sample-count multiplier for a tier (relative to normal = 1). */
export function qualitySampleFactor(quality: EffectQuality): number {
  switch (quality) {
    case 'interactive':
      return 0.5;
    case 'normal':
      return 1;
    case 'export':
      return 2;
  }
}

/** Box-average downsample by an integer factor (deterministic, no canvas). */
export function downsampleBox(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  factor: number,
): { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
  const f = Math.max(1, Math.floor(factor));
  const dw = Math.max(1, Math.floor(w / f));
  const dh = Math.max(1, Math.floor(h / f));
  const out = new Uint8ClampedArray(new ArrayBuffer(dw * dh * 4));
  for (let y = 0; y < dh; y += 1) {
    for (let x = 0; x < dw; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      const y0 = y * f;
      const x0 = x * f;
      for (let sy = y0; sy < Math.min(y0 + f, h); sy += 1) {
        for (let sx = x0; sx < Math.min(x0 + f, w); sx += 1) {
          const o = (sy * w + sx) * 4;
          r += src[o]!;
          g += src[o + 1]!;
          b += src[o + 2]!;
          a += src[o + 3]!;
          n += 1;
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return { data: out, width: dw, height: dh };
}

/** Bilinear-upsample a buffer into a destination sized w×h (deterministic). */
export function upsampleBilinear(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dst: Uint8ClampedArray,
  w: number,
  h: number,
): void {
  const sxScale = sw / w;
  const syScale = sh / h;
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * syScale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sxScale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = sx - x0;
      const o00 = (y0 * sw + x0) * 4;
      const o10 = (y0 * sw + x1) * 4;
      const o01 = (y1 * sw + x0) * 4;
      const o11 = (y1 * sw + x1) * 4;
      const do_ = (y * w + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        const top = src[o00 + c]! + (src[o10 + c]! - src[o00 + c]!) * fx;
        const bot = src[o01 + c]! + (src[o11 + c]! - src[o01 + c]!) * fx;
        dst[do_ + c] = Math.round(top + (bot - top) * fy);
      }
    }
  }
}
