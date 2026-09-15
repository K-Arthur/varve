import { describe, expect, it, vi } from 'vitest';
import {
  combineMaskCoverage,
  maskCoverageFromRgba,
  putMaskCoverage,
  rasterizeMaskStroke,
  refineGenerativeMask,
} from './maskOperations';

describe('generative mask operations', () => {
  it('expands a single selected pixel without mutating the source', () => {
    const source = new Uint8Array(25);
    source[12] = 255;

    const expanded = refineGenerativeMask(source, { width: 5, height: 5 }, { expansion: 1 });

    expect([...source]).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect([...expanded]).toEqual([
      0, 0, 0, 0, 0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('feathers a hard edge into partial coverage', () => {
    const source = new Uint8Array([255, 255, 0, 0, 0]);
    const feathered = refineGenerativeMask(source, { width: 5, height: 1 }, { feather: 1 });

    expect(feathered[0]).toBe(255);
    expect(feathered[1]).toBeGreaterThan(feathered[2]!);
    expect(feathered[2]).toBeGreaterThan(0);
    expect(feathered[4]).toBe(0);
  });

  it('shrinks a selected region without changing the input mask', () => {
    const source = new Uint8Array(25).fill(255);
    const shrunk = refineGenerativeMask(source, { width: 5, height: 5 }, { expansion: -1 });

    expect([...source].every((value) => value === 255)).toBe(true);
    expect([...shrunk]).toEqual([
      0, 0, 0, 0, 0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('combines hard and soft masks with explicit operations', () => {
    const current = Uint8Array.from([0, 100, 255]);
    const incoming = Uint8Array.from([128, 200, 128]);
    expect(combineMaskCoverage(current, incoming, 'replace')).toEqual(incoming);
    expect(combineMaskCoverage(current, incoming, 'add')).toEqual(Uint8Array.from([128, 200, 255]));
    expect(combineMaskCoverage(current, incoming, 'subtract')).toEqual(
      Uint8Array.from([0, 22, 127]),
    );
    expect(combineMaskCoverage(current, incoming, 'intersect')).toEqual(
      Uint8Array.from([0, 100, 128]),
    );
  });

  it('reads alpha masks and opaque grayscale masks', () => {
    expect(maskCoverageFromRgba(new Uint8ClampedArray([10, 0, 0, 20, 30, 0, 0, 255]))).toEqual(
      new Uint8Array([20, 255]),
    );
    expect(maskCoverageFromRgba(new Uint8ClampedArray([10, 0, 0, 255, 30, 0, 0, 255]))).toEqual(
      new Uint8Array([10, 30]),
    );
  });

  it('writes opaque RGBA coverage for the preview canvas', () => {
    const putImageData = vi.fn();
    const createImageData = vi.fn(() => ({ data: new Uint8ClampedArray(8) }));
    putMaskCoverage(
      { createImageData, putImageData } as unknown as CanvasRenderingContext2D,
      new Uint8Array([0, 128]),
      { width: 2, height: 1 },
    );

    expect(createImageData).toHaveBeenCalledWith(2, 1);
    expect(putImageData).toHaveBeenCalledWith(
      { data: new Uint8ClampedArray([0, 0, 0, 255, 128, 128, 128, 255]) },
      0,
      0,
    );
  });

  it('fills the path between coalesced pointer samples', () => {
    const point = rasterizeMaskStroke({ width: 32, height: 16 }, null, { x: 3, y: 8 }, 2);
    const segment = rasterizeMaskStroke(
      { width: 32, height: 16 },
      { x: 3, y: 8 },
      { x: 20, y: 8 },
      2,
    );

    expect(point.some((value) => value > 0)).toBe(true);
    expect(segment.filter((value) => value > 0).length).toBeGreaterThan(
      point.filter((value) => value > 0).length,
    );
    for (let x = 3; x <= 20; x += 1) {
      expect(segment[8 * 32 + x]).toBe(255);
    }
  });
});
