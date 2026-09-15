import { describe, expect, it } from 'vitest';
import { isNearNeutralLab, isSkinLikeLab } from './heuristics';

describe('isSkinLikeLab', () => {
  it('accepts the broad Lab hue band used for skin tones', () => {
    expect(isSkinLikeLab(12, 18)).toBe(true);
    expect(isSkinLikeLab(20, 15)).toBe(true);
    expect(isSkinLikeLab(25, 30)).toBe(true);
  });

  it('rejects saturated non-skin hues and neutrals', () => {
    expect(isSkinLikeLab(-30, 30)).toBe(false);
    expect(isSkinLikeLab(0, -40)).toBe(false);
    expect(isSkinLikeLab(0, 0)).toBe(false);
    expect(isSkinLikeLab(70, 40)).toBe(false);
  });

  it('is a softening hint, not an exclusion: warm wood can fall inside', () => {
    // Documented limitation — callers must never treat this as segmentation.
    expect(isSkinLikeLab(15, 40)).toBe(true);
  });
});

describe('isNearNeutralLab', () => {
  it('matches authored near-neutral chroma but not pure grayscale', () => {
    expect(isNearNeutralLab(1, 1)).toBe(true);
    expect(isNearNeutralLab(4, -3)).toBe(true);
    expect(isNearNeutralLab(0, 0)).toBe(false);
    expect(isNearNeutralLab(0.005, 0)).toBe(false);
  });

  it('leaves clearly colored pixels unprotected', () => {
    expect(isNearNeutralLab(10, 0)).toBe(false);
    expect(isNearNeutralLab(0, 12)).toBe(false);
  });
});
