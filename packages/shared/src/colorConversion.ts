/**
 * Analytical (non-ICC) color conversion functions.
 *
 * ICC profile-based conversions live in the Rust strata-print crate. This
 * module provides the TypeScript-side fallback for standard color space
 * conversions that don't require external profile data.
 *
 * Research basis: sRGB IEC 61966-2-1, CIE 15:2018 (Colorimetry),
 * Björn Ottosson "A perceptually uniform color space for image processing"
 * (2020), ISO 12647 (print), Bruce Lindbloom matrices, ICC.1:2010.
 */

import { cssStringToManagedColor } from './cssColorParser';
import type { RgbPrimariesName, TransferFunctionName } from './rasterColorEncoding';

// ── Bit depth ────────────────────────────────────────────────────────────────

/**
 * Color channel bit depth. Determines storage precision and value range.
 *
 * | bitDepth | range    | notes |
 * |----------|----------|-------|
 * | uint8    | 0–255    | integer. Backward compatible — existing documents use this. |
 * | uint16   | 0–65535  | integer. |
 * | float16  | 0.0–1.0  | half-float precision intent; stored as JS number. |
 * | float32  | 0.0–1.0  | single-precision; HDR can exceed 1.0. |
 *
 * The same range applies to all channels (R G B A C M Y K V) for a given
 * bit depth. This is the canonical definition; @varve/scene re-exports it.
 */
export type BitDepth = 'uint8' | 'uint16' | 'float16' | 'float32';

/** Default bit depth for colors that don't specify one (backward compat). */
export const DEFAULT_BIT_DEPTH: BitDepth = 'uint8';

/** Maximum channel value for a bit depth (uint8 → 255, uint16 → 65535, floats → 1). */
export function channelMax(bitDepth: BitDepth): number {
  switch (bitDepth) {
    case 'uint8':
      return 255;
    case 'uint16':
      return 65535;
    case 'float16':
    case 'float32':
      return 1;
  }
}

/**
 * Normalize a channel value to 0.0–1.0 float regardless of bit depth.
 *
 * - uint8/uint16: divides by max (255 / 65535).
 * - float16/float32: clamps to [0, 1] (HDR values > 1 are clamped;
 *   use `normalizeChannelLinear` for extended range).
 */
export function normalizeChannel(value: number, bitDepth: BitDepth): number {
  if (bitDepth === 'uint8') return value / 255;
  if (bitDepth === 'uint16') return value / 65535;
  return Math.max(0, Math.min(1, value));
}

/**
 * Denormalize a 0.0–1.0 float to storage range for the given bit depth.
 *
 * - uint8/uint16: multiplies by max and rounds to integer.
 * - float16/float32: returns as-is (full float precision retained).
 */
export function denormalizeChannel(value: number, bitDepth: BitDepth): number {
  if (bitDepth === 'uint8') return Math.round(value * 255);
  if (bitDepth === 'uint16') return Math.round(value * 65535);
  return value;
}

/**
 * Clamp a value to the valid channel range for a bit depth.
 * Integer depths clamp to [0, max]; float depths allow extended range
 * but clamp NaN/Infinity to 0.
 */
export function clampChannel(value: number, bitDepth: BitDepth): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  if (bitDepth === 'uint8') return Math.max(0, Math.min(255, Math.round(value)));
  if (bitDepth === 'uint16') return Math.max(0, Math.min(65535, Math.round(value)));
  // float depths: allow extended range (HDR), but reject NaN/Inf
  return value;
}

// ── Type shims for ManagedColor helpers ─────────────────────────────────────
// These mirror @varve/scene types to avoid circular deps. The actual type
// definitions are in packages/scene/src/colorManagement.ts.

/** RGB color value (channel range depends on bitDepth). */
interface RgbColorShim {
  space: 'rgb';
  bitDepth?: BitDepth;
  r: number;
  g: number;
  b: number;
  a: number;
  profile?: string;
}

/** CMYK color value (channel range depends on bitDepth). */
interface CmykColorShim {
  space: 'cmyk';
  bitDepth?: BitDepth;
  c: number;
  m: number;
  y: number;
  k: number;
  a: number;
  profile?: string;
}

/** Grayscale color value (channel range depends on bitDepth). */
interface GrayColorShim {
  space: 'gray';
  bitDepth?: BitDepth;
  v: number;
  a: number;
  profile?: string;
}

/** Spot color reference. */
interface SpotColorRefShim {
  space: 'spot';
  spotId?: string;
  library?: string;
  name: string;
  tint: number;
  a: number;
  processFallback?: { c: number; m: number; y: number; k: number };
}

/** CIELAB color (D50 reference white by default; float channels). */
interface LabColorShim {
  space: 'lab';
  l: number;
  av: number;
  b: number;
  a: number;
  bitDepth?: BitDepth;
  profile?: string;
  profileFingerprint?: string;
}

/** CIELCH color (polar CIELAB; hue in degrees). */
interface LchColorShim {
  space: 'lch';
  l: number;
  c: number;
  h: number;
  a: number;
  bitDepth?: BitDepth;
  profile?: string;
  profileFingerprint?: string;
}

/** Registration color — prints on every plate. */
interface RegistrationColorShim {
  space: 'registration';
  a: number;
}

/** Unresolved imported color — source retained, display-only fallback. */
interface UnresolvedColorShim {
  space: 'unresolved';
  a: number;
  source: string;
  reason?: string;
  fallback?: { r: number; g: number; b: number };
}

export type ManagedColorShim =
  | RgbColorShim
  | CmykColorShim
  | GrayColorShim
  | SpotColorRefShim
  | LabColorShim
  | LchColorShim
  | RegistrationColorShim
  | UnresolvedColorShim;

/**
 * Normalized encoded sRGB working value. Unlike `managedColorToRgba`, this
 * tuple is not reduced to 8-bit channels and is therefore safe for blending,
 * interpolation, proof transforms, and other derived calculations.
 */
