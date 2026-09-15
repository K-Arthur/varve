import { describe, expect, it } from 'vitest';
import {
  computeUpscaleDimensions,
  type UpscaleOptions,
  upscaleImageData,
} from './imageEnhancement';

function imageData(width: number, height: number, pixels: number[]): ImageData {
  return new ImageData(new Uint8ClampedArray(pixels), width, height);
}

describe('computeUpscaleDimensions', () => {
  it('preserves aspect ratio from a scale factor', () => {
    expect(computeUpscaleDimensions(320, 180, { scale: 2 })).toEqual({
      width: 640,
      height: 360,
    });
  });

  it('derives the missing target dimension from the source aspect ratio', () => {
    expect(computeUpscaleDimensions(320, 180, { targetWidth: 960 })).toEqual({
      width: 960,
      height: 540,
    });
  });

  it('rejects invalid or unsafe dimensions', () => {
    expect(() => computeUpscaleDimensions(0, 100, { scale: 2 })).toThrow('Source dimensions');
    expect(() => computeUpscaleDimensions(100, 100, { scale: 0 })).toThrow('scale');
    expect(() => computeUpscaleDimensions(4000, 4000, { scale: 4, maxPixels: 10_000_000 })).toThrow(
      'maximum',
    );
  });
});

describe('upscaleImageData', () => {
  it('uses nearest-neighbor for pixel-art upscaling', () => {
    const source = imageData(2, 1, [255, 0, 0, 255, 0, 0, 255, 255]);
    const result = upscaleImageData(source, {
      scale: 2,
      method: 'nearest',
    });

    expect(result.width).toBe(4);
    expect(result.height).toBe(2);
    expect([...result.data.slice(0, 8)]).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
    expect([...result.data.slice(8, 16)]).toEqual([0, 0, 255, 255, 0, 0, 255, 255]);
  });

  it('interpolates transparent edges without leaking hidden RGB fringe colors', () => {
    const source = imageData(2, 1, [255, 0, 0, 0, 255, 255, 255, 255]);
    const options: UpscaleOptions = { targetWidth: 3, targetHeight: 1, method: 'bilinear' };

    const result = upscaleImageData(source, options);
    const center = [...result.data.slice(4, 8)];

    expect(center[0]).toBeGreaterThan(240);
    expect(center[1]).toBeGreaterThan(240);
    expect(center[2]).toBeGreaterThan(240);
    expect(center[3]).toBeGreaterThan(100);
    expect(center[3]).toBeLessThan(220);
  });

  it('clamps bilinear samples at the image border instead of bleeding inward', () => {
    const source = imageData(2, 1, [255, 0, 0, 255, 0, 0, 255, 255]);

    const result = upscaleImageData(source, {
      scale: 2,
      method: 'bilinear',
    });

    expect([...result.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...result.data.slice(12, 16)]).toEqual([0, 0, 255, 255]);
  });

  it('bicubic doubles pixel dimensions without alpha corruption', () => {
    const source = imageData(2, 1, [0, 128, 255, 255, 255, 0, 0, 128]);
    const result = upscaleImageData(source, { scale: 2, method: 'bicubic' });
    expect(result.width).toBe(4);
    expect(result.height).toBe(2);
    expect(result.data.length).toBe(32);
  });

  it('bicubic preserves transparent edge without leaking fringe', () => {
    const source = imageData(2, 1, [255, 0, 0, 0, 0, 255, 0, 255]);
    const result = upscaleImageData(source, { targetWidth: 4, targetHeight: 1, method: 'bicubic' });
    const midLeft = [...result.data.slice(4, 8)];
    expect(midLeft[3]).toBeGreaterThan(0);
    expect(midLeft[3]).toBeLessThan(255);
  });

  it('lanczos3 doubles pixel dimensions without alpha corruption', () => {
    const source = imageData(2, 1, [0, 128, 255, 255, 255, 0, 0, 128]);
    const result = upscaleImageData(source, { scale: 2, method: 'lanczos3' });
    expect(result.width).toBe(4);
    expect(result.height).toBe(2);
    expect(result.data.length).toBe(32);
  });

  it('lanczos3 preserves transparent edge without leaking fringe', () => {
    const source = imageData(2, 1, [255, 0, 0, 0, 0, 255, 0, 255]);
    const result = upscaleImageData(source, {
      targetWidth: 4,
      targetHeight: 1,
      method: 'lanczos3',
    });
    const midLeft = [...result.data.slice(4, 8)];
    expect(midLeft[3]).toBeGreaterThan(0);
    expect(midLeft[3]).toBeLessThan(255);
  });

  it('never silently treats an AI request as conventional resampling', () => {
    const source = imageData(1, 1, [10, 20, 30, 255]);

    expect(() => upscaleImageData(source, { method: 'ai' })).toThrow(/not available/i);
  });
});
