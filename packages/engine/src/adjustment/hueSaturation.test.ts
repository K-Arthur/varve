// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  applyHueSaturation,
  HUE_SATURATION_RANGES,
  type HueSaturationParams,
} from './hueSaturation';

function params(): HueSaturationParams {
  return Object.fromEntries(
    HUE_SATURATION_RANGES.map((range) => [range, { hue: 0, saturation: 0, lightness: 0 }]),
  ) as HueSaturationParams;
}

describe('hue/saturation ranges', () => {
  it('adjusts only the selected hue family and preserves alpha', () => {
    const input = new ImageData(new Uint8ClampedArray([255, 0, 0, 123, 0, 0, 255, 0]), 2, 1);
    const next = params();
    next.reds.hue = 60;
    applyHueSaturation(input, next);
    expect(input.data[3]).toBe(123);
    expect(input.data[1]).toBeGreaterThan(0);
    expect(input.data[2]).toBe(0);
    expect([...input.data.slice(4)]).toEqual([0, 0, 255, 0]);
  });
});