export type NormalizedRgba = [number, number, number, number];

/** Engine RGBA tuple (0-255 per channel). */
type ColorShim = readonly [number, number, number, number];

// ── sRGB gamma ──────────────────────────────────────────────────────────────

/**
 * sRGB gamma expansion: 8-bit value (0-255) → linear (0-1).
 */
export function srgbToLinear(c: number): number {
  const v = c / 255;
  if (v <= 0.04045) return v / 12.92;
  return ((v + 0.055) / 1.055) ** 2.4;
}

/**
 * sRGB gamma compression: linear (0-1) → 8-bit (0-255).
 */
export function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(v * 255);
}

/** Convert [r,g,b] in 0-255 sRGB to 0-1 linear sRGB. */
export function rgbToLinearRgb(rgb: [number, number, number]): [number, number, number] {
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
}

/** Convert [r,g,b] in 0-1 linear sRGB to 0-255 sRGB. */
export function linearRgbToRgb(linear: [number, number, number]): [number, number, number] {
  return [linearToSrgb(linear[0]), linearToSrgb(linear[1]), linearToSrgb(linear[2])];
}

// ── Linear sRGB <-> CIE XYZ (D65) ────────────────────────────────────────────

/*
 * sRGB linear → XYZ D65 transform matrix (from IEC 61966-2-1).
 *  0.4124564  0.3575761  0.1804375
 *  0.2126729  0.7151522  0.0721750
 *  0.0193339  0.1191920  0.9503041
 *
 * Inverse matrix (XYZ D65 → linear sRGB):
 *  3.2409699419045226  -1.5373831775700939  -0.4986107602930034
 * -0.9692436362808796   1.8759675015077202   0.0415550574071756
 *  0.05563007969699366 -0.20397696064067220  1.0569715142428786
 */

const SRGB_TO_XYZ: readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] = [
  0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.072175, 0.0193339, 0.119192, 0.9503041,
];

const XYZ_TO_SRGB: readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] = [
  3.2409699419045226, -1.5373831775700939, -0.4986107602930034, -0.9692436362808796,
  1.8759675015077202, 0.0415550574071756, 0.05563007969699366, -0.2039769606406722,
  1.0569715142428786,
];

function mul3x3(
  m: readonly [number, number, number, number, number, number, number, number, number],
  v: readonly [number, number, number],
): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/**
 * Linear sRGB [r,g,b] (0-1) → CIE XYZ (D65).
 */
export function linearRgbToXyzD65(rgb: [number, number, number]): [number, number, number] {
  return mul3x3(SRGB_TO_XYZ, rgb);
}

/**
 * CIE XYZ (D65) → linear sRGB [r,g,b] (0-1).
 */
export function xyzD65ToLinearRgb(xyz: [number, number, number]): [number, number, number] {
  return mul3x3(XYZ_TO_SRGB, xyz);
}

// ── Bradford chromatic adaptation (D65 <-> D50) ───────────────────────────────

/*
 * D65 → D50 Bradford adaptation matrix.
 *  1.0479298208405488   0.0229467933410191  -0.0501922295431357
 *  0.0296278156881593   0.990434484573249   -0.0170738250293851
 * -0.00924305815259118  0.0150551448965779   0.7518742899580008
 *
 * D50 → D65 Bradford adaptation matrix (inverse).
 *  0.9554734529412182  -0.0230985368742614   0.0632593086610217
 * -0.0283697099638638   1.0099954580106629   0.0210413989669430
 *  0.0123140016883199  -0.0205076964334779   1.3303659366080753
 */

const BRADFORD_D65_TO_D50: readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] = [
  1.0479298208405488, 0.0229467933410191, -0.0501922295431357, 0.0296278156881593,
  0.990434484573249, -0.0170738250293851, -0.00924305815259118, 0.0150551448965779,
  0.7518742899580008,
];

const BRADFORD_D50_TO_D65: readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] = [
  0.9554734529412182, -0.0230985368742614, 0.0632593086610217, -0.0283697099638638,
  1.0099954580106629, 0.021041398966943, 0.0123140016883199, -0.0205076964334779,
  1.3303659366080753,
];

// ── D65 and D50 white points (CIE 1931 2° standard observer) ────────────────

const D50_WHITE: [number, number, number] = [0.96422, 1.0, 0.82521];

// ── CIE Lab ─────────────────────────────────────────────────────────────────

function labF(t: number): number {
  const δ = 6 / 29;
  if (t > δ * δ * δ) return Math.cbrt(t);
  return t / (3 * δ * δ) + 4 / 29;
}

function labFInv(t: number): number {
  const δ = 6 / 29;
  if (t > δ) return t * t * t;
  return 3 * δ * δ * (t - 4 / 29);
}

/**
 * CIE XYZ (D65) → CIELAB (D50 adapted via Bradford).
 *
 * Converts from XYZ D65 to D50 using Bradford adaptation, then applies
 * the standard CIE Lab formula with the D50 white point.
 */
export function xyzToLab(xyz: [number, number, number]): [number, number, number] {
  // Adapt D65 → D50
  const d50 = mul3x3(BRADFORD_D65_TO_D50, xyz);
  const [xn, yn, zn] = D50_WHITE;

  const fx = labF(d50[0] / xn);
  const fy = labF(d50[1] / yn);
  const fz = labF(d50[2] / zn);

  const l = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);

  return [l, a, b];
}

/**
 * CIELAB → CIE XYZ (D65) via D50 Bradford adaptation.
 *
 * Applies the inverse Lab formula with D50 white point, then adapts
 * D50 → D65 via Bradford.
 */
export function labToXyz(lab: [number, number, number]): [number, number, number] {
  const [l, a, b] = lab;
  const [xn, yn, zn] = D50_WHITE;

  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const x = xn * labFInv(fx);
  const y = yn * labFInv(fy);
  const z = zn * labFInv(fz);

  // Adapt D50 → D65
  return mul3x3(BRADFORD_D50_TO_D65, [x, y, z]);
}

