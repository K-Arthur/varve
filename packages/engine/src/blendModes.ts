/**
 * Individual software blend mode functions for pixel-level compositing.
 *
 * Research basis: W3C Compositing and Blending Level 1 §10 (Blending).
 * Canvas2D `globalCompositeOperation` uses these formulas for separable
 * blend modes; this module provides the same math in pure JS for use in
 * OffscreenCanvas contexts where GCO coverage is incomplete.
 *
 * Architecture: each blend function operates on non-premultiplied [r,g,b]
 * values in [0, 1]. The `blend()` wrapper handles pre-multiplied input,
 * opacity, and alpha compositing. The `blendPixels()` function operates
 * on entire ImageData buffers (for compatibility with compositeCanvas.ts).
 *
 * Separable blend modes are listed in §10.1 of the W3C spec:
 *   normal, multiply, screen, overlay, darken, lighten, color-dodge,
 *   color-burn, hard-light, soft-light, difference, exclusion.
 *
 * The non-separable modes (hue, saturation, color, luminosity) are in
 * §10.2 and live in nonSeparable.ts.
 *
 * Canvas2D composites: plus-lighter, plus-darker, pass-through.
 */

import { blendNonSeparable, type NonSeparableMode } from './nonSeparable';

// ── Separable blend mode functions ───────────────────────────────────────────
// Each takes non-premultiplied [r,g,b] in [0, 1] and returns blended [r,g,b].

/** Normal: source over backdrop (default). */
export function blendNormal(
  _br: number, _bg: number, _bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  return [sr, sg, sb];
}

/** Multiply: Cs × Cb. */
export function blendMultiply(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  return [br * sr, bg * sg, bb * sb];
}

/** Screen: 1 - (1 - Cs) × (1 - Cb). */
export function blendScreen(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  return [
    1 - (1 - br) * (1 - sr),
    1 - (1 - bg) * (1 - sg),
    1 - (1 - bb) * (1 - sb),
  ];
}

/** Overlay: multiply or screen depending on backdrop value. */
export function blendOverlay(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  return [
    br < 0.5 ? 2 * br * sr : 1 - 2 * (1 - br) * (1 - sr),
    bg < 0.5 ? 2 * bg * sg : 1 - 2 * (1 - bg) * (1 - sg),
    bb < 0.5 ? 2 * bb * sb : 1 - 2 * (1 - bb) * (1 - sb),
  ];
}

/** Darken: min(Cs, Cb). */
export function blendDarken(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  return [Math.min(br, sr), Math.min(bg, sg), Math.min(bb, sb)];
}

/** Lighten: max(Cs, Cb). */
export function blendLighten(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  return [Math.max(br, sr), Math.max(bg, sg), Math.max(bb, sb)];
}

/** Color-dodge: brighten backdrop to reflect source. */
export function blendColorDodge(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  return [
    br === 0 ? 0 : sr >= 1 ? 1 : Math.min(1, br / (1 - sr)),
    bg === 0 ? 0 : sg >= 1 ? 1 : Math.min(1, bg / (1 - sg)),
    bb === 0 ? 0 : sb >= 1 ? 1 : Math.min(1, bb / (1 - sb)),
  ];
}

/** Color-burn: darken backdrop to reflect source. */
export function blendColorBurn(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  return [
    br >= 1 ? 1 : sr <= 0 ? 0 : 1 - Math.min(1, (1 - br) / sr),
    bg >= 1 ? 1 : sg <= 0 ? 0 : 1 - Math.min(1, (1 - bg) / sg),
    bb >= 1 ? 1 : sb <= 0 ? 0 : 1 - Math.min(1, (1 - bb) / sb),
  ];
}

/** Hard-light: multiply or screen depending on source value. */
export function blendHardLight(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  return [
    sr < 0.5 ? 2 * br * sr : 1 - 2 * (1 - br) * (1 - sr),
    sg < 0.5 ? 2 * bg * sg : 1 - 2 * (1 - bg) * (1 - sg),
    sb < 0.5 ? 2 * bb * sb : 1 - 2 * (1 - bb) * (1 - sb),
  ];
}

/** Soft-light: subtle contrast enhancement (W3C formula). */
export function blendSoftLight(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  const soft = (a: number, b: number): number => {
    if (b <= 0.5) return a - (1 - 2 * b) * a * (1 - a);
    const g = a <= 0.25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a);
    return a + (2 * b - 1) * (g - a);
  };
  return [soft(br, sr), soft(bg, sg), soft(bb, sb)];
}

/** Difference: |Cs - Cb|. */
export function blendDifference(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  return [
    Math.abs(br - sr),
    Math.abs(bg - sg),
    Math.abs(bb - sb),
  ];
}

/** Exclusion: Cs + Cb - 2 × Cs × Cb. */
export function blendExclusion(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  return [
    br + sr - 2 * br * sr,
    bg + sg - 2 * bg * sg,
    bb + sb - 2 * bb * sb,
  ];
}

// ── Non-separable dispatch ───────────────────────────────────────────────────

/**
 * Non-separable blend mode dispatch (hue, saturation, color, luminosity).
 * Delegates to nonSeparable.ts.
 */
