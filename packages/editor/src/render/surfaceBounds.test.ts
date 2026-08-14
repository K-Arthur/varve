import { describe, expect, it } from 'vitest';
import { alphaBounds } from './surfaceBounds';

describe('alphaBounds', () => {
  it('returns the rendered non-transparent extent', () => {
    const data = new Uint8ClampedArray(5 * 4 * 4);
    data[(1 * 5 + 2) * 4 + 3] = 255;
    data[(3 * 5 + 4) * 4 + 3] = 128;
    const context = {
      getImageData: () => ({ data }),
    } as unknown as CanvasRenderingContext2D;

    expect(alphaBounds(context, 5, 4)).toEqual({ x: 2, y: 1, w: 3, h: 3 });
  });

  it('returns null for an empty target surface', () => {
    const context = {
      getImageData: () => ({ data: new Uint8ClampedArray(3 * 2 * 4) }),
    } as unknown as CanvasRenderingContext2D;
    expect(alphaBounds(context, 3, 2)).toBeNull();
  });
});