// ── Wide-gamut RGB working spaces ───────────────────────────────────────────
//
// Primaries matrices map linear RGB (in the space's own white point) to
// CIE XYZ, and back. sRGB/P3/Adobe RGB/Rec.2020 are D65 spaces; ProPhoto is
// D50. All matrices below are the canonical published values (IEC 61966-2-1,
// CSS Color 4 / W3C, and the ProPhoto RGB specification).

/** Display P3 (D65) → XYZ D65 (CSS Color 4). */
const P3_TO_XYZ: readonly [number, number, number, number, number, number, number, number, number] =
  [
    0.4865709486482162, 0.26566769316909306, 0.1982172852343625, 0.2289745640697488,
    0.6917385218365064, 0.079286914093745, 0.0, 0.04511338185890264, 1.043944368900976,
  ];

/** XYZ D65 → Display P3 (CSS Color 4). */
const XYZ_TO_P3: readonly [number, number, number, number, number, number, number, number, number] =
  [
    2.493496911941425, -0.9313836179191239, -0.40271078445071684, -0.8294889695615747,
    1.7626640603183463, 0.023624685841943577, 0.03584583024378447, -0.07617238926804182,
    0.9568845240076872,
  ];

/** Adobe RGB (1998) (D65) → XYZ D65 (Lindbloom). */
const ADOBE_TO_XYZ: readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] = [
  0.5767309, 0.185554, 0.1881852, 0.2973769, 0.6273491, 0.0752741, 0.0270343, 0.0706872, 0.9911085,
];

/** XYZ D65 → Adobe RGB (1998) (Lindbloom). */
const XYZ_TO_ADOBE: readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] = [
  2.041369, -0.5649464, -0.3446944, -0.969266, 1.8760108, 0.041556, 0.0134474, -0.1183897,
  1.0154096,
];

/** Rec.2020 (D65) → XYZ D65 (CSS Color 4). */
const REC2020_TO_XYZ: readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] = [
  0.6369580483012914, 0.14461690358620832, 0.1688809751641721, 0.2627002120112671,
  0.6779980715188708, 0.05930171646986196, 0.0, 0.028072693049087428, 1.060985057710791,
];

/** XYZ D65 → Rec.2020 (CSS Color 4). */
const XYZ_TO_REC2020: readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] = [
  1.7166511879712674, -0.35567078377639233, -0.25336628137365974, -0.6666843518324892,
  1.6164812366349395, 0.01576854581391113, 0.017639857445310783, -0.042770613257808524,
  0.9421031212354738,
];

/** ProPhoto RGB (D50) → XYZ D50 (Lindbloom). */
const PROPHOTO_TO_XYZ: readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] = [0.7976749, 0.1351917, 0.0313534, 0.2880402, 0.7118741, 0.0000857, 0.0, 0.0, 0.82521];

/** XYZ D50 → ProPhoto RGB (Lindbloom). */
const XYZ_TO_PROPHOTO: readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] = [1.3459433, -0.2556075, -0.0511118, -0.5445989, 1.5081673, 0.0205351, 0.0, 0.0, 1.2118128];

/** Display label for a primaries family. */
export function rgbPrimariesLabel(primaries: RgbPrimariesName): string {
  switch (primaries) {
    case 'srgb':
      return 'sRGB';
    case 'display-p3':
      return 'Display P3';
    case 'adobe-rgb':
      return 'Adobe RGB (1998)';
    case 'pro-photo':
      return 'ProPhoto RGB';
    case 'rec2020':
      return 'Rec.2020';
    case 'unknown':
      return 'Unknown RGB';
  }
}

/** Display label for a transfer function. */
export function transferLabel(transfer: TransferFunctionName): string {
  switch (transfer) {
    case 'srgb':
      return 'sRGB';
    case 'gamma22':
      return 'gamma 2.2';
    case 'gamma18':
      return 'gamma 1.8';
    case 'prophoto':
      return 'ProPhoto (1.8)';
    case 'rec2020':
      return 'Rec.2020 OETF';
    case 'linear':
      return 'linear';
    case 'pq':
      return 'PQ (SMPTE 2084)';
    case 'hlg':
      return 'HLG (ARIB B-67)';
    case 'unknown':
      return 'unknown';
  }
}

// ── Transfer functions (linear <-> encoded, unit range) ────────────────────

