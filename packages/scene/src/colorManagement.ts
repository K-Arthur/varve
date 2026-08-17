/**
 * Color management types — color spaces, ICC profiles, managed colors,
 * spot colors, and document-level color configuration.
 *
 * This module provides the type system for professional color management.
 * The actual conversion engine lives in the Rust print crate (strata-print)
 * and the TS rendering pipeline (@varve/engine).
 *
 * Research basis: ICC.1:2010 (Profile Version 4.3), ISO 12647 (printing
 * conditions), LittleCMS architecture, Adobe ACE color engine model,
 * OpenEXR / half-float convention.
 */

import type { BitDepth, ColorMode, DocumentUnit, RenderingIntent } from '@varve/shared';
import { DEFAULT_BIT_DEPTH } from '@varve/shared';

// ── Color Mode + Bit Depth ─────────────────────────────────────────────────

export { DEFAULT_BIT_DEPTH } from '@varve/shared';
/**
 * Bit depth determines channel storage precision and value range. Canonical
 * definition lives in @varve/shared (so the conversion engine can use it
 * without a circular dep on @varve/scene); re-exported here.
 *
 * | bitDepth | range    | notes |
 * |----------|----------|-------|
 * | uint8    | 0–255    | integer. Default for existing documents. |
 * | uint16   | 0–65535  | integer. |
 * | float16  | 0.0–1.0  | half-float intent; stored as JS number. |
 * | float32  | 0.0–1.0  | single-precision; HDR can exceed 1.0. */
/** Document-level color mode. Determines default color space for new colors.
 *  Canonical definition lives in @varve/shared (used by the preset system
 *  as well); re-exported here so existing `import type { ColorMode } from
 *  '@varve/scene'` call sites keep working unchanged. */
export type { BitDepth, ColorMode };

// ── Color Space ─────────────────────────────────────────────────────────────

/** Color space identifiers for individual colors. */
export type ColorSpace =
  | 'rgb'
  | 'cmyk'
  | 'gray'
  | 'spot'
  | 'lab'
  | 'lch'
  | 'registration'
  | 'unresolved';

// ── Rendering Intent ────────────────────────────────────────────────────────

/**
 * Rendering intent for color conversion (ICC standard).
 *
 * - Perceptual: preserve overall color relationships (photographs).
 * - Relative: map white point, clip out-of-gamut colors (default for most work).
 * - Absolute: simulate source paper color on target (proofing).
 * - Saturation: preserve saturation (charts, business graphics).
 */
export type { RenderingIntent } from '@varve/shared';

// ── ICC Profile Reference ───────────────────────────────────────────────────

/**
 * Reference to an ICC color profile.
 *
 * Profiles can be referenced by id (built-in) or embedded with raw data.
 * The profile id maps to a registry maintained by the color management engine.
 */
export interface ColorProfileRef {
  /** Profile identifier (e.g., 'srgb', 'display-p3', 'fogra39', 'gracol2006'). */
  id: string;
  /** Display name for UI. */
  name: string;
  /** Whether the profile data is embedded in the document. */
  embedded?: boolean;
  /** Raw ICC profile bytes (when embedded). */
  data?: Uint8Array;
}

// ── Output Intent ───────────────────────────────────────────────────────────

/**
 * Output intent for print export (PDF/X requirement).
 *
 * Specifies the target color profile and conversion settings for the
 * final output device. This is a document-level property, not an export
 * option.
 */
export interface OutputIntentRef {
  /** Target output profile. */
  profile: ColorProfileRef;
  /** Rendering intent for the output conversion. */
  renderingIntent: RenderingIntent;
  /** Whether to apply black point compensation. */
  blackPointCompensation: boolean;
}

// ── Managed Color ───────────────────────────────────────────────────────────

/**
 * RGB color value. Channel range depends on `bitDepth`:
 * - uint8 (default): 0–255
 * - uint16: 0–65535
 * - float16/float32: 0.0–1.0 (HDR can exceed 1.0)
 */
export interface RgbColor {
  space: 'rgb';
  /** Channel bit depth. Optional; defaults to 'uint8' when absent. */
  bitDepth?: BitDepth;
  r: number;
  g: number;
  b: number;
  a: number;
  /** ICC profile id for this color (defaults to document profile). */
  profile?: string;
  /**
   * Fingerprint (hash) of the ICC profile bytes this color was authored or
   * converted under. Detects profile-version drift; distinct from `profile`
   * (an id/name that can be reused across profile revisions).
   */
  profileFingerprint?: string;
}

