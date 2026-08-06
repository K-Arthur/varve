/**
 * Trace contract goldens: structural invariants every provider (TS fallback,
 * WASM, native Rust) must satisfy. The native engine reaches parity with the
 * TS tracer here: compound holes are attached as ring arrays (not dropped),
 * donuts emit one path with one hole, and pixel-art mode emits hard-edged
 * pixel-aligned polygons.
 */

import { describe, expect, it } from 'vitest';
import { quantizeExactPalette, traceRasterToPaths } from './rasterTrace';

function rgba(width: number, height: number, pixels: number[]): ImageData {
  return new ImageData(new Uint8ClampedArray(pixels), width, height);
}

describe('trace contract golden', () => {
  it('emits evenodd compound rings for a donut without omitting holes', () => {
    const pixels: number[] = [];
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const dark = x >= 1 && x <= 3 && y >= 1 && y <= 3 && !(x === 2 && y === 2);
        pixels.push(dark ? 0 : 255, dark ? 0 : 255, dark ? 0 : 255, 255);
      }
    }
    const result = traceRasterToPaths(new ImageData(new Uint8ClampedArray(pixels), 5, 5), {
      simplifyTolerance: 0,
      foreground: 'dark',
      threshold: 128,
    });

    expect(result.omittedHoles).toBe(0);
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.holes).toHaveLength(1);
    // Outer starts at top-left-most of the dark ring.
    expect(result.paths[0]?.points[0]).toEqual({ x: 1, y: 1 });
  });

  it('preserves holes for thick filled regions (native-parity contract)', () => {
    // A solid annulus must trace to exactly one outer ring with one hole
    // ring — the contract the Rust engine now satisfies and that the TS
    // tracer must keep matching.
    const pixels: number[] = [];
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const dx = x - 8;
        const dy = y - 8;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ring = dist >= 3 && dist <= 7;
        pixels.push(ring ? 30 : 255, ring ? 30 : 255, ring ? 30 : 255, 255);
      }
    }
    const result = traceRasterToPaths(rgba(16, 16, pixels), {
      simplifyTolerance: 0,
      foreground: 'dark',
      threshold: 128,
    });
    expect(result.omittedHoles).toBe(0);
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.holes).toHaveLength(1);
  });

  it('pixel-art mode collapses collinear runs to corner-only polygons', () => {
    const pixels: number[] = [];
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const block = x >= 2 && x < 6 && y >= 2 && y < 6;
        pixels.push(block ? 200 : 0, block ? 30 : 0, block ? 30 : 0, block ? 255 : 0);
      }
    }
    const result = traceRasterToPaths(rgba(8, 8, pixels), {
      mode: 'pixel-art',
      maxColors: 8,
      minArea: 1,
    });
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.points).toHaveLength(4);
    expect(result.paths[0]?.points[0]).toEqual({ x: 2, y: 2 });
  });

  it('pixel-art exact palette preserves distinct sprite colors', () => {
    const source = rgba(3, 1, [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const palette = quantizeExactPalette(source, 16, 1);
    expect(palette).toHaveLength(3);
    const keys = palette.map((c) => `${c.r},${c.g},${c.b}`).sort();
    expect(keys).toEqual(['0,0,255', '0,255,0', '255,0,0']);
  });

  it('pixel-art palette merges perceptually-near colors when over budget', () => {
    const source = rgba(2, 1, [255, 0, 0, 255, 250, 4, 4, 255]);
    const palette = quantizeExactPalette(source, 1, 1);
    expect(palette).toHaveLength(1);
    expect(Math.abs((palette[0]?.r ?? 0) - 255)).toBeLessThanOrEqual(5);
  });

  it('pixel-art mode never emits open or bezier-fitted paths', () => {
    const pixels: number[] = [];
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const on = (x + y) % 2 === 0;
        pixels.push(on ? 60 : 0, on ? 120 : 0, on ? 240 : 0, 255);
      }
    }
    const result = traceRasterToPaths(rgba(4, 4, pixels), {
      mode: 'pixel-art',
      maxColors: 8,
      minArea: 1,
    });
    expect(result.paths.length).toBeGreaterThan(0);
    for (const path of result.paths) {
      expect(path.closed).toBe(true);
      for (const point of path.points) {
        expect(Number.isInteger(point.x)).toBe(true);
        expect(Number.isInteger(point.y)).toBe(true);
      }
    }
  });
});
