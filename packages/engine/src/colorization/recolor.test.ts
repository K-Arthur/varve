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

  it('introduces chroma into a grayscale pixel for an absolute hue target', () => {
    const src = new ImageData(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1);
    const result = selectiveRecolor(src, new Uint8Array([255]), 1, 1, 120, 1, 1);

    expect(result.data[0] === result.data[1] && result.data[1] === result.data[2]).toBe(false);
    expect(result.data[1] ?? 0).toBeGreaterThan(result.data[0] ?? 0);
  });

  it('uses the full mask when mask and source dimensions differ', () => {
    const src = new ImageData(2, 2);
    src.data.fill(128);
    for (let i = 3; i < src.data.length; i += 4) src.data[i] = 255;

    const result = selectiveRecolor(src, new Uint8Array([255]), 1, 1, 120, 1, 1);
    for (let i = 0; i < result.data.length; i += 4) {
      expect(
        result.data[i] === result.data[i + 1] && result.data[i + 1] === result.data[i + 2],
      ).toBe(false);
    }
  });

  it('treats zero blend strength as an identity operation', () => {
    const src = new ImageData(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1);
    const result = selectiveRecolor(src, new Uint8Array([255]), 1, 1, 120, 1, 1, 0);
    expect(Array.from(result.data)).toEqual(Array.from(src.data));
  });

  it('rejects a mask whose declared dimensions do not contain its pixels', () => {
    const src = new ImageData(1, 1);
    expect(() => selectiveRecolor(src, new Uint8Array([255]), 2, 2, 120, 1, 1)).toThrow(
      'mask dimensions',
    );
  });
});
