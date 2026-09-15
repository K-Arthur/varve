import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyFilterWithCompositing } from './filterCompositor';
import type { FilterIR } from './types';

vi.mock('./rasterSurface', () => ({
  createRasterSurface: () => {
    throw new Error('No intermediate surface');
  },
}));
afterEach(() => vi.restoreAllMocks());

function render(filter: FilterIR): { output: Uint8ClampedArray; before: Uint8ClampedArray } {
  let pixels = new Uint8ClampedArray(9 * 9 * 4);
  for (let y = 0; y < 9; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      const i = (y * 9 + x) * 4;
      pixels[i] = 30 + x * 20;
      pixels[i + 1] = 30 + y * 20;
      pixels[i + 2] = 40 + ((x + y) % 3) * 35;
      pixels[i + 3] = 255;
    }
  }
  const before = new Uint8ClampedArray(pixels);
  const ctx = {
    getImageData: () => new ImageData(new Uint8ClampedArray(pixels), 9, 9),
    putImageData: (next: ImageData) => {
      pixels = new Uint8ClampedArray(next.data);
    },
  } as unknown as CanvasRenderingContext2D;
  applyFilterWithCompositing(ctx, [filter], 9, 9, {
    treatmentSpace: { pixelToTreatment: [1, 0, 0, 1, 0, 0], pixelsPerUnit: 1 },
  });
  return { output: pixels, before };
}

describe('spatial additions through the FilterIR compositor', () => {
  it.each([
    {
      kind: 'motionBlur',
      distance: 8,
      angle: 20,
      opacity: 1,
      blendMode: 'normal',
    },
    {
      kind: 'mosaic',
      blockSize: 4,
      originX: 0,
      originY: 0,
      opacity: 1,
      blendMode: 'normal',
    },
    {
      kind: 'surfaceSmooth',
      radius: 3,
      sensitivity: 24,
      opacity: 1,
      blendMode: 'normal',
    },
    {
      kind: 'edgeInk',
      radius: 1,
      threshold: 0.1,
      softness: 0.2,
      foregroundColor: [20, 30, 40] as const,
      backgroundColor: [250, 248, 240] as const,
      transparentBackground: false,
      opacity: 1,
      blendMode: 'normal',
    },
  ] as FilterIR[])('executes %s via software FilterIR replay', (filter) => {
    const { output, before } = render(filter);
    expect(output.length).toBe(9 * 9 * 4);
    expect(output.some((value, index) => value !== before[index])).toBe(true);
  });
});
