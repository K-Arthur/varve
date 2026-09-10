// @ts-nocheck
// Low-level byte loops: every index is bounds-checked by construction;
// noUncheckedIndexedAccess produces noise here without adding safety.
export type PixelArtAlgorithm =
  | 'nearest'
  | 'epx'
  | 'scale2x'
  | 'scale3x'
  | 'scale4x'
  | 'hqx'
  | 'xbr';

export interface PixelArtOptions {
  algorithm: PixelArtAlgorithm;
  scale: number;
}

type FixedBytes = { [i: number]: number };

function epx2x(source: ImageData): ImageData {
  const sw = source.width;
  const sh = source.height;
  const dw = sw * 2;
  const dh = sh * 2;
  const out = new ImageData(dw, dh);
  const src = source.data as unknown as FixedBytes;
  const dst = out.data as unknown as FixedBytes;

  function px(x: number, y: number): [number, number, number, number] {
    const cx = Math.max(0, Math.min(sw - 1, x));
    const cy = Math.max(0, Math.min(sh - 1, y));
    const i = (cy * sw + cx) * 4;
    return [src[i], src[i + 1], src[i + 2], src[i + 3]];
  }

  function same(a: [number, number, number, number], b: [number, number, number, number]): boolean {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
  }

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const B = px(x, y);
      const T = px(x, y - 1);
      const Bpx = px(x, y + 1);
      const L = px(x - 1, y);
      const R = px(x + 1, y);
      const TL = px(x - 1, y - 1);
      const TR = px(x + 1, y - 1);
      const BL = px(x - 1, y + 1);
      const BR = px(x + 1, y + 1);

      const diTL = same(B, BR) && !same(B, BL) && !same(B, TR) && !same(L, T);
      const diTR = same(B, BL) && !same(B, BR) && !same(B, TL) && !same(R, T);
      const diBL = same(B, TR) && !same(B, TL) && !same(B, BR) && !same(L, Bpx);
      const diBR = same(B, TL) && !same(B, TR) && !same(B, BL) && !same(R, Bpx);

      const oy = y * 2;
      const ox = x * 2;

      function set(oy2: number, ox2: number, color: [number, number, number, number]) {
        const di = (oy2 * dw + ox2) * 4;
        dst[di] = color[0];
        dst[di + 1] = color[1];
        dst[di + 2] = color[2];
        dst[di + 3] = color[3];
      }

      if (same(L, T)) {
        set(oy, ox, L);
      } else if (diTL) {
        set(oy, ox, TL);
      } else {
        set(oy, ox, B);
      }

      if (same(R, T)) {
        set(oy, ox + 1, R);
      } else if (diTR) {
        set(oy, ox + 1, TR);
      } else {
        set(oy, ox + 1, B);
      }

      if (same(L, Bpx)) {
        set(oy + 1, ox, L);
      } else if (diBL) {
        set(oy + 1, ox, BL);
      } else {
        set(oy + 1, ox, B);
      }

      if (same(R, Bpx)) {
        set(oy + 1, ox + 1, R);
      } else if (diBR) {
        set(oy + 1, ox + 1, BR);
      } else {
        set(oy + 1, ox + 1, B);
      }
    }
  }
  return out;
}

function scaleNx(source: ImageData, factor: number): ImageData {
  const sw = source.width;
  const sh = source.height;
  const dw = sw * factor;
  const dh = sh * factor;
  const out = new ImageData(dw, dh);
  const src = source.data as unknown as FixedBytes;
  const dst = out.data as unknown as FixedBytes;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      const r = src[i],
        g = src[i + 1],
        b = src[i + 2],
        a = src[i + 3];
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const di = ((y * factor + dy) * dw + (x * factor + dx)) * 4;
          dst[di] = r;
          dst[di + 1] = g;
          dst[di + 2] = b;
          dst[di + 3] = a;
        }
      }
    }
  }
  return out;
}