/** sRGB OETF (encoded → linear), unit range. */
export function srgbToLinearUnit(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** sRGB EOTF (linear → encoded), unit range. */
export function linearToSrgbUnit(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** ProPhoto RGB toe threshold on the linear side (1/512). */
export const PROPHOTO_LINEAR_TOE = 1 / 512;

/** ProPhoto RGB OETF (encoded → linear), unit range, with the linear toe. */
export function prophotoToLinearUnit(v: number): number {
  return v >= 1 / 32 ? v ** 1.8 : v / 16;
}

/** ProPhoto RGB EOTF (linear → encoded), unit range, with the linear toe. */
export function linearToProphotoUnit(v: number): number {
  return v >= PROPHOTO_LINEAR_TOE ? v ** (1 / 1.8) : 16 * v;
}

/** Rec.2020 / BT.2100 OETF constants. */
export const REC2020_ALPHA = 1.09929682680944;
export const REC2020_BETA = 0.018053968510807;

/** Rec.2020 OETF (encoded → linear), unit range. */
export function rec2020ToLinearUnit(v: number): number {
  const β = REC2020_BETA;
  return v <= 4.5 * β ? v / 4.5 : ((v + REC2020_ALPHA - 1) / REC2020_ALPHA) ** (1 / 0.45);
}

/** Rec.2020 EOTF (linear → encoded), unit range. */
export function linearToRec2020Unit(v: number): number {
  const β = REC2020_BETA;
  return v <= β ? v * 4.5 : REC2020_ALPHA * v ** 0.45 - (REC2020_ALPHA - 1);
}

/**
 * Transfer decode (encoded → linear). Returns null for transfers that are
 * undefined ('unknown') or unsupported by the analytical engine ('pq',
 * 'hlg') — callers must treat null as an explicit unsupported outcome, not
 * fall through to gamma 2.2.
 */
export function transferDecode(transfer: TransferFunctionName, v: number): number | null {
  switch (transfer) {
    case 'srgb':
      return srgbToLinearUnit(v);
    case 'gamma22':
      return v ** 2.2;
    case 'gamma18':
      return v ** 1.8;
    case 'prophoto':
      return prophotoToLinearUnit(v);
    case 'rec2020':
      return rec2020ToLinearUnit(v);
    case 'linear':
      return v;
    case 'pq':
    case 'hlg':
    case 'unknown':
      return null;
  }
}

/**
 * Transfer encode (linear → encoded). Returns null when the transfer is
 * undefined or unsupported (see `transferDecode`).
 */
export function transferEncode(transfer: TransferFunctionName, v: number): number | null {
  switch (transfer) {
    case 'srgb':
      return linearToSrgbUnit(v);
    case 'gamma22':
      return v ** (1 / 2.2);
    case 'gamma18':
      return v ** (1 / 1.8);
    case 'prophoto':
      return linearToProphotoUnit(v);
    case 'rec2020':
      return linearToRec2020Unit(v);
    case 'linear':
      return v;
    case 'pq':
    case 'hlg':
    case 'unknown':
      return null;
  }
}

/** Linear RGB (space's own white point) → XYZ in the same white point. */
function linearRgbToXyzOwn(
  primaries: RgbPrimariesName,
  rgb: readonly [number, number, number],
): [number, number, number] | null {
  switch (primaries) {
    case 'srgb':
      return mul3x3(SRGB_TO_XYZ, rgb);
    case 'display-p3':
      return mul3x3(P3_TO_XYZ, rgb);
    case 'adobe-rgb':
      return mul3x3(ADOBE_TO_XYZ, rgb);
    case 'rec2020':
      return mul3x3(REC2020_TO_XYZ, rgb);
    case 'pro-photo':
      return mul3x3(PROPHOTO_TO_XYZ, rgb);
    case 'unknown':
      return null;
  }
}

/** XYZ (space's own white point) → linear RGB. */
function xyzOwnToLinearRgb(
  primaries: RgbPrimariesName,
  xyz: readonly [number, number, number],
): [number, number, number] | null {
  switch (primaries) {
    case 'srgb':
      return mul3x3(XYZ_TO_SRGB, xyz);
    case 'display-p3':
      return mul3x3(XYZ_TO_P3, xyz);
    case 'adobe-rgb':
      return mul3x3(XYZ_TO_ADOBE, xyz);
    case 'rec2020':
      return mul3x3(XYZ_TO_REC2020, xyz);
    case 'pro-photo':
      return mul3x3(XYZ_TO_PROPHOTO, xyz);
    case 'unknown':
      return null;
  }
}

/**
 * Linear RGB in `primaries` → CIE XYZ D50 (the ICC PCS). D65-based spaces
 * are Bradford-adapted to D50; ProPhoto already uses D50.
 */
export function linearRgbPrimariesToXyzD50(
  primaries: RgbPrimariesName,
  rgb: readonly [number, number, number],
): [number, number, number] | null {
  const xyz = linearRgbToXyzOwn(primaries, rgb);
  if (!xyz) return null;
  if (primaries === 'pro-photo') return xyz;
  return mul3x3(BRADFORD_D65_TO_D50, xyz);
}

/**
 * CIE XYZ D50 → linear RGB in `primaries`.
 */
export function xyzD50ToLinearRgbPrimaries(
  primaries: RgbPrimariesName,
  xyz: readonly [number, number, number],
): [number, number, number] | null {
  const adapted = primaries === 'pro-photo' ? xyz : mul3x3(BRADFORD_D50_TO_D65, xyz);
  return xyzOwnToLinearRgb(primaries, adapted);
}

/** An RGB working space identified by primaries + transfer. */
export interface RgbWorkingSpaceRef {
  primaries: RgbPrimariesName;
  transfer: TransferFunctionName;
}

/** True when both members are analytically convertible. */
export function isAnalyticRgbWorkingSpace(space: RgbWorkingSpaceRef): boolean {
  return (
    space.primaries !== 'unknown' &&
    (space.transfer === 'srgb' ||
      space.transfer === 'gamma22' ||
      space.transfer === 'gamma18' ||
      space.transfer === 'prophoto' ||
      space.transfer === 'rec2020' ||
      space.transfer === 'linear')
  );
}

/**
 * Convert an encoded RGB triple between working spaces: transfer-decode →
 * primaries → XYZ D50 → target primaries → transfer-encode. Values outside
 * [0,1] are preserved (never clamped): authoritative wide-gamut pixels must
 * survive conversion; clipping is a display/output boundary decision.
 *
 * Returns null when either space is unsupported (unknown primaries, or
 * PQ/HLG transfer). Alpha is untouched — color transforms operate on color
 * channels only.
 */
export function convertEncodedRgb(
  source: RgbWorkingSpaceRef,
  target: RgbWorkingSpaceRef,
  rgb: readonly [number, number, number],
): [number, number, number] | null {
  if (!isAnalyticRgbWorkingSpace(source) || !isAnalyticRgbWorkingSpace(target)) return null;
  const r = transferDecode(source.transfer, rgb[0]);
  const g = transferDecode(source.transfer, rgb[1]);
  const b = transferDecode(source.transfer, rgb[2]);
  if (r === null || g === null || b === null) return null;
  const xyz = linearRgbPrimariesToXyzD50(source.primaries, [r, g, b]);
  if (!xyz) return null;
  const linear = xyzD50ToLinearRgbPrimaries(target.primaries, xyz);
  if (!linear) return null;
  const tr = transferEncode(target.transfer, linear[0]);
  const tg = transferEncode(target.transfer, linear[1]);
  const tb = transferEncode(target.transfer, linear[2]);
  if (tr === null || tg === null || tb === null) return null;
  return [tr, tg, tb];
}

// ── Oklab (Ottosson 2020) ───────────────────────────────────────────────────

/*
 * Björn Ottosson's Oklab — a perceptually uniform color space.
 *
 * Linear sRGB → LMS (M1):
 *  0.4122214708  0.5363325363  0.0514459929
 *  0.2119034982  0.6806995451  0.1073969566
 *  0.0883024619  0.2817188376  0.6299787005
 *
 * LMS (cube root) → Oklab (M2):
 *  0.2104542553   0.7936177850  -0.0040720468
 *  1.9779984951  -2.4285922050   0.4505937099
 *  0.0259040371   0.7827717662  -0.8086757660
 *
 * Oklab → LMS (cube root) (M2⁻¹):
 *  1.0000000000   0.3963377774   0.2158037573
 *  1.0000000000  -0.1055613458  -0.0638541728
 *  1.0000000000  -0.0894841775  -1.2914855480
 *
 * LMS → linear sRGB (M1⁻¹):
 *  4.0767416621  -3.3077115913   0.2309699292
 * -1.2684380046   2.6097574011  -0.3413193965
 * -0.0041960863  -0.7034186147   1.7076147010
 */

const M1: readonly [number, number, number, number, number, number, number, number, number] = [
  0.4122214708, 0.5363325363, 0.0514459929, 0.2119034982, 0.6806995451, 0.1073969566, 0.0883024619,
  0.2817188376, 0.6299787005,
];

const M2: readonly [number, number, number, number, number, number, number, number, number] = [
  0.2104542553, 0.793617785, -0.0040720468, 1.9779984951, -2.428592205, 0.4505937099, 0.0259040371,
  0.7827717662, -0.808675766,
];

const M2_INV: readonly [number, number, number, number, number, number, number, number, number] = [
  1.0, 0.3963377774, 0.2158037573, 1.0, -0.1055613458, -0.0638541728, 1.0, -0.0894841775,
  -1.291485548,
];

const M1_INV: readonly [number, number, number, number, number, number, number, number, number] = [
  4.0767416621, -3.3077115913, 0.2309699292, -1.2684380046, 2.6097574011, -0.3413193965,
  -0.0041960863, -0.7034186147, 1.707614701,
];

/**
 * Linear sRGB [r,g,b] (0-1) → Oklab [L, a, b].
 */
export function linearSrgbToOklab(rgb: [number, number, number]): [number, number, number] {
  const lms = mul3x3(M1, rgb);
  const lmsCubeRoot: [number, number, number] = [
    Math.cbrt(lms[0]),
    Math.cbrt(lms[1]),
    Math.cbrt(lms[2]),
  ];
  return mul3x3(M2, lmsCubeRoot);
}

/**
 * Oklab [L, a, b] → linear sRGB [r,g,b] (0-1).
 */
export function oklabToLinearSrgb(lab: [number, number, number]): [number, number, number] {
  const lmsCubeRoot = mul3x3(M2_INV, lab);
  const lms: [number, number, number] = [
    lmsCubeRoot[0] * lmsCubeRoot[0] * lmsCubeRoot[0],
    lmsCubeRoot[1] * lmsCubeRoot[1] * lmsCubeRoot[1],
    lmsCubeRoot[2] * lmsCubeRoot[2] * lmsCubeRoot[2],
  ];
  return mul3x3(M1_INV, lms);
}

// ── RGB <-> CMYK (analytical, no ICC) ────────────────────────────────────────

/**
 * RGB (0-255) → CMYK (0-255 per channel).
 *
 * Standard inverse-complement analytical conversion:
 * C' = 1 - R, M' = 1 - G, Y' = 1 - B, K = min(C', M', Y'),
 * then C = (C' - K) / (1 - K), etc.
 */
export function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const rc = 1 - r / 255;
  const gc = 1 - g / 255;
  const bc = 1 - b / 255;
  const k = Math.min(rc, gc, bc);
  if (Math.abs(k - 1) < 1e-10) return [0, 0, 0, 255];
  const denom = 1 - k;
  return [
    Math.round(255 * ((rc - k) / denom)),
    Math.round(255 * ((gc - k) / denom)),
    Math.round(255 * ((bc - k) / denom)),
    Math.round(255 * k),
  ];
}

/**
 * CMYK (0-255 per channel) → RGB (0-255).
 */
export function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  const rc = c / 255;
  const rm = m / 255;
  const ry = y / 255;
  const rk = k / 255;
  return [
    Math.round(255 * (1 - rc) * (1 - rk)),
    Math.round(255 * (1 - rm) * (1 - rk)),
    Math.round(255 * (1 - ry) * (1 - rk)),
  ];
}

