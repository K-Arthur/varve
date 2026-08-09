/**
 * Downsampling correctness corpus: premultiplied-alpha behaviour, edge
 * clamping, determinism, sparse holes, and cascade quality. Pin the
 * anti-halo contract: averaged straight RGBA would darken antialiased
 * transparent edges; the pyramid must preserve edge coverage (brief §17).
 */
import { describe, expect, it } from 'vitest';
import {
  type ChildTileSource,
  downsampleParentTile,
  parentTileContentSize,
  splitIntoTiles,
} from './downsample';
import { PYRAMID_TILE_SIZE } from './pyramid';

const T = PYRAMID_TILE_SIZE;

function solidTile(r: number, g: number, b: number, a: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(T * T * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  }
  return px;
}

function childrenAt(
  tiles: Map<string, Uint8ClampedArray>,
  col: number,
  row: number,
): ChildTileSource[] {
  // Immediate children are the 2x2 block at (2c,2r) in level-(level-1) coords.
  const out: ChildTileSource[] = [];
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const c = col * 2 + dx;
      const r = row * 2 + dy;
      out.push({ coord: { col: c, row: r }, pixels: tiles.get(`${c}:${r}`) });
    }
  }
  return out;
}

describe('premultiplied-alpha downsampling', () => {
  it('averages an opaque 1px checkerboard exactly', () => {
    // 1px red/blue checkerboard across all four children: every parent
    // texel averages 2 red + 2 blue -> purple 128,0,128 at full alpha.
    const mk = (r: number, g: number, b: number) => {
      const px = new Uint8ClampedArray(T * T * 4);
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          const i = (y * T + x) * 4;
          if ((x + y) % 2 === 0) {
            px[i] = r;
            px[i + 1] = g;
            px[i + 2] = b;
          } else {
            px[i] = 0;
            px[i + 1] = 0;
            px[i + 2] = 255;
          }
          px[i + 3] = 255;
        }
      }
      return px;
    };
    const tiles = new Map<string, Uint8ClampedArray>();
    tiles.set('0:0', mk(255, 0, 0));
    tiles.set('1:0', mk(255, 0, 0));
    tiles.set('0:1', mk(255, 0, 0));
    tiles.set('1:1', mk(255, 0, 0));
    const out = downsampleParentTile({
      childLevel: { width: 256, height: 256 },
      children: childrenAt(tiles, 0, 0),
      parent: { col: 0, row: 0 },
    });
    expect(out[0]).toBe(128); // (255+0+0+255)/4 = 127.5, rounds half-up
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(128);
    expect(out[3]).toBe(255);
  });

  it('preserves edge coverage of antialiased black-on-transparent (no dark halo)', () => {
    // A 2x2 region with three transparent pixels and one half-alpha black:
    // straight average would give R=G=B=0 (black) at alpha 63.75/255 with the
    // premultiplied formula the RGB must scale with alpha coverage.
    const px = new Uint8ClampedArray(T * T * 4);
    for (let i = 0; i < px.length; i += 4) {
      px[i + 3] = 0;
    }
    // Top-left texel: black at 50% alpha.
    px[0] = 0;
    px[1] = 0;
    px[2] = 0;
    px[3] = 128;
    const tiles = new Map<string, Uint8ClampedArray>();
    tiles.set('0:0', px);
    // Other three children empty (sparse: absent tiles -> transparent).
    const out = downsampleParentTile({
      childLevel: { width: 256, height: 256 },
      children: [
        { coord: { col: 0, row: 0 }, pixels: px },
        { coord: { col: 1, row: 0 } },
        { coord: { col: 0, row: 1 } },
        { coord: { col: 1, row: 1 } },
      ],
      parent: { col: 0, row: 0 },
    });
    // Alpha = 128/255 / 4 = 0.125 -> 31.875 -> 32; RGB stays black.
    expect(out[3]).toBe(32);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('keeps semi-transparent strokes from darkening (white on transparent)', () => {
    const px = new Uint8ClampedArray(T * T * 4);
    for (let i = 0; i < px.length; i += 4) {
      px[i] = 255;
      px[i + 1] = 255;
      px[i + 2] = 255;
      px[i + 3] = 51; // 20% white
    }
    const out = downsampleParentTile({
      childLevel: { width: 256, height: 256 },
      children: [
        { coord: { col: 0, row: 0 }, pixels: px },
        { coord: { col: 1, row: 0 }, pixels: px },
        { coord: { col: 0, row: 1 }, pixels: px },
        { coord: { col: 1, row: 1 }, pixels: px },
      ],
      parent: { col: 0, row: 0 },
    });
    expect(out[3]).toBe(51);
    expect(out[0]).toBe(255); // no darkening: premultiplied white stays white
    expect(out[1]).toBe(255);
    expect(out[2]).toBe(255);
  });

  it('saturated colour stays hue-true through alpha averaging', () => {
    const px = new Uint8ClampedArray(T * T * 4);
    for (let i = 0; i < px.length; i += 4) {
      px[i] = 255;
      px[i + 1] = 0;
      px[i + 2] = 0;
      px[i + 3] = 128; // 50% saturated red
    }
    const out = downsampleParentTile({
      childLevel: { width: 256, height: 256 },
      children: [
        { coord: { col: 0, row: 0 }, pixels: px },
        { coord: { col: 1, row: 0 }, pixels: px },
        { coord: { col: 0, row: 1 }, pixels: px },
        { coord: { col: 1, row: 1 }, pixels: px },
      ],
      parent: { col: 0, row: 0 },
    });
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
    expect(out[3]).toBe(128);
  });
});

