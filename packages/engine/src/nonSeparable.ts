/**
 * Non-separable blend modes (hue, saturation, color, luminosity).
 *
 * Research basis: W3C Compositing and Blending Level 1 §10 (Non-separable
 * blend modes). Two implementations: the W3C standard approach using
 * SetSat/SetLum/ClipColor, and a more accurate approach using proper
 * L*a*b* → L*C*h* color space conversion.
 *
 * Architecture: functions operate on non-premultiplied [r,g,b] in [0,1].
 * Caller handles alpha compositing via the blending pipeline.
 */

// ── W3C Spec helpers ────────────────────────────────────────────────────────

/** Relative luminance (W3C formula). */
export function lum(r: number, g: number, b: number): number {
  return 0.3 * r + 0.59 * g + 0.11 * b;
}

/** Clip color values to the available gamut (W3C ClipColor). */
const EPS = 1e-12;
export function clipColor(r: number, g: number, b: number): [number, number, number] {
  const l = lum(r, g, b);
  let cr = r;
  let cg = g;
  let cb = b;
  const n = Math.min(r, g, b);
  const x = Math.max(r, g, b);
  if (n < 0) {
    const denom = l - n;
    if (Math.abs(denom) > EPS) {
      const factor = l / denom;
      cr = l + (cr - l) * factor;
      cg = l + (cg - l) * factor;
      cb = l + (cb - l) * factor;
    }
  }
  if (x > 1) {
    const denom = x - l;
    if (Math.abs(denom) > EPS) {
      const scale = (1 - l) / denom;
      cr = l + (cr - l) * scale;
      cg = l + (cg - l) * scale;
      cb = l + (cb - l) * scale;
    }
  }
  // Clamp floating-point rounding errors (preserves luminance at EPS scale)
  return [
    cr < 0 ? 0 : cr,
    cg < 0 ? 0 : cg,
    cb < 0 ? 0 : cb,
  ];
}

/** Set luminance of a color to a target value (W3C SetLum). */
export function setLum(r: number, g: number, b: number, l: number): [number, number, number] {
  const d = l - lum(r, g, b);
  return clipColor(r + d, g + d, b + d);
}

/** Saturation of a color (W3C Sat). */
export function sat(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** Set saturation of a color to a target value (W3C SetSat). */
export function setSat(r: number, g: number, b: number, s: number): [number, number, number] {
  const sorted = [r, g, b].sort((a, c) => a - c);
  const min = sorted[0]!;
  const mid = sorted[1]!;
  const max = sorted[2]!;
  if (max > min) {
    const mid2 = ((mid - min) * s) / (max - min);
    const result = [r, g, b].map((v) => {
      if (v === max) return s;
      if (v === min) return 0;
      return mid2;
    });
    return [result[0]!, result[1]!, result[2]!];
  }
  return [0, 0, 0];
}

// ── W3C Non-separable blend modes ───────────────────────────────────────────

/** Hue blend: hue from source, luminance and saturation from backdrop. */
export function blendHueW3C(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  const [setR, setG, setB] = setSat(sr, sg, sb, sat(br, bg, bb));
  return setLum(setR, setG, setB, lum(br, bg, bb));
}

/** Saturation blend: saturation from source, luminance and hue from backdrop. */
export function blendSaturationW3C(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  const [setR, setG, setB] = setSat(br, bg, bb, sat(sr, sg, sb));
  return setLum(setR, setG, setB, lum(br, bg, bb));
}

/** Color blend: hue and saturation from source, luminance from backdrop. */
export function blendColorW3C(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  return setLum(sr, sg, sb, lum(br, bg, bb));
}

/** Luminosity blend: luminance from source, hue and saturation from backdrop. */
export function blendLuminosityW3C(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  return setLum(br, bg, bb, lum(sr, sg, sb));
}

// ── L*a*b* → L*C*h* color space (perceptually uniform) ─────────────────────

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

const D65 = [0.95047, 1.0, 1.08883] as const;

/**
 * Convert sRGB [r,g,b] in [0,1] to CIE L*a*b*.
 * D65 illuminant, 2-degree standard observer.
 */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  let lr = srgbToLinear(r);
  let lg = srgbToLinear(g);
  let lb = srgbToLinear(b);

  // Linear sRGB → CIE XYZ (D65)
  const x = 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb;
  const z = 0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb;

  // XYZ → L*a*b*
  const xn = x / D65[0];
  const yn = y / D65[1];
  const zn = z / D65[2];

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : (903.3 * t + 16) / 116);
  const fx = f(xn);
  const fy = f(yn);
  const fz = f(zn);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bVal = 200 * (fy - fz);

  return [L, a, bVal];
}

