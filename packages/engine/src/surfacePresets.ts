import {
  ADJUSTMENT_LAYER_KINDS,
  EFFECT_STUDIO_KINDS,
  type EffectStudioCategoryId,
  type EffectSurface,
  IMAGE_TUNING_KINDS,
} from './effectRegistry';
import type { Adjustment, AdjustmentKind } from './filters';
import type { Color } from './types';

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

/** Visual thumbnail vocabulary consumed by the Effect Studio gallery. */
export const STUDIO_TREATMENT_ARTS = [
  'cutout',
  'wash',
  'ink',
  'screen',
  'hatch',
  'spray',
  'glass',
  'ripple',
  'prism',
  'signal',
  'relief',
  'chalk',
  'graphite',
  'stamp',
  'glow',
  'shafts',
  'phosphor',
  'leak',
  'newsprint',
  'riso',
  'paper',
  'tape',
  'reticulation',
] as const;

export type StudioTreatmentArt = (typeof STUDIO_TREATMENT_ARTS)[number];

/** A small, intent-level control exposed by a curated Studio treatment. */
export interface StudioTreatmentControl {
  id: string;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: '%' | 'steps' | 'px';
  targets: readonly StudioTreatmentControlTarget[];
}

/** One numeric treatment control can drive one or more underlying filter fields. */
export interface StudioTreatmentControlTarget {
  effectIndex: number;
  parameter: string;
  outputMin: number;
  outputMax: number;
  round?: boolean;
}

export type StudioTreatmentControlValues = Readonly<Record<string, number>>;

/**
 * A named, outcome-oriented recipe rather than an individual filter control.
 *
 * Treatments may compose shared adjustment primitives that are not themselves
 * shown in the Studio's primitive library. This preserves the product boundary:
 * Studio is for discovering a visual language, while Object Filters owns the
 * individual controls and Image Tuning / Adjustment Filters retain their own
 * correction workflows.
 */
export interface StudioTreatment extends SurfacePreset {
  surface: 'effect-studio';
  categoryId: EffectStudioCategoryId;
  tags: readonly string[];
  art: StudioTreatmentArt;
  featured?: boolean;
  /**
   * Author-defined macro controls for this treatment. When omitted, the
   * Studio derives up to two safe controls from its constituent primitives.
   */
  controls?: readonly StudioTreatmentControl[];
}

type StudioEffectOverrides<K extends AdjustmentKind> = Partial<
  Omit<Extract<Adjustment, { kind: K }>, 'id' | 'kind'>
>;

function studioEffect<K extends AdjustmentKind>(
  kind: K,
  overrides?: StudioEffectOverrides<K>,
): SurfacePresetEffect {
  return overrides ? { kind, overrides } : { kind };
}

function rgb(red: number, green: number, blue: number): [number, number, number] {
  return [red, green, blue];
}

function rgba(red: number, green: number, blue: number, alpha = 255): Color {
  return [red, green, blue, alpha];
}

interface AutoTreatmentControl {
  id: string;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: StudioTreatmentControl['unit'];
  targets: readonly Omit<StudioTreatmentControlTarget, 'effectIndex'>[];
}

/**
 * Intent-level controls for common recipe primitives. They deliberately stop
 * before exposing every implementation parameter: the full Object Filters
 * editor remains the advanced escape hatch.
 */
