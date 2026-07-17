import { describe, expect, it } from 'vitest';
import { suggestFit } from './imageFitAdvisor';

describe('suggestFit', () => {
  it('returns stretch for images with near-perfect AR match', () => {
    const result = suggestFit(200, 100, 200, 100);
    expect(result.fit).toBe('stretch');
    expect(typeof result.reason).toBe('string');
  });

  it('returns fill for images wider than frame', () => {
    const result = suggestFit(300, 100, 200, 100);
    expect(result.fit).toBe('fill');
  });

  it('returns fit for images taller than frame', () => {
    const result = suggestFit(100, 300, 200, 100);
    expect(result.fit).toBe('fit');
  });

  it('returns tile for images with transparency', () => {
    const result = suggestFit(200, 100, 100, 50, true);
    expect(result.fit).toBe('tile');
  });

  it('returns stretch for unknown dimensions (0 width)', () => {
    const result = suggestFit(0, 100, 200, 100);
    expect(result.fit).toBe('stretch');
  });

  it('returns stretch for unknown dimensions (NaN)', () => {
    const result = suggestFit(NaN, 100, 200, 100);
    expect(result.fit).toBe('stretch');
  });

  it('returns fill for wider images outside 5% AR tolerance', () => {
    const result = suggestFit(220, 100, 200, 100);
    expect(result.fit).toBe('fill');
  });

  it('returns fit for taller images outside 5% AR tolerance', () => {
    const result = suggestFit(100, 220, 200, 100);
    expect(result.fit).toBe('fit');
  });
});
