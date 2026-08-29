/**
 * Image Treatments parameter contracts.
 *
 * These descriptors are intentionally independent of user-facing panel
 * placement. `id` and parameter keys are serialized through the shared
 * Adjustment model, while labels, ranges, defaults, formatting, and
 * accessibility descriptions are consumed by the Image Tuning UI and the
 * persistence boundary. Keeping them together prevents a slider from
 * disagreeing with its renderer or saved-document sanitizer.
 */

export const IMAGE_TREATMENT_KINDS = [
  'microDetail',
  'definition',
  'atmosphere',
  'dehaze',
  'edgeFalloff',
  'grain',
  'softBloom',
] as const;

export type ImageTreatmentKind = (typeof IMAGE_TREATMENT_KINDS)[number];

export type ImageTreatmentGroup = 'detail' | 'presence' | 'finish';

export interface ImageTreatmentParameterSchema {
  key: string;
  label: string;
  description: string;
  min: number;
  max: number;
  defaultValue: number;
  step: number;
  fineStep: number;
  unit?: '%' | 'px';
  advanced?: boolean;
}

export interface ImageTreatmentSchema {
  id: ImageTreatmentKind;
  label: string;
  group: ImageTreatmentGroup;
  description: string;
  parameters: readonly ImageTreatmentParameterSchema[];
}

export interface MicroDetailParams {
  amount: number;
  threshold: number;
}

export interface DefinitionParams {
  amount: number;
  radius: number;
  protectHighlights: number;
}

export interface AtmosphereParams {
  amount: number;
  radius: number;
  protectHighlights: number;
}

/**
 * Local atmospheric-veil recovery. Unlike Atmospheric Depth's (`atmosphere`)
 * broad local-contrast control, Dehaze estimates a local dark-channel veil and
 * reconstructs a bounded transmission through it.
 */
export interface DehazeParams {
  amount: number;
  radius: number;
  protectHighlights: number;
}

export interface EdgeFalloffParams {
  strength: number;
  midpoint: number;
  feather: number;
  roundness: number;
  centerX: number;
  centerY: number;
  highlightProtection: number;
}

export interface GrainParams {
  strength: number;
  scale: number;
  character: number;
  seed: number;
}

export interface SoftBloomParams {
  strength: number;
  radius: number;
  threshold: number;
  softness: number;
}

export interface ImageTreatmentParamsByKind {
  microDetail: MicroDetailParams;
  definition: DefinitionParams;
  atmosphere: AtmosphereParams;
  dehaze: DehazeParams;
  edgeFalloff: EdgeFalloffParams;
  grain: GrainParams;
  softBloom: SoftBloomParams;
}

export type ImageTreatmentParams = ImageTreatmentParamsByKind[ImageTreatmentKind];

