import {
  ADJUSTMENT_LAYER_KINDS,
  EFFECT_STUDIO_KINDS,
  type EffectSurface,
  IMAGE_TUNING_KINDS,
} from './effectRegistry';
import type { Adjustment, AdjustmentKind } from './filters';

export interface SurfacePresetEffect {
  kind: AdjustmentKind;
  overrides?: Partial<Adjustment>;
}

export interface SurfacePreset {
  id: string;
  name: string;
  description: string;
  surface: Extract<EffectSurface, 'effect-studio' | 'image-tuning' | 'adjustment-layer'>;
  effects: readonly SurfacePresetEffect[];
}

/** Creative, object-local recipes for Effect Studio. */
export const EFFECT_STUDIO_PRESETS: readonly SurfacePreset[] = [
  {
    id: 'studio-chromatic-bloom',
    name: 'Chromatic Bloom',
    description: 'A luminous halo with a controlled colour fringe.',
    surface: 'effect-studio',
    effects: [
      { kind: 'bloom', overrides: { intensity: 0.38, radius: 18 } },
      { kind: 'rgbSplit', overrides: { amount: 0.16 } },
    ],
  },
  {
    id: 'studio-screen-print',
    name: 'Screen Print',
    description: 'A graphic print treatment built from colour halftone and palette reduction.',
    surface: 'effect-studio',
    effects: [
      { kind: 'colorHalftone', overrides: { intensity: 0.72 } },
      { kind: 'paletteSnap', overrides: { strength: 0.35 } },
    ],
  },
  {
    id: 'studio-analog-signal',
    name: 'Analog Signal',
    description: 'Tape colour, scanline character, and restrained signal drift.',
    surface: 'effect-studio',
    effects: [
      { kind: 'vhs', overrides: { intensity: 0.42 } },
      { kind: 'crt', overrides: { intensity: 0.28 } },
    ],
  },
  {
    id: 'studio-refracted-light',
    name: 'Refracted Light',
    description: 'A glassy caustic response with a soft atmospheric lift.',
    surface: 'effect-studio',
    effects: [
      { kind: 'caustics', overrides: { intensity: 0.3 } },
      { kind: 'lightLeak', overrides: { intensity: 0.18 } },
    ],
  },
  {
    id: 'studio-pencil-poster',
    name: 'Pencil Poster',
    description: 'A reduced, hand-made mark-making treatment for graphic objects.',
    surface: 'effect-studio',
    effects: [
      { kind: 'dither', overrides: { intensity: 0.42 } },
      { kind: 'duotone', overrides: { intensity: 0.7 } },
    ],
  },
];

/** Image-only recipes tuned for photographic correction and finishing. */
export const IMAGE_TUNING_PRESETS: readonly SurfacePreset[] = [
  {
    id: 'photo-natural-detail',
    name: 'Natural Detail',
    description: 'A restrained lift for texture and medium-scale structure.',
    surface: 'image-tuning',
    effects: [
      { kind: 'contrast', overrides: { value: 8 } },
      { kind: 'microDetail', overrides: { amount: 18 } },
      { kind: 'definition', overrides: { amount: 12 } },
    ],
  },
  {
    id: 'photo-warm-portrait',
    name: 'Warm Portrait',
    description: 'Gentle warmth, colour presence, and highlight diffusion.',
    surface: 'image-tuning',
    effects: [
      { kind: 'temperature', overrides: { value: 12 } },
      { kind: 'tint', overrides: { value: 3 } },
      { kind: 'vibrance', overrides: { value: 10 } },
      { kind: 'softBloom', overrides: { strength: 18, radius: 14 } },
    ],
  },
  {
    id: 'photo-matte-film',
    name: 'Matte Film',
    description: 'Lower contrast, edge falloff, and fine grain for a quiet finish.',
    surface: 'image-tuning',
    effects: [
      { kind: 'contrast', overrides: { value: -10 } },
      { kind: 'edgeFalloff', overrides: { strength: -24 } },
      { kind: 'grain', overrides: { strength: 22, character: 58 } },
    ],
  },
  {
    id: 'photo-atmospheric-depth',
    name: 'Atmospheric Depth',
    description: 'Broad depth recovery with protected highlights and subtle dehaze.',
    surface: 'image-tuning',
    effects: [
      { kind: 'atmosphere', overrides: { amount: 24, protectHighlights: 0.7 } },
      { kind: 'dehaze', overrides: { amount: 12, protectHighlights: 0.65 } },
    ],
  },
];

/** Backdrop-scoped tonal and colour correction recipes for Adjustment Layers. */
export const ADJUSTMENT_LAYER_PRESETS: readonly SurfacePreset[] = [
  {
    id: 'correction-balanced',
    name: 'Balanced Correction',
    description: 'A safe starting point for exposure, contrast, and tonal recovery.',
    surface: 'adjustment-layer',
    effects: [
      { kind: 'exposure', overrides: { value: 0.25 } },
      { kind: 'contrast', overrides: { value: 8 } },
      { kind: 'shadowHighlight', overrides: { shadows: 18, highlights: 12 } },
    ],
  },
  {
    id: 'correction-cool-editorial',
    name: 'Cool Editorial',
    description: 'Cool the colour cast while retaining a clean tonal separation.',
    surface: 'adjustment-layer',
    effects: [
      { kind: 'temperature', overrides: { value: -12 } },
      { kind: 'tint', overrides: { value: 2 } },
      { kind: 'contrast', overrides: { value: 14 } },
    ],
  },
  {
    id: 'correction-monochrome',
    name: 'Monochrome Print',
    description: 'A scoped black-and-white conversion with a little tonal lift.',
    surface: 'adjustment-layer',
    effects: [{ kind: 'blackAndWhite' }, { kind: 'contrast', overrides: { value: 12 } }],
  },
  {
    id: 'correction-colour-grade',
    name: 'Colour Grade',
    description: 'A restrained gradient-map grade for a consistent backdrop mood.',
    surface: 'adjustment-layer',
    effects: [{ kind: 'gradientMap', overrides: { intensity: 0.28 } }],
  },
];

export const SURFACE_PRESETS = Object.freeze({
  'effect-studio': EFFECT_STUDIO_PRESETS,
  'image-tuning': IMAGE_TUNING_PRESETS,
  'adjustment-layer': ADJUSTMENT_LAYER_PRESETS,
});

export function surfacePresetKinds(presets: readonly SurfacePreset[]): AdjustmentKind[] {
  return [...new Set(presets.flatMap((preset) => preset.effects.map((effect) => effect.kind)))];
}

export const SURFACE_PRESET_KIND_SETS = Object.freeze({
  'effect-studio': EFFECT_STUDIO_KINDS,
  'image-tuning': IMAGE_TUNING_KINDS,
  'adjustment-layer': ADJUSTMENT_LAYER_KINDS,
});