// ── ΔEOK (Oklab color difference) ───────────────────────────────────────────

/**
 * Compute the Oklab color difference (ΔEOK) between two RGBA colors.
 *
 * Both inputs are [r, g, b, a] in 0-255 sRGB. The alpha channel is
 * currently ignored for the ΔE calculation (perceptual difference
 * assumes full opacity).
 */
export function deltaEOk(
  c1: [number, number, number, number],
  c2: [number, number, number, number],
): number {
  const rgb1: [number, number, number] = [c1[0], c1[1], c1[2]];
  const rgb2: [number, number, number] = [c2[0], c2[1], c2[2]];

  const lab1 = linearSrgbToOklab(rgbToLinearRgb(rgb1));
  const lab2 = linearSrgbToOklab(rgbToLinearRgb(rgb2));

  const dL = lab1[0] - lab2[0];
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];

  return Math.sqrt(dL * dL + da * da + db * db);
}

// ── ManagedColor helpers ────────────────────────────────────────────────────

/**
 * Convert any ManagedColor to an RGBA tuple [r, g, b, a] (0-255).
 *
 * Channels are first normalized to 0.0–1.0 based on the color's bitDepth
 * (or uint8 when absent), then denormalized to 0-255 uint8 output. This
 * preserves precision for float/16-bit documents.
 *
 * - RgbColor: normalize from bitDepth → denormalize to uint8
 * - CmykColor: normalize CMYK → analytical CMYK→RGB → uint8
 * - GrayColor: R=G=B=normalized(v)
 * - SpotColorRef: uses processFallback if available; applies tint as opacity;
 *   falls back to black if no fallback
 */
