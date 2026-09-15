import { describe, expect, it } from 'vitest';
import { upscaleCacheClear, upscaleCacheGet, upscaleCacheSet } from './upscaleCache';

function makeImageData(
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
  a: number,
): ImageData {
  const data = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const off = i * 4;
    data.data[off] = r;
    data.data[off + 1] = g;
    data.data[off + 2] = b;
    data.data[off + 3] = a;
  }
  return data;
}

describe('upscaleCache', () => {
  it('returns null for a cache miss', () => {
    upscaleCacheClear();
    const src = makeImageData(4, 4, 255, 0, 0, 255);
    expect(upscaleCacheGet(src, 2, 'lanczos3')).toBeNull();
  });

  it('returns cached data on a cache hit', () => {
    upscaleCacheClear();
    const src = makeImageData(4, 4, 0, 128, 255, 255);
    const result = makeImageData(8, 8, 0, 128, 255, 255);
    upscaleCacheSet(src, 2, 'lanczos3', result);
    const cached = upscaleCacheGet(src, 2, 'lanczos3');
    expect(cached).not.toBeNull();
    expect(cached!.width).toBe(8);
    expect(cached!.height).toBe(8);
  });

  it('returns null when method differs', () => {
    upscaleCacheClear();
    const src = makeImageData(4, 4, 100, 200, 50, 255);
    const result = makeImageData(8, 8, 100, 200, 50, 255);
    upscaleCacheSet(src, 2, 'lanczos3', result);
    expect(upscaleCacheGet(src, 2, 'ai')).toBeNull();
  });

  it('clear removes all entries', () => {
    upscaleCacheClear();
    const src = makeImageData(2, 2, 10, 20, 30, 255);
    const result = makeImageData(4, 4, 10, 20, 30, 255);
    upscaleCacheSet(src, 2, 'lanczos3', result);
    expect(upscaleCacheGet(src, 2, 'lanczos3')).not.toBeNull();
    upscaleCacheClear();
    expect(upscaleCacheGet(src, 2, 'lanczos3')).toBeNull();
  });
});
