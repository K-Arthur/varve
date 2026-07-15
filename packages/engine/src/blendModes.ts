/**
 * Individual software blend mode functions for pixel-level compositing.
 *
 * Research basis: W3C Compositing and Blending Level 1 §10 (Blending).
 * Canvas2D `globalCompositeOperation` uses these formulas for separable
 * blend modes; this module provides the same math in pure JS for use in
 * OffscreenCanvas contexts where GCO coverage is incomplete.
 *
 * Architecture: blend functions and `blend()` inputs use straight
 * (non-premultiplied) channels in [0, 1]. The `blend()` wrapper combines the
 * source-uncovered, overlap, and backdrop-uncovered premultiplied compositing
 * terms, then converts the result back to straight channels. `blendPixels()`
 * operates on entire ImageData buffers (for compatibility with compositeCanvas.ts).
 *
 * Separable blend modes are listed in §10.1 of the W3C spec:
 *   normal, multiply, screen, overlay, darken, lighten, color-dodge,
 *   color-burn, hard-light, soft-light, difference, exclusion.
 *
 * The non-separable modes (hue, saturation, color, luminosity) are in
 * §10.2 and live in nonSeparable.ts.
 *
 * Plus-lighter is a premultiplied composite operation. Plus-darker is legacy,
 * and pass-through is group policy rather than a pixel blend mode.
 */

import { blendNonSeparable, type NonSeparableMode } from './nonSeparable';

// ── Separable blend mode functions ───────────────────────────────────────────
// Each takes non-premultiplied [r,g,b] in [0, 1] and returns blended [r,g,b].

type BlendChannel = (backdrop: number, source: number) => number;

const blendNormalChannel: BlendChannel = (_backdrop, source) => source;
const blendMultiplyChannel: BlendChannel = (backdrop, source) => backdrop * source;
const blendScreenChannel: BlendChannel = (backdrop, source) => 1 - (1 - backdrop) * (1 - source);
const blendOverlayChannel: BlendChannel = (backdrop, source) =>
  backdrop < 0.5 ? 2 * backdrop * source : 1 - 2 * (1 - backdrop) * (1 - source);
const blendDarkenChannel: BlendChannel = (backdrop, source) => Math.min(backdrop, source);
const blendLightenChannel: BlendChannel = (backdrop, source) => Math.max(backdrop, source);
const blendColorDodgeChannel: BlendChannel = (backdrop, source) =>
  backdrop === 0 ? 0 : source >= 1 ? 1 : Math.min(1, backdrop / (1 - source));
const blendColorBurnChannel: BlendChannel = (backdrop, source) =>
  backdrop >= 1 ? 1 : source <= 0 ? 0 : 1 - Math.min(1, (1 - backdrop) / source);
const blendHardLightChannel: BlendChannel = (backdrop, source) =>
  source < 0.5 ? 2 * backdrop * source : 1 - 2 * (1 - backdrop) * (1 - source);
const blendSoftLightChannel: BlendChannel = (backdrop, source) => {
  if (source <= 0.5) return backdrop - (1 - 2 * source) * backdrop * (1 - backdrop);
  const dodge =
    backdrop <= 0.25 ? ((16 * backdrop - 12) * backdrop + 4) * backdrop : Math.sqrt(backdrop);
  return backdrop + (2 * source - 1) * (dodge - backdrop);
};
const blendDifferenceChannel: BlendChannel = (backdrop, source) => Math.abs(backdrop - source);
const blendExclusionChannel: BlendChannel = (backdrop, source) =>
  backdrop + source - 2 * backdrop * source;

/** Normal: source over backdrop (default). */
export function blendNormal(
  _br: number,
  _bg: number,
  _bb: number,
  sr: number,
  sg: number,
  sb: number,
): [number, number, number] {
  return [blendNormalChannel(_br, sr), blendNormalChannel(_bg, sg), blendNormalChannel(_bb, sb)];
}

