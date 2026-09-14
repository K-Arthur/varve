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

describe('traceRasterToPaths pixel-art mode', () => {
  it('traces a single pixel-art block as one hard-edged square', () => {
    const source = rgba(
      8,
      8,
      Array.from({ length: 8 * 8 * 4 }, (_, i) => {
        const x = Math.floor(i / 4) % 8;
        const y = Math.floor(i / 32);
        if (x >= 2 && x < 6 && y >= 2 && y < 6) {
          return [255, 0, 0, 255][i % 4] as number;
        }
        return i % 4 === 3 ? 0 : 0;
      }),
    );
    const result = traceRasterToPaths(source, {
      mode: 'pixel-art',
      maxColors: 8,
      minArea: 1,
    });
    expect(result.paths).toHaveLength(1);
    const path = result.paths[0];
    expect(path?.closed).toBe(true);
    // Collinear runs collapse: a square keeps exactly its 4 corners.
    expect(path?.points).toHaveLength(4);
    expect(path?.fill).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it('preserves the hole in a pixel-art ring', () => {
    const pixels: number[] = [];
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const ring =
          x >= 1 && x <= 6 && y >= 1 && y <= 6 && !(x >= 3 && x <= 4 && y >= 3 && y <= 4);
        // Background and the hole are fully transparent; only the ring is ink.
        pixels.push(ring ? 30 : 0, ring ? 30 : 0, ring ? 30 : 0, ring ? 255 : 0);
      }
    }
    const source = rgba(8, 8, pixels);
    const result = traceRasterToPaths(source, {
      mode: 'pixel-art',
      maxColors: 8,
      minArea: 1,
    });
    expect(result.omittedHoles).toBe(0);
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.holes).toHaveLength(1);
  });

  it('keeps distinct colors as separate regions and preserves transparency', () => {
    const pixels: number[] = [];
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        if (x === 0 && y === 0) pixels.push(255, 0, 0, 255);
        else if (x === 3 && y === 3) pixels.push(0, 0, 255, 255);
        else pixels.push(0, 0, 0, 0); // transparent background
      }
    }
    const source = rgba(4, 4, pixels);
    const result = traceRasterToPaths(source, {
      mode: 'pixel-art',
      maxColors: 8,
      minArea: 1,
    });
    expect(result.paths).toHaveLength(2);
    const fills = result.paths.map((p) => p.fill);
    expect(fills.some((f) => f && f.r > 200 && f.g < 50 && f.b < 50)).toBe(true);
    expect(fills.some((f) => f && f.b > 200 && f.r < 50 && f.g < 50)).toBe(true);
  });

  it('is deterministic across repeated runs', () => {
    const pixels: number[] = [];
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const c = ((x * 3 + y * 5) % 4) * 64;
        pixels.push(c, 255 - c, 40, 255);
      }
    }
    const source = rgba(16, 16, pixels);
    const options = { mode: 'pixel-art' as const, maxColors: 6, minArea: 1 };
    const a = traceRasterToPaths(source, options);
    const b = traceRasterToPaths(source, options);
    expect(a.paths.length).toBe(b.paths.length);
    expect(a.omittedHoles).toBe(b.omittedHoles);
  });

  it('rejects centerline tracing honestly instead of emitting filled paths', () => {
    const source = rgba(2, 2, [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    expect(() => traceRasterToPaths(source, { traceMode: 'centerline' })).toThrowError(
      /centerline/i,
    );
  });
});

describe('traceRasterToPaths output structure', () => {
  function ringOnBackground(
    width: number,
    height: number,
    background: [number, number, number, number],
    ring: [number, number, number],
    ringBounds: { x0: number; y0: number; x1: number; y1: number },
  ): ImageData {
    const pixels: number[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const onRing =
          x >= ringBounds.x0 &&
          x <= ringBounds.x1 &&
          y >= ringBounds.y0 &&
          y <= ringBounds.y1 &&
          !(x > ringBounds.x0 && x < ringBounds.x1 && y > ringBounds.y0 && y < ringBounds.y1);
        if (onRing) pixels.push(ring[0], ring[1], ring[2], 255);
        else pixels.push(...background);
      }
    }
    return rgba(width, height, pixels);
  }

  it('stacked output drops holes that a later region paints over', () => {
    // White background with a red ring; the ring's center is white again.
    const source = ringOnBackground(9, 9, [255, 255, 255, 255], [200, 0, 0], {
      x0: 2,
      y0: 2,
      x1: 6,
      y1: 6,
    });
    const result = traceRasterToPaths(source, {
      mode: 'pixel-art',
      maxColors: 2,
      minArea: 1,
      simplifyTolerance: 0,
      structure: 'stacked',
    });
    expect(result.omittedHoles).toBe(0);
    expect(result.paths.length).toBeGreaterThanOrEqual(3);
    for (const path of result.paths) {
      expect(path.holes ?? []).toHaveLength(0);
    }
    // Paint order is back-to-front: non-increasing area.
    for (let i = 1; i < result.paths.length; i += 1) {
      expect(result.paths[i - 1]!.area).toBeGreaterThanOrEqual(result.paths[i]!.area);
    }
    const whiteFills = result.paths.filter(
      (path) => path.fill && path.fill.r > 240 && path.fill.g > 240 && path.fill.b > 240,
    );
    expect(whiteFills).toHaveLength(2);
    const redFills = result.paths.filter(
      (path) => path.fill && path.fill.r > 150 && path.fill.g < 80 && path.fill.b < 80,
    );
    expect(redFills).toHaveLength(1);
  });

  it('stacked output keeps a hole when transparency shows through it', () => {
    const source = ringOnBackground(9, 9, [0, 0, 0, 0], [200, 0, 0], {
      x0: 2,
      y0: 2,
      x1: 6,
      y1: 6,
    });
    const result = traceRasterToPaths(source, {
      mode: 'color',
      maxColors: 2,
      minArea: 1,
      simplifyTolerance: 0,
      structure: 'stacked',
    });
    expect(result.omittedHoles).toBe(0);
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.holes).toHaveLength(1);
  });

  it('never silently drops a large white region (no hidden background heuristic)', () => {
    const pixels: number[] = [];
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        const dark = x >= 10 && x < 22 && y >= 10 && y < 22;
        if (dark) pixels.push(0, 0, 0, 255);
        else pixels.push(255, 255, 255, 255);
      }
    }
    const result = traceRasterToPaths(rgba(32, 32, pixels), {
      mode: 'color',
      maxColors: 2,
      minArea: 1,
      simplifyTolerance: 0,
    });
    const white = result.paths.filter(
      (path) => path.fill && path.fill.r > 240 && path.fill.g > 240 && path.fill.b > 240,
    );
    expect(white.length).toBeGreaterThanOrEqual(1);
    expect(white[0]?.area).toBeGreaterThan(100);
  });
});
