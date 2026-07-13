import { describe, expect, it } from 'vitest';
import { traceRasterToPaths } from './rasterTrace';

function rgba(width: number, height: number, pixels: number[]): ImageData {
  return new ImageData(new Uint8ClampedArray(pixels), width, height);
}

describe('traceRasterToPaths', () => {
  it('traces a solid monochrome block into one closed path', () => {
    const source = rgba(
      3,
      3,
      [
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
      ],
    );

    const result = traceRasterToPaths(source, {
      threshold: 128,
      foreground: 'dark',
      simplifyTolerance: 0,
      minArea: 1,
    });

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.closed).toBe(true);
    expect(result.paths[0]?.points).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ]);
  });

  it('filters tiny components before path generation', () => {
    const source = rgba(2, 1, [0, 0, 0, 255, 255, 255, 255, 255]);

    const result = traceRasterToPaths(source, {
      threshold: 128,
      foreground: 'dark',
      minArea: 2,
    });

    expect(result.paths).toHaveLength(0);
  });

  it('keeps only the requested number of largest paths', () => {
    const source = rgba(
      5,
      1,
      [0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255],
    );

    const result = traceRasterToPaths(source, { maxPaths: 2, simplifyTolerance: 0 });

    expect(result.paths).toHaveLength(2);
  });

  it('attaches enclosed holes as compound path rings (evenodd)', () => {
    const pixels: number[] = [];
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const dark = x >= 1 && x <= 3 && y >= 1 && y <= 3 && !(x === 2 && y === 2);
        pixels.push(dark ? 0 : 255, dark ? 0 : 255, dark ? 0 : 255, 255);
      }
    }

    const result = traceRasterToPaths(rgba(5, 5, pixels), { simplifyTolerance: 0 });

    expect(result.omittedHoles).toBe(0);
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.holes?.length).toBe(1);
  });

  it('traces distinct colors into separately filled paths', () => {
    // 2x2: red | blue / red | blue
    const source = rgba(2, 2, [255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255]);

    const result = traceRasterToPaths(source, {
      mode: 'color',
      maxColors: 2,
      minArea: 1,
      simplifyTolerance: 0,
    });

    expect(result.paths.length).toBeGreaterThanOrEqual(2);
    const fills = result.paths.map((path) => path.fill);
    expect(fills.some((f) => f && f.r > 200 && f.g < 50 && f.b < 50)).toBe(true);
    expect(fills.some((f) => f && f.b > 200 && f.r < 50 && f.g < 50)).toBe(true);
  });

  it('grayscale mode collapses to luminance bands with gray fills', () => {
    const source = rgba(2, 1, [40, 40, 40, 255, 200, 200, 200, 255]);
    const result = traceRasterToPaths(source, {
      mode: 'grayscale',
      maxColors: 2,
      minArea: 1,
      simplifyTolerance: 0,
    });

    expect(result.paths.length).toBeGreaterThanOrEqual(1);
    for (const path of result.paths) {
      expect(path.fill).toBeDefined();
      expect(path.fill?.r).toBe(path.fill?.g);
      expect(path.fill?.g).toBe(path.fill?.b);
    }
  });
});