/** Multiply: Cs × Cb. */
export function blendMultiply(
  br: number,
  bg: number,
  bb: number,
  sr: number,
  sg: number,
  sb: number,
): [number, number, number] {
  return [blendMultiplyChannel(br, sr), blendMultiplyChannel(bg, sg), blendMultiplyChannel(bb, sb)];
}

/** Screen: 1 - (1 - Cs) × (1 - Cb). */
export function blendScreen(
  br: number,
  bg: number,
  bb: number,
  sr: number,
  sg: number,
  sb: number,
): [number, number, number] {
  return [blendScreenChannel(br, sr), blendScreenChannel(bg, sg), blendScreenChannel(bb, sb)];
}

/** Overlay: multiply or screen depending on backdrop value. */
export function blendOverlay(
  br: number,
  bg: number,
  bb: number,
  sr: number,
  sg: number,
  sb: number,
): [number, number, number] {
  return [blendOverlayChannel(br, sr), blendOverlayChannel(bg, sg), blendOverlayChannel(bb, sb)];
}

/** Darken: min(Cs, Cb). */
export function blendDarken(
  br: number,
  bg: number,
  bb: number,
  sr: number,
  sg: number,
  sb: number,
): [number, number, number] {
  return [blendDarkenChannel(br, sr), blendDarkenChannel(bg, sg), blendDarkenChannel(bb, sb)];
}

/** Lighten: max(Cs, Cb). */
export function blendLighten(
  br: number,
  bg: number,
  bb: number,
  sr: number,
  sg: number,
  sb: number,
): [number, number, number] {
  return [blendLightenChannel(br, sr), blendLightenChannel(bg, sg), blendLightenChannel(bb, sb)];
}

/** Color-dodge: brighten backdrop to reflect source. */
export function blendColorDodge(
  br: number,
  bg: number,
  bb: number,
  sr: number,
  sg: number,
  sb: number,
): [number, number, number] {
  return [
    blendColorDodgeChannel(br, sr),
    blendColorDodgeChannel(bg, sg),
    blendColorDodgeChannel(bb, sb),
  ];
}

/** Color-burn: darken backdrop to reflect source. */
export function blendColorBurn(
  br: number,
  bg: number,
  bb: number,
  sr: number,
  sg: number,
  sb: number,
): [number, number, number] {
  return [
    blendColorBurnChannel(br, sr),
    blendColorBurnChannel(bg, sg),
    blendColorBurnChannel(bb, sb),
  ];
}

/** Hard-light: multiply or screen depending on source value. */
export function blendHardLight(
  br: number,
  bg: number,
  bb: number,
  sr: number,
  sg: number,
  sb: number,
): [number, number, number] {
  return [
    blendHardLightChannel(br, sr),
    blendHardLightChannel(bg, sg),
    blendHardLightChannel(bb, sb),
  ];
}

/** Soft-light: subtle contrast enhancement (W3C formula). */
export function blendSoftLight(
  br: number,
  bg: number,
  bb: number,
  sr: number,
  sg: number,
  sb: number,
): [number, number, number] {
  return [
    blendSoftLightChannel(br, sr),
    blendSoftLightChannel(bg, sg),
    blendSoftLightChannel(bb, sb),
  ];
}

/** Difference: |Cs - Cb|. */
export function blendDifference(
  br: number,
  bg: number,
  bb: number,
  sr: number,
  sg: number,
  sb: number,
): [number, number, number] {
  return [
    blendDifferenceChannel(br, sr),
    blendDifferenceChannel(bg, sg),
    blendDifferenceChannel(bb, sb),
  ];
}

/** Exclusion: Cs + Cb - 2 × Cs × Cb. */
export function blendExclusion(
  br: number,
  bg: number,
  bb: number,
  sr: number,
  sg: number,
  sb: number,
): [number, number, number] {
  return [
    blendExclusionChannel(br, sr),
    blendExclusionChannel(bg, sg),
    blendExclusionChannel(bb, sb),
  ];
}

// ── Non-separable dispatch ───────────────────────────────────────────────────

/**
 * Non-separable blend mode dispatch (hue, saturation, color, luminosity).
 * Delegates to nonSeparable.ts.
 */