/**
 * CMYK color value. Channel range depends on `bitDepth`:
 * - uint8 (default): 0–255 per channel
 * - uint16: 0–65535 per channel
 * - float16/float32: 0.0–1.0 (proportion of full ink)
 */
export interface CmykColor {
  space: 'cmyk';
  /** Channel bit depth. Optional; defaults to 'uint8' when absent. */
  bitDepth?: BitDepth;
  c: number;
  m: number;
  y: number;
  k: number;
  a: number;
  /** ICC profile id for this color (defaults to document output intent). */
  profile?: string;
  /** Fingerprint of the ICC profile bytes (see `RgbColor.profileFingerprint`). */
  profileFingerprint?: string;
}

/**
 * Grayscale color value. Channel range depends on `bitDepth`:
 * - uint8 (default): 0–255 (0 = black, 255 = white)
 * - uint16: 0–65535
 * - float16/float32: 0.0–1.0
 */
export interface GrayColor {
  space: 'gray';
  /** Channel bit depth. Optional; defaults to 'uint8' when absent. */
  bitDepth?: BitDepth;
  v: number;
  a: number;
  profile?: string;
  /** Fingerprint of the ICC profile bytes (see `RgbColor.profileFingerprint`). */
  profileFingerprint?: string;
}

/**
 * CIELAB color value (D50 reference white by default).
 *
 * Channels are float-valued and independent of `bitDepth` (L 0–100, a/b
 * signed, typically -128..128 but not restricted). `bitDepth` only scales
 * the alpha channel, matching the other color variants.
 *
 * Naming note: the CIELAB a-channel is stored as `av` so that `a` keeps its
 * union-wide meaning (alpha). The picker labels it "a".
 *
 * Lab is an authoring-first space: values may be out of the display or
 * output gamut and MUST NOT be silently clamped by renderers. Display paths
 * clip for preview; authoritative values stay in the document.
 */
export interface LabColor {
  space: 'lab';
  /** Lightness, 0–100 (float). */
  l: number;
  /** a channel (green–red axis, signed float). */
  av: number;
  /** b channel (blue–yellow axis, signed float). */
  b: number;
  /** Alpha, bit-depth scaled (default uint8 → 0-255). */
  a: number;
  /** Alpha bit depth (defaults to 'uint8'). Only scales alpha. */
  bitDepth?: BitDepth;
  /** ICC profile id of the reference white / encoding context. */
  profile?: string;
  /** Fingerprint of the ICC profile bytes (see `RgbColor.profileFingerprint`). */
  profileFingerprint?: string;
}

/**
 * CIELCH color value (polar form of CIELAB).
 *
 * Channels are float-valued and independent of `bitDepth` (L 0–100, C ≥ 0,
 * H in degrees 0–360). Hue is always serialized normalized to [0, 360);
 * editing continuity for achromatic colors is a picker concern, not a
 * storage concern. `a` is alpha, matching every other union member.
 */
export interface LchColor {
  space: 'lch';
  /** Lightness, 0–100 (float). */
  l: number;
  /** Chroma ≥ 0 (float). Negative input is normalized to |c|. */
  c: number;
  /** Hue in degrees, wrapped to [0, 360). */
  h: number;
  /** Alpha, bit-depth scaled (default uint8 → 0-255). */
  a: number;
  /** Alpha bit depth (defaults to 'uint8'). Only scales alpha. */
  bitDepth?: BitDepth;
  /** ICC profile id of the reference white / encoding context. */
  profile?: string;
  /** Fingerprint of the ICC profile bytes (see `RgbColor.profileFingerprint`). */
  profileFingerprint?: string;
}

/**
 * Registration color — prints on every plate (process + spot). Used for
 * printer marks and annotations. Rendered as black on screen.
 */
export interface RegistrationColor {
  space: 'registration';
  /** Alpha, bit-depth scaled (default uint8 → 0-255). */
  a: number;
}

