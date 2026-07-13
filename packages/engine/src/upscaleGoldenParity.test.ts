/**
 * Cross-language upscale golden: nearest-neighbor 2x on a 2x2 RGBA fixture.
 * Must match crates/strata-upscale nearest test byte-for-byte.
 */

import { describe, expect, it } from 'vitest';
import { upscaleImageData } from './imageEnhancement';

/** Shared fixture with strata-upscale `nearest_golden_matches_typescript`. */
const SOURCE = new Uint8ClampedArray([
  255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
]);

const EXPECTED_NEAREST_2X = new Uint8ClampedArray([
  255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0,
  255, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 0, 255, 255, 255, 0, 255,
  0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 0, 255, 255, 255, 0, 255,
]);

describe('upscale nearest golden (TS/Rust)', () => {
  it('matches the shared nearest-neighbor 2x golden', () => {
    const source = new ImageData(SOURCE, 2, 2);
    const result = upscaleImageData(source, { scale: 2, method: 'nearest' });
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    expect([...result.data]).toEqual([...EXPECTED_NEAREST_2X]);
  });
});
