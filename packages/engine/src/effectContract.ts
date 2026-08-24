/**
 * Effect rendering contract — formal metadata for every adjustment and
 * effect in the system.
 *
 * Every effect in Varve follows this contract regardless of whether it
 * runs on CPU, GPU, or during export.  This module documents the per-effect
 * metadata and provides lookup infrastructure.
 *
 * Working color space
 * ────────────────────
 * Each effect declares its working space here rather than relying on an
 * implicit renderer default. Most effects operate in sRGB gamma-encoded space
 * (gamma ≈ 2.2); blur and bloom use linear-light stages for correct colour
 * bleeding and highlight accumulation, while palette matching may use OKLab
 * according to its explicit metric. Document/profile conversion and soft
 * proofing are separate colour-management stages, described in
 * docs/architecture/color-management.md.
 *
 * Alpha conventions
 * ─────────────────
 * Input to every effect kernel is straight (non-premultiplied) RGBA, 8-bit
 * per channel.  Kernels must preserve alpha — transparent input pixels
 * (a === 0) are skipped.  Semi-transparent pixels are transformed
 * proportionally.  Premultiplied alpha is an internal detail of specific
 * kernels (sharpen, blur) and must be undone before returning.
 *
 * Quality levels
 * ──────────────
 * Every effect defines a preview quality (interactive, ≤ viewport) and a
 * final quality (export, > viewport).  Preview may use approximations
 * (e.g., halftone Bayer ordered dither instead of Floyd-Steinberg) when
 * the difference is below documented tolerances.
 */

import type { FilterIR } from './types';

export type WorkingSpace = 'srgb-gamma' | 'linear-light' | 'oklab';

export type AlphaConvention = 'straight' | 'premultiplied-internal';

export type QualityTier = 'preview' | 'final';

export interface EffectContractEntry {
  /** Human-readable name */
  name: string;
  /** Working colour space for the pixel math */
  workingSpace: WorkingSpace;
  /** Internal alpha convention (must convert to/from straight at boundaries) */
  alphaConvention: AlphaConvention;
  /** Whether preview quality may differ from export quality */
  hasApproximatePreview: boolean;
  /** Acceptable per-pixel ΔE tolerance between preview and final */
  previewTolerance: number;
  /** Whether this effect requires rasterization for vector export */
  requiresRasterForExport: boolean;
  /** CSS filter equivalent string, or null if software-only */
  cssFilterEquivalent: string | null;
  /** GPU compute path status */
  gpuStatus: 'not-implemented' | 'implemented' | 'partial';
  /** Native (Rust) path status (absent = not implemented) */
  nativeStatus?: 'not-implemented' | 'implemented' | 'partial';
}

