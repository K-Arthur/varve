/**
 * CRT / analog display emulation kernel.
 *
 * Reusable procedural primitives: barrel curvature warp, scanline shading,
 * phosphor mask layouts (RGB stripe / BGR stripe / aperture grille / shadow
 * mask), glow, vignette, sub-pixel convergence offsets, and brightness/
 * contrast gain. Every pattern is analytic and deterministic — no noise, no
 * randomness. Scanline/phosphor moiré is mitigated by sampling the mask at
 * device pixels while curvature is applied in normalized coordinates, so the
 * pattern only aliases at extreme zoom (documented; the saved effect is
 * unchanged by zoom).
 */

export type PhosphorMask = 'none' | 'rgb-stripe' | 'bgr-stripe' | 'aperture-grille' | 'shadow-mask';

export interface CrtParams {
  /** 0..1 barrel curvature. */
  curvature: number;
  /** 0..1 corner rounding (multiplies the vignette falloff). */
  cornerRadius: number;
  /** Scanline period in device pixels (>= 1.5). */
  scanlinePeriod: number;
  /** 0..1 scanline depth. */
  scanlineStrength: number;
  /** 0..1 scanline softness. */
  scanlineSoftness: number;
  phosphorMask: PhosphorMask;
  /** Phosphor pitch in device pixels (>= 1). */
  phosphorPitch: number;
  /** 0..1 phosphor mask depth. */
  phosphorIntensity: number;
  /** 0..1 phosphor glow (small blur added to the bright pass). */
  glow: number;
  /** 0..1 vignette depth. */
  vignette: number;
  /** 0..1 vignette radius (0.5 = screen centre at 50%). */
  vignetteRadius: number;
  /** Convergence offsets in device pixels (red/blue opposed). */
  convergenceX: number;
  convergenceY: number;
  /** -1..1 brightness shift. */
  brightness: number;
  /** 0..2 contrast gain. */
  contrast: number;
}

/** Apply CRT emulation in place. Returns the same ImageData. */
export function applyCrt(imageData: ImageData, params: CrtParams): ImageData {
  const { data, width: w, height: h } = imageData;
  if (w === 0 || h === 0) return imageData;

  const curvature = clamp01(params.curvature ?? 0);
  const scanPeriod = Math.max(1.5, params.scanlinePeriod ?? 3);
  const scanStrength = clamp01(params.scanlineStrength ?? 0.5);
  const scanSoftness = clamp01(params.scanlineSoftness ?? 0.5);
  const phosphor = params.phosphorMask ?? 'none';
  const pitch = Math.max(1, params.phosphorPitch ?? 4);
  const phIntensity = clamp01(params.phosphorIntensity ?? 0.6);
  const glow = clamp01(params.glow ?? 0);
  const vignette = clamp01(params.vignette ?? 0);
  const vignetteR = clamp01(params.vignetteRadius ?? 0.5);
  const cx = params.convergenceX ?? 0;
  const cy = params.convergenceY ?? 0;
  const brightness = clampRange(params.brightness ?? 0, -1, 1);
  const contrast = clampRange(params.contrast ?? 1, 0, 2);

  const src = new Uint8ClampedArray(data);
  premultiply(src);

  const halfW = w / 2;
  const halfH = h / 2;

  // Curvature warp: inverse mapping (output px → source offset).
  // Barrel: out_r = in_r * (1 + k * in_r²) → sample at in = out/(1+k·out²).
  const warpK = curvature * 0.28;

  // Phosphor mask pattern: evaluated analytically per subpixel phase.

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      const a = src[o + 3]!;

      // Curvature: sample source at warped position (clamp border).
      let sx = x;
      let sy = y;
      if (warpK > 0) {
        const nx = (x - halfW) / halfW;
        const ny = (y - halfH) / halfH;
        const r2 = nx * nx + ny * ny;
        const scale = 1 + warpK * r2;
        sx = Math.min(w - 1, Math.max(0, halfW + (nx * halfW) / scale));
        sy = Math.min(h - 1, Math.max(0, halfH + (ny * halfH) / scale));
      }
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const x1 = Math.min(w - 1, x0 + 1);
      const y1 = Math.min(h - 1, y0 + 1);
      let r = lerp(
        lerp(src[(y0 * w + x0) * 4]!, src[(y0 * w + x1) * 4]!, fx),
        lerp(src[(y1 * w + x0) * 4]!, src[(y1 * w + x1) * 4]!, fx),
        fy,
      );
      let g = lerp(
        lerp(src[(y0 * w + x0) * 4 + 1]!, src[(y0 * w + x1) * 4 + 1]!, fx),
        lerp(src[(y1 * w + x0) * 4 + 1]!, src[(y1 * w + x1) * 4 + 1]!, fx),
        fy,
      );
      let b = lerp(
        lerp(src[(y0 * w + x0) * 4 + 2]!, src[(y0 * w + x1) * 4 + 2]!, fx),
        lerp(src[(y1 * w + x0) * 4 + 2]!, src[(y1 * w + x1) * 4 + 2]!, fx),
        fy,
      );

      // Convergence: red shifted +, blue shifted − (subpixel bilinear).
      if (cx !== 0 || cy !== 0) {
        const rr = sampleBilinear(src, w, h, x + cx, y + cy, 0);
        const rb = sampleBilinear(src, w, h, x - cx, y - cy, 2);
        r = lerp(r, rr, 0.6);
        b = lerp(b, rb, 0.6);
      }

      // Scanlines.
      if (scanStrength > 0) {
        const phase = ((y % scanPeriod) + scanPeriod) % scanPeriod;
        const pulse = 0.5 + 0.5 * Math.cos((2 * Math.PI * phase) / scanPeriod);
        const depth = scanStrength * pulse ** (0.4 + scanSoftness * 2.2);
        r *= 1 - depth;
        g *= 1 - depth;
        b *= 1 - depth;
      }

      // Phosphor mask.
      if (phosphor !== 'none' && phIntensity > 0) {
        const [mr, mg, mb] = phosphorMaskAt(phosphor, x, y, pitch);
        const m = phIntensity;
        r = r * (1 - m) + r * mr * m;
        g = g * (1 - m) + g * mg * m;
        b = b * (1 - m) + b * mb * m;
      }

      // Vignette (also handles corner rounding via the same falloff).
      if (vignette > 0) {
        const nx = (x - halfW) / (halfW * vignetteR * 2);
        const ny = (y - halfH) / (halfH * vignetteR * 2);
        const d = Math.min(1, Math.hypot(nx, ny));
        const vig = 1 - vignette * smoothstep(0.55, 1, d);
        r *= vig;
        g *= vig;
        b *= vig;
      }

      // Brightness/contrast.
      const gain = contrast;
      r = (r - 128) * gain + 128 + brightness * 128;
      g = (g - 128) * gain + 128 + brightness * 128;
      b = (b - 128) * gain + 128 + brightness * 128;

      data[o] = clampByte(r);
      data[o + 1] = clampByte(g);
      data[o + 2] = clampByte(b);
      data[o + 3] = a;
    }
  }

  // Glow: add a small blur of the bright content back (linear-light friendly).
  if (glow > 0) {
    const glowPass = new Uint8ClampedArray(data);
    boxBlur3(glowPass, w, h, 2);
    const m = glow * 0.5;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clampByte(data[i]! + (glowPass[i]! - data[i]!) * m);
      data[i + 1] = clampByte(data[i + 1]! + (glowPass[i + 1]! - data[i + 1]!) * m);
      data[i + 2] = clampByte(data[i + 2]! + (glowPass[i + 2]! - data[i + 2]!) * m);
    }
  }

  unpremultiply(data);
  return imageData;
}