/**
 * Unresolved imported color — a value whose color-space interpretation is
 * unknown (missing profile, unknown ICC class, ambiguous metadata). The
 * original serialization is retained in `source` and never silently
 * reinterpreted. `fallback` (when present) is a DISPLAY-ONLY approximation
 * and can never replace the authoritative source.
 */
export interface UnresolvedColor {
  space: 'unresolved';
  /** Alpha, bit-depth scaled (default uint8 → 0-255). */
  a: number;
  /** Original serialized representation (e.g. ICC tag bytes, PDF string). */
  source: string;
  /** Human-readable reason the color is unresolved. */
  reason?: string;
  /** Display-only approximation. Non-authoritative. */
  fallback?: { r: number; g: number; b: number };
}

/** Spot color reference. */
export interface SpotColorRef {
  space: 'spot';
  /**
   * Stable spot-ink identifier. When set, this reference points at a
   * `SpotColorDef` with the same id (document or library scope); `name` is
   * then a denormalized display copy. When absent (legacy documents), the
   * ref is resolved by `name` and a spotId is synthesized on migration.
   * Two spots with identical names from different libraries are never
   * merged — identity is `spotId`/`library`, not `name`.
   */
  spotId?: string;
  /** Library identifier the spot belongs to (empty = project-local). */
  library?: string;
  /** Spot color name (e.g., "Pantone 185 C"). Display copy when spotId set. */
  name: string;
  /** Tint percentage (0-100). 100 = full strength. */
  tint: number;
  a: number;
  /** CMYK process fallback for when spot ink is unavailable. */
  processFallback?: { c: number; m: number; y: number; k: number };
}

/**
 * A color value that can be in any supported color space.
 *
 * This is the professional color type. The existing `Color` type
 * (readonly [number, number, number, number]) remains for backward
 * compatibility and is treated as sRGB RGBA.
 *
 * Invariants (enforced by `packages/scene/src/colorValidation.ts`):
 * - Channel values are normalized per-space; NaN/Infinity are rejected.
 * - Alpha has one canonical storage scale: the color's `bitDepth`
 *   (default uint8 → 0-255). The normalized 0-1 range is a boundary
 *   convention, produced by `normalizeChannel`.
 * - LCH hue wraps deterministically to [0, 360); chroma is always ≥ 0.
 * - Spot tints are within [0, 100].
 * - `UnresolvedColor.fallback` is display-only and never authoritative.
 * - Conversions never mutate their source object.
 */
export type ManagedColor =
  | RgbColor
  | CmykColor
  | GrayColor
  | SpotColorRef
  | LabColor
  | LchColor
  | RegistrationColor
  | UnresolvedColor;

// ── Spot Color Definition ───────────────────────────────────────────────────

/**
 * Definition of a spot color available in the document.
 *
 * Spot colors are named, premixed inks (Pantone, RAL, NCS, HKS, or custom).
 * They are stored as references in node fills and resolved at render/export time.
 *
 * Research basis: Pantone Matching System, RAL Classic, NCS,
 * ISO 2846 (ink color standards).
 */
export interface SpotColorDef {
  /** Unique id within the document (or library). */
  id: string;
  /** Spot color name (e.g., "Pantone 185 C", "RAL 3000"). */
  name: string;
  /** Export name (PDF Separation ink name). Defaults to `name`. */
  exportName?: string;
  /** Color book/library identifier (empty = project-local). */
  library: string;
  /** Display name of the owning library (denormalized). */
  libraryName?: string;
  /** CMYK process fallback (used when spot ink is unavailable). */
  processFallback: { c: number; m: number; y: number; k: number };
  /** Lab values for color-accurate display and soft proofing. */
  lab?: { l: number; a: number; b: number };
  /** Whether this spot color is available on the output device. */
  available?: boolean;
  /** Manufacturer or system name (e.g., "Pantone LLC"). */
  manufacturer?: string;
  /** Optional ink code (e.g., "185 C"). */
  code?: string;
  /** Free-form notes. */
  notes?: string;
  /** Provenance: how this definition entered the document. */
  provenance?: 'user' | 'import' | 'library' | 'migration';
  /** Aliases (alternate names) for resolution on import. */
  aliases?: string[];
  /** Creation time (ISO 8601). */
  createdAt?: string;
  /** Last modification time (ISO 8601). */
  modifiedAt?: string;
}

