// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { dHash, hammingDistance, pHash, rankBySimilarity } from './perceptualHash';

function makeTestImageData(
  width: number,
  height: number,
  fillFn: (x: number, y: number) => [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fillFn(x, y);
      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return new ImageData(data, width, height);
}

describe('dHash', () => {
  it('produces a hex string', () => {
    const img = makeTestImageData(16, 16, () => [255, 0, 0, 255]);
    const hash = dHash(img);
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash.length).toBe(16); // 64 bits = 16 hex chars
  });

  it('produces identical hashes for identical images', () => {
    const img = makeTestImageData(32, 32, () => [128, 128, 128, 255]);
    const hash1 = dHash(img);
    const hash2 = dHash(img);
    expect(hash1).toBe(hash2);
  });

  it('produces similar hashes for similar images', () => {
    // Use alternating vertical stripes — creates horizontal edges dHash can detect
    const stripes4 = makeTestImageData(32, 32, (x) =>
      Math.floor(x / 4) % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    );
    const stripes5 = makeTestImageData(32, 32, (x) =>
      Math.floor(x / 5) % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    );
    // Different: checkerboard pattern
    const checker = makeTestImageData(32, 32, (x, y) =>
      (x + y) % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    );

    const hash4 = dHash(stripes4);
    const hash5 = dHash(stripes5);
    const hashCheck = dHash(checker);

    const simDist = hammingDistance(hash4, hash5);
    const checkDist = hammingDistance(hash4, hashCheck);

    expect(simDist).toBeLessThan(checkDist);
  });

  it('produces different hashes for different images', () => {
    const stripes4 = makeTestImageData(32, 32, (x) =>
      Math.floor(x / 4) % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    );
    const stripes8 = makeTestImageData(32, 32, (x) =>
      Math.floor(x / 8) % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    );

    expect(dHash(stripes4)).not.toBe(dHash(stripes8));
  });
});

describe('pHash', () => {
  it('produces a hex string', () => {
    const img = makeTestImageData(32, 32, () => [100, 100, 100, 255]);
    const hash = pHash(img);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('produces identical hashes for identical images', () => {
    const img = makeTestImageData(32, 32, () => [64, 128, 192, 255]);
    const hash1 = pHash(img);
    const hash2 = pHash(img);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different images', () => {
    const stripes4 = makeTestImageData(32, 32, (x) =>
      Math.floor(x / 4) % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    );
    const stripes8 = makeTestImageData(32, 32, (x) =>
      Math.floor(x / 8) % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    );

    expect(pHash(stripes4)).not.toBe(pHash(stripes8));
  });
});

describe('hammingDistance', () => {
  it('returns 0 for identical hashes', () => {
    expect(hammingDistance('aabb', 'aabb')).toBe(0);
  });

  it('returns non-zero for different hashes', () => {
    expect(hammingDistance('0000', 'ffff')).toBeGreaterThan(0);
  });

  it('handles different length hashes', () => {
    const dist = hammingDistance('a', 'aa');
    expect(dist).toBeGreaterThanOrEqual(0);
  });
});

describe('rankBySimilarity', () => {
  it('ranks by increasing distance', () => {
    const hashes = [
      { id: 'a', hash: '0000' },
      { id: 'b', hash: '0001' },
      { id: 'c', hash: 'ffff' },
    ];

    const ranked = rankBySimilarity('0000', hashes);
    expect(ranked[0]!.id).toBe('a');
    expect(ranked[1]!.id).toBe('b');
    expect(ranked[2]!.id).toBe('c');
  });

  it('returns empty for no candidates', () => {
    expect(rankBySimilarity('abc', [])).toEqual([]);
  });
});
