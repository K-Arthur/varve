/**
 * Vectorization settings, presets, and validation for the logo workflow.
 *
 * The settings shape is serializable (no functions, no DOM types) so it can
 * be persisted to editor settings and passed across worker boundaries. The
 * actual trace execution reuses the engine's existing provider chain
 * (`@varve/engine` dispatchTrace): worker → direct → wasm → native.
 */

import type { RasterTraceOptions } from '@varve/engine';

/** Source-preparation stage applied before tracing (never mutates the source asset). */
export interface SourcePrepSettings {
  /** Convert to grayscale (luma). */
  grayscale: boolean;
  /** Invert luminance. */
  invert: boolean;
  /** Contrast factor (0.5 = low, 1 = none, 1.5 = high). */
  contrast: number;
  /** Brightness delta in [-100, 100]. */
  brightness: number;
  /** Box-blur radius used for denoise (0 = off, max 2). */
  denoise: number;
  /** Apply a binary threshold to the prepared pixels before tracing. */
  threshold: boolean;
  /** Ignore transparent pixels when classifying foreground. */
  ignoreTransparent: boolean;
}

export interface VectorizationSettings {
  /** Preset id this settings snapshot came from; null when hand-edited. */
  presetId: string | null;
  mode: 'monochrome' | 'grayscale' | 'color' | 'pixel-art';
  traceMode: 'silhouette' | 'centerline';
  threshold: number;
  minArea: number;
  simplifyTolerance: number;
  maxPaths: number;
  maxColors: number;
  compoundHoles: boolean;
  cornerAngle: number;
  /** Maximum Bezier fitting error in pixels (0.1–10). Controls curve fidelity. */
  maxError: number;
  foreground: 'dark' | 'light';
  alphaThreshold: number;
  centerlineWidth: number;
  centerlinePrune: number;
  prep: SourcePrepSettings;
}

export interface VectorizationPreset {
  id: string;
  label: string;
  description: string;
  settings: Omit<VectorizationSettings, 'presetId'>;
}

export const DEFAULT_VECTORIZATION_SETTINGS: VectorizationSettings = {
  presetId: 'crisp-black-logo',
  mode: 'monochrome',
  traceMode: 'silhouette',
  threshold: 128,
  minArea: 4,
  simplifyTolerance: 0.75,
  maxPaths: 1000,
  maxColors: 8,
  compoundHoles: true,
  cornerAngle: 135,
  maxError: 1.0,
  foreground: 'dark',
  alphaThreshold: 1,
  centerlineWidth: 2,
  centerlinePrune: 4,
  prep: {
    grayscale: false,
    invert: false,
    contrast: 1,
    brightness: 0,
    denoise: 0,
    threshold: false,
    ignoreTransparent: true,
  },
};

