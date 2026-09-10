import { describe, expect, it } from 'vitest';
import { selectiveRecolor } from './recolor';

describe('selectiveRecolor', () => {
  it('preserves pixels outside mask', () => {
    const data = new Uint8ClampedArray([128, 128, 128, 255]);
    const src = new ImageData(1, 1);
    src.data.set(data);
    const mask = new Uint8Array([0]);
    const result = selectiveRecolor(src, mask, 1, 1, 180, 1, 1);
    expect(result.data[0]).toBe(128);
    expect(result.data[1]).toBe(128);
    expect(result.data[2]).toBe(128);
  });

  it('modifies masked pixels when hue is non-zero', () => {
    const data = new Uint8ClampedArray([200, 100, 50, 255]);
    const src = new ImageData(1, 1);
    src.data.set(data);
    const mask = new Uint8Array([255]);
    const result = selectiveRecolor(src, mask, 1, 1, 90, 1, 1);
    const changed = result.data[0] !== 200 || result.data[1] !== 100 || result.data[2] !== 50;
    expect(changed).toBe(true);
  });

  it('preserves alpha channel', () => {
    const data = new Uint8ClampedArray([200, 100, 50, 128]);
    const src = new ImageData(1, 1);
    src.data.set(data);
    const mask = new Uint8Array([255]);
    const result = selectiveRecolor(src, mask, 1, 1, 0, 1, 1);
    expect(result.data[3]).toBe(128);
  });
});
