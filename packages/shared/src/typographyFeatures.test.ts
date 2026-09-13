import { describe, expect, it } from 'vitest';
import {
  normalizeOpenTypeFeatureMap,
  openTypeFeaturesToCss,
  resolveOpenTypeFeatureMaps,
} from './typographyFeatures';

describe('OpenType feature contract', () => {
  it('keeps unset, explicit off, Boolean on, and indexed values distinct', () => {
    const result = normalizeOpenTypeFeatureMap(
      { liga: false, calt: true, ss01: 3, salt: { value: 2 } },
      12,
    );

    expect(result.warnings).toEqual([]);
    expect(result.features).toEqual([
      { tag: 'liga', value: 0, startUtf16: 0, endUtf16: 12 },
      { tag: 'calt', value: 1, startUtf16: 0, endUtf16: 12 },
      { tag: 'ss01', value: 3, startUtf16: 0, endUtf16: 12 },
      { tag: 'salt', value: 2, startUtf16: 0, endUtf16: 12 },
    ]);
  });

  it('normalizes source-local feature ranges and preserves their order', () => {
    const result = normalizeOpenTypeFeatureMap(
      {
        cv01: {
          value: 1,
          ranges: [
            { startUtf16: 2, endUtf16: 5, value: 4 },
            { startUtf16: -10, endUtf16: 100, value: false },
          ],
        },
      },
      8,
    );

    expect(result.features).toEqual([
      { tag: 'cv01', value: 1, startUtf16: 0, endUtf16: 8 },
      { tag: 'cv01', value: 4, startUtf16: 2, endUtf16: 5 },
      { tag: 'cv01', value: 0, startUtf16: 0, endUtf16: 8 },
    ]);
  });

  it('merges layers without deep-merging a replaced feature setting', () => {
    const result = resolveOpenTypeFeatureMaps(
      { liga: true, ss01: { value: 2 } },
      { liga: false, custom: { ss01: 4, swsh: true } },
      { salt: 3 },
    );

    expect(result.liga).toBe(false);
    expect(result.ss01).toEqual({ value: 2 });
    expect(result.salt).toBe(3);
    expect(result.custom).toEqual({ ss01: 4, swsh: true });
  });

  it('rejects invalid tags, non-finite values, and empty ranges', () => {
    const result = normalizeOpenTypeFeatureMap(
      {
        bad: true,
        lig: true,
        liga: Number.NaN,
        kern: { value: true, ranges: [{ startUtf16: 4, endUtf16: 4, value: 1 }] },
      },
      10,
    );

    expect(result.features).toEqual([{ tag: 'kern', value: 1, startUtf16: 0, endUtf16: 10 }]);
    expect(result.warnings).toHaveLength(4);
  });

  it('serializes only whole-run settings for CSS fallback', () => {
    expect(openTypeFeaturesToCss({ liga: true, ss01: 2 })).toBe('"liga" 1, "ss01" 2');
    expect(
      openTypeFeaturesToCss({
        liga: { value: true, ranges: [{ startUtf16: 0, endUtf16: 1, value: 0 }] },
      }),
    ).toBeUndefined();
  });
});
