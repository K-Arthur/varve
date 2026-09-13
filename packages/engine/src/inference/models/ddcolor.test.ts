import { describe, expect, it } from 'vitest';
import { DD_COLOR_INPUT_SIZE, ddColorInputFromSource, decodeDdColorOutput } from './ddcolor';

describe('decodeDdColorOutput', () => {
  it('DD_COLOR_INPUT_SIZE is 512', () => {
    expect(DD_COLOR_INPUT_SIZE).toBe(512);
  });

  it('returns correctly sized planes for square input', () => {
    const size = 512;
    const data = new Float32Array(size * size * 2);
    const result = decodeDdColorOutput(data, size, size, size, size);
    expect(result.a.length).toBe(size * size);
    expect(result.b.length).toBe(size * size);
  });

  it('resizes output to non-square target dimensions', () => {
    const size = 512;
    const data = new Float32Array(size * size * 2);
    for (let i = 0; i < size * size; i++) {
      data[i] = 10;
      data[size * size + i] = -5;
    }
    const result = decodeDdColorOutput(data, size, size, 256, 128);
    expect(result.a.length).toBe(256 * 128);
    expect(result.b.length).toBe(256 * 128);
  });

  it('crops letterbox padding before resize', () => {
    const size = 512;
    const data = new Float32Array(size * size * 2);
    for (let i = 0; i < size * size; i++) {
      data[i] = 42;
      data[size * size + i] = -17;
    }
    const result = decodeDdColorOutput(data, size, size, 512, 256, {
      offsetX: 0,
      offsetY: 128,
    });
    expect(result.a.length).toBe(512 * 256);
    expect(result.b.length).toBe(512 * 256);
    expect(result.a[0]).toBe(42);
    expect(result.b[0]).toBe(-17);
  });

  it('uses explicit asymmetric content bounds when reversing letterbox geometry', () => {
    const width = 6;
    const height = 4;
    const data = new Float32Array(width * height * 2);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        data[y * width + x] = y * 10 + x;
        data[width * height + y * width + x] = -(y * 10 + x);
      }
    }
    const result = decodeDdColorOutput(data, width, height, 3, 2, {
      offsetX: 1,
      offsetY: 1,
      contentWidth: 3,
      contentHeight: 2,
    });
    expect(result.a.length).toBe(6);
    expect(result.a[0]).toBe(11);
    expect(result.b[0]).toBe(-11);
  });

  it('rejects malformed or non-finite model tensors', () => {
    expect(() => decodeDdColorOutput(new Float32Array(3), 2, 2, 2, 2)).toThrow('output length');
    const malformed = new Float32Array(8);
    malformed[0] = Number.NaN;
    expect(() => decodeDdColorOutput(malformed, 2, 2, 2, 2)).toThrow('non-finite');
  });
});

describe('ddColorInputFromSource', () => {
  it('converts a saturated source to neutral RGB with the same lightness', () => {
    const source = new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1);
    const result = ddColorInputFromSource(source);
    const [r, g, b, a] = Array.from(result.data);
    expect(Math.abs((r ?? 0) - (g ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((g ?? 0) - (b ?? 0))).toBeLessThanOrEqual(1);
    expect(a).toBe(255);
    // Pure red has L* ~= 53.24, which is mid-gray, not black or white.
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(160);
  });

  it('leaves an already-neutral pixel essentially unchanged', () => {
    const source = new ImageData(new Uint8ClampedArray([128, 128, 128, 200]), 1, 1);
    const result = ddColorInputFromSource(source);
    const [r, g, b, a] = Array.from(result.data);
    expect(Math.abs((r ?? 0) - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs((g ?? 0) - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs((b ?? 0) - 128)).toBeLessThanOrEqual(1);
    expect(a).toBe(200);
  });

  it('keeps distinct source luminances distinct and ordered', () => {
    const source = new ImageData(
      new Uint8ClampedArray([20, 60, 200, 255, 200, 200, 200, 255]),
      2,
      1,
    );
    const result = ddColorInputFromSource(source);
    const dark = result.data[0] ?? 0;
    const light = result.data[4] ?? 0;
    expect(dark).toBeLessThan(light);
    expect(light - dark).toBeGreaterThan(30);
  });

  it('rejects zero-sized sources', () => {
    const invalid = { width: 0, height: 0, data: new Uint8ClampedArray(0) } as ImageData;
    expect(() => ddColorInputFromSource(invalid)).toThrow('positive integers');
  });
});