/**
 * Convert CIE L*a*b* to sRGB [r,g,b] in [0,1].
 */
export function labToRgb(L: number, a: number, bVal: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - bVal / 200;

  const fInv = (t: number) => {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (116 * t - 16) / 903.3;
  };

  const x = fInv(fx) * D65[0];
  const y = fInv(fy) * D65[1];
  const z = fInv(fz) * D65[2];

  // XYZ → linear sRGB
  const lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const lg = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
  const lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

  return [
    Math.max(0, Math.min(1, linearToSrgb(lr))),
    Math.max(0, Math.min(1, linearToSrgb(lg))),
    Math.max(0, Math.min(1, linearToSrgb(lb))),
  ];
}

/**
 * Convert CIE L*a*b* to L*C*h* (cylindrical representation).
 * L*: lightness (0-100)
 * C: chroma (0-~100)
 * h: hue angle (0-360 degrees)
 */
export function labToLch(L: number, a: number, b: number): [number, number, number] {
  const C = Math.sqrt(a * a + b * b);
  let h = Math.atan2(b, a) * (180 / Math.PI);
  if (h < 0) h += 360;
  return [L, C, h];
}

/**
 * Convert L*C*h* to CIE L*a*b*.
 */
export function lchToLab(L: number, C: number, h: number): [number, number, number] {
  const hRad = h * (Math.PI / 180);
  return [L, C * Math.cos(hRad), C * Math.sin(hRad)];
}

/**
 * Convert sRGB to L*C*h* (full pipeline).
 */
export function rgbToLch(r: number, g: number, b: number): [number, number, number] {
  const [L, a, bVal] = rgbToLab(r, g, b);
  return labToLch(L, a, bVal);
}

/**
 * Convert L*C*h* to sRGB (full pipeline).
 */
export function lchToRgb(L: number, C: number, h: number): [number, number, number] {
  const [La, a, bVal] = lchToLab(L, C, h);
  return labToRgb(La, a, bVal);
}

// ── L*C*h* Non-separable blend modes ─────────────────────────────────────────

/**
 * Hue blend using L*C*h* space: hue from source, L and C from backdrop.
 */
export function blendHueLch(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  const [bL, bC] = rgbToLch(br, bg, bb);
  const [, , sH] = rgbToLch(sr, sg, sb);
  return lchToRgb(bL, bC, sH);
}

/**
 * Saturation blend using L*C*h* space: C from source, L and h from backdrop.
 */
export function blendSaturationLch(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  const [bL, , bH] = rgbToLch(br, bg, bb);
  const [, sC] = rgbToLch(sr, sg, sb);
  return lchToRgb(bL, sC, bH);
}

/**
 * Color blend using L*C*h* space: L from backdrop, C and h from source.
 */
export function blendColorLch(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  const [bL] = rgbToLch(br, bg, bb);
  const [, sC, sH] = rgbToLch(sr, sg, sb);
  return lchToRgb(bL, sC, sH);
}

/**
 * Luminosity blend using L*C*h* space: L from source, C and h from backdrop.
 */
export function blendLuminosityLch(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  const [, bC, bH] = rgbToLch(br, bg, bb);
  const [sL] = rgbToLch(sr, sg, sb);
  return lchToRgb(sL, bC, bH);
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

export type NonSeparableMode = 'hue' | 'saturation' | 'color' | 'luminosity';

/**
 * Dispatch non-separable blend mode by name (W3C implementation).
 */
export function blendNonSeparable(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
  mode: NonSeparableMode | string,
): [number, number, number] {
  switch (mode) {
    case 'hue':
      return blendHueW3C(br, bg, bb, sr, sg, sb);
    case 'saturation':
      return blendSaturationW3C(br, bg, bb, sr, sg, sb);
    case 'color':
      return blendColorW3C(br, bg, bb, sr, sg, sb);
    case 'luminosity':
      return blendLuminosityW3C(br, bg, bb, sr, sg, sb);
    default:
      return [sr, sg, sb];
  }
}
