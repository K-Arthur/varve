import { describe, expect, it } from 'vitest';
import { ShapingCache } from './shapingCache';
import type { TextShaping } from './types';

const shaping: TextShaping = {
  runs: [],
  width: 0,
  height: 0,
  baseDirection: 'ltr',
  direction: 'ltr',
};

describe('ShapingCache identity', () => {
  it('separates font revisions and shaping policy from the source text', () => {
    const cache = new ShapingCache();
    cache.set('office', 'Inter', 16, 'ltr', 'en', shaping, {
      fontRevision: 'font:1',
      featureKey: 'liga=1',
      variationKey: 'wght=400',
      maxWidth: 240,
      layoutMode: 'single-line',
    });

    expect(
      cache.get('office', 'Inter', 16, 'ltr', 'en', {
        fontRevision: 'font:1',
        featureKey: 'liga=1',
        variationKey: 'wght=400',
        maxWidth: 240,
        layoutMode: 'single-line',
      }),
    ).toBe(shaping);
    expect(
      cache.get('office', 'Inter', 16, 'ltr', 'en', {
        fontRevision: 'font:2',
        featureKey: 'liga=1',
        variationKey: 'wght=400',
        maxWidth: 240,
        layoutMode: 'single-line',
      }),
    ).toBeUndefined();
  });

  it('tracks estimated bytes and evicts by the configured byte budget', () => {
    const cache = new ShapingCache(10, 1);
    cache.set('a', 'Inter', 16, 'ltr', '', shaping);
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });
});