/**
 * A named spot-color library. Libraries group spot definitions with a stable
 * identity. `kind` distinguishes behavior:
 * - `builtin`: read-only, bundled with the app (display-only catalog).
 * - `user-global`: shared across documents on this machine.
 * - `project`: embedded in the document and travels with it.
 * - `imported`: came in via import; may be missing its external source.
 */
export interface SpotLibrary {
  /** Stable library id (e.g., 'pantone-c' or a generated project id). */
  id: string;
  /** Display name (e.g., "Pantone C"). */
  name: string;
  kind: 'builtin' | 'user-global' | 'project' | 'imported';
  /** Spot definitions owned by this library. */
  spots: SpotColorDef[];
  /** For user-global libraries: filesystem location (desktop only). */
  sourcePath?: string;
  /** Timestamps for imported/user libraries. */
  createdAt?: string;
  modifiedAt?: string;
}

// ── Global Color Swatch ─────────────────────────────────────────────────────

/**
 * A reusable color swatch stored at the document level.
 *
 * Swatches can be RGB, CMYK, grayscale, or spot colors. They are
 * referenced by id from node fills, styles, and variables.
 */
export interface ColorSwatch {
  /** Unique id within the document. */
  id: string;
  /** Display name. */
  name: string;
  /** The color value. */
  color: ManagedColor;
  /** Whether this swatch is a spot color reference. */
  spotColorId?: string;
}

// ── Bleed Configuration ─────────────────────────────────────────────────────

/**
 * Bleed configuration for a document or page.
 *
 * Bleed extends the artwork beyond the trim boundary to prevent
 * visible white edges after trimming. Standard commercial bleed is 3mm.
 *
 * Research basis: ISO 12647-2, commercial print standards.
 */
export interface BleedConfig {
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** Whether all edges are linked (change one = change all). */
  linked: boolean;
  /** Unit for bleed values. */
  unit: DocumentUnit;
}

/** Create a uniform bleed config with all edges linked. */
export function uniformBleed(value: number, unit: DocumentUnit): BleedConfig {
  return {
    top: value,
    right: value,
    bottom: value,
    left: value,
    linked: true,
    unit,
  };
}

/** Default bleed: 3mm, all edges linked. */
export const DEFAULT_BLEED: BleedConfig = uniformBleed(3, 'mm');

// ── Safe Area Configuration ─────────────────────────────────────────────────

/**
 * Safe area (live area) configuration.
 *
 * The safe area is inside the trim boundary. Critical content should be
 * kept within this area to account for cutting tolerance.
 * Standard safe area is 5mm inside trim.
 */
export interface SafeAreaConfig {
  top: number;
  right: number;
  bottom: number;
  left: number;
  unit: DocumentUnit;
  /** Whether safe area is active (visible + enforced in preflight). */
  enabled: boolean;
}

/** Default safe area: 5mm, all edges, enabled. */
export const DEFAULT_SAFE_AREA: SafeAreaConfig = {
  top: 5,
  right: 5,
  bottom: 5,
  left: 5,
  unit: 'mm',
  enabled: false,
};

// ── Slug Configuration ──────────────────────────────────────────────────────

/**
 * Slug area configuration.
 *
 * The slug area is outside the bleed, used for printer instructions,
 * file info, color bars, and registration marks. It is not part of the
 * final printed piece.
 */
export interface SlugConfig {
  top: number;
  right: number;
  bottom: number;
  left: number;
  unit: DocumentUnit;
  /** Whether slug area is included in the document. */
  enabled: boolean;
}

// ── Black Generation ────────────────────────────────────────────────────────

/**
 * Black generation settings for RGB-to-CMYK conversion.
 *
 * Controls how the black (K) channel is derived during color conversion.
 *
 * - Standard black: K only for text and pure black (0,0,0,100).
 * - Rich black: CMY+K for deeper blacks (e.g., 60,50,50,100).
 * - Custom: user-specified rich black values.
 */
export type BlackGeneration = 'standard' | 'rich' | 'custom';

/**
 * Black generation configuration.
 */
export interface BlackGenerationConfig {
  mode: BlackGeneration;
  /** Custom rich black values (when mode = 'custom'). */
  customRichBlack?: { c: number; m: number; y: number; k: number };
  /** Whether to apply overprint to black objects. */
  overprintBlack: boolean;
}