const SCHEMAS: Record<ImageTreatmentKind, ImageTreatmentSchema> = {
  microDetail: {
    id: 'microDetail',
    label: 'Fine Texture',
    group: 'detail',
    description: 'Accentuate or soften fine texture without changing global tone.',
    parameters: [
      {
        key: 'amount',
        label: 'Fine Texture',
        description: 'Fine texture enhancement. Negative values soften fine detail.',
        min: -100,
        max: 100,
        defaultValue: 0,
        step: 1,
        fineStep: 0.1,
        unit: '%',
      },
      {
        key: 'threshold',
        label: 'Smooth-Area Protection',
        description: 'Protect nearly flat areas from fine-texture enhancement.',
        min: 0,
        max: 1,
        defaultValue: 0.12,
        step: 0.01,
        fineStep: 0.005,
        advanced: true,
      },
    ],
  },
  definition: {
    id: 'definition',
    label: 'Local Contrast',
    group: 'presence',
    description: 'Shape medium-scale structure with local contrast.',
    parameters: [
      {
        key: 'amount',
        label: 'Local Contrast',
        description: 'Medium-scale local contrast. Negative values create a softer appearance.',
        min: -100,
        max: 100,
        defaultValue: 0,
        step: 1,
        fineStep: 0.1,
        unit: '%',
      },
      {
        key: 'radius',
        label: 'Detail Size',
        description: 'The size of structures affected by Local Contrast.',
        min: 2,
        max: 64,
        defaultValue: 12,
        step: 1,
        fineStep: 0.5,
        unit: 'px',
        advanced: true,
      },
      {
        key: 'protectHighlights',
        label: 'Highlight Protection',
        description: 'Limit local-contrast changes in bright highlights.',
        min: 0,
        max: 1,
        defaultValue: 0.35,
        step: 0.01,
        fineStep: 0.005,
        advanced: true,
      },
    ],
  },
  atmosphere: {
    id: 'atmosphere',
    label: 'Atmospheric Depth',
    group: 'presence',
    description: 'Recover or add broad atmospheric depth without global contrast.',
    parameters: [
      {
        key: 'amount',
        label: 'Atmospheric Depth',
        description: 'Positive values recover atmospheric depth; negative values add softness.',
        min: -100,
        max: 100,
        defaultValue: 0,
        step: 1,
        fineStep: 0.1,
        unit: '%',
      },
      {
        key: 'radius',
        label: 'Depth Area',
        description: 'The broad tonal scale used to shape atmospheric depth.',
        min: 4,
        max: 128,
        defaultValue: 28,
        step: 1,
        fineStep: 0.5,
        unit: 'px',
        advanced: true,
      },
      {
        key: 'protectHighlights',
        label: 'Highlight Protection',
        description: 'Limit atmospheric recovery around bright skies and lights.',
        min: 0,
        max: 1,
        defaultValue: 0.6,
        step: 0.01,
        fineStep: 0.005,
        advanced: true,
      },
    ],
  },
  dehaze: {
    id: 'dehaze',
    label: 'Dehaze',
    group: 'presence',
    description: 'Recover contrast through a locally estimated atmospheric veil.',
    parameters: [
      {
        key: 'amount',
        label: 'Dehaze',
        description: 'Strength of local atmospheric-haze removal.',
        min: 0,
        max: 100,
        defaultValue: 0,
        step: 1,
        fineStep: 0.1,
        unit: '%',
      },
      {
        key: 'radius',
        label: 'Haze Area',
        description: 'The local area used to estimate atmospheric haze.',
        min: 4,
        max: 256,
        defaultValue: 48,
        step: 1,
        fineStep: 0.5,
        unit: 'px',
        advanced: true,
      },
      {
        key: 'protectHighlights',
        label: 'Highlight Protection',
        description: 'Limit haze recovery in bright skies, clouds, and lights.',
        min: 0,
        max: 1,
        defaultValue: 0.45,
        step: 0.01,
        fineStep: 0.005,
        advanced: true,
      },
    ],
  },
  edgeFalloff: {
    id: 'edgeFalloff',
    label: 'Vignette',
    group: 'finish',
    description: 'Lighten or darken image edges in object coordinates.',
    parameters: [
      {
        key: 'strength',
        label: 'Vignette Amount',
        description: 'Negative values darken edges; positive values lighten them.',
        min: -100,
        max: 100,
        defaultValue: 0,
        step: 1,
        fineStep: 0.1,
        unit: '%',
      },
      {
        key: 'midpoint',
        label: 'Midpoint',
        description: 'How close to the corners the falloff begins.',
        min: 0,
        max: 100,
        defaultValue: 50,
        step: 1,
        fineStep: 0.1,
        unit: '%',
        advanced: true,
      },
      {
        key: 'feather',
        label: 'Feather',
        description: 'Softness of the transition into the edge falloff.',
        min: 0,
        max: 100,
        defaultValue: 60,
        step: 1,
        fineStep: 0.1,
        unit: '%',
        advanced: true,
      },
      {
        key: 'roundness',
        label: 'Vignette Shape',
        description: 'Adjust the falloff shape from oval to circular.',
        min: -100,
        max: 100,
        defaultValue: 0,
        step: 1,
        fineStep: 0.1,
        unit: '%',
        advanced: true,
      },
      {
        key: 'centerX',
        label: 'Horizontal Center',
        description: 'Horizontal position of the falloff center.',
        min: 0,
        max: 1,
        defaultValue: 0.5,
        step: 0.01,
        fineStep: 0.005,
        advanced: true,
      },
      {
        key: 'centerY',
        label: 'Vertical Center',
        description: 'Vertical position of the falloff center.',
        min: 0,
        max: 1,
        defaultValue: 0.5,
        step: 0.01,
        fineStep: 0.005,
        advanced: true,
      },
      {
        key: 'highlightProtection',
        label: 'Highlight Protection',
        description: 'Preserve bright edge detail while darkening edges.',
        min: 0,
        max: 100,
        defaultValue: 0,
        step: 1,
        fineStep: 0.1,
        unit: '%',
        advanced: true,
      },
    ],
  },
  grain: {
    id: 'grain',
    label: 'Grain',
    group: 'finish',
    description: 'Deterministic photographic grain anchored to the image.',
    parameters: [
      {
        key: 'strength',
        label: 'Grain Amount',
        description: 'Amount of deterministic photographic grain.',
        min: 0,
        max: 100,
        defaultValue: 0,
        step: 1,
        fineStep: 0.1,
        unit: '%',
      },
      {
        key: 'scale',
        label: 'Grain Size',
        description: 'Size of grain features in image pixels.',
        min: 0.25,
        max: 4,
        defaultValue: 1,
        step: 0.05,
        fineStep: 0.01,
        advanced: true,
      },
      {
        key: 'character',
        label: 'Grain Roughness',
        description: 'Regularity and clustering of the grain pattern.',
        min: 0,
        max: 100,
        defaultValue: 50,
        step: 1,
        fineStep: 0.1,
        unit: '%',
        advanced: true,
      },
      {
        key: 'seed',
        label: 'Pattern Variation',
        description: 'Choose a repeatable grain pattern without changing its amount.',
        min: 0,
        max: 4294967295,
        defaultValue: 0,
        step: 1,
        fineStep: 1,
        advanced: true,
      },
    ],
  },
  softBloom: {
    id: 'softBloom',
    label: 'Highlight Glow',
    group: 'finish',
    description: 'Highlight-biased diffusion for a soft luminous finish.',
    parameters: [
      {
        key: 'strength',
        label: 'Glow Amount',
        description: 'Strength of highlight-biased diffusion.',
        min: 0,
        max: 100,
        defaultValue: 0,
        step: 1,
        fineStep: 0.1,
        unit: '%',
      },
      {
        key: 'radius',
        label: 'Glow Size',
        description: 'How far highlight diffusion spreads.',
        min: 0,
        max: 128,
        defaultValue: 24,
        step: 1,
        fineStep: 0.5,
        unit: 'px',
        advanced: true,
      },
      {
        key: 'threshold',
        label: 'Highlight Threshold',
        description: 'Brightness level where Highlight Glow begins.',
        min: 0,
        max: 1,
        defaultValue: 0.65,
        step: 0.01,
        fineStep: 0.005,
        advanced: true,
      },
      {
        key: 'softness',
        label: 'Glow Softness',
        description: 'How gently the highlight selection transitions into bloom.',
        min: 0,
        max: 1,
        defaultValue: 0.35,
        step: 0.01,
        fineStep: 0.005,
        advanced: true,
      },
    ],
  },
};

export const IMAGE_TREATMENT_SCHEMAS: readonly ImageTreatmentSchema[] = IMAGE_TREATMENT_KINDS.map(
  (kind) => SCHEMAS[kind],
);

export function isImageTreatmentKind(value: unknown): value is ImageTreatmentKind {
  return typeof value === 'string' && (IMAGE_TREATMENT_KINDS as readonly string[]).includes(value);
}

export function imageTreatmentSchema(kind: ImageTreatmentKind): ImageTreatmentSchema {
  return SCHEMAS[kind];
}

/**
 * Look up a serialized numeric parameter contract without repeating its range
 * in the inspector, document codec, or migration code.
 */
export function imageTreatmentParameter(
  kind: ImageTreatmentKind,
  key: string,
): ImageTreatmentParameterSchema | undefined {
  return SCHEMAS[kind].parameters.find((parameter) => parameter.key === key);
}

export function imageTreatmentDefaults<K extends ImageTreatmentKind>(
  kind: K,
): ImageTreatmentParamsByKind[K] {
  const result = {} as Record<string, number>;
  for (const parameter of SCHEMAS[kind].parameters) {
    result[parameter.key] = parameter.defaultValue;
  }
  return result as unknown as ImageTreatmentParamsByKind[K];
}
