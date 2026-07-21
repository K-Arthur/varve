import { describe, expect, it } from 'vitest';
import { recommendPresets } from './motionPresetRecommender';

describe('recommendPresets', () => {
  it('recommends Fade In for opacity+ease+300', () => {
    const results = recommendPresets('opacity', 'ease', 300);
    expect(results.length).toBeGreaterThan(0);
    const fadeIn = results.find((r) => r.presetId === 'fade-in');
    expect(fadeIn).toBeDefined();
    expect(fadeIn!.matchScore).toBeGreaterThan(0.5);
  });

  it('recommends Slide Up for position+easeOut+400', () => {
    const results = recommendPresets('position', 'easeOut', 400);
    const slideUp = results.find((r) => r.presetId === 'slide-up');
    expect(slideUp).toBeDefined();
    expect(slideUp!.matchScore).toBeGreaterThan(0.5);
  });

  it('recommends Scale In for scale+easeOut+300', () => {
    const results = recommendPresets('scale', 'easeOut', 300);
    const scaleIn = results.find((r) => r.presetId === 'scale-in');
    expect(scaleIn).toBeDefined();
    expect(scaleIn!.matchScore).toBeGreaterThan(0.5);
  });

  it('recommends Rotate for rotation+easeInOut+500', () => {
    const results = recommendPresets('rotation', 'easeInOut', 500);
    const rotate = results.find((r) => r.presetId === 'rotate');
    expect(rotate).toBeDefined();
    expect(rotate!.matchScore).toBeGreaterThan(0.5);
  });

  it('returns empty array when no presets match above 0.5 threshold', () => {
    const results = recommendPresets('opacity', 'linear', 9999);
    const aboveThreshold = results.filter((r) => r.matchScore > 0.5);
    expect(aboveThreshold).toHaveLength(0);
  });

  it('returns results sorted by matchScore descending', () => {
    const results = recommendPresets('opacity', 'ease', 300);
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.matchScore).toBeLessThanOrEqual(results[i - 1]!.matchScore);
    }
  });

  it('is deterministic: same inputs produce same output', () => {
    const a = recommendPresets('scale', 'easeOut', 300);
    const b = recommendPresets('scale', 'easeOut', 300);
    expect(a).toEqual(b);
  });

  it('fade-slide-up preset matches opacity+easeOut for partial property match', () => {
    const results = recommendPresets('opacity', 'easeOut', 400);
    const fadeSlide = results.find((r) => r.presetId === 'fade-slide-up');
    expect(fadeSlide).toBeDefined();
    expect(fadeSlide!.matchScore).toBeGreaterThan(0.5);
  });
});