/** Default black generation: standard, no overprint. */
export const DEFAULT_BLACK_GENERATION: BlackGenerationConfig = {
  mode: 'standard',
  overprintBlack: false,
};

// ── Document Color Configuration ────────────────────────────────────────────

/**
 * Working color space for compositing and blending.
 *
 * - 'srgb': blend in gamma-encoded sRGB (current behavior, fast, but
 *   mathematically incorrect for multiply/screen/overlay).
 * - 'linear': decode to linear light before blending, re-encode after
 *   (physically correct — how compositing works in Photoshop, Figma, CSS).
 */
export type WorkingSpace = 'srgb' | 'linear';

/**
 * Complete color management configuration for a document.
 *
 * This is stored as `Document.colorConfig` and drives all color behavior:
 * default color space, bit depth, profile assignment, output intent, and
 * black generation.
 */
export interface ColorConfig {
  /** Document color mode. */
  mode: ColorMode;
  /** Default bit depth for newly created colors. */
  bitDepth: BitDepth;
  /** Working color space for blending and compositing. */
  workingSpace: WorkingSpace;
  /** Working RGB profile (for RGB documents). */
  rgbProfile: ColorProfileRef;
  /** Working CMYK profile (for CMYK documents and output intent). */
  cmykProfile: ColorProfileRef;
  /** Display profile for soft proofing (optional). */
  displayProfile?: ColorProfileRef;
  /** Output intent for print export. */
  outputIntent?: OutputIntentRef;
  /** Black generation settings. */
  blackGeneration: BlackGenerationConfig;
  /**
   * Default interpolation space for new gradients. When a gradient's own
   * `interpolationSpace` is unset, this value is used. Existing gradients
   * without this field resolve to 'oklab' (historical default).
   */
  defaultGradientInterpolation?: import('./types').GradientInterpolationSpace;
}

// ── Built-in Profile Registry ───────────────────────────────────────────────

/** Common RGB ICC profile identifiers. */
export const RGB_PROFILES = {
  srgb: { id: 'srgb', name: 'sRGB IEC61966-2.1' },
  displayP3: { id: 'display-p3', name: 'Display P3' },
  adobeRgb: { id: 'adobe-rgb', name: 'Adobe RGB (1998)' },
  proPhoto: { id: 'pro-photo', name: 'ProPhoto RGB' },
} as const;

/** Common CMYK ICC profile identifiers. */
export const CMYK_PROFILES = {
  fogra39: { id: 'fogra39', name: 'Fogra39 (ISO Coated v2 300%)' },
  fogra51: { id: 'fogra51', name: 'Fogra51 (PSO Coated v3)' },
  gracol2006: { id: 'gracol2006', name: 'GRACoL 2006' },
  swopCoated: { id: 'swop-coated', name: 'SWOP Coated v2' },
  swopUncoated: { id: 'swop-uncoated', name: 'SWOP Uncoated v2' },
  japanColor2011: { id: 'japan-color-2011', name: 'Japan Color 2011 Coated' },
} as const;

/** Default working space: sRGB (backward compatible). Existing documents
 *  blend in gamma space; new documents can opt into 'linear'. */
export const DEFAULT_WORKING_SPACE: WorkingSpace = 'srgb';

/** Default color configuration for RGB documents. */
export function defaultRgbColorConfig(bitDepth: BitDepth = DEFAULT_BIT_DEPTH): ColorConfig {
  return {
    mode: 'rgb',
    bitDepth,
    workingSpace: DEFAULT_WORKING_SPACE,
    rgbProfile: { ...RGB_PROFILES.srgb },
    cmykProfile: { ...CMYK_PROFILES.fogra39 },
    blackGeneration: { ...DEFAULT_BLACK_GENERATION },
  };
}

/** Default color configuration for CMYK documents. */
export function defaultCmykColorConfig(bitDepth: BitDepth = DEFAULT_BIT_DEPTH): ColorConfig {
  return {
    mode: 'cmyk',
    bitDepth,
    workingSpace: DEFAULT_WORKING_SPACE,
    rgbProfile: { ...RGB_PROFILES.srgb },
    cmykProfile: { ...CMYK_PROFILES.fogra39 },
    outputIntent: {
      profile: { ...CMYK_PROFILES.fogra39 },
      renderingIntent: 'relative',
      blackPointCompensation: true,
    },
    blackGeneration: { ...DEFAULT_BLACK_GENERATION },
  };
}

