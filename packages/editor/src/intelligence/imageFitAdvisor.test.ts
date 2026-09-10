import { describe, expect, it } from 'vitest';
import { suggestFit } from './imageFitAdvisor';

describe('suggestFit', () => {
  it('suggests cover for images wider than the frame', () => {
    const result = suggestFit(1000, 500, 500, 500);
    expect(result.fit).toBe('cover');
  });

  it('suggests contain for images taller than the frame', () => {
    const result = suggestFit(500, 1000, 500, 500);
    expect(result.fit).toBe('contain');
  });

  it('suggests fill for a near-perfect aspect ratio match', () => {
    const result = suggestFit(500, 500, 500, 500);
    expect(result.fit).toBe('fill');
  });

  it('suggests crop for images with transparency in a path shape', () => {
    const result = suggestFit(500, 500, 500, 500, true);
    expect(result.fit).toBe('crop');
  });

  it('respects an existing imageFit setting', () => {
    const result = suggestFit(1000, 500, 500, 500, false, 'fit');
    expect(result.fit).toBe('contain');
  });

  it('defaults to fill when image dimensions are unknown', () => {
    const result = suggestFit(0, 500, 500, 500);
    expect(result.fit).toBe('fill');
  });

  it('defaults to fill when image dimensions are NaN', () => {
    const result = suggestFit(NaN, 500, 500, 500);
    expect(result.fit).toBe('fill');
  });

  it('suggests fill when aspect ratios are within 5% tolerance', () => {
    const result = suggestFit(204, 100, 200, 100);
    expect(result.fit).toBe('fill');
  });
});