export function blendNonSeparableDispatch(
  br: number,
  bg: number,
  bb: number,
  sr: number,
  sg: number,
  sb: number,
  mode: NonSeparableMode | string,
): [number, number, number] {
  return blendNonSeparable(br, bg, bb, sr, sg, sb, mode);
}

// ── Plus modes ───────────────────────────────────────────────────────────────

/**
 * Plus-darker scalar helper retained for compatibility.
 * The unified `blend()` API rejects this legacy non-pixel mode.
 */
export function blendPlusDarker(
  br: number,
  bg: number,
  bb: number,
  sr: number,
  sg: number,
  sb: number,
): [number, number, number] {
  return [Math.max(0, br + sr - 1), Math.max(0, bg + sg - 1), Math.max(0, bb + sb - 1)];
}

/**
 * Plus-lighter scalar helper retained for compatibility.
 * The unified `blend()` API models plus-lighter as a premultiplied composite,
 * not as a source-over blend function.
 */
export function blendPlusLighter(
  br: number,
  bg: number,
  bb: number,
  sr: number,
  sg: number,
  sb: number,
): [number, number, number] {
  return [Math.min(1, br + sr), Math.min(1, bg + sg), Math.min(1, bb + sb)];
}

// ─── Unified blend with alpha compositing ────────────────────────────────────

type ResolvedBlendMode = BlendChannel | NonSeparableMode | 'plusLighter';