const AUTO_TREATMENT_CONTROLS: Partial<Record<AdjustmentKind, readonly AutoTreatmentControl[]>> = {
  posterize: [
    {
      id: 'tone-steps',
      label: 'Tone steps',
      description: 'Choose how many tonal bands the graphic treatment keeps.',
      min: 2,
      max: 12,
      step: 1,
      defaultValue: 4,
      unit: 'steps',
      targets: [{ parameter: 'levels', outputMin: 2, outputMax: 12, round: true }],
    },
  ],
  paletteSnap: [
    {
      id: 'palette-strength',
      label: 'Palette strength',
      description: 'Control how firmly colours resolve to the treatment palette.',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 90,
      unit: '%',
      targets: [{ parameter: 'amount', outputMin: 0, outputMax: 1 }],
    },
  ],
  dither: [
    {
      id: 'mark-density',
      label: 'Mark density',
      description: 'Make dithered marks coarser or more tightly packed.',
      min: 1,
      max: 100,
      step: 1,
      defaultValue: 60,
      unit: '%',
      targets: [{ parameter: 'cellSize', outputMin: 8, outputMax: 1, round: true }],
    },
    {
      id: 'tone-steps',
      label: 'Tone steps',
      description: 'Set the number of tone bands used to build the marks.',
      min: 2,
      max: 8,
      step: 1,
      defaultValue: 4,
      unit: 'steps',
      targets: [{ parameter: 'levels', outputMin: 2, outputMax: 8, round: true }],
    },
  ],
  grain: [
    {
      id: 'material-grain',
      label: 'Material grain',
      description: 'Increase or soften the material character over the result.',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 40,
      unit: '%',
      targets: [{ parameter: 'strength', outputMin: 0, outputMax: 40 }],
    },
  ],
  halftone: [
    {
      id: 'screen-density',
      label: 'Screen density',
      description: 'Control how tightly the print screen is packed.',
      min: 4,
      max: 80,
      step: 1,
      defaultValue: 20,
      targets: [{ parameter: 'frequency', outputMin: 4, outputMax: 80 }],
    },
    {
      id: 'ink-strength',
      label: 'Ink strength',
      description: 'Control the visual weight of the screened marks.',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 75,
      unit: '%',
      targets: [{ parameter: 'intensity', outputMin: 0, outputMax: 1 }],
    },
  ],
  colorHalftone: [
    {
      id: 'dot-scale',
      label: 'Dot scale',
      description: 'Set the size of the colour-print dots.',
      min: 4,
      max: 28,
      step: 1,
      defaultValue: 12,
      unit: 'px',
      targets: [{ parameter: 'screenSize', outputMin: 4, outputMax: 28 }],
    },
    {
      id: 'ink-strength',
      label: 'Ink strength',
      description: 'Control the weight of the printed colour screen.',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 72,
      unit: '%',
      targets: [{ parameter: 'intensity', outputMin: 0, outputMax: 1 }],
    },
  ],
  tritone: [
    {
      id: 'colour-strength',
      label: 'Colour strength',
      description: 'Blend the three-tone colour interpretation with the source.',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 80,
      unit: '%',
      targets: [{ parameter: 'intensity', outputMin: 0, outputMax: 1 }],
    },
  ],
  duotone: [
    {
      id: 'ink-strength',
      label: 'Ink strength',
      description: 'Blend the two-tone ink interpretation with the source.',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 90,
      unit: '%',
      targets: [{ parameter: 'intensity', outputMin: 0, outputMax: 1 }],
    },
  ],
  bloom: [
    {
      id: 'glow-strength',
      label: 'Glow strength',
      description: 'Control how strongly bright areas bloom.',
      min: 0,
      max: 200,
      step: 1,
      defaultValue: 100,
      unit: '%',
      targets: [{ parameter: 'intensity', outputMin: 0, outputMax: 2 }],
    },
    {
      id: 'glow-spread',
      label: 'Glow spread',
      description: 'Set how far the highlight glow extends.',
      min: 0,
      max: 96,
      step: 1,
      defaultValue: 24,
      unit: 'px',
      targets: [{ parameter: 'radius', outputMin: 0, outputMax: 96 }],
    },
  ],
  softBloom: [
    {
      id: 'glow-strength',
      label: 'Glow strength',
      description: 'Control the softness of highlight diffusion.',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 25,
      unit: '%',
      targets: [{ parameter: 'strength', outputMin: 0, outputMax: 100 }],
    },
    {
      id: 'glow-spread',
      label: 'Glow spread',
      description: 'Set how far the soft bloom extends.',
      min: 0,
      max: 96,
      step: 1,
      defaultValue: 18,
      unit: 'px',
      targets: [{ parameter: 'radius', outputMin: 0, outputMax: 96 }],
    },
  ],
  rgbSplit: [
    {
      id: 'channel-shift',
      label: 'Channel shift',
      description: 'Separate colour channels more or less strongly.',
      min: 0,
      max: 24,
      step: 1,
      defaultValue: 4,
      unit: 'px',
      targets: [{ parameter: 'amount', outputMin: 0, outputMax: 24 }],
    },
    {
      id: 'shift-strength',
      label: 'Shift strength',
      description: 'Blend the split-channel treatment with the source.',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 100,
      unit: '%',
      targets: [{ parameter: 'intensity', outputMin: 0, outputMax: 1 }],
    },
  ],
};

function clampControlValue(value: number, control: StudioTreatmentControl): number {
  return Math.min(control.max, Math.max(control.min, value));
}

function mapControlValue(
  value: number,
  control: StudioTreatmentControl,
  target: StudioTreatmentControlTarget,
): number {
  const span = control.max - control.min;
  const amount = span === 0 ? 0 : (clampControlValue(value, control) - control.min) / span;
  const mapped = target.outputMin + (target.outputMax - target.outputMin) * amount;
  return target.round ? Math.round(mapped) : mapped;
}

function mapTargetToControlValue(
  value: number,
  control: Pick<StudioTreatmentControl, 'min' | 'max'>,
  target: Omit<StudioTreatmentControlTarget, 'effectIndex'>,
): number {
  const span = target.outputMax - target.outputMin;
  const amount = span === 0 ? 0 : (value - target.outputMin) / span;
  return Math.min(
    control.max,
    Math.max(control.min, control.min + (control.max - control.min) * amount),
  );
}