export function managedColorToRgba(color: ManagedColorShim): [number, number, number, number] {
  switch (color.space) {
    case 'rgb': {
      const bd = color.bitDepth ?? 'uint8';
      return [
        denormalizeChannel(normalizeChannel(color.r, bd), 'uint8'),
        denormalizeChannel(normalizeChannel(color.g, bd), 'uint8'),
        denormalizeChannel(normalizeChannel(color.b, bd), 'uint8'),
        denormalizeChannel(normalizeChannel(color.a, bd), 'uint8'),
      ];
    }
    case 'cmyk': {
      const bd = color.bitDepth ?? 'uint8';
      const c = normalizeChannel(color.c, bd);
      const m = normalizeChannel(color.m, bd);
      const y = normalizeChannel(color.y, bd);
      const k = normalizeChannel(color.k, bd);
      const [r, g, b] = cmykToRgb(
        denormalizeChannel(c, 'uint8'),
        denormalizeChannel(m, 'uint8'),
        denormalizeChannel(y, 'uint8'),
        denormalizeChannel(k, 'uint8'),
      );
      return [r, g, b, denormalizeChannel(normalizeChannel(color.a, bd), 'uint8')];
    }
    case 'gray': {
      const bd = color.bitDepth ?? 'uint8';
      const v = denormalizeChannel(normalizeChannel(color.v, bd), 'uint8');
      return [v, v, v, denormalizeChannel(normalizeChannel(color.a, bd), 'uint8')];
    }
    case 'spot': {
      const a = Math.round(color.a * (color.tint / 100));
      if (color.processFallback) {
        const [r, g, b] = cmykToRgb(
          color.processFallback.c,
          color.processFallback.m,
          color.processFallback.y,
          color.processFallback.k,
        );
        return [r, g, b, a];
      }
      return [0, 0, 0, a];
    }
    case 'lab': {
      const [r, g, b] = labToRgb(color.l, color.av, color.b);
      return [
        r,
        g,
        b,
        denormalizeChannel(normalizeChannel(color.a, color.bitDepth ?? 'uint8'), 'uint8'),
      ];
    }
    case 'lch': {
      const [r, g, b] = lchToRgb(color.l, color.c, color.h);
      return [
        r,
        g,
        b,
        denormalizeChannel(normalizeChannel(color.a, color.bitDepth ?? 'uint8'), 'uint8'),
      ];
    }
    case 'registration': {
      // Registration prints on every plate; on screen it is black.
      return [0, 0, 0, denormalizeChannel(normalizeChannel(color.a, 'uint8'), 'uint8')];
    }
    case 'unresolved': {
      const a = denormalizeChannel(normalizeChannel(color.a, 'uint8'), 'uint8');
      if (color.fallback) return [color.fallback.r, color.fallback.g, color.fallback.b, a];
      // Best-effort display parse of the retained source; the authoritative
      // value is never rewritten.
      const parsed = cssStringToManagedColor(color.source);
      if (parsed && parsed.space === 'rgb') return [parsed.r, parsed.g, parsed.b, a];
      return [0, 0, 0, a];
    }
  }
}

/**
 * Normalize any ManagedColor to a 0.0–1.0 RGBA tuple for blending math.
 *
 * All color spaces are reduced to normalized RGBA: CMYK and spot colors
 * go through their process-color equivalent first, gray expands to RGB.
 * Channels are bit-depth-aware and remain floating point. This function is
 * deliberately independent from `managedColorToRgba`; the latter is an
 * explicit 8-bit display boundary and must not be used as a working buffer.
 */