export const VECTORIZATION_PRESETS: readonly VectorizationPreset[] = [
  {
    id: 'crisp-black-logo',
    label: 'Crisp black logo',
    description: 'Binary trace of dark ink on light background; small regions dropped.',
    settings: {
      mode: 'monochrome',
      traceMode: 'silhouette',
      threshold: 128,
      minArea: 4,
      simplifyTolerance: 0.75,
      maxPaths: 1000,
      maxColors: 8,
      compoundHoles: true,
      cornerAngle: 135,
      maxError: 1.0,
      foreground: 'dark',
      alphaThreshold: 1,
      centerlineWidth: 2,
      centerlinePrune: 4,
      prep: {
        grayscale: false,
        invert: false,
        contrast: 1,
        brightness: 0,
        denoise: 0,
        threshold: false,
        ignoreTransparent: true,
      },
    },
  },
  {
    id: 'hand-drawn-sketch',
    label: 'Hand-drawn sketch',
    description: 'Higher threshold and simplification to tame pencil noise into clean marks.',
    settings: {
      mode: 'monochrome',
      traceMode: 'silhouette',
      threshold: 160,
      minArea: 8,
      simplifyTolerance: 1.25,
      maxPaths: 800,
      maxColors: 8,
      compoundHoles: true,
      cornerAngle: 120,
      maxError: 1.0,
      foreground: 'dark',
      alphaThreshold: 4,
      centerlineWidth: 2,
      centerlinePrune: 4,
      prep: {
        grayscale: true,
        invert: false,
        contrast: 1.1,
        brightness: 0,
        denoise: 1,
        threshold: false,
        ignoreTransparent: true,
      },
    },
  },
  {
    id: 'geometric-mark',
    label: 'Geometric mark',
    description: 'Low tolerance binary trace that keeps corners crisp for badge construction.',
    settings: {
      mode: 'monochrome',
      traceMode: 'silhouette',
      threshold: 120,
      minArea: 4,
      simplifyTolerance: 0.35,
      maxPaths: 1000,
      maxColors: 8,
      compoundHoles: true,
      cornerAngle: 160,
      maxError: 1.0,
      foreground: 'dark',
      alphaThreshold: 1,
      centerlineWidth: 2,
      centerlinePrune: 4,
      prep: {
        grayscale: false,
        invert: false,
        contrast: 1,
        brightness: 0,
        denoise: 0,
        threshold: false,
        ignoreTransparent: true,
      },
    },
  },
  {
    id: 'flat-multicolor',
    label: 'Flat multi-color',
    description: 'Median-cut palette trace preserving solid brand colors as separate fills.',
    settings: {
      mode: 'color',
      traceMode: 'silhouette',
      threshold: 128,
      minArea: 4,
      simplifyTolerance: 0.75,
      maxPaths: 1000,
      maxColors: 8,
      compoundHoles: true,
      cornerAngle: 135,
      maxError: 1.0,
      foreground: 'dark',
      alphaThreshold: 1,
      centerlineWidth: 2,
      centerlinePrune: 4,
      prep: {
        grayscale: false,
        invert: false,
        contrast: 1.05,
        brightness: 0,
        denoise: 0,
        threshold: false,
        ignoreTransparent: true,
      },
    },
  },
  {
    id: 'fine-line-art',
    label: 'Fine line art',
    description: 'Keep the smallest contours; gentle simplification preserves hairline detail.',
    settings: {
      mode: 'monochrome',
      traceMode: 'silhouette',
      threshold: 140,
      minArea: 1,
      simplifyTolerance: 0.4,
      maxPaths: 2000,
      maxColors: 8,
      compoundHoles: true,
      cornerAngle: 140,
      maxError: 0.8,
      foreground: 'dark',
      alphaThreshold: 1,
      centerlineWidth: 1,
      centerlinePrune: 2,
      prep: {
        grayscale: true,
        invert: false,
        contrast: 1,
        brightness: 0,
        denoise: 0,
        threshold: false,
        ignoreTransparent: true,
      },
    },
  },
  {
    id: 'organic-illustration',
    label: 'Organic illustration',
    description: 'Loose tolerance and more colors preserve soft painted shapes.',
    settings: {
      mode: 'color',
      traceMode: 'silhouette',
      threshold: 128,
      minArea: 6,
      simplifyTolerance: 1.5,
      maxPaths: 1200,
      maxColors: 12,
      compoundHoles: true,
      cornerAngle: 110,
      maxError: 1.5,
      foreground: 'dark',
      alphaThreshold: 2,
      centerlineWidth: 2,
      centerlinePrune: 4,
      prep: {
        grayscale: false,
        invert: false,
        contrast: 1.05,
        brightness: 0,
        denoise: 1,
        threshold: false,
        ignoreTransparent: true,
      },
    },
  },
  {
    id: 'low-res-source',
    label: 'Low-resolution source',
    description: 'Denoise and a higher threshold clean up pixel soup from small scans.',
    settings: {
      mode: 'monochrome',
      traceMode: 'silhouette',
      threshold: 150,
      minArea: 3,
      simplifyTolerance: 1.0,
      maxPaths: 1000,
      maxColors: 8,
      compoundHoles: true,
      cornerAngle: 130,
      maxError: 1.0,
      foreground: 'dark',
      alphaThreshold: 2,
      centerlineWidth: 2,
      centerlinePrune: 4,
      prep: {
        grayscale: true,
        invert: false,
        contrast: 1.15,
        brightness: 5,
        denoise: 2,
        threshold: false,
        ignoreTransparent: true,
      },
    },
  },
  {
    id: 'small-icon',
    label: 'Small icon',
    description: 'Aggressive simplification and hole merging for 16-64px legibility.',
    settings: {
      mode: 'monochrome',
      traceMode: 'silhouette',
      threshold: 128,
      minArea: 8,
      simplifyTolerance: 1.75,
      maxPaths: 300,
      maxColors: 8,
      compoundHoles: true,
      cornerAngle: 150,
      maxError: 1.5,
      foreground: 'dark',
      alphaThreshold: 1,
      centerlineWidth: 2,
      centerlinePrune: 4,
      prep: {
        grayscale: false,
        invert: false,
        contrast: 1.05,
        brightness: 0,
        denoise: 1,
        threshold: false,
        ignoreTransparent: true,
      },
    },
  },
  {
    id: 'pixel-art-sprite',
    label: 'Pixel art sprite',
    description: 'Hard pixel boundaries preserved; same-color regions merge into single polygons.',
    settings: {
      mode: 'pixel-art',
      traceMode: 'silhouette',
      threshold: 128,
      minArea: 1,
      simplifyTolerance: 0,
      maxPaths: 1000,
      maxColors: 16,
      compoundHoles: true,
      cornerAngle: 135,
      maxError: 1.0,
      foreground: 'dark',
      alphaThreshold: 1,
      centerlineWidth: 2,
      centerlinePrune: 4,
      prep: {
        grayscale: false,
        invert: false,
        contrast: 1,
        brightness: 0,
        denoise: 0,
        threshold: false,
        ignoreTransparent: true,
      },
    },
  },
];

