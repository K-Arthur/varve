import { describe, expect, it } from 'vitest';
import { fitRect, isFitEmpty, type MockupAlignX, type MockupAlignY } from '../fit';
import type { Quad } from '../homography';
import { mapQuadPoint, sampleBilinear, warpImageToQuad } from '../quadWarp';

describe('fitRect', () => {
  it('contains a 16:9 source in a 9:16 slot (letterbox by width)', () => {
    const r = fitRect(1600, 900, 390, 844, 'contain');
    expect(r).not.toBeNull();
    // The landscape source is width-bound: dw = slot width, dh follows aspect.
    expect(r!.dw).toBeCloseTo(390, 3);
    expect(r!.dh).toBeCloseTo(390 * (9 / 16), 3);
  });

  it('contains a 9:16 source in a 16:9 slot (letterbox horizontal)', () => {
    const r = fitRect(900, 1600, 1920, 1080, 'contain');
    expect(r).not.toBeNull();
    expect(r!.dw).toBeCloseTo(1080 * (900 / 1600), 3);
    expect(r!.dh).toBeCloseTo(1080, 3);
  });

  it('covers a 16:9 slot with a 4:3 source (crop vertically)', () => {
    const r = fitRect(400, 300, 1920, 1080, 'cover');
    expect(r).not.toBeNull();
    expect(r!.dw).toBeCloseTo(1920, 3);
    expect(r!.dh).toBeCloseTo(1080, 3);
    // Source crop: the narrower-dimension overflow is cropped; sampling
    // rect is 400 wide, height scaled to the slot aspect.
    expect(r!.sw).toBeCloseTo(400, 3);
    expect(r!.sh).toBeCloseTo(400 / (1920 / 1080), 3);
    expect(r!.sy).toBeCloseTo((300 - r!.sh) / 2, 6);
  });

  it('stretches to the slot', () => {
    const r = fitRect(100, 50, 300, 300, 'stretch');
    expect(r!.dw).toBe(300);
    expect(r!.dh).toBe(300);
  });

  it('native keeps pixel size and honors alignment', () => {
    const r = fitRect(100, 50, 300, 300, 'native', 'max', 'max');
    expect(r!.dw).toBe(100);
    expect(r!.dh).toBe(50);
    expect(r!.dx).toBe(200);
    expect(r!.dy).toBe(250);
  });

  it('center alignment centers within leftover space', () => {
    const r = fitRect(100, 50, 200, 100, 'native');
    expect(r!.dx).toBeCloseTo(50, 6);
    expect(r!.dy).toBeCloseTo(25, 6);
  });

  it('rejects degenerate inputs', () => {
    expect(fitRect(0, 10, 100, 100, 'contain')).toBeNull();
    expect(fitRect(10, 10, 0, 100, 'contain')).toBeNull();
    expect(fitRect(NaN, 10, 100, 100, 'contain')).toBeNull();
    expect(isFitEmpty(fitRect(0, 10, 100, 100, 'contain'))).toBe(true);
    expect(isFitEmpty(fitRect(100, 100, 100, 100, 'contain'))).toBe(false);
  });

  it('contain never overflows the slot regardless of alignment', () => {
    const alignsX: MockupAlignX[] = ['min', 'center', 'max'];
    const alignsY: MockupAlignY[] = ['min', 'center', 'max'];
    for (const ax of alignsX) {
      for (const ay of alignsY) {
        const r = fitRect(900, 1600, 1920, 1080, 'contain', ax, ay)!;
        expect(r.dx).toBeGreaterThanOrEqual(-1e-9);
        expect(r.dy).toBeGreaterThanOrEqual(-1e-9);
        expect(r.dx + r.dw).toBeLessThanOrEqual(1920 + 1e-9);
        expect(r.dy + r.dh).toBeLessThanOrEqual(1080 + 1e-9);
      }
    }
  });
});

