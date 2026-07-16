import { describe, expect, it } from 'vitest';
import {
  composeSourceAndSubjectAlpha,
  computeLetterboxTransform,
  extractAlignedEdgeBand,
  reconstructModelMask,
  refineEdgeBand,
} from '../reconstructMask';

describe('computeLetterboxTransform', () => {
  it('computes correct letterbox for portrait source in square model', () => {
    const t = computeLetterboxTransform(600, 800, 320, 320);
    // contentScale = min(320/600, 320/800) = 0.4
    expect(t.scaleX).toBeCloseTo(0.4);
    expect(t.scaleY).toBeCloseTo(0.4);
    // contentW = 600*0.4 = 240, offsetX = (320-240)/2 = 40
    // contentH = 800*0.4 = 320, offsetY = (320-320)/2 = 0
    expect(t.offsetX).toBeCloseTo(40);
    expect(t.offsetY).toBeCloseTo(0);
    expect(t.sourceWidth).toBe(600);
    expect(t.sourceHeight).toBe(800);
    expect(t.modelWidth).toBe(320);
    expect(t.modelHeight).toBe(320);
  });

  it('computes zero offset for exact-fit source', () => {
    const t = computeLetterboxTransform(320, 320, 320, 320);
    expect(t.offsetX).toBe(0);
    expect(t.offsetY).toBe(0);
    expect(t.scaleX).toBe(1);
    expect(t.scaleY).toBe(1);
  });

  it('computes correct letterbox for landscape source', () => {
    const t = computeLetterboxTransform(800, 600, 320, 320);
    // contentScale = min(320/800, 320/600) = 0.4
    // offsetX = (320 - 800*0.4)/2 = 0  (content fills width exactly)
    // offsetY = (320 - 600*0.4)/2 = 40 (content centered vertically)
    expect(t.offsetX).toBe(0);
    expect(t.offsetY).toBeCloseTo(40);
  });

  it('throws on zero dimensions', () => {
    expect(() => computeLetterboxTransform(0, 100, 320, 320)).toThrow('positive');
    expect(() => computeLetterboxTransform(100, 0, 320, 320)).toThrow('positive');
    expect(() => computeLetterboxTransform(100, 100, 0, 320)).toThrow('positive');
  });
});

describe('reconstructModelMask', () => {
  it('reconstructs a letterboxed matte into exact source coordinates', () => {
    const modelW = 320;
    const modelH = 320;
    const modelMask = new Uint8Array(modelW * modelH);
    // Put a 100x100 solid white rect at center of model mask
    const rx = 110;
    const ry = 110;
    const rw = 100;
    const rh = 100;
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        modelMask[y * modelW + x] = 255;
      }
    }

    const sourceW = 800;
    const sourceH = 600;
    const transform = computeLetterboxTransform(sourceW, sourceH, modelW, modelH);

    expect(transform.scaleX).toBeCloseTo(0.4);
    expect(transform.scaleY).toBeCloseTo(0.4);
    expect(transform.offsetX).toBe(0);
    expect(transform.offsetY).toBeCloseTo(40);

    const result = reconstructModelMask(modelMask, modelW, modelH, transform);

    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.alpha.length).toBe(800 * 600);

    // Model subject at (160, 160) maps to source (160/0.4, (160-40)/0.4) = (400, 300)
    const centerSx = Math.round(rx / 0.4 + rw / 2 / 0.4);
    const centerSy = Math.round((ry - 40) / 0.4 + rh / 2 / 0.4);
    expect(result.alpha[centerSy * 800 + centerSx]).toBe(255);

    // Top-left corner source pixel should map to letterbox padding → 0
    expect(result.alpha[0]).toBe(0);
  });

  it('handles zero-size edge case by returning empty', () => {
    const mask = new Uint8Array(320 * 320).fill(255);
    const transform = {
      offsetX: 0,
      offsetY: 0,
      scaleX: 0,
      scaleY: 0,
      sourceWidth: 0,
      sourceHeight: 0,
      modelWidth: 320,
      modelHeight: 320,
    };
    const result = reconstructModelMask(mask, 320, 320, transform);
    expect(result.alpha.length).toBe(0);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });

  it('throws when mask length does not match dimensions', () => {
    const transform = computeLetterboxTransform(100, 100, 50, 50);
    const wrongMask = new Uint8Array(100);
    expect(() => reconstructModelMask(wrongMask, 50, 50, transform)).toThrow('length');
  });
});

