/**
 * Selective color adjustment engine.
 *
 * Research basis: Photoshop Selective Color — adjusts CMYK ink percentages
 * within a specific color range (reds, yellows, greens, cyans, blues,
 * magentas, whites, neutrals, blacks). Each target color has independently
 * adjustable cyan/magenta/yellow/black components.
 *
 * Two methods: 'absolute' (adds to current percentage) and 'relative'
 * (scales adjustment by current color amount).
 *
 * Architecture: for each pixel, determine which color range(s) it belongs to,
 * then apply the CMYK adjustments. Uses a soft range-weighting approach:
 * pixels near the boundary of a range get partial adjustment.
 */

export type SelectiveColorTarget =
  | 'red'
  | 'green'
  | 'blue'
  | 'cyan'
  | 'magenta'
  | 'yellow'
  | 'white'
  | 'neutral'
  | 'black';

export interface SelectiveColorParams {
  color: SelectiveColorTarget;
  cyan: number;
  magenta: number;
  yellow: number;
  black: number;
  method: 'absolute' | 'relative';
}

const MAX_ADJUSTMENT = 100;

function clampAdjust(v: number): number {
  return Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, v));
}

function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const k = 1 - Math.max(rf, gf, bf);
  if (k >= 1) return [0, 0, 0, 1];
  const c = (1 - rf - k) / (1 - k);
  const m = (1 - gf - k) / (1 - k);
  const y = (1 - bf - k) / (1 - k);
  return [c, m, y, k];
}

function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  const rf = 255 * (1 - c) * (1 - k);
  const gf = 255 * (1 - m) * (1 - k);
  const bf = 255 * (1 - y) * (1 - k);
  return [Math.round(rf), Math.round(gf), Math.round(bf)];
}

function getTargetWeight(r: number, g: number, b: number, target: SelectiveColorTarget): number {
  const maxC = Math.max(r, g, b);
  const isRed = r >= g && r >= b;
  const isGreen = g >= r && g >= b;
  const isBlue = b >= r && b >= g;

  switch (target) {
    case 'red':
      return isRed ? (r - Math.min(g, b)) / 255 : 0;
    case 'green':
      return isGreen ? (g - Math.min(r, b)) / 255 : 0;
    case 'blue':
      return isBlue ? (b - Math.min(r, g)) / 255 : 0;
    case 'cyan':
      return isGreen && isBlue ? Math.min(g, b) / 255 : 0;
    case 'magenta':
      return isRed && isBlue ? Math.min(r, b) / 255 : 0;
    case 'yellow':
      return isRed && isGreen ? Math.min(r, g) / 255 : 0;
    case 'white':
      return maxC > 204 ? (maxC - 204) / 51 : 0;
    case 'black':
      return maxC < 51 ? 1 - maxC / 51 : 0;
    case 'neutral': {
      const lum = (r + g + b) / (3 * 255);
      return lum > 0.1 && lum < 0.9 ? 1 : 0;
    }
  }
}

export function applySelectiveColor(
  imageData: ImageData,
  adjustments: SelectiveColorParams[],
): ImageData {
  const w = imageData.width;
  const h = imageData.height;
  const result = new ImageData(w, h);
  const src = imageData.data;
  const dst = result.data;

  for (let i = 0; i < w * h; i++) {
    const off = i * 4;
    let r = src[off]!;
    let g = src[off + 1]!;
    let b = src[off + 2]!;
    const a = src[off + 3]!;

    if (a === 0) {
      dst[off] = r;
      dst[off + 1] = g;
      dst[off + 2] = b;
      dst[off + 3] = a;
      continue;
    }

    for (const adj of adjustments) {
      const weight = getTargetWeight(r, g, b, adj.color);
      if (weight <= 0) continue;

      let [c, m, y, k] = rgbToCmyk(r, g, b);

      const applyAdjust = (
        current: number,
        delta: number,
        method: 'absolute' | 'relative',
      ): number => {
        const clamped = clampAdjust(delta) / 100;
        if (method === 'absolute') return Math.max(0, Math.min(1, current + clamped * weight));
        return Math.max(0, Math.min(1, current + current * clamped * weight));
      };

      c = applyAdjust(c, adj.cyan, adj.method);
      m = applyAdjust(m, adj.magenta, adj.method);
      y = applyAdjust(y, adj.yellow, adj.method);
      k = applyAdjust(k, adj.black, adj.method);

      [r, g, b] = cmykToRgb(c, m, y, k);
    }

    dst[off] = r;
    dst[off + 1] = g;
    dst[off + 2] = b;
    dst[off + 3] = a;
  }

  return result;
}