export function getVectorizationPreset(id: string | null): VectorizationPreset | null {
  if (!id) return null;
  return VECTORIZATION_PRESETS.find((p) => p.id === id) ?? null;
}

export interface VectorizationValidation {
  ok: boolean;
  warnings: string[];
}

/** Clamp + validate settings; returns warnings for out-of-range values. */
export function validateVectorizationSettings(s: VectorizationSettings): VectorizationValidation {
  const warnings: string[] = [];
  if (s.threshold < 1 || s.threshold > 254) warnings.push('Threshold must be 1-254.');
  if (s.minArea < 0) warnings.push('Minimum region area cannot be negative.');
  if (s.simplifyTolerance < 0 || s.simplifyTolerance > 10)
    warnings.push('Simplification tolerance must be 0-10.');
  if (s.maxPaths < 1 || s.maxPaths > 20000) warnings.push('Max paths must be 1-20000.');
  if (s.maxColors < 2 || s.maxColors > 32) warnings.push('Color count must be 2-32.');
  if (s.cornerAngle < 90 || s.cornerAngle > 180) warnings.push('Corner angle must be 90-180.');
  if (s.maxError < 0.1 || s.maxError > 10) warnings.push('Curve tolerance must be 0.1-10.');
  if (s.prep.contrast < 0.2 || s.prep.contrast > 3) warnings.push('Contrast must be 0.2-3.');
  if (s.prep.brightness < -100 || s.prep.brightness > 100)
    warnings.push('Brightness must be -100 to 100.');
  if (s.prep.denoise < 0 || s.prep.denoise > 2) warnings.push('Denoise radius must be 0-2.');
  return { ok: warnings.length === 0, warnings };
}

/** Map logo-workflow settings onto the engine trace options. */
export function toTraceOptions(s: VectorizationSettings): RasterTraceOptions {
  return {
    mode: s.mode,
    traceMode: s.traceMode,
    threshold: s.threshold,
    foreground: s.foreground,
    alphaThreshold: s.alphaThreshold,
    minArea: s.minArea,
    simplifyTolerance: s.simplifyTolerance,
    maxPaths: s.maxPaths,
    maxColors: s.maxColors,
    compoundHoles: s.compoundHoles,
    cornerAngle: s.cornerAngle,
    maxError: s.maxError,
    centerlineWidth: s.centerlineWidth,
    centerlinePrune: s.centerlinePrune,
  };
}

/** Settings hash used for stale-result correlation. */
export function hashVectorizationSettings(s: VectorizationSettings): string {
  const flat = JSON.stringify(s);
  let hash = 0;
  for (let i = 0; i < flat.length; i += 1) {
    hash = (hash * 31 + flat.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/** Apply a preset onto the editable settings (keeps presetId for display). */
export function applyPreset(
  _current: VectorizationSettings,
  preset: VectorizationPreset,
): VectorizationSettings {
  return { ...preset.settings, presetId: preset.id };
}