export function blendNonSeparableDispatch(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
  mode: NonSeparableMode | string,
): [number, number, number] {
  return blendNonSeparable(br, bg, bb, sr, sg, sb, mode);
}

// ── Plus modes ───────────────────────────────────────────────────────────────

/** Plus-darker: max(0, Cs + Cb - 1). */
export function blendPlusDarker(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  return [
    Math.max(0, br + sr - 1),
    Math.max(0, bg + sg - 1),
    Math.max(0, bb + sb - 1),
  ];
}

/** Plus-lighter: min(1, Cs + Cb). */
export function blendPlusLighter(
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
): [number, number, number] {
  return [
    Math.min(1, br + sr),
    Math.min(1, bg + sg),
    Math.min(1, bb + sb),
  ];
}

// ─── Unified blend with alpha compositing ────────────────────────────────────

/** Map blend mode string to a (backdrop, source) → blended function. */
function getBlendFn(mode: string): (
  br: number, bg: number, bb: number,
  sr: number, sg: number, sb: number,
) => [number, number, number] {
  switch (mode) {
    case 'normal': return blendNormal;
    case 'multiply': return blendMultiply;
    case 'screen': return blendScreen;
    case 'overlay': return blendOverlay;
    case 'darken': return blendDarken;
    case 'lighten': return blendLighten;
    case 'colorDodge': return blendColorDodge;
    case 'colorBurn': return blendColorBurn;
    case 'hardLight': return blendHardLight;
    case 'softLight': return blendSoftLight;
    case 'difference': return blendDifference;
    case 'exclusion': return blendExclusion;
    case 'hue':
    case 'saturation':
    case 'color':
    case 'luminosity':
      return (br, bg, bb, sr, sg, sb) => blendNonSeparableDispatch(br, bg, bb, sr, sg, sb, mode);
    case 'plusDarker': return blendPlusDarker;
    case 'plusLighter': return blendPlusLighter;
    default: return blendNormal;
  }
}

/**
 * Blend two pixels with alpha compositing (non-premultiplied input/output).
 *
 * @param backdrop  Non-premultiplied [r, g, b, a] in [0, 1].
 * @param source    Non-premultiplied [r, g, b, a] in [0, 1].
 * @param mode      Blend mode name.
 * @param opacity   Source opacity multiplier [0, 1].
 * @returns         Non-premultiplied [r, g, b, a] result in [0, 1].
 */
export function blend(
  backdrop: readonly [number, number, number, number],
  source: readonly [number, number, number, number],
  mode: string,
  opacity: number,
): [number, number, number, number] {
  const [br, bg, bb, ba] = backdrop;
  const [srIn, sgIn, sbIn, saIn] = source;

  const sa = Math.max(0, Math.min(1, saIn * opacity));
  if (sa === 0) return [br, bg, bb, ba];
  if (ba === 0) return [srIn, sgIn, sbIn, sa];

  const blendFn = getBlendFn(mode);
  const [mr, mg, mb] = blendFn(br, bg, bb, srIn, sgIn, sbIn);

  const ao = sa + ba * (1 - sa);
  if (ao === 0) return [0, 0, 0, 0];

  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  return [
    clamp((sa * mr + ba * (1 - sa) * br) / ao),
    clamp((sa * mg + ba * (1 - sa) * bg) / ao),
    clamp((sa * mb + ba * (1 - sa) * bb) / ao),
    clamp(ao),
  ];
}

/**
 * Blend pixels across an entire ImageData buffer.
 * Delegates to `blend()` per pixel.
 *
 * Operates on the same signature as the existing `blendPixels` in
 * compositeCanvas.ts, but uses the individual blend functions from
 * this module.
 */
export function blendPixels(
  backdrop: ImageData,
  source: ImageData,
  blendMode: string,
  opacity: number,
): ImageData {
  const w = Math.min(backdrop.width, source.width);
  const h = Math.min(backdrop.height, source.height);
  const result = new ImageData(w, h);
  const bd: Uint8ClampedArray = backdrop.data;
  const sd: Uint8ClampedArray = source.data;
  const rd: Uint8ClampedArray = result.data;

  for (let i = 0; i < w * h; i++) {
    const offset = i * 4;

    // Convert to non-premultiplied float [0,1]
    const br = bd[offset]! / 255;
    const bg = bd[offset + 1]! / 255;
    const bb = bd[offset + 2]! / 255;
    const ba = bd[offset + 3]! / 255;
    const sr = sd[offset]! / 255;
    const sg = sd[offset + 1]! / 255;
    const sb = sd[offset + 2]! / 255;
    const sa = sd[offset + 3]! / 255;

    const [mr, mg, mb, ma] = blend([br, bg, bb, ba], [sr, sg, sb, sa], blendMode, opacity);

    rd[offset] = Math.round(Math.max(0, Math.min(255, mr * 255)));
    rd[offset + 1] = Math.round(Math.max(0, Math.min(255, mg * 255)));
    rd[offset + 2] = Math.round(Math.max(0, Math.min(255, mb * 255)));
    rd[offset + 3] = Math.round(Math.max(0, Math.min(255, ma * 255)));
  }

  return result;
}
