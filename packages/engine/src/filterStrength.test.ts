import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyFilterWithCompositing } from './filterCompositor';
import type { FilterIR } from './types';

// Force the allocation-failure route; pixels still pass through the production
// kernel and strength compositor rather than a mock of their arithmetic.
vi.mock('./rasterSurface', () => ({
  createRasterSurface: () => {
    throw new Error('No intermediate surface');
  },
}));
afterEach(() => vi.restoreAllMocks());

function render(pixel: number[], filter: FilterIR): number[] {
  let pixels = new ImageData(new Uint8ClampedArray(pixel), 1, 1);
  const ctx = {
    getImageData: () => new ImageData(new Uint8ClampedArray(pixels.data), 1, 1),
    putImageData: (next: ImageData) => {
      pixels = next;
    },
  } as unknown as CanvasRenderingContext2D;
  applyFilterWithCompositing(ctx, [filter], 1, 1);
  return Array.from(pixels.data);
}

describe('normal filter strength is a replacement mix', () => {
  it.each([0, 0.25, 0.5, 1])(
    'preserves neutral semitransparent pixels at strength %s',
    (opacity) => {
      expect(
        render([120, 80, 40, 128], {
          kind: 'brightness',
          value: 0,
          opacity,
          blendMode: 'normal',
        }),
      ).toEqual([120, 80, 40, 128]);
    },
  );
  it('interpolates color without accumulating source coverage', () => {
    expect(
      render([40, 80, 120, 128], {
        kind: 'invert',
        value: 100,
        opacity: 0.5,
        blendMode: 'normal',
      }),
    ).toEqual([128, 128, 128, 128]);
  });
  it('interpolates alpha-changing operations rather than enforcing source alpha', () => {
    expect(
      render([120, 80, 40, 128], {
        kind: 'opacity',
        value: 0,
        opacity: 0.5,
        blendMode: 'normal',
      }),
    ).toEqual([120, 80, 40, 64]);
  });
  it('bypasses even an unsupported operation at zero strength', () => {
    expect(
      render([120, 80, 40, 128], {
        kind: 'futureFilter',
        opacity: 0,
        blendMode: 'normal',
      } as unknown as FilterIR),
    ).toEqual([120, 80, 40, 128]);
  });
});
