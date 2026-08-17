/**
 * Explicit artistic blend evaluation semantics.
 *
 * This is separate from gradient interpolation, document profiles, and
 * Porter-Duff alpha compositing. Legacy sRGB is the default for documents
 * that predate this field so loading them cannot change rendered pixels.
 */
export type BlendEvaluationSpace = 'legacy-srgb' | 'linear-srgb';

export type BlendEvaluationCategory = 'separable' | 'non-separable' | 'composite' | 'normal';

export interface BlendEvaluationPolicy {
  readonly mode: string;
  readonly category: BlendEvaluationCategory;
  readonly linearEvaluation: boolean;
}

const SEPARABLE_MODES = [
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'colorDodge',
  'colorBurn',
  'hardLight',
  'softLight',
  'difference',
  'exclusion',
] as const;

const NON_SEPARABLE_MODES = ['hue', 'saturation', 'color', 'luminosity'] as const;

export const BLEND_EVALUATION_POLICIES: readonly BlendEvaluationPolicy[] = Object.freeze([
  { mode: 'normal', category: 'normal', linearEvaluation: false },
  ...SEPARABLE_MODES.map((mode) => ({
    mode,
    category: 'separable' as const,
    linearEvaluation: true,
  })),
  ...NON_SEPARABLE_MODES.map((mode) => ({
    mode,
    category: 'non-separable' as const,
    linearEvaluation: false,
  })),
  { mode: 'plusLighter', category: 'composite', linearEvaluation: false },
  { mode: 'plusDarker', category: 'composite', linearEvaluation: false },
]);

const POLICY_BY_MODE = new Map(BLEND_EVALUATION_POLICIES.map((policy) => [policy.mode, policy]));

export function blendEvaluationPolicy(mode: string): BlendEvaluationPolicy | undefined {
  return POLICY_BY_MODE.get(mode);
}

/** Unknown and malformed persisted values fail closed to historical behavior. */
export function normalizeBlendEvaluationSpace(value: unknown): BlendEvaluationSpace {
  return value === 'linear-srgb' ? 'linear-srgb' : 'legacy-srgb';
}

/** Keep non-separable W3C modes out of an undefined "linear HSL" path. */
export function effectiveBlendEvaluationSpace(
  mode: string,
  requested: BlendEvaluationSpace,
): BlendEvaluationSpace {
  return requested === 'linear-srgb' && blendEvaluationPolicy(mode)?.linearEvaluation
    ? 'linear-srgb'
    : 'legacy-srgb';
}

/** Resolve the persisted setting without importing scene types. */
export function resolveBlendEvaluationSpace(config: {
  blendEvaluationSpace?: unknown;
  workingSpace?: unknown;
}): BlendEvaluationSpace {
  if (config.blendEvaluationSpace !== undefined) {
    return normalizeBlendEvaluationSpace(config.blendEvaluationSpace);
  }
  // The former workingSpace setting was the only linear opt-in. Preserve it
  // for documents written by that implementation; old sRGB documents remain
  // encoded-RGB compatible.
  return config.workingSpace === 'linear' ? 'linear-srgb' : 'legacy-srgb';
}