describe('composeSourceAndSubjectAlpha', () => {
  it('never increases existing source alpha', () => {
    const source = new Uint8Array([32]);
    const subject = new Uint8Array([255]);
    const result = composeSourceAndSubjectAlpha(source, subject);
    expect(result[0]).toBe(32);
  });

  it('preserves fully opaque source pixels with opaque subject', () => {
    const source = new Uint8Array([255]);
    const subject = new Uint8Array([255]);
    const result = composeSourceAndSubjectAlpha(source, subject);
    expect(result[0]).toBe(255);
  });

  it('produces zero alpha when either input is zero', () => {
    const source = new Uint8Array([0, 128, 128]);
    const subject = new Uint8Array([128, 0, 128]);
    const result = composeSourceAndSubjectAlpha(source, subject);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(Math.round((128 * 128) / 255));
  });

  it('throws on mismatched lengths', () => {
    expect(() => composeSourceAndSubjectAlpha(new Uint8Array([1, 2]), new Uint8Array([1]))).toThrow(
      'same length',
    );
  });
});

describe('extractAlignedEdgeBand', () => {
  it('returns correct bounds for a simple alpha', () => {
    // 10x10 alpha with a 4x4 rect at center, feathered edges
    const w = 10;
    const h = 10;
    const alpha = new Uint8Array(w * h);
    // Fill with solid 0/255, with a transition band at the rect edge
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x >= 3 && x < 7 && y >= 3 && y < 7) {
          alpha[y * w + x] = 255;
        } else if ((x === 2 || x === 7) && y >= 3 && y < 7) {
          alpha[y * w + x] = 128;
        } else if ((y === 2 || y === 7) && x >= 3 && x < 7) {
          alpha[y * w + x] = 128;
        } else {
          alpha[y * w + x] = 0;
        }
      }
    }

    const bandRadius = 1;
    const { bandAlpha, bandBounds, sourceCrop } = extractAlignedEdgeBand(alpha, w, h, bandRadius);

    // After 1 dilation, band should span x:2..7, y:2..7
    expect(bandBounds.x).toBeLessThanOrEqual(2);
    expect(bandBounds.y).toBeLessThanOrEqual(2);
    expect(bandBounds.w).toBeGreaterThanOrEqual(6);
    expect(bandBounds.h).toBeGreaterThanOrEqual(6);
    expect(bandAlpha.length).toBe(bandBounds.w * bandBounds.h);
    expect(sourceCrop.x).toBe(bandBounds.x);
    expect(sourceCrop.y).toBe(bandBounds.y);
  });

  it('returns empty for all-0 alpha', () => {
    const alpha = new Uint8Array(100);
    const { bandAlpha, bandBounds } = extractAlignedEdgeBand(alpha, 10, 10, 3);
    expect(bandAlpha.length).toBe(0);
    expect(bandBounds.w).toBe(0);
    expect(bandBounds.h).toBe(0);
  });

  it('returns empty for all-255 alpha', () => {
    const alpha = new Uint8Array(100).fill(255);
    const { bandAlpha } = extractAlignedEdgeBand(alpha, 10, 10, 3);
    expect(bandAlpha.length).toBe(0);
  });

  it('handles zero-size input', () => {
    const { bandAlpha } = extractAlignedEdgeBand(new Uint8Array(0), 0, 0, 2);
    expect(bandAlpha.length).toBe(0);
  });
});

describe('refineEdgeBand', () => {
  it('returns a copy of the band alpha (placeholder)', () => {
    const band = new Uint8Array([0, 128, 255]);
    const crop = { x: 0, y: 0, w: 3, h: 1 };
    const rgba = new Uint8Array(12);
    const result = refineEdgeBand(band, crop, rgba, 3);
    expect(result).toEqual(band);
    expect(result).not.toBe(band);
  });
});
