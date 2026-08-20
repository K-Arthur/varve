import type { GradientFill } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  resolvedGradientHueInterpolation,
  resolvedGradientInterpolationSpace,
} from './gradientUiState';

const gradient = (overrides: Partial<GradientFill> = {}): GradientFill => ({
  type: 'linear',
  stops: [
    { position: 0, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
    { position: 1, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
  ],
  ...overrides,
});

describe('gradient inspector state', () => {
  it('treats legacy missing metadata as encoded sRGB', () => {
    expect(resolvedGradientInterpolationSpace(gradient())).toBe('srgb');
  });

  it('resolves document inheritance using the current document default', () => {
    expect(
      resolvedGradientInterpolationSpace(gradient({ interpolationSource: 'document' }), 'oklch'),
    ).toBe('oklch');
  });

  it('defaults hue direction only for cylindrical spaces', () => {
    expect(resolvedGradientHueInterpolation(gradient({ interpolationSpace: 'oklch' }))).toBe(
      'shorter',
    );
    expect(resolvedGradientHueInterpolation(gradient({ interpolationSpace: 'srgb' }))).toBe(
      undefined,
    );
  });

  it('preserves an explicit hue direction', () => {
    expect(
      resolvedGradientHueInterpolation(
        gradient({ interpolationSpace: 'oklch', hueInterpolation: 'increasing' }),
      ),
    ).toBe('increasing');
  });
});
