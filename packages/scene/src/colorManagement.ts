/**
 * Color management types — color spaces, ICC profiles, managed colors,
 * spot colors, and document-level color configuration.
 *
 * This module provides the type system for professional color management.
 * The actual conversion engine lives in the Rust print crate (strata-print)
 * and the TS rendering pipeline (@strata/engine).
 *
 * Research basis: ICC.1:2010 (Profile Version 4.3), ISO 12647 (printing
 * conditions), LittleCMS architecture, Adobe ACE color engine model.
 */

import type { DocumentUnit } from '@strata/shared';

// ── Color Mode ──────────────────────────────────────────────────────────────

/** Document-level color mode. Determines default color space for new colors. */
export type ColorMode = 'rgb' | 'cmyk' | 'grayscale';

// ── Color Space ─────────────────────────────────────────────────────────────

/** Color space identifiers for individual colors. */
export type ColorSpace = 'rgb' | 'cmyk' | 'gray' | 'spot';

// ── Rendering Intent ────────────────────────────────────────────────────────

/**
 * Rendering intent for color conversion (ICC standard).
 *
 * - Perceptual: preserve overall color relationships (photographs).
 * - Relative: map white point, clip out-of-gamut colors (default for most work).
 * - Absolute: simulate source paper color on target (proofing).
 * - Saturation: preserve saturation (charts, business graphics).
 */
export type RenderingIntent = 'perceptual' | 'relative' | 'absolute' | 'saturation';

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

/** RGB color value (0-255 per channel, sRGB by default). */
export interface RgbColor {
  space: 'rgb';
  r: number;
  g: number;
  b: number;
  a: number;
  /** ICC profile id for this color (defaults to document profile). */
  profile?: string;
}

/** CMYK color value (0-255 per channel). */
export interface CmykColor {
  space: 'cmyk';
  c: number;
  m: number;
  y: number;
  k: number;
  a: number;
  /** ICC profile id for this color (defaults to document output intent). */
  profile?: string;
}

/** Grayscale color value (0-255, 0 = black, 255 = white). */
export interface GrayColor {
  space: 'gray';
  v: number;
  a: number;
  profile?: string;
}

/** Spot color reference. */
export interface SpotColorRef {
  space: 'spot';
  /** Spot color name (e.g., "Pantone 185 C"). */
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
 */
export type ManagedColor = RgbColor | CmykColor | GrayColor | SpotColorRef;

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
  /** Unique id within the document. */
  id: string;
  /** Spot color name (e.g., "Pantone 185 C", "RAL 3000"). */
  name: string;
  /** Color book/library identifier. */
  library: string;
  /** CMYK process fallback (used when spot ink is unavailable). */
  processFallback: { c: number; m: number; y: number; k: number };
  /** Lab values for color-accurate display and soft proofing. */
  lab?: { l: number; a: number; b: number };
  /** Whether this spot color is available on the output device. */
  available?: boolean;
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
 * Complete color management configuration for a document.
 *
 * This is stored as `Document.colorConfig` and drives all color behavior:
 * default color space, profile assignment, output intent, and black generation.
 */
export interface ColorConfig {
  /** Document color mode. */
  mode: ColorMode;
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

/** Default color configuration for RGB documents. */
export function defaultRgbColorConfig(): ColorConfig {
  return {
    mode: 'rgb',
    rgbProfile: { ...RGB_PROFILES.srgb },
    cmykProfile: { ...CMYK_PROFILES.fogra39 },
    blackGeneration: { ...DEFAULT_BLACK_GENERATION },
  };
}

/** Default color configuration for CMYK documents. */
export function defaultCmykColorConfig(): ColorConfig {
  return {
    mode: 'cmyk',
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

/** Default color configuration based on color mode. */
export function defaultColorConfig(mode: ColorMode = 'rgb'): ColorConfig {
  if (mode === 'cmyk') return defaultCmykColorConfig();
  return defaultRgbColorConfig();
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

/** Create an RGB ManagedColor from a legacy Color tuple [r, g, b, a]. */
export function rgbFromTuple(
  rgba: readonly [number, number, number, number],
  profile?: string,
): RgbColor {
  return {
    space: 'rgb',
    r: rgba[0],
    g: rgba[1],
    b: rgba[2],
    a: rgba[3],
    profile,
  };
}

/** Convert an RgbColor to a legacy Color tuple [r, g, b, a]. */
export function rgbToTuple(c: RgbColor): [number, number, number, number] {
  return [c.r, c.g, c.b, c.a];
}

/** Convert a CmykColor to a CMYK tuple [c, m, y, k, a]. */
export function cmykToTuple(c: CmykColor): [number, number, number, number, number] {
  return [c.c, c.m, c.y, c.k, c.a];
}