describe('edge tiles and odd dimensions', () => {
  it('clamps sampling to the child level edge (no dimming of odd edges)', () => {
    // Child level 257x257 has a 3x3 tile grid; the L1 parent tile (1,1) reads
    // only L0 tile (2,2) (a 1x1 content tile); the other three children lie
    // beyond the level and must not contribute.
    const tiles = new Map<string, Uint8ClampedArray>();
    tiles.set('2:2', solidTile(200, 100, 50, 255));
    const out = downsampleParentTile({
      childLevel: { width: 257, height: 257 },
      children: childrenAt(tiles, 1, 1),
      parent: { col: 1, row: 1 },
    });
    // Content size: parent level is 129x129, tile (1,1) holds 1x1 content.
    expect(parentTileContentSize({ width: 257, height: 257 }, { col: 1, row: 1 })).toEqual({
      width: 1,
      height: 1,
    });
    expect(out[0]).toBe(200);
    expect(out[1]).toBe(100);
    expect(out[2]).toBe(50);
    expect(out[3]).toBe(255);
    // The rest of the tile buffer stays transparent (padding never bleeds).
    const pad = (T - 1) * T * 4;
    expect(out[pad]).toBe(0);
    expect(out[pad + 3]).toBe(0);
  });

  it('handles 1x1 child levels without error', () => {
    const px = new Uint8ClampedArray(4);
    px[0] = 10;
    px[1] = 20;
    px[2] = 30;
    px[3] = 255;
    const out = downsampleParentTile({
      childLevel: { width: 1, height: 1 },
      children: [{ coord: { col: 0, row: 0 }, pixels: px }],
      parent: { col: 0, row: 0 },
    });
    expect(out[0]).toBe(10);
    expect(out[3]).toBe(255);
  });
});

describe('determinism', () => {
  it('produces bit-identical output across runs', () => {
    const tiles = new Map<string, Uint8ClampedArray>();
    tiles.set('0:0', solidTile(12, 34, 56, 78));
    tiles.set('1:0', solidTile(90, 12, 34, 200));
    tiles.set('0:1', solidTile(56, 78, 90, 120));
    tiles.set('1:1', solidTile(200, 100, 50, 255));
    const mk = () =>
      downsampleParentTile({
        childLevel: { width: 256, height: 256 },
        children: childrenAt(tiles, 0, 0),
        parent: { col: 0, row: 0 },
      });
    const a = mk();
    const b = mk();
    expect(a).toEqual(b);
    // Spot-check a few texels rather than the whole 64KiB buffer.
    expect(a.subarray(0, 16)).toEqual(b.subarray(0, 16));
  });
});

describe('cascade vs direct source derivation (quality policy)', () => {
  it('cascade box2-box2 approximates a single box4 of the source within tolerance', () => {
    // 512x512 source with a diagonal ramp and checkerboard; compare L2 built
    // by two cascade steps against a one-shot 4x4 box average.
    const src = new Uint8ClampedArray(512 * 512 * 4);
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const i = (y * 512 + x) * 4;
        src[i] = (x + y) % 256;
        src[i + 1] = x % 256;
        src[i + 2] = y % 256;
        src[i + 3] = 255;
      }
    }
    const l0 = splitIntoTiles(src, 512, 512, T);
    const l1 = new Map<string, Uint8ClampedArray>();
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        l1.set(
          `${c}:${r}`,
          downsampleParentTile({
            childLevel: { width: 512, height: 512 },
            children: childrenAt(l0, c, r),
            parent: { col: c, row: r },
          }),
        );
      }
    }
    const l2 = downsampleParentTile({
      childLevel: { width: 256, height: 256 },
      children: childrenAt(l1, 0, 0),
      parent: { col: 0, row: 0 },
    });
    // Direct 4x4 box on the same region.
    let maxErr = 0;
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let sumA = 0;
        for (let dy = 0; dy < 4; dy++) {
          for (let dx = 0; dx < 4; dx++) {
            const i = ((y * 4 + dy) * 512 + (x * 4 + dx)) * 4;
            const a = (src[i + 3] ?? 0) / 255;
            sumR += (src[i] ?? 0) * a;
            sumG += (src[i + 1] ?? 0) * a;
            sumB += (src[i + 2] ?? 0) * a;
            sumA += a;
          }
        }
        const oi = (y * T + x) * 4;
        maxErr = Math.max(
          maxErr,
          Math.abs((l2[oi] ?? 0) - sumR / sumA),
          Math.abs((l2[oi + 1] ?? 0) - sumG / sumA),
          Math.abs((l2[oi + 2] ?? 0) - sumB / sumA),
        );
      }
    }
    // Rounding at the intermediate level can cost at most a couple of units.
    expect(maxErr).toBeLessThanOrEqual(3);
  });
});