/** Resolve once before entering an ImageData hot loop. */
function resolveBlendMode(mode: string): ResolvedBlendMode {
  switch (mode) {
    case 'normal':
      return blendNormalChannel;
    case 'multiply':
      return blendMultiplyChannel;
    case 'screen':
      return blendScreenChannel;
    case 'overlay':
      return blendOverlayChannel;
    case 'darken':
      return blendDarkenChannel;
    case 'lighten':
      return blendLightenChannel;
    case 'colorDodge':
      return blendColorDodgeChannel;
    case 'colorBurn':
      return blendColorBurnChannel;
    case 'hardLight':
      return blendHardLightChannel;
    case 'softLight':
      return blendSoftLightChannel;
    case 'difference':
      return blendDifferenceChannel;
    case 'exclusion':
      return blendExclusionChannel;
    case 'hue':
    case 'saturation':
    case 'color':
    case 'luminosity':
    case 'plusLighter':
      return mode;
    default:
      throw new Error(`Unsupported blend mode: ${mode}`);
  }
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

function compositePlusLighterChannel(
  source: number,
  backdrop: number,
  sourceAlpha: number,
  backdropAlpha: number,
  outputAlpha: number,
): number {
  return clamp(Math.min(1, sourceAlpha * source + backdropAlpha * backdrop) / outputAlpha);
}

function compositeBlendChannel(
  source: number,
  blended: number,
  backdrop: number,
  sourceUncovered: number,
  overlap: number,
  backdropUncovered: number,
  outputAlpha: number,
): number {
  return clamp(
    (sourceUncovered * source + overlap * blended + backdropUncovered * backdrop) / outputAlpha,
  );
}

const toByte = (channel: number): number => Math.round(Math.max(0, Math.min(255, channel * 255)));

/**
 * Blend two pixels with alpha compositing (non-premultiplied input/output).
 *
 * @param backdrop  Non-premultiplied [r, g, b, a] in [0, 1].
 * @param source    Non-premultiplied [r, g, b, a] in [0, 1].
 * @param mode      Blend mode name.
 * @param opacity   Source opacity multiplier [0, 1].
 * @returns         Non-premultiplied [r, g, b, a] result in [0, 1].
 *
 * @remarks Inputs and opacity must be finite normalized values in [0, 1].
 * Invalid numeric inputs are unsupported and are not broadly validated in
 * this hot per-pixel path.
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
  const resolvedMode = resolveBlendMode(mode);

  if (resolvedMode === 'plusLighter') {
    const ao = Math.min(1, sa + ba);
    if (ao === 0) return [0, 0, 0, 0];

    return [
      compositePlusLighterChannel(srIn, br, sa, ba, ao),
      compositePlusLighterChannel(sgIn, bg, sa, ba, ao),
      compositePlusLighterChannel(sbIn, bb, sa, ba, ao),
      ao,
    ];
  }

  if (sa === 0 && ba === 0) return [0, 0, 0, 0];
  if (sa === 0) return [br, bg, bb, ba];
  if (ba === 0) return [srIn, sgIn, sbIn, sa];

  let mr: number;
  let mg: number;
  let mb: number;
  if (typeof resolvedMode === 'function') {
    mr = resolvedMode(br, srIn);
    mg = resolvedMode(bg, sgIn);
    mb = resolvedMode(bb, sbIn);
  } else {
    [mr, mg, mb] = blendNonSeparableDispatch(br, bg, bb, srIn, sgIn, sbIn, resolvedMode);
  }
  const sourceUncovered = sa * (1 - ba);
  const overlap = sa * ba;
  const backdropUncovered = (1 - sa) * ba;
  const ao = sa + ba * (1 - sa);
  if (ao === 0) return [0, 0, 0, 0];

  return [
    compositeBlendChannel(srIn, mr, br, sourceUncovered, overlap, backdropUncovered, ao),
    compositeBlendChannel(sgIn, mg, bg, sourceUncovered, overlap, backdropUncovered, ao),
    compositeBlendChannel(sbIn, mb, bb, sourceUncovered, overlap, backdropUncovered, ao),
    clamp(ao),
  ];
}

/**
 * Blend pixels across an entire ImageData buffer.
 *
 * Resolves the mode once per buffer. Separable modes use the same scalar
 * channel formulas as the public tuple helpers without allocating temporary
 * input, blended, or output tuples per pixel. Component modes retain their
 * canonical non-separable tuple result.
 */
export function blendPixels(
  backdrop: ImageData,
  source: ImageData,
  blendMode: string,
  opacity: number,
): ImageData {
  const resolvedMode = resolveBlendMode(blendMode);
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
    const sa = clamp((sd[offset + 3]! / 255) * opacity);

    let mr = 0;
    let mg = 0;
    let mb = 0;
    let ma = 0;

    if (resolvedMode === 'plusLighter') {
      ma = Math.min(1, sa + ba);
      if (ma !== 0) {
        mr = compositePlusLighterChannel(sr, br, sa, ba, ma);
        mg = compositePlusLighterChannel(sg, bg, sa, ba, ma);
        mb = compositePlusLighterChannel(sb, bb, sa, ba, ma);
      }
    } else if (sa === 0 && ba === 0) {
      // Keep canonical transparent black.
    } else if (sa === 0) {
      mr = br;
      mg = bg;
      mb = bb;
      ma = ba;
    } else if (ba === 0) {
      mr = sr;
      mg = sg;
      mb = sb;
      ma = sa;
    } else {
      let blendedR: number;
      let blendedG: number;
      let blendedB: number;
      if (typeof resolvedMode === 'function') {
        blendedR = resolvedMode(br, sr);
        blendedG = resolvedMode(bg, sg);
        blendedB = resolvedMode(bb, sb);
      } else {
        [blendedR, blendedG, blendedB] = blendNonSeparableDispatch(
          br,
          bg,
          bb,
          sr,
          sg,
          sb,
          resolvedMode,
        );
      }

      const sourceUncovered = sa * (1 - ba);
      const overlap = sa * ba;
      const backdropUncovered = (1 - sa) * ba;
      ma = sa + ba * (1 - sa);
      mr = compositeBlendChannel(sr, blendedR, br, sourceUncovered, overlap, backdropUncovered, ma);
      mg = compositeBlendChannel(sg, blendedG, bg, sourceUncovered, overlap, backdropUncovered, ma);
      mb = compositeBlendChannel(sb, blendedB, bb, sourceUncovered, overlap, backdropUncovered, ma);
    }

    rd[offset] = toByte(mr);
    rd[offset + 1] = toByte(mg);
    rd[offset + 2] = toByte(mb);
    rd[offset + 3] = toByte(ma);
  }

  return result;
}
