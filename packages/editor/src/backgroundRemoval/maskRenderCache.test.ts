import { describe, expect, it } from 'vitest';
import { maskRenderDimensions, maskRenderUrl } from './maskRenderCache';

describe('mask render cache sizing', () => {
  it('keeps small masks at source resolution', () => {
    expect(maskRenderDimensions(1024, 768)).toEqual({ width: 1024, height: 768 });
  });

  it('bounds a large landscape mask without changing its aspect ratio', () => {
    expect(maskRenderDimensions(8803, 5919)).toEqual({ width: 2048, height: 1377 });
  });

  it('bounds portrait and panoramic masks by their longest edge', () => {
    expect(maskRenderDimensions(1200, 4800)).toEqual({ width: 512, height: 2048 });
    expect(maskRenderDimensions(8000, 1000)).toEqual({ width: 2048, height: 256 });
  });

  it('returns a safe minimum for invalid metadata', () => {
    expect(maskRenderDimensions(0, Number.NaN)).toEqual({ width: 1, height: 1 });
  });

  it('keeps the full-resolution URL when no live render proxy is registered', () => {
    expect(maskRenderUrl('data:image/png;base64,full-resolution')).toBe(
      'data:image/png;base64,full-resolution',
    );
  });
});