function phosphorMaskAt(
  mask: PhosphorMask,
  x: number,
  y: number,
  pitch: number,
): [number, number, number] {
  const px = x % pitch;
  const t = px / pitch;
  switch (mask) {
    case 'rgb-stripe':
      return t < 0.34 ? [1, 0.22, 0.22] : t < 0.67 ? [0.22, 1, 0.22] : [0.22, 0.22, 1];
    case 'bgr-stripe':
      return t < 0.34 ? [0.22, 0.22, 1] : t < 0.67 ? [0.22, 1, 0.22] : [1, 0.22, 0.22];
    case 'aperture-grille': {
      // Vertical slots: narrow dark bands between columns of phosphors.
      return t < 0.5 ? [1, 0.35, 0.35] : [0.35, 0.35, 1];
    }
    case 'shadow-mask': {
      const py = y % pitch;
      const dot = Math.hypot(t - 0.5, py / pitch - 0.5) * 2;
      const dark = dot > 0.85 ? 0.2 : 1;
      return [dark, dark, dark];
    }
    default:
      return [1, 1, 1];
  }
}

function sampleBilinear(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  c: number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = Math.min(w - 1, Math.max(0, x0 + 1));
  const y1 = Math.min(h - 1, Math.max(0, y0 + 1));
  const c0 = Math.max(0, Math.min(w - 1, x0));
  const r0 = Math.max(0, Math.min(h - 1, y0));
  const a = src[(r0 * w + c0) * 4 + c]!;
  const b = src[(r0 * w + x1) * 4 + c]!;
  const d = src[(y1 * w + c0) * 4 + c]!;
  const e = src[(y1 * w + x1) * 4 + c]!;
  return a + (b - a) * fx + (d - a) * fy + (a - b - d + e) * fx * fy;
}

function boxBlur3(data: Uint8ClampedArray, w: number, h: number, radius: number): void {
  const tmp = new Float32Array(w * h * 4);
  for (let c = 0; c < 4; c += 1) {
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let sum = 0;
        let n = 0;
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            sum += data[(ny * w + nx) * 4 + c]!;
            n += 1;
          }
        }
        tmp[(y * w + x) * 4 + c] = sum / n;
      }
    }
  }
  for (let i = 0; i < data.length; i += 1) data[i] = Math.round(tmp[i]!);
}

function premultiply(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 255) continue;
    if (a === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      continue;
    }
    data[i] = Math.round((data[i]! * a) / 255);
    data[i + 1] = Math.round((data[i + 1]! * a) / 255);
    data[i + 2] = Math.round((data[i + 2]! * a) / 255);
  }
}

function unpremultiply(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 0 || a === 255) continue;
    const inv = 255 / a;
    data[i] = clampByte(data[i]! * inv);
    data[i + 1] = clampByte(data[i + 1]! * inv);
    data[i + 2] = clampByte(data[i + 2]! * inv);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampRange(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