function hq2xCore(source: ImageData): ImageData {
  const sw = source.width;
  const sh = source.height;
  const dw = sw * 2;
  const dh = sh * 2;
  const out = new ImageData(dw, dh);
  const src = source.data as unknown as FixedBytes;
  const dst = out.data as unknown as FixedBytes;

  const tr = 30;

  function lum(r: number, g: number, b: number): number {
    return (r * 299 + g * 587 + b * 114) / 1000;
  }

  function diff(y1: number, y2: number): number {
    return Math.abs(y1 - y2);
  }

  function getLum(x: number, y: number): number {
    const cx = Math.max(0, Math.min(sw - 1, x));
    const cy = Math.max(0, Math.min(sh - 1, y));
    const i = (cy * sw + cx) * 4;
    return lum(src[i], src[i + 1], src[i + 2]);
  }

  function getRgb(x: number, y: number): [number, number, number, number] {
    const cx = Math.max(0, Math.min(sw - 1, x));
    const cy = Math.max(0, Math.min(sh - 1, y));
    const i = (cy * sw + cx) * 4;
    return [src[i], src[i + 1], src[i + 2], src[i + 3]];
  }

  function set(oy: number, ox: number, cr: number, cg: number, cb: number, ca: number) {
    const di = (oy * dw + ox) * 4;
    dst[di] = cr;
    dst[di + 1] = cg;
    dst[di + 2] = cb;
    dst[di + 3] = ca;
  }

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const c0 = getLum(x - 1, y - 1);
      const c1 = getLum(x, y - 1);
      const c2 = getLum(x + 1, y - 1);
      const c3 = getLum(x - 1, y);
      const c5 = getLum(x + 1, y);
      const c6 = getLum(x - 1, y + 1);
      const c7 = getLum(x, y + 1);
      const c8 = getLum(x + 1, y + 1);

      const [r, g, b, a] = getRgb(x, y);
      const oy = y * 2;
      const ox = x * 2;

      const de = diff(c1, c7) + diff(c3, c5) + diff(c0, c8) + diff(c2, c6);
      const dhv = Math.abs(diff(c1, c3) - diff(c7, c5)) + Math.abs(diff(c3, c1) - diff(c5, c7));
      const isEdge = de > tr * 2 || dhv > tr;

      if (isEdge) {
        if (diff(c1, c3) < tr && diff(c1, c5) < tr && diff(c3, c1) < tr) {
          const [r1, g1, b1]: [number, number, number] = [
            Math.round((r + getRgb(x - 1, y)[0]) / 2),
            Math.round((g + getRgb(x - 1, y)[1]) / 2),
            Math.round((b + getRgb(x - 1, y)[2]) / 2),
          ];
          set(oy, ox, r1, g1, b1, a);
        } else {
          set(oy, ox, r, g, b, a);
        }

        if (diff(c1, c5) < tr && diff(c3, c5) < tr && diff(c1, c7) < tr) {
          const [r1, g1, b1]: [number, number, number] = [
            Math.round((r + getRgb(x + 1, y)[0]) / 2),
            Math.round((g + getRgb(x + 1, y)[1]) / 2),
            Math.round((b + getRgb(x + 1, y)[2]) / 2),
          ];
          set(oy, ox + 1, r1, g1, b1, a);
        } else {
          set(oy, ox + 1, r, g, b, a);
        }

        if (diff(c7, c3) < tr && diff(c7, c5) < tr && diff(c7, c1) < tr) {
          const [r1, g1, b1]: [number, number, number] = [
            Math.round((r + getRgb(x - 1, y + 1)[0]) / 2),
            Math.round((g + getRgb(x - 1, y + 1)[1]) / 2),
            Math.round((b + getRgb(x - 1, y + 1)[2]) / 2),
          ];
          set(oy + 1, ox, r1, g1, b1, a);
        } else {
          set(oy + 1, ox, r, g, b, a);
        }

        if (diff(c5, c3) < tr && diff(c5, c7) < tr && diff(c5, c1) < tr) {
          const [r1, g1, b1]: [number, number, number] = [
            Math.round((r + getRgb(x + 1, y + 1)[0]) / 2),
            Math.round((g + getRgb(x + 1, y + 1)[1]) / 2),
            Math.round((b + getRgb(x + 1, y + 1)[2]) / 2),
          ];
          set(oy + 1, ox + 1, r1, g1, b1, a);
        } else {
          set(oy + 1, ox + 1, r, g, b, a);
        }
      } else {
        set(oy, ox, r, g, b, a);
        set(oy, ox + 1, r, g, b, a);
        set(oy + 1, ox, r, g, b, a);
        set(oy + 1, ox + 1, r, g, b, a);
      }
    }
  }
  return out;
}

