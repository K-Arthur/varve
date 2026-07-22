import { describe, expect, it } from 'vitest';
import { DD_COLOR_INPUT_SIZE, decodeDdColorOutput } from './ddcolor';

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
});