const EFFECT_CONTRACTS: Record<string, EffectContractEntry> = {
  brightness: {
    name: 'Brightness',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: false,
    cssFilterEquivalent: 'brightness(%)',
    gpuStatus: 'not-implemented',
  },
  contrast: {
    name: 'Contrast',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: false,
    cssFilterEquivalent: 'contrast(%)',
    gpuStatus: 'not-implemented',
  },
  saturation: {
    name: 'Saturation',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: false,
    cssFilterEquivalent: 'saturate(%)',
    gpuStatus: 'not-implemented',
  },
  hueSaturation: {
    name: 'Hue / Saturation',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  hueRotate: {
    name: 'Hue Rotate',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: false,
    cssFilterEquivalent: 'hue-rotate(deg)',
    gpuStatus: 'not-implemented',
  },
  sepia: {
    name: 'Sepia',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: false,
    cssFilterEquivalent: 'sepia(%)',
    gpuStatus: 'not-implemented',
  },
  grayscale: {
    name: 'Grayscale',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: false,
    cssFilterEquivalent: 'grayscale(%)',
    gpuStatus: 'not-implemented',
  },
  invert: {
    name: 'Invert',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: false,
    cssFilterEquivalent: 'invert(%)',
    gpuStatus: 'not-implemented',
  },
  opacity: {
    name: 'Opacity',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: false,
    cssFilterEquivalent: 'opacity(%)',
    gpuStatus: 'not-implemented',
  },
  blur: {
    name: 'Blur',
    workingSpace: 'linear-light',
    alphaConvention: 'premultiplied-internal',
    hasApproximatePreview: true,
    previewTolerance: 1,
    requiresRasterForExport: false,
    cssFilterEquivalent: 'blur(px)',
    gpuStatus: 'not-implemented',
  },
  exposure: {
    name: 'Exposure',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  sharpen: {
    name: 'Sharpen',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'premultiplied-internal',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  temperature: {
    name: 'Temperature',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  tint: {
    name: 'Tint',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  vibrance: {
    name: 'Vibrance',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: 'saturate(%)',
    gpuStatus: 'not-implemented',
  },
  levels: {
    name: 'Levels',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  curves: {
    name: 'Curves',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  selectiveColor: {
    name: 'Selective Color',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  colorBalance: {
    name: 'Color Balance',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  channelMixer: {
    name: 'Channel Mixer',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  photoFilter: {
    name: 'Photo Filter',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  halftone: {
    name: 'Halftone',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: true,
    previewTolerance: 2,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  gradientMap: {
    name: 'Gradient Map',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  tritone: {
    name: 'Tritone',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  colorHalftone: {
    name: 'Color Halftone',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: true,
    previewTolerance: 2,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  shadowHighlight: {
    name: 'Shadow / Highlight',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  duotone: {
    name: 'Duotone',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  blackAndWhite: {
    name: 'Black & White',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  posterize: {
    name: 'Posterize',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  threshold: {
    name: 'Threshold',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  lut: {
    name: 'LUT',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'not-implemented',
  },
  dither: {
    name: 'Dither',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: true,
    previewTolerance: 2,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'partial',
    nativeStatus: 'implemented',
  },
  paletteSnap: {
    name: 'Palette Snap',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'implemented',
    nativeStatus: 'implemented',
  },
  bloom: {
    name: 'Bloom',
    workingSpace: 'linear-light',
    alphaConvention: 'straight',
    hasApproximatePreview: true,
    previewTolerance: 2,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'implemented',
    nativeStatus: 'implemented',
  },
  rgbSplit: {
    name: 'RGB Split',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'premultiplied-internal',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'implemented',
    nativeStatus: 'implemented',
  },
  crt: {
    name: 'CRT',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'premultiplied-internal',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'implemented',
    nativeStatus: 'implemented',
  },
  vhs: {
    name: 'VHS',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: true,
    previewTolerance: 3,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'implemented',
    nativeStatus: 'implemented',
  },
  lightShafts: {
    name: 'Light Shafts',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: true,
    previewTolerance: 3,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'implemented',
    nativeStatus: 'implemented',
  },
  lensFlare: {
    name: 'Lens Flare',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: true,
    previewTolerance: 3,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'implemented',
    nativeStatus: 'implemented',
  },
  lightLeak: {
    name: 'Light Leak',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: false,
    previewTolerance: 0,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'implemented',
    nativeStatus: 'implemented',
  },
  caustics: {
    name: 'Caustics',
    workingSpace: 'srgb-gamma',
    alphaConvention: 'straight',
    hasApproximatePreview: true,
    previewTolerance: 3,
    requiresRasterForExport: true,
    cssFilterEquivalent: null,
    gpuStatus: 'implemented',
    nativeStatus: 'implemented',
  },
};

export function getEffectContract(kind: string): EffectContractEntry | undefined {
  const entry = EFFECT_CONTRACTS[kind];
  if (!entry) return undefined;
  return {
    ...entry,
    gpuStatus: entry.gpuStatus ?? 'not-implemented',
    nativeStatus: entry.nativeStatus ?? 'not-implemented',
  };
}

export function getEffectContracts(): Record<string, EffectContractEntry> {
  return { ...EFFECT_CONTRACTS };
}

/**
 * Whether a filter chain uses features that require working-space awareness
 * beyond plain sRGB gamma.
 */
export function requiresColorManagedPipeline(filters: FilterIR[]): boolean {
  for (const f of filters) {
    const contract = EFFECT_CONTRACTS[f.kind];
    if (contract && contract.workingSpace !== 'srgb-gamma') return true;
  }
  return false;
}

/**
 * Whether any effect in the chain uses a linear-light working space.
 */
export function anyLinearLightEffect(filters: FilterIR[]): boolean {
  for (const f of filters) {
    const contract = EFFECT_CONTRACTS[f.kind];
    if (contract?.workingSpace === 'linear-light') return true;
  }
  return false;
}
