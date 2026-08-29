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
  edgeFalloff: EdgeFalloffParams;
  grain: GrainParams;
  softBloom: SoftBloomParams;
}

export type ImageTreatmentParams = ImageTreatmentParamsByKind[ImageTreatmentKind];

const SCHEMAS: Record<ImageTreatmentKind, ImageTreatmentSchema> = {
  microDetail: {
    id: 'microDetail',
    label: 'Micro Detail',
    group: 'detail',
    description: 'Accentuate or soften fine texture without changing global tone.',
    parameters: [
      {
        key: 'amount',
        label: 'Micro Detail',
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
        label: 'Noise Protection',
        description: 'Protect nearly-flat areas from fine-detail enhancement.',
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
    label: 'Definition',
    group: 'presence',
    description: 'Shape medium-scale structure with local contrast.',
    parameters: [
      {
        key: 'amount',
        label: 'Definition',
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
        label: 'Structure Scale',
        description: 'The size of structures affected by Definition.',
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
    label: 'Atmosphere',
    group: 'presence',
    description: 'Recover or add broad atmospheric depth without global contrast.',
    parameters: [
      {
        key: 'amount',
        label: 'Atmosphere',
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
        label: 'Depth Scale',
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
  edgeFalloff: {
    id: 'edgeFalloff',
    label: 'Edge Falloff',
    group: 'finish',
    description: 'Lighten or darken image edges in object coordinates.',
    parameters: [
      {
        key: 'strength',
        label: 'Edge Falloff',
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
        label: 'Roundness',
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
        label: 'Center X',
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
        label: 'Center Y',
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
        label: 'Strength',
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
        label: 'Scale',
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
        label: 'Character',
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
        label: 'Seed',
        description: 'Deterministic pattern identity. Intended for advanced use.',
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
    label: 'Soft Bloom',
    group: 'finish',
    description: 'Highlight-biased diffusion for a soft luminous finish.',
    parameters: [
      {
        key: 'strength',
        label: 'Soft Bloom',
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
        label: 'Radius',
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
        label: 'Highlight Bias',
        description: 'Brightness level where Soft Bloom begins.',
        min: 0,
        max: 1,
        defaultValue: 0.65,
        step: 0.01,
        fineStep: 0.005,
        advanced: true,
      },
      {
        key: 'softness',
        label: 'Softness',
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
