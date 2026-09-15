import { describe, expect, it } from 'vitest';
import { type ContentEffect, contentEffectPadding } from './replay';

const layerBlur = (radius: number): ContentEffect => ({
  type: 'layerBlur',
  radius,
  visible: true,
});

const gaussianBlur = (sigma: number): ContentEffect => ({
  type: 'gaussianBlur',
  sigmaX: sigma,
  sigmaY: sigma,
  linkedAxes: true,
  algorithmVersion: 1,
  coordinateSpace: 'owner-normalized',
  edgeMode: 'clamp',
  visible: true,
});

describe('content effect bounds', () => {
  it('accumulates support across sequential local effects', () => {
    expect(contentEffectPadding([layerBlur(4), layerBlur(8)])).toBe(36);
    expect(contentEffectPadding([gaussianBlur(2), gaussianBlur(5)])).toBe(21);
  });

  it('keeps mixed local support additive instead of taking the largest halo', () => {
    const chromatic: ContentEffect = {
      type: 'chromaticAberration',
      offsets: { redX: 3, redY: 0, greenX: 0, greenY: 0, blueX: 0, blueY: 0 },
      intensity: 1,
      mix: 1,
      blendMode: 'normal',
      opacity: 1,
      visible: true,
    };
    expect(contentEffectPadding([layerBlur(4), chromatic, gaussianBlur(2)])).toBe(21);
  });

  it('ignores malformed numeric fields without returning NaN', () => {
    const chromatic: ContentEffect = {
      type: 'chromaticAberration',
      offsets: {
        redX: Number.NaN,
        redY: Number.POSITIVE_INFINITY,
        greenX: 2,
        greenY: 0,
        blueX: 0,
        blueY: 0,
      },
      intensity: 1,
      mix: 1,
      blendMode: 'normal',
      opacity: 1,
      visible: true,
    };
    expect(contentEffectPadding([layerBlur(Number.NaN), chromatic])).toBe(2);
    expect(contentEffectPadding([layerBlur(Number.POSITIVE_INFINITY)])).toBe(0);
  });
});