/** Default color configuration based on color mode and bit depth. */
export function defaultColorConfig(
  mode: ColorMode = 'rgb',
  bitDepth: BitDepth = DEFAULT_BIT_DEPTH,
): ColorConfig {
  if (mode === 'cmyk') return defaultCmykColorConfig(bitDepth);
  return defaultRgbColorConfig(bitDepth);
}

/** Return a ColorConfig with bitDepth and workingSpace fields set to safe
 *  defaults when missing (documents saved before v2.4). */
export function colorConfigWithDefaults(config: ColorConfig | undefined): ColorConfig {
  const base = config ?? defaultColorConfig('rgb', DEFAULT_BIT_DEPTH);
  return {
    ...base,
    bitDepth: base.bitDepth ?? DEFAULT_BIT_DEPTH,
    workingSpace: base.workingSpace ?? DEFAULT_WORKING_SPACE,
  };
}

// ── Helper Functions ────────────────────────────────────────────────────────

/** Check if a ManagedColor is RGB. */
export function isRgbColor(c: ManagedColor): c is RgbColor {
  return c.space === 'rgb';
}

/** Check if a ManagedColor is CMYK. */
export function isCmykColor(c: ManagedColor): c is CmykColor {
  return c.space === 'cmyk';
}

/** Check if a ManagedColor is grayscale. */
export function isGrayColor(c: ManagedColor): c is GrayColor {
  return c.space === 'gray';
}

/** Check if a ManagedColor is a spot color reference. */
export function isSpotColor(c: ManagedColor): c is SpotColorRef {
  return c.space === 'spot';
}

/** Check if a ManagedColor is CIELAB. */
export function isLabColor(c: ManagedColor): c is LabColor {
  return c.space === 'lab';
}

/** Check if a ManagedColor is CIELCH. */
export function isLchColor(c: ManagedColor): c is LchColor {
  return c.space === 'lch';
}

/** Check if a ManagedColor is the registration color. */
export function isRegistrationColor(c: ManagedColor): c is RegistrationColor {
  return c.space === 'registration';
}

/** Check if a ManagedColor is an unresolved imported color. */
export function isUnresolvedColor(c: ManagedColor): c is UnresolvedColor {
  return c.space === 'unresolved';
}

/** Create an RGB ManagedColor from a legacy Color tuple [r, g, b, a]. */
export function rgbFromTuple(
  rgba: readonly [number, number, number, number],
  profile?: string,
): RgbColor {
  return {
    space: 'rgb',
    bitDepth: 'uint8',
    r: rgba[0],
    g: rgba[1],
    b: rgba[2],
    a: rgba[3],
    profile,
  };
}

/**
 * Return a copy of a ManagedColor with `bitDepth` explicitly set.
 *
 * Existing colors (deserialized from documents saved before bit depth was
 * added) have `bitDepth: undefined`. Use this helper at every read boundary
 * where a concrete bit depth is required — conversion functions, rendering
 * pipelines, and serialization. The optional `fallback` defaults to
 * `DEFAULT_BIT_DEPTH` ('uint8'), so existing documents round-trip losslessly.
 *
 * For spot colors (which have no channel precision), the color is returned
 * unchanged.
 */
export function withDefaultBitDepth<T extends ManagedColor>(
  color: T,
  fallback: BitDepth = DEFAULT_BIT_DEPTH,
): T {
  if (color.space === 'spot' || color.space === 'registration' || color.space === 'unresolved') {
    return color;
  }
  if (color.bitDepth) return color;
  return { ...color, bitDepth: fallback } as T;
}

/** Convert an RgbColor to a legacy Color tuple [r, g, b, a]. */
export function rgbToTuple(c: RgbColor): [number, number, number, number] {
  return [c.r, c.g, c.b, c.a];
}

/** Convert a CmykColor to a CMYK tuple [c, m, y, k, a]. */
export function cmykToTuple(c: CmykColor): [number, number, number, number, number] {
  return [c.c, c.m, c.y, c.k, c.a];
}
