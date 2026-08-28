// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { exportRasterizedSubtree } from './exportRasterizedSubtree';

const renderTarget = vi.fn();

describe('exportRasterizedSubtree', () => {
  it.each([
    [72, 720, 360],
    [96, 960, 480],
    [150, 1500, 750],
    [300, 3000, 1500],
    [600, 6000, 3000],
  ])('renders a 10 × 5 inch design at %i PPI with exact output dimensions', async (ppi, w, h) => {
    const result = await exportRasterizedSubtree(960, 480, [], renderTarget, {
      scale: ppi / 96,
      cssWidth: 960,
      cssHeight: 480,
    });

    expect(result.requestedPixelWidth).toBe(w);
    expect(result.requestedPixelHeight).toBe(h);
    expect(result.pixelWidth).toBe(w);
    expect(result.pixelHeight).toBe(h);
    expect(result.constrainedBy).toEqual([]);
  });

  it('preserves aspect ratio and reports the actual dimensions when the surface guard constrains output', async () => {
    const result = await exportRasterizedSubtree(40_000, 2_000, [], renderTarget, {
      scale: 1,
      cssWidth: 40_000,
      cssHeight: 2_000,
    });

    expect(result.requestedPixelWidth).toBe(40_000);
    expect(result.requestedPixelHeight).toBe(2_000);
    expect(result.pixelWidth).toBeLessThanOrEqual(16_384);
    expect(result.pixelWidth / result.pixelHeight).toBeCloseTo(20, 2);
    expect(result.constrainedBy).toContain('dimension');
  });
});