export function managedColorToNormalized(color: ManagedColorShim): NormalizedRgba {
  switch (color.space) {
    case 'rgb': {
      const bitDepth = color.bitDepth ?? DEFAULT_BIT_DEPTH;
      return [
        normalizeChannel(color.r, bitDepth),
        normalizeChannel(color.g, bitDepth),
        normalizeChannel(color.b, bitDepth),
        normalizeChannel(color.a, bitDepth),
      ];
    }
    case 'cmyk': {
      const bitDepth = color.bitDepth ?? DEFAULT_BIT_DEPTH;
      const c = normalizeChannel(color.c, bitDepth);
      const m = normalizeChannel(color.m, bitDepth);
      const y = normalizeChannel(color.y, bitDepth);
      const k = normalizeChannel(color.k, bitDepth);
      return [
        (1 - c) * (1 - k),
        (1 - m) * (1 - k),
        (1 - y) * (1 - k),
        normalizeChannel(color.a, bitDepth),
      ];
    }
    case 'gray': {
      const bitDepth = color.bitDepth ?? DEFAULT_BIT_DEPTH;
      const v = normalizeChannel(color.v, bitDepth);
      return [v, v, v, normalizeChannel(color.a, bitDepth)];
    }
    case 'spot': {
      const fallback = color.processFallback;
      const c = fallback ? fallback.c / 255 : 1;
      const m = fallback ? fallback.m / 255 : 1;
      const y = fallback ? fallback.y / 255 : 1;
      const k = fallback ? fallback.k / 255 : 1;
      return [
        (1 - c) * (1 - k),
        (1 - m) * (1 - k),
        (1 - y) * (1 - k),
        (color.a / 255) * (color.tint / 100),
      ];
    }
    case 'lab': {
      const linear = xyzD65ToLinearRgb(labToXyz([color.l, color.av, color.b]));
      const bitDepth = color.bitDepth ?? DEFAULT_BIT_DEPTH;
      return [
        linearToSrgbUnit(linear[0]),
        linearToSrgbUnit(linear[1]),
        linearToSrgbUnit(linear[2]),
        normalizeChannel(color.a, bitDepth),
      ];
    }
    case 'lch': {
      const [l, av, b] = lchToLab([color.l, color.c, color.h]);
      const linear = xyzD65ToLinearRgb(labToXyz([l, av, b]));
      const bitDepth = color.bitDepth ?? DEFAULT_BIT_DEPTH;
      return [
        linearToSrgbUnit(linear[0]),
        linearToSrgbUnit(linear[1]),
        linearToSrgbUnit(linear[2]),
        normalizeChannel(color.a, bitDepth),
      ];
    }
    case 'registration':
      return [0, 0, 0, color.a / 255];
    case 'unresolved': {
      const alpha = color.a / 255;
      if (color.fallback) {
        return [color.fallback.r / 255, color.fallback.g / 255, color.fallback.b / 255, alpha];
      }
      const parsed = cssStringToManagedColor(color.source);
      if (parsed && parsed.space === 'rgb') {
        return [parsed.r / 255, parsed.g / 255, parsed.b / 255, alpha];
      }
      return [0, 0, 0, alpha];
    }
  }
}

/**
 * Convert any ManagedColor to a CSS rgba() string.
 * Bit-depth-aware: channels are normalized before formatting.
 */
export function managedColorToCss(color: ManagedColorShim): string {
  const [r, g, b, a] = managedColorToRgba(color);
  return `rgba(${r},${g},${b},${a / 255})`;
}

/**
 * Format a normalized 0.0–1.0 RGBA tuple as a CSS color string.
 * Alpha is emitted with full float precision.
 */
export function normalizedToCss(rgba: [number, number, number, number]): string {
  const [r, g, b, a] = rgba;
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

/**
 * Convert any ManagedColor to an engine Color tuple [r, g, b, a] (0-255).
 */
export function managedColorToEngineColor(color: ManagedColorShim): ColorShim {
  return managedColorToRgba(color);
}

/**
 * Stable canonical identity key for a ManagedColor.
 *
 * Used to detect whether an incoming `value` prop is the picker's own echo of
 * a just-emitted color (equal key) or an external change (different key) such
 * as undo, redo, selection change, or gradient-stop switch. Comparing a
 * structural key avoids both object-identity false negatives (immutable
 * documents produce fresh objects every edit) and value-equality false
 * positives (byte-equal colors from different sources).
 */
export function managedColorKey(color: ManagedColorShim): string {
  switch (color.space) {
    case 'rgb':
      return `rgb:${color.bitDepth ?? 'uint8'}:${color.r},${color.g},${color.b},${color.a}:${
        color.profile ?? ''
      }`;
    case 'cmyk':
      return `cmyk:${color.bitDepth ?? 'uint8'}:${color.c},${color.m},${color.y},${color.k},${
        color.a
      }:${color.profile ?? ''}`;
    case 'gray':
      return `gray:${color.bitDepth ?? 'uint8'}:${color.v},${color.a}:${color.profile ?? ''}`;
    case 'spot':
      return `spot:${color.spotId ?? ''}:${color.library ?? ''}:${color.name}:${color.tint}:${
        color.a
      }:${color.processFallback ? JSON.stringify(color.processFallback) : ''}`;
    case 'lab':
      return `lab:${color.l},${color.av},${color.b},${color.a}:${color.profile ?? ''}:${
        color.profileFingerprint ?? ''
      }`;
    case 'lch':
      return `lch:${color.l},${color.c},${color.h},${color.a}:${color.profile ?? ''}:${
        color.profileFingerprint ?? ''
      }`;
    case 'registration':
      return `registration:${color.a}`;
    case 'unresolved':
      return `unresolved:${color.a}:${color.source}:${
        color.fallback ? JSON.stringify(color.fallback) : ''
      }`;
  }
}

// ── Oklab <-> Oklch ─────────────────────────────────────────────────────────

/**
 * Convert Oklab [L, a, b] to Oklch [L, Chroma, Hue] (hue in radians).
 */
export function oklabToOkLch(lab: [number, number, number]): [number, number, number] {
  const [L, a, b] = lab;
  return [L, Math.sqrt(a * a + b * b), Math.atan2(b, a)];
}

/**
 * Convert Oklch [L, Chroma, Hue] (hue in radians) to Oklab [L, a, b].
 */
export function oklchToOkLab(lch: [number, number, number]): [number, number, number] {
  const [L, C, H] = lch;
  return [L, C * Math.cos(H), C * Math.sin(H)];
}

// ── CIELAB / CIELCH (D50, degrees hue) ─────────────────────────────────────

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Normalize a hue angle to [0, 360). Deterministic; NaN → 0. */
export function normalizeHueDegrees(h: number): number {
  if (Number.isNaN(h) || !Number.isFinite(h)) return 0;
  let v = h % 360;
  if (v < 0) v += 360;
  return v;
}

/**
 * CIELab [L, a, b] → CIELCH [L, C, H] with hue in degrees wrapped to
 * [0, 360). Achromatic colors (C ≈ 0) keep the previous hue convention of
 * 0 — pickers maintain editing continuity separately (see the picker's
 * last-meaningful-hue state).
 */
export function labToLch(lab: [number, number, number]): [number, number, number] {
  const [L, a, b] = lab;
  const C = Math.sqrt(a * a + b * b);
  const H = C < 1e-12 ? 0 : normalizeHueDegrees(Math.atan2(b, a) * RAD2DEG);
  return [L, C, H];
}

/**
 * CIELCH [L, C, H] (hue degrees) → CIELab [L, a, b].
 * Chroma is normalized to |C| and hue is wrapped before conversion, so
 * negative chroma or unwrapped hue cannot leak through.
 */
export function lchToLab(lch: [number, number, number]): [number, number, number] {
  const [L, C, H] = lch;
  const c = Math.abs(C);
  const h = normalizeHueDegrees(H) * DEG2RAD;
  return [L, c * Math.cos(h), c * Math.sin(h)];
}

/** 0-255 sRGB → CIELab (D50), matching `xyzToLab`'s white point. */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  return xyzToLab(linearRgbToXyzD65(rgbToLinearRgb([r, g, b])));
}

