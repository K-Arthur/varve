import { describe, expect, it } from 'vitest';
import {
  BLEND_EVALUATION_POLICIES,
  blendEvaluationPolicy,
  effectiveBlendEvaluationSpace,
  normalizeBlendEvaluationSpace,
  resolveBlendEvaluationSpace,
} from './blendEvaluation';

describe('blend evaluation policy', () => {
  it('covers the supported artistic mode matrix', () => {
    expect(BLEND_EVALUATION_POLICIES.map((policy) => policy.mode)).toEqual(
      expect.arrayContaining([
        'normal',
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
        'hue',
        'saturation',
        'color',
        'luminosity',
        'plusLighter',
      ]),
    );
  });

  it('allows linear evaluation only for separable formulas', () => {
    expect(blendEvaluationPolicy('multiply')?.linearEvaluation).toBe(true);
    expect(blendEvaluationPolicy('hue')?.linearEvaluation).toBe(false);
    expect(effectiveBlendEvaluationSpace('multiply', 'linear-srgb')).toBe('linear-srgb');
    expect(effectiveBlendEvaluationSpace('hue', 'linear-srgb')).toBe('legacy-srgb');
  });

  it('fails closed for malformed and missing document values', () => {
    expect(normalizeBlendEvaluationSpace('banana')).toBe('legacy-srgb');
    expect(resolveBlendEvaluationSpace({})).toBe('legacy-srgb');
    expect(resolveBlendEvaluationSpace({ workingSpace: 'linear' })).toBe('linear-srgb');
    expect(resolveBlendEvaluationSpace({ blendEvaluationSpace: 'banana' })).toBe('legacy-srgb');
  });
});