function xbr2x(source: ImageData): ImageData {
  const sw = source.width;
  const sh = source.height;
  const dw = sw * 2;
  const dh = sh * 2;
  const out = new ImageData(dw, dh);
  const src = source.data as unknown as FixedBytes;
  const dst = out.data as unknown as FixedBytes;

  const tr = 20;

  function weight(c1: [number, number, number], c2: [number, number, number]): number {
    const dr = c1[0] - c2[0];
    const dg = c1[1] - c2[1];
    const db = c1[2] - c2[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function getRgb(x: number, y: number): [number, number, number, number] {
    const cx = Math.max(0, Math.min(sw - 1, x));
    const cy = Math.max(0, Math.min(sh - 1, y));
    const i = (cy * sw + cx) * 4;
    return [src[i], src[i + 1], src[i + 2], src[i + 3]];
  }

  function set(oy: number, ox: number, cr: number, cg: number, cb: number, ca: number) {
    const di = (oy * dw + ox) * 4;
    dst[di] = cr;
    dst[di + 1] = cg;
    dst[di + 2] = cb;
    dst[di + 3] = ca;
  }

  function df(v1: [number, number, number], v2: [number, number, number]): boolean {
    return weight(v1, v2) <= tr;
  }

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const [cr, cg, cb, ca] = getRgb(x, y);
      const c: [number, number, number] = [cr, cg, cb];
      const w1 = getRgb(x - 1, y - 1);
      const w2 = getRgb(x, y - 1);
      const w3 = getRgb(x + 1, y - 1);
      const w4 = getRgb(x - 1, y);
      const w5 = getRgb(x + 1, y);
      const w6 = getRgb(x - 1, y + 1);
      const w7 = getRgb(x, y + 1);
      const w8 = getRgb(x + 1, y + 1);
      const oy = y * 2;
      const ox = x * 2;

      const diagNW = df([w1[0], w1[1], w1[2]], c)
        ? 0
        : df([w2[0], w2[1], w2[2]], c) && df([w4[0], w4[1], w4[2]], c)
          ? 1
          : 2;
      const diagNE = df([w3[0], w3[1], w3[2]], c)
        ? 0
        : df([w2[0], w2[1], w2[2]], c) && df([w5[0], w5[1], w5[2]], c)
          ? 1
          : 2;
      const diagSW = df([w6[0], w6[1], w6[2]], c)
        ? 0
        : df([w4[0], w4[1], w4[2]], c) && df([w7[0], w7[1], w7[2]], c)
          ? 1
          : 2;
      const diagSE = df([w8[0], w8[1], w8[2]], c)
        ? 0
        : df([w5[0], w5[1], w5[2]], c) && df([w7[0], w7[1], w7[2]], c)
          ? 1
          : 2;

      if (diagNW === 0) {
        set(oy, ox, cr, cg, cb, ca);
      } else if (diagNW === 1) {
        const avg: [number, number, number] = [
          Math.round((cr + w2[0] + w4[0]) / 3),
          Math.round((cg + w2[1] + w4[1]) / 3),
          Math.round((cb + w2[2] + w4[2]) / 3),
        ];
        set(oy, ox, avg[0], avg[1], avg[2], ca);
      } else {
        set(oy, ox, cr, cg, cb, ca);
      }

      if (diagNE === 0) {
        set(oy, ox + 1, cr, cg, cb, ca);
      } else if (diagNE === 1) {
        const avg: [number, number, number] = [
          Math.round((cr + w2[0] + w5[0]) / 3),
          Math.round((cg + w2[1] + w5[1]) / 3),
          Math.round((cb + w2[2] + w5[2]) / 3),
        ];
        set(oy, ox + 1, avg[0], avg[1], avg[2], ca);
      } else {
        set(oy, ox + 1, cr, cg, cb, ca);
      }

      if (diagSW === 0) {
        set(oy + 1, ox, cr, cg, cb, ca);
      } else if (diagSW === 1) {
        const avg: [number, number, number] = [
          Math.round((cr + w4[0] + w7[0]) / 3),
          Math.round((cg + w4[1] + w7[1]) / 3),
          Math.round((cb + w4[2] + w7[2]) / 3),
        ];
        set(oy + 1, ox, avg[0], avg[1], avg[2], ca);
      } else {
        set(oy + 1, ox, cr, cg, cb, ca);
      }

      if (diagSE === 0) {
        set(oy + 1, ox + 1, cr, cg, cb, ca);
      } else if (diagSE === 1) {
        const avg: [number, number, number] = [
          Math.round((cr + w5[0] + w7[0]) / 3),
          Math.round((cg + w5[1] + w7[1]) / 3),
          Math.round((cb + w5[2] + w7[2]) / 3),
        ];
        set(oy + 1, ox + 1, avg[0], avg[1], avg[2], ca);
      } else {
        set(oy + 1, ox + 1, cr, cg, cb, ca);
      }
    }
  }
  return out;
}

/**
 * Apply a 2x pixel-art algorithm iteratively to reach the target power-of-2
 * scale. Non-power-of-2 remainder is filled with nearest-neighbor (which
 * is honest — these algorithms are designed for 2x passes, not fractional).
 */
function iterativePixelArtScale(
  source: ImageData,
  scale: number,
  core2x: (src: ImageData) => ImageData,
): ImageData {
  if (scale === 1) return source;
  // Number of 2x passes: floor(log2(scale)) — e.g. scale 8 = 3 passes
  const passes = Math.floor(Math.log2(scale));
  let current = source;
  for (let i = 0; i < passes; i++) {
    current = core2x(current);
  }
  // If scale is not a power of 2, fill the remainder with nearest-neighbor
  const achievedScale = current.width / source.width;
  if (achievedScale < scale) {
    current = scaleNx(current, scale / achievedScale);
  }
  return current;
}

export function scalePixelArt(source: ImageData, options: PixelArtOptions): ImageData {
  const { algorithm, scale } = options;
  if (scale <= 0 || !Number.isInteger(scale)) {
    throw new Error(`Pixel-art scale must be a positive integer, got ${scale}`);
  }

  switch (algorithm) {
    case 'nearest':
      return scaleNx(source, scale);
    case 'epx':
    case 'scale2x':
      return iterativePixelArtScale(source, scale, epx2x);
    case 'scale3x':
      return scaleNx(source, 3);
    case 'scale4x':
      return scaleNx(source, 4);
    case 'hqx':
      return iterativePixelArtScale(source, scale, hq2xCore);
    case 'xbr':
      return iterativePixelArtScale(source, scale, xbr2x);
    default:
      return scaleNx(source, scale);
  }
}