/** CIELab (D50) → 0-255 sRGB, clamped to display range (preview only). */
export function labToRgb(l: number, a: number, b: number): [number, number, number] {
  const linear = xyzD65ToLinearRgb(labToXyz([l, a, b]));
  return linearRgbToRgb([clamp01(linear[0]), clamp01(linear[1]), clamp01(linear[2])]);
}

/** 0-255 sRGB → CIELCH (D50, hue degrees). */
export function rgbToLch(r: number, g: number, b: number): [number, number, number] {
  return labToLch(rgbToLab(r, g, b));
}

/** CIELCH (D50, hue degrees) → 0-255 sRGB, clamped to display range. */
export function lchToRgb(l: number, c: number, h: number): [number, number, number] {
  const lab = lchToLab([l, c, h]);
  return labToRgb(lab[0], lab[1], lab[2]);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Deterministic rounding for picker display and serialization. Rounding the
 * AUTHORITATIVE stored value repeatedly while switching picker modes is
 * forbidden — use this only for display formatting and cache keys.
 */
export function roundTo(value: number, digits: number): number {
  const f = 10 ** digits;
  // Round half away from zero, with an epsilon break in the correct
  // direction for the value's sign (Math.round(-0.5) is -0 otherwise).
  const sign = value < 0 ? -1 : 1;
  return Math.round(value * f + sign * Number.EPSILON) / f;
}

// ── Precision and determinism conventions ───────────────────────────────────

/**
 * Canonical precision conventions (Phase 4 of the color-management program).
 *
 * - `COLOR_EQUALITY_TOLERANCE`: default per-channel tolerance for managed
 *   color comparisons (`managedColorEquals`).
 * - `COLOR_SERIALIZATION_PRECISION`: relative magnitude retained when
 *   serializing float channels (Lab/LCH). Values are never rounded on
 *   storage; this is the tolerance used when comparing serialized floats.
 * - Picker display precision: Lab L/a/b and LCH L/C to 1 decimal, LCH hue
 *   to 0.1°. Display formatting is presentation-only; it is never written
 *   back to the authoritative value.
 *
 * Determinism: for identical inputs, profile versions, and options, all
 * conversions in this module produce bit-identical results on a given
 * runtime (no Math.random, no Date, no platform-dependent rounding).
 */
export const COLOR_EQUALITY_TOLERANCE = 1e-9;
export const COLOR_SERIALIZATION_PRECISION = 1e-6;
export const COLOR_DISPLAY_DECIMALS = 1;
export const COLOR_HUE_DISPLAY_DECIMALS = 1;

// ── Gamut mapping ───────────────────────────────────────────────────────────

/**
 * Check if linear sRGB [r,g,b] is in-gamut (all channels in [0,1]).
 */
function inGamut(linear: [number, number, number]): boolean {
  return (
    linear[0] >= 0 &&
    linear[0] <= 1 &&
    linear[1] >= 0 &&
    linear[1] <= 1 &&
    linear[2] >= 0 &&
    linear[2] <= 1
  );
}

/**
 * Map an Oklch [L, Chroma, Hue] color to sRGB via chroma reduction.
 *
 * Uses binary search on chroma to find the closest in-gamut color
 * while preserving lightness and hue.
 *
 * Returns [r, g, b] in 0-255 sRGB, rounded for display compatibility.
 */
export function gamutMapToSrgb(oklch: [number, number, number]): [number, number, number] {
  return gamutMapToSrgbUnit(oklch).map((value) => Math.round(value)) as [number, number, number];
}

/**
 * Map Oklch to sRGB without quantizing the encoded channels. This is the
 * working-space counterpart to `gamutMapToSrgb`; callers should quantize only
 * when they cross a display or file-format boundary.
 */
export function gamutMapToSrgbUnit(oklch: [number, number, number]): [number, number, number] {
  const [L, C, H] = oklch;

  // Oklch → Oklab
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const oklab: [number, number, number] = [L, a, b];

  // Try full chroma first
  const linear = oklabToLinearSrgb(oklab);
  if (inGamut(linear)) {
    // Fully in gamut — clamp and return
    return [
      Math.max(0, Math.min(1, linear[0])),
      Math.max(0, Math.min(1, linear[1])),
      Math.max(0, Math.min(1, linear[2])),
    ].map((value) => linearToSrgbUnit(value) * 255) as [number, number, number];
  }

  // Binary search on chroma
  let lo = 0;
  let hi = C;

  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const ma = mid * Math.cos(H);
    const mb = mid * Math.sin(H);
    const mLinear = oklabToLinearSrgb([L, ma, mb]);
    if (inGamut(mLinear)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const fa = lo * Math.cos(H);
  const fb = lo * Math.sin(H);
  const finalLinear = oklabToLinearSrgb([L, fa, fb]);
  return [
    Math.max(0, Math.min(1, finalLinear[0])),
    Math.max(0, Math.min(1, finalLinear[1])),
    Math.max(0, Math.min(1, finalLinear[2])),
  ].map((value) => linearToSrgbUnit(value) * 255) as [number, number, number];
}