function numericOverride(effect: SurfacePresetEffect, parameter: string): number | undefined {
  const value = (effect.overrides as Record<string, unknown> | undefined)?.[parameter];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function defaultAmountControl(treatment: StudioTreatment): StudioTreatmentControl {
  return {
    id: 'amount',
    label: 'Amount',
    description: 'Blend the whole treatment stack with the unfiltered object result.',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 100,
    unit: '%',
    targets: treatment.effects.map((_, effectIndex) => ({
      effectIndex,
      parameter: 'opacity',
      outputMin: 0,
      outputMax: 1,
    })),
  };
}

function derivedControls(treatment: StudioTreatment): StudioTreatmentControl[] {
  const controls: StudioTreatmentControl[] = [];
  for (const [effectIndex, effect] of treatment.effects.entries()) {
    const templates = AUTO_TREATMENT_CONTROLS[effect.kind] ?? [];
    for (const template of templates) {
      if (controls.length >= 2) return controls;
      const firstTarget = template.targets[0];
      const initialTargetValue = firstTarget
        ? numericOverride(effect, firstTarget.parameter)
        : undefined;
      const base = {
        min: template.min,
        max: template.max,
      };
      const derivedDefault =
        initialTargetValue === undefined || !firstTarget
          ? template.defaultValue
          : mapTargetToControlValue(initialTargetValue, base, firstTarget);
      controls.push({
        ...template,
        id: `${effect.kind}-${effectIndex}-${template.id}`,
        defaultValue: template.step >= 1 ? Math.round(derivedDefault) : derivedDefault,
        targets: template.targets.map((target) => ({ ...target, effectIndex })),
      });
    }
  }
  return controls;
}

/** Return the compact, treatment-appropriate controls shown in Effect Studio. */
export function studioTreatmentControls(treatment: StudioTreatment): StudioTreatmentControl[] {
  return [defaultAmountControl(treatment), ...(treatment.controls ?? derivedControls(treatment))];
}

/** Return a complete set of default values for the Studio's treatment controls. */
export function defaultStudioTreatmentControlValues(
  treatment: StudioTreatment,
): Record<string, number> {
  return Object.fromEntries(
    studioTreatmentControls(treatment).map((control) => [control.id, control.defaultValue]),
  );
}

/**
 * Resolve intent-level control values into an ordinary ordered recipe.
 *
 * The output remains a standard Adjustment recipe. This lets the Studio own
 * simple named controls while the renderer, undo, export, and Object Filters
 * continue to use exactly one stack representation.
 */
export function resolveStudioTreatmentEffects(
  treatment: StudioTreatment,
  values: StudioTreatmentControlValues = {},
): SurfacePresetEffect[] {
  const effects = treatment.effects.map((effect) => ({
    ...effect,
    overrides: effect.overrides ? { ...effect.overrides } : undefined,
  }));
  for (const control of studioTreatmentControls(treatment)) {
    const raw = values[control.id];
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : control.defaultValue;
    for (const target of control.targets) {
      const effect = effects[target.effectIndex];
      if (!effect) continue;
      effect.overrides = {
        ...effect.overrides,
        [target.parameter]: mapControlValue(value, control, target),
      } as Partial<Adjustment>;
    }
  }
  return effects;
}

/**
 * Creative, object-local treatment recipes for Effect Studio.
 *
 * Each result is an editable ordered stack. The gallery deliberately carries
 * more outcome names than low-level primitives so a designer can start from a
 * recognizable intent without turning every other effect surface into the
 * same long menu.
 */
export const EFFECT_STUDIO_TREATMENTS: readonly StudioTreatment[] = [
  {
    id: 'studio-palette-cut',
    name: 'Palette Cut',
    description: 'Flatten broad tone into a restrained, poster-like colour composition.',
    surface: 'effect-studio',
    categoryId: 'artistic',
    tags: ['cutout', 'poster', 'flat colour', 'illustration'],
    art: 'cutout',
    featured: true,
    effects: [
      studioEffect('posterize', { levels: 4 }),
      studioEffect('paletteSnap', {
        colors: [
          rgb(21, 28, 47),
          rgb(67, 94, 118),
          rgb(198, 132, 86),
          rgb(241, 207, 156),
          rgb(252, 242, 214),
        ],
        amount: 0.9,
        dither: true,
        ditherAlgorithm: 'atkinson',
        ditherStrength: 0.35,
        seed: 11,
      }),
    ],
  },
  {
    id: 'studio-pigment-wash',
    name: 'Pigment Wash',
    description: 'Layer soft painted colour with a gentle, blooming paper response.',
    surface: 'effect-studio',
    categoryId: 'artistic',
    tags: ['watercolour', 'paint', 'soft', 'pigment'],
    art: 'wash',
    effects: [
      studioEffect('tritone', {
        shadowColor: rgba(34, 57, 101),
        midtoneColor: rgba(150, 176, 188),
        highlightColor: rgba(247, 232, 207),
        shadowPoint: 0.3,
        highlightPoint: 0.72,
        intensity: 0.78,
      }),
      studioEffect('softBloom', { strength: 13, radius: 18, threshold: 0.52, softness: 0.58 }),
      studioEffect('grain', { strength: 8, scale: 1.15, character: 42, seed: 17 }),
    ],
  },
  {
    id: 'studio-inked-paper',
    name: 'Inked Paper',
    description: 'Set dark ink against warm stock with a quiet material tooth.',
    surface: 'effect-studio',
    categoryId: 'artistic',
    tags: ['ink', 'paper', 'duotone', 'editorial'],
    art: 'ink',
    effects: [
      studioEffect('duotone', {
        shadowColor: rgba(35, 31, 34),
        highlightColor: rgba(241, 226, 192),
        shadowPoint: 0.28,
        highlightPoint: 0.76,
        intensity: 0.92,
      }),
      studioEffect('grain', { strength: 15, scale: 1.05, character: 58, seed: 23 }),
    ],
  },
  {
    id: 'studio-screen-print',
    name: 'Screen Print',
    description: 'Build bold colour dots and controlled palette reduction for graphic print.',
    surface: 'effect-studio',
    categoryId: 'artistic',
    tags: ['print', 'halftone', 'poster', 'colour dots'],
    art: 'screen',
    effects: [
      studioEffect('colorHalftone', {
        screenSize: 10,
        angle: 15,
        dotShape: 'round',
        mode: 'cmyk',
        intensity: 0.72,
      }),
      studioEffect('paletteSnap', {
        amount: 0.4,
        dither: true,
        ditherAlgorithm: 'floyd-steinberg',
        ditherStrength: 0.3,
        seed: 31,
      }),
    ],
  },
  {
    id: 'studio-dry-ink',
    name: 'Dry Ink',
    description: 'Break tone into dry, granular ink marks with visible paper underneath.',
    surface: 'effect-studio',
    categoryId: 'brush-ink',
    tags: ['ink', 'brush', 'dry media', 'drawn'],
    art: 'ink',
    featured: true,
    effects: [
      studioEffect('blackAndWhite', { brightness: 4, preserveLuminosity: false }),
      studioEffect('dither', {
        algorithm: 'bayer',
        paletteMode: 'levels',
        levels: 3,
        serpentine: false,
        strength: 0.7,
        bayerSize: 8,
        cellSize: 2,
        seed: 7,
      }),
      studioEffect('grain', { strength: 18, scale: 1.2, character: 72, seed: 7 }),
    ],
  },
  {
    id: 'studio-crosshatch',
    name: 'Crosshatch',
    description: 'Turn light and shadow into angled ink lines with a printed-paper ground.',
    surface: 'effect-studio',
    categoryId: 'brush-ink',
    tags: ['hatching', 'ink', 'linework', 'sketch'],
    art: 'hatch',
    effects: [
      studioEffect('blackAndWhite', { brightness: 2, preserveLuminosity: false }),
      studioEffect('halftone', {
        pattern: 'cross',
        frequency: 20,
        angle: -35,
        dotShape: 'line',
        channel: 'k',
        method: 'am',
        intensity: 0.74,
        softness: 0.12,
        foregroundColor: rgb(35, 40, 47),
        backgroundColor: rgb(242, 237, 222),
      }),
    ],
  },
  {
    id: 'studio-ink-wash',
    name: 'Ink Wash',
    description: 'Pool blue-black ink into soft midtones and a lightly textured wash.',
    surface: 'effect-studio',
    categoryId: 'brush-ink',
    tags: ['ink wash', 'brush', 'paint', 'soft'],
    art: 'wash',
    effects: [
      studioEffect('tritone', {
        shadowColor: rgba(19, 32, 57),
        midtoneColor: rgba(112, 137, 154),
        highlightColor: rgba(232, 226, 209),
        shadowPoint: 0.3,
        highlightPoint: 0.7,
        intensity: 0.84,
      }),
      studioEffect('softBloom', { strength: 9, radius: 22, threshold: 0.5, softness: 0.64 }),
      studioEffect('grain', { strength: 11, scale: 1.3, character: 46, seed: 27 }),
    ],
  },
  {
    id: 'studio-sprayed-stroke',
    name: 'Sprayed Stroke',
    description: 'Make a limited palette feel atomized and loosely sprayed across the surface.',
    surface: 'effect-studio',
    categoryId: 'brush-ink',
    tags: ['spray', 'stipple', 'paint', 'marks'],
    art: 'spray',
    effects: [
      studioEffect('paletteSnap', {
        colors: [rgb(29, 42, 67), rgb(89, 119, 136), rgb(222, 158, 99), rgb(244, 223, 181)],
        amount: 0.68,
        dither: true,
        ditherAlgorithm: 'blue-noise',
        ditherStrength: 0.8,
        seed: 19,
      }),
      studioEffect('dither', {
        algorithm: 'blue-noise',
        paletteMode: 'levels',
        levels: 4,
        serpentine: false,
        strength: 0.52,
        bayerSize: 8,
        cellSize: 2,
        seed: 19,
      }),
    ],
  },
  {
    id: 'studio-glass-shift',
    name: 'Glass Shift',
    description: 'Refract the object through shallow glass with a controlled chromatic edge.',
    surface: 'effect-studio',
    categoryId: 'distort',
    tags: ['glass', 'refraction', 'chromatic', 'distortion'],
    art: 'glass',
    featured: true,
    effects: [
      studioEffect('caustics', {
        scale: 34,
        depth: 0.36,
        waveCount: 4,
        complexity: 0.26,
        refractionAmount: 0.28,
        sharpness: 0.58,
        dispersion: 0.08,
        distortionAmount: 0.52,
        output: 'combined',
        seed: 13,
      }),
      studioEffect('rgbSplit', {
        mode: 'radial',
        amount: 2.2,
        centerX: 0.5,
        centerY: 0.5,
        falloff: 1.35,
        intensity: 0.48,
      }),
    ],
  },
  {
    id: 'studio-ocean-ripple',
    name: 'Ocean Ripple',
    description: 'Pass moving water-like refraction through the image with a cool edge of light.',
    surface: 'effect-studio',
    categoryId: 'distort',
    tags: ['water', 'ripple', 'wave', 'refraction'],
    art: 'ripple',
    effects: [
      studioEffect('caustics', {
        scale: 42,
        depth: 0.64,
        waveCount: 6,
        complexity: 0.42,
        refractionAmount: 0.5,
        sharpness: 0.62,
        brightness: 1.16,
        contrast: 1.22,
        dispersion: 0.18,
        distortionAmount: 0.92,
        output: 'combined',
        waterTint: rgb(31, 91, 151),
        seed: 8,
      }),
      studioEffect('lightLeak', {
        x: 0.82,
        y: 0.55,
        angle: -22,
        size: 0.72,
        softness: 0.72,
        hue: 196,
        saturation: 0.68,
        lightness: 0.58,
        intensity: 0.16,
        seed: 9,
      }),
    ],
  },
  {
    id: 'studio-refracted-light',
    name: 'Refracted Light',
    description: 'Cast luminous caustics through the surface and soften their atmospheric lift.',
    surface: 'effect-studio',
    categoryId: 'distort',
    tags: ['caustics', 'light', 'glass', 'refraction'],
    art: 'glass',
    effects: [
      studioEffect('caustics', {
        scale: 26,
        depth: 0.46,
        waveCount: 4,
        complexity: 0.28,
        refractionAmount: 0.36,
        sharpness: 0.55,
        brightness: 1.18,
        contrast: 1.1,
        dispersion: 0.12,
        distortionAmount: 0.64,
        output: 'lighting',
        waterTint: rgb(193, 228, 255),
        seed: 15,
      }),
      studioEffect('lightLeak', {
        x: 0.15,
        y: 0.4,
        angle: 20,
        size: 0.84,
        softness: 0.7,
        hue: 42,
        saturation: 0.62,
        lightness: 0.64,
        intensity: 0.2,
        seed: 4,
      }),
    ],
  },
  {
    id: 'studio-prism-flare',
    name: 'Prism Flare',
    description: 'Scatter a controlled lens source into a radial colour fringe.',
    surface: 'effect-studio',
    categoryId: 'distort',
    tags: ['prism', 'flare', 'lens', 'chromatic'],
    art: 'prism',
    effects: [
      studioEffect('lensFlare', {
        sourceX: 0.52,
        sourceY: 0.34,
        brightness: 0.82,
        scale: 0.9,
        ghostCount: 4,
        ghostSpacing: 0.76,
        halo: 0.56,
        streakIntensity: 0.28,
        chromaticDispersion: 0.68,
        seed: 5,
      }),
      studioEffect('rgbSplit', {
        mode: 'radial',
        amount: 2.6,
        centerX: 0.52,
        centerY: 0.34,
        falloff: 1.6,
        intensity: 0.42,
      }),
    ],
  },
  {
    id: 'studio-relief-study',
    name: 'Relief Study',
    description: 'Compress tone into sharp, carved-looking graphic planes.',
    surface: 'effect-studio',
    categoryId: 'sketch',
    tags: ['relief', 'embossed', 'graphic', 'monochrome'],
    art: 'relief',
    effects: [
      studioEffect('blackAndWhite', { brightness: 0, preserveLuminosity: false }),
      studioEffect('sharpen', { amount: 1.1, radius: 1.2, threshold: 3 }),
      studioEffect('posterize', { levels: 5 }),
    ],
  },
  {
    id: 'studio-chalk-field',
    name: 'Chalk Field',
    description: 'Lay rough pale grain and broken values over a dark chalkboard-like ground.',
    surface: 'effect-studio',
    categoryId: 'sketch',
    tags: ['chalk', 'charcoal', 'grain', 'drawing'],
    art: 'chalk',
    effects: [
      studioEffect('blackAndWhite', {
        brightness: -4,
        tintColor: rgba(225, 231, 220),
        preserveLuminosity: false,
      }),
      studioEffect('dither', {
        algorithm: 'floyd-steinberg',
        paletteMode: 'levels',
        levels: 3,
        serpentine: true,
        strength: 0.66,
        bayerSize: 8,
        cellSize: 1,
        seed: 41,
      }),
      studioEffect('grain', { strength: 26, scale: 1.45, character: 78, seed: 41 }),
    ],
  },
  {
    id: 'studio-pencil-poster',
    name: 'Pencil Poster',
    description: 'Reduce colour to hand-made graphite-like marks for a bold graphic object.',
    surface: 'effect-studio',
    categoryId: 'sketch',
    tags: ['pencil', 'graphite', 'poster', 'dither'],
    art: 'graphite',
    featured: true,
    effects: [
      studioEffect('dither', {
        algorithm: 'atkinson',
        paletteMode: 'levels',
        levels: 4,
        serpentine: true,
        strength: 0.54,
        bayerSize: 8,
        cellSize: 1,
        seed: 29,
      }),
      studioEffect('duotone', {
        shadowColor: rgba(28, 31, 36),
        highlightColor: rgba(232, 226, 209),
        shadowPoint: 0.3,
        highlightPoint: 0.7,
        intensity: 0.72,
      }),
      studioEffect('grain', { strength: 10, scale: 0.9, character: 50, seed: 29 }),
    ],
  },
  {
    id: 'studio-stamp-cut',
    name: 'Stamp Cut',
    description: 'Make a hard-edged two-colour impression with an imperfect printed surface.',
    surface: 'effect-studio',
    categoryId: 'sketch',
    tags: ['stamp', 'threshold', 'print', 'high contrast'],
    art: 'stamp',
    effects: [
      studioEffect('threshold', { level: 132 }),
      studioEffect('duotone', {
        shadowColor: rgba(39, 32, 35),
        highlightColor: rgba(238, 215, 174),
        shadowPoint: 0.32,
        highlightPoint: 0.68,
        intensity: 0.9,
      }),
      studioEffect('grain', { strength: 12, scale: 1, character: 62, seed: 37 }),
    ],
  },
  {
    id: 'studio-graphic-pen',
    name: 'Graphic Pen',
    description: 'Drive a sharp pen-like contour through simplified black-and-white values.',
    surface: 'effect-studio',
    categoryId: 'sketch',
    tags: ['pen', 'linework', 'ink', 'contour'],
    art: 'ink',
    effects: [
      studioEffect('blackAndWhite', { brightness: 5, preserveLuminosity: false }),
      studioEffect('sharpen', { amount: 1.35, radius: 1, threshold: 3 }),
      studioEffect('threshold', { level: 150 }),
    ],
  },
  {
    id: 'studio-dot-study',
    name: 'Dot Study',
    description: 'Translate tone into a compact monochrome dot field with a drawing-like rhythm.',
    surface: 'effect-studio',
    categoryId: 'sketch',
    tags: ['dots', 'halftone', 'stippling', 'drawing'],
    art: 'screen',
    effects: [
      studioEffect('blackAndWhite', { brightness: 2, preserveLuminosity: false }),
      studioEffect('halftone', {
        pattern: 'dot',
        frequency: 24,
        angle: 45,
        dotShape: 'round',
        channel: 'k',
        method: 'am',
        intensity: 0.76,
        softness: 0.1,
        foregroundColor: rgb(31, 36, 43),
        backgroundColor: rgb(242, 238, 228),
      }),
      studioEffect('grain', { strength: 8, scale: 0.85, character: 36, seed: 67 }),
    ],
  },
  {
    id: 'studio-paper-copy',
    name: 'Paper Copy',
    description: 'Make a high-contrast copied impression with broken toner and warm paper.',
    surface: 'effect-studio',
    categoryId: 'sketch',
    tags: ['photocopy', 'paper', 'toner', 'high contrast'],
    art: 'newsprint',
    effects: [
      studioEffect('blackAndWhite', { brightness: 6, preserveLuminosity: false }),
      studioEffect('threshold', { level: 144 }),
      studioEffect('grain', { strength: 19, scale: 0.7, character: 74, seed: 71 }),
    ],
  },
  {
    id: 'studio-contour-dither',
    name: 'Contour Dither',
    description: 'Keep drawn contours legible while tone steps into fine graphite-like marks.',
    surface: 'effect-studio',
    categoryId: 'sketch',
    tags: ['contour', 'graphite', 'dither', 'drawing'],
    art: 'graphite',
    effects: [
      studioEffect('blackAndWhite', { brightness: 1, preserveLuminosity: false }),
      studioEffect('sharpen', { amount: 0.82, radius: 1, threshold: 2 }),
      studioEffect('dither', {
        algorithm: 'atkinson',
        paletteMode: 'levels',
        levels: 3,
        serpentine: true,
        strength: 0.46,
        bayerSize: 8,
        cellSize: 1,
        seed: 73,
      }),
    ],
  },
  {
    id: 'studio-chromatic-bloom',
    name: 'Chromatic Bloom',
    description: 'Create a luminous halo with a controlled colour fringe.',
    surface: 'effect-studio',
    categoryId: 'stylize',
    tags: ['glow', 'colour', 'neon', 'light'],
    art: 'glow',
    featured: true,
    effects: [
      studioEffect('bloom', { intensity: 0.38, radius: 18, threshold: 0.56, softKnee: 0.24 }),
      studioEffect('rgbSplit', {
        mode: 'radial',
        amount: 1.8,
        centerX: 0.5,
        centerY: 0.5,
        falloff: 1.25,
        intensity: 0.32,
      }),
    ],
  },
  {
    id: 'studio-cinema-shafts',
    name: 'Cinema Shafts',
    description: 'Send directional light through an object with a restrained diffusion bloom.',
    surface: 'effect-studio',
    categoryId: 'stylize',
    tags: ['light rays', 'cinematic', 'atmosphere', 'glow'],
    art: 'shafts',
    effects: [
      studioEffect('lightShafts', {
        lightX: 0.48,
        lightY: -0.14,
        lightType: 'directional',
        direction: -18,
        intensity: 0.88,
        density: 0.12,
        weight: 0.8,
        scattering: 0.46,
        tint: rgb(255, 244, 214),
      }),
      studioEffect('softBloom', { strength: 12, radius: 24, threshold: 0.58, softness: 0.62 }),
    ],
  },
  {
    id: 'studio-neon-phosphor',
    name: 'Neon Phosphor',
    description: 'Give a bright electronic edge a soft phosphor glow and scanline character.',
    surface: 'effect-studio',
    categoryId: 'stylize',
    tags: ['neon', 'crt', 'phosphor', 'screen'],
    art: 'phosphor',
    effects: [
      studioEffect('crt', {
        curvature: 0.08,
        scanlinePeriod: 3,
        scanlineStrength: 0.42,
        phosphorMask: 'rgb-stripe',
        phosphorPitch: 4,
        phosphorIntensity: 0.58,
        glow: 0.46,
        vignette: 0.22,
        brightness: 0.02,
        contrast: 1.14,
      }),
      studioEffect('bloom', {
        threshold: 0.66,
        softKnee: 0.16,
        intensity: 0.74,
        radius: 16,
        diffusion: 0.34,
        composite: 'add',
      }),
    ],
  },
  {
    id: 'studio-light-leak',
    name: 'Light Leak',
    description:
      'Brush a soft analogue colour leak through highlights without flattening the source.',
    surface: 'effect-studio',
    categoryId: 'stylize',
    tags: ['light leak', 'analogue', 'warm', 'film'],
    art: 'leak',
    effects: [
      studioEffect('lightLeak', {
        x: 0.16,
        y: 0.42,
        angle: 20,
        size: 1.05,
        softness: 0.72,
        hue: 25,
        saturation: 0.84,
        lightness: 0.6,
        intensity: 0.56,
        seed: 4,
      }),
      studioEffect('softBloom', { strength: 8, radius: 20, threshold: 0.6, softness: 0.58 }),
    ],
  },
  {
    id: 'studio-aperture-star',
    name: 'Aperture Star',
    description: 'Create a crisp multi-blade flare with a softly glowing optical halo.',
    surface: 'effect-studio',
    categoryId: 'stylize',
    tags: ['aperture', 'star', 'flare', 'light'],
    art: 'prism',
    effects: [
      studioEffect('lensFlare', {
        sourceX: 0.5,
        sourceY: 0.34,
        brightness: 1.12,
        scale: 1,
        ghostCount: 4,
        ghostSpacing: 0.8,
        halo: 0.42,
        apertureBlades: 8,
        apertureRotation: 22,
        streakIntensity: 0.52,
        anamorphicRatio: 0.12,
        chromaticDispersion: 0.34,
        seed: 5,
      }),
      studioEffect('bloom', {
        threshold: 0.62,
        softKnee: 0.18,
        intensity: 0.68,
        radius: 20,
        diffusion: 0.4,
        composite: 'screen',
      }),
    ],
  },
  {
    id: 'studio-laser-streak',
    name: 'Laser Streak',
    description: 'Stretch bright colour into a narrow cinematic streak with a controlled fringe.',
    surface: 'effect-studio',
    categoryId: 'stylize',
    tags: ['streak', 'laser', 'anamorphic', 'neon'],
    art: 'shafts',
    effects: [
      studioEffect('bloom', {
        threshold: 0.58,
        softKnee: 0.2,
        intensity: 0.98,
        radius: 18,
        diffusion: 0.34,
        composite: 'screen',
        streakEnabled: true,
        streakAngle: 0,
        streakLength: 190,
        streakIntensity: 0.64,
        streakAspect: 3.4,
      }),
      studioEffect('rgbSplit', {
        mode: 'offset',
        redX: 3,
        redY: 0,
        greenX: 0,
        greenY: 0,
        blueX: -3,
        blueY: 0,
        intensity: 0.32,
      }),
    ],
  },
  {
    id: 'studio-solar-shift',
    name: 'Solar Shift',
    description: 'Partially invert and simplify colour into a bright, surreal graphic response.',
    surface: 'effect-studio',
    categoryId: 'stylize',
    tags: ['solar', 'invert', 'surreal', 'colour'],
    art: 'glow',
    effects: [
      studioEffect('invert', { value: 42 }),
      studioEffect('posterize', { levels: 5 }),
      studioEffect('lightLeak', {
        x: 0.68,
        y: 0.28,
        angle: 42,
        size: 0.78,
        softness: 0.62,
        hue: 332,
        saturation: 0.78,
        lightness: 0.58,
        intensity: 0.22,
        seed: 79,
      }),
    ],
  },
  {
    id: 'studio-terminal-glow',
    name: 'Terminal Glow',
    description:
      'Render a phosphor-green terminal response with scanlines and gentle emissive glow.',
    surface: 'effect-studio',
    categoryId: 'stylize',
    tags: ['terminal', 'phosphor', 'green screen', 'crt'],
    art: 'phosphor',
    effects: [
      studioEffect('duotone', {
        shadowColor: rgba(2, 17, 8),
        highlightColor: rgba(121, 255, 169),
        shadowPoint: 0.3,
        highlightPoint: 0.7,
        intensity: 0.9,
      }),
      studioEffect('crt', {
        curvature: 0.06,
        scanlinePeriod: 2.5,
        scanlineStrength: 0.48,
        phosphorMask: 'shadow-mask',
        phosphorPitch: 4,
        phosphorIntensity: 0.52,
        glow: 0.5,
        vignette: 0.34,
        contrast: 1.12,
      }),
      studioEffect('bloom', {
        threshold: 0.64,
        softKnee: 0.18,
        intensity: 0.56,
        radius: 14,
        diffusion: 0.3,
        tint: rgb(121, 255, 169),
        tintAmount: 0.4,
        composite: 'add',
      }),
    ],
  },
  {
    id: 'studio-analog-signal',
    name: 'Analog Signal',
    description: 'Add tape colour, scanline character, and restrained signal drift.',
    surface: 'effect-studio',
    categoryId: 'texture',
    tags: ['vhs', 'tape', 'retro', 'signal'],
    art: 'signal',
    effects: [
      studioEffect('vhs', {
        lumaNoise: 0.24,
        chromaNoise: 0.2,
        chromaBleed: 0.28,
        jitter: 0.22,
        tracking: 0.18,
        dropouts: 0.08,
        headSwitching: 0.28,
        tearing: 0.12,
        signalBlur: 0.13,
        timeInstability: 0.16,
        seed: 1,
      }),
      studioEffect('crt', {
        curvature: 0.14,
        scanlinePeriod: 3,
        scanlineStrength: 0.34,
        phosphorIntensity: 0.34,
        glow: 0.28,
        vignette: 0.26,
        contrast: 1.08,
      }),
    ],
  },
  {
    id: 'studio-newsprint',
    name: 'Newsprint',
    description: 'Print monochrome dots into an absorbent paper-like surface.',
    surface: 'effect-studio',
    categoryId: 'texture',
    tags: ['newsprint', 'halftone', 'paper', 'print'],
    art: 'newsprint',
    featured: true,
    effects: [
      studioEffect('blackAndWhite', { brightness: 3, preserveLuminosity: false }),
      studioEffect('halftone', {
        pattern: 'dot',
        frequency: 34,
        angle: 45,
        dotShape: 'round',
        channel: 'k',
        method: 'am',
        intensity: 0.82,
        softness: 0.08,
        foregroundColor: rgb(36, 39, 43),
        backgroundColor: rgb(236, 229, 209),
      }),
      studioEffect('grain', { strength: 12, scale: 0.82, character: 46, seed: 43 }),
    ],
  },
  {
    id: 'studio-riso-ink',
    name: 'Riso Ink',
    description:
      'Overprint a limited ink palette with tactile dots and a small registration wobble.',
    surface: 'effect-studio',
    categoryId: 'texture',
    tags: ['riso', 'print', 'ink', 'halftone'],
    art: 'riso',
    effects: [
      studioEffect('duotone', {
        shadowColor: rgba(42, 67, 143),
        highlightColor: rgba(248, 130, 102),
        shadowPoint: 0.3,
        highlightPoint: 0.7,
        intensity: 0.82,
      }),
      studioEffect('colorHalftone', {
        screenSize: 9,
        angle: 15,
        dotShape: 'round',
        mode: 'cmyk',
        intensity: 0.52,
      }),
      studioEffect('grain', { strength: 10, scale: 0.9, character: 54, seed: 47 }),
    ],
  },
  {
    id: 'studio-water-paper',
    name: 'Water Paper',
    description: 'Set watery colour into fibrous stock with diffuse highlights and gentle tooth.',
    surface: 'effect-studio',
    categoryId: 'texture',
    tags: ['paper', 'watercolour', 'grain', 'material'],
    art: 'paper',
    effects: [
      studioEffect('tritone', {
        shadowColor: rgba(48, 93, 133),
        midtoneColor: rgba(154, 188, 192),
        highlightColor: rgba(245, 236, 207),
        shadowPoint: 0.28,
        highlightPoint: 0.74,
        intensity: 0.7,
      }),
      studioEffect('softBloom', { strength: 10, radius: 26, threshold: 0.54, softness: 0.7 }),
      studioEffect('grain', { strength: 16, scale: 1.55, character: 68, seed: 53 }),
    ],
  },
  {
    id: 'studio-worn-tape',
    name: 'Worn Tape',
    description: 'Age the signal with tracking wear, low chroma fidelity, and fine noise.',
    surface: 'effect-studio',
    categoryId: 'texture',
    tags: ['tape', 'vhs', 'worn', 'noise'],
    art: 'tape',
    effects: [
      studioEffect('vhs', {
        lumaNoise: 0.36,
        chromaNoise: 0.3,
        chromaBleed: 0.44,
        jitter: 0.38,
        tracking: 0.34,
        dropouts: 0.18,
        headSwitching: 0.48,
        tearing: 0.24,
        signalBlur: 0.24,
        timeInstability: 0.28,
        seed: 3,
      }),
      studioEffect('grain', { strength: 15, scale: 0.72, character: 66, seed: 3 }),
    ],
  },
  {
    id: 'studio-reticulation',
    name: 'Reticulation',
    description: 'Break continuous tone into clustered marks and an irregular material grain.',
    surface: 'effect-studio',
    categoryId: 'texture',
    tags: ['reticulation', 'texture', 'grain', 'abstract'],
    art: 'reticulation',
    controls: [
      {
        id: 'cluster-density',
        label: 'Cluster density',
        description: 'Pack the reticulated marks more tightly or let them open up.',
        min: 1,
        max: 100,
        step: 1,
        defaultValue: 67,
        unit: '%',
        targets: [
          { effectIndex: 0, parameter: 'cellSize', outputMin: 7, outputMax: 1, round: true },
        ],
      },
      {
        id: 'tone-steps',
        label: 'Tone steps',
        description: 'Control how many tonal levels resolve into clustered marks.',
        min: 2,
        max: 8,
        step: 1,
        defaultValue: 4,
        unit: 'steps',
        targets: [{ effectIndex: 0, parameter: 'levels', outputMin: 2, outputMax: 8, round: true }],
      },
      {
        id: 'material-grain',
        label: 'Material grain',
        description: 'Set the irregular surface grain behind the clusters.',
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 60,
        unit: '%',
        targets: [{ effectIndex: 1, parameter: 'strength', outputMin: 0, outputMax: 40 }],
      },
    ],
    effects: [
      studioEffect('dither', {
        algorithm: 'blue-noise',
        paletteMode: 'levels',
        levels: 4,
        serpentine: false,
        strength: 0.48,
        bayerSize: 8,
        cellSize: 3,
        seed: 61,
      }),
      studioEffect('grain', { strength: 24, scale: 1.7, character: 82, seed: 61 }),
    ],
  },
];

/** Backward-compatible name for the complete curated Studio catalog. */
export const EFFECT_STUDIO_PRESETS = EFFECT_STUDIO_TREATMENTS;

export const FEATURED_EFFECT_STUDIO_TREATMENTS: readonly StudioTreatment[] =
  EFFECT_STUDIO_TREATMENTS.filter((treatment) => treatment.featured);

export function listEffectStudioTreatments(): StudioTreatment[] {
  return [...EFFECT_STUDIO_TREATMENTS];
}

export function getEffectStudioTreatment(id: string): StudioTreatment | undefined {
  return EFFECT_STUDIO_TREATMENTS.find((treatment) => treatment.id === id);
}

export function searchEffectStudioTreatments(
  query: string,
  categoryId?: EffectStudioCategoryId,
): StudioTreatment[] {
  const normalized = query.trim().toLocaleLowerCase();
  return listEffectStudioTreatments().filter((treatment) => {
    if (categoryId && treatment.categoryId !== categoryId) return false;
    if (!normalized) return true;
    return [treatment.name, treatment.description, ...treatment.tags].some((value) =>
      value.toLocaleLowerCase().includes(normalized),
    );
  });
}

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