describe('warpImageToQuad', () => {
  it('returns null for degenerate quads and zero dimensions', () => {
    const src = new Uint8ClampedArray(4 * 4 * 4);
    const degenerate: Quad = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(warpImageToQuad(src, 4, 4, degenerate, 8, 8)).toBeNull();
    expect(
      warpImageToQuad(
        src,
        0,
        4,
        [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
          { x: 0, y: 4 },
        ],
        8,
        8,
      ),
    ).toBeNull();
  });

  it('warps an axis-aligned quad without distortion (identity mapping)', () => {
    // Build a checkerboard source.
    const w = 8;
    const h = 8;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = (x + y) % 2 === 0 ? 255 : 0;
        src[i] = v;
        src[i + 1] = v;
        src[i + 2] = v;
        src[i + 3] = 255;
      }
    }
    // Offset quad: [1,1]..[9,9] inside a 10x10 target maps the source 1:1
    // with a one-pixel transparent margin.
    const quad: Quad = [
      { x: 1, y: 1 },
      { x: 9, y: 1 },
      { x: 9, y: 9 },
      { x: 1, y: 9 },
    ];
    const out = warpImageToQuad(src, w, h, quad, 10, 10);
    expect(out).not.toBeNull();
    const o = out!.data;
    // Target (3,3) maps to source (2,2): even sum -> white, exact 1:1.
    expect(o[(3 * 10 + 3) * 4]).toBe(255);
    expect(o[(3 * 10 + 3) * 4 + 3]).toBe(255);
    // Target (4,3) maps to source (3,2): odd sum -> black, still opaque.
    expect(o[(3 * 10 + 4) * 4]).toBe(0);
    expect(o[(3 * 10 + 4) * 4 + 3]).toBe(255);
    // Outside the quad (0,0) stays transparent; (0,9) is outside too.
    expect(o[0 * 4 + 3]).toBe(0);
    expect(o[(9 * 10 + 0) * 4 + 3]).toBe(0);
  });

  it('maps a perspective quad to a tilted shape (corner accuracy)', () => {
    const w = 10;
    const h = 10;
    const src = new Uint8ClampedArray(w * h * 4).fill(255, 0, w * h * 4);
    const quad: Quad = [
      { x: 4, y: 2 },
      { x: 14, y: 3 },
      { x: 13, y: 13 },
      { x: 3, y: 12 },
    ];
    const out = warpImageToQuad(src, w, h, quad, 20, 20);
    expect(out).not.toBeNull();
    // Points on the warped quad must be opaque, points far outside transparent.
    expect(out!.data[(3 * 20 + 10) * 4 + 3]).toBeGreaterThan(0);
    expect(out!.data[(2 * 20 + 4) * 4 + 3]).toBe(0);
  });
});

describe('mapQuadPoint', () => {
  it('maps source corners onto destination corners', () => {
    const quad: Quad = [
      { x: 10, y: 20 },
      { x: 90, y: 22 },
      { x: 88, y: 78 },
      { x: 12, y: 76 },
    ];
    const tl = mapQuadPoint(100, 60, quad, { x: 0, y: 0 });
    expect(tl!.x).toBeCloseTo(10, 4);
    expect(tl!.y).toBeCloseTo(20, 4);
    const br = mapQuadPoint(100, 60, quad, { x: 100, y: 60 });
    expect(br!.x).toBeCloseTo(88, 4);
    expect(br!.y).toBeCloseTo(78, 4);
  });

  it('returns null for degenerate quads', () => {
    const degenerate: Quad = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(mapQuadPoint(100, 60, degenerate, { x: 50, y: 30 })).toBeNull();
  });
});

describe('sampleBilinear', () => {
  it('interpolates at half-pixel offsets', () => {
    const src = new Uint8ClampedArray(2 * 2 * 4);
    src.fill(0);
    src[0] = 0; // black top-left
    src[4] = 200; // red top-right
    src[8] = 0;
    src[12] = 0;
    const out = new Uint8ClampedArray(4);
    sampleBilinear(src, 2, 2, 0.5, 0, out, 0);
    expect(out[0]).toBe(100);
    expect(out[3]).toBe(0);
  });

  it('clamps out-of-bounds coordinates', () => {
    const src = new Uint8ClampedArray(2 * 2 * 4);
    src[0] = 50;
    src[4] = 50;
    src[8] = 50;
    src[12] = 50;
    const out = new Uint8ClampedArray(4);
    sampleBilinear(src, 2, 2, 5, 5, out, 0);
    expect(out[0]).toBe(50);
  });
});
