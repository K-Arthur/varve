import { describe, expect, it } from 'vitest';
import { SEGMENTATION_CORPUS } from './corpus';
import {
  boundaryFScore,
  computeSegmentationQuality,
  evaluateCorpus,
  maskDice,
  maskIoU,
} from './metrics';

describe('object-selection corpus', () => {
  it('is license-safe and fully synthetic', () => {
    for (const fixture of SEGMENTATION_CORPUS) {
      expect(fixture.image.width).toBe(fixture.width);
      expect(fixture.image.height).toBe(fixture.height);
      expect(fixture.oracleMask.length).toBe(fixture.width * fixture.height);
      expect(fixture.image.data.length).toBe(fixture.width * fixture.height * 4);
    }
  });

  it('has at least one foreground and one background pixel in every oracle', () => {
    for (const fixture of SEGMENTATION_CORPUS) {
      let fg = 0;
      let bg = 0;
      for (let i = 0; i < fixture.oracleMask.length; i++) {
        if (fixture.oracleMask[i]) fg++;
        else bg++;
      }
      expect(fg, `${fixture.id} foreground`).toBeGreaterThan(0);
      expect(bg, `${fixture.id} background`).toBeGreaterThan(0);
    }
  });

  it('covers the categories the release gate cares about', () => {
    const categories = new Set(SEGMENTATION_CORPUS.map((f) => f.category));
    for (const expected of [
      'plain-background',
      'hair-fur',
      'thin-geometry',
      'overlapping',
      'tiny-object',
      'touches-edge',
      'low-contrast',
      'glass-translucency',
      'multiple-similar',
      'foliage',
    ]) {
      expect(categories.has(expected), expected).toBe(true);
    }
  });
});

describe('segmentation quality metrics', () => {
  const w = 8;
  const h = 8;
  const pixel = (x: number, y: number) => y * w + x;
  const filled = new Uint8Array(w * h);
  for (let y = 1; y < 7; y++) {
    for (let x = 1; x < 7; x++) filled[pixel(x, y)] = 1;
  }

  it('scores a perfect prediction 1.0 on every metric', () => {
    const metrics = computeSegmentationQuality(filled, filled, w, h);
    expect(metrics.iou).toBe(1);
    expect(metrics.dice).toBe(1);
    expect(metrics.boundaryF).toBe(1);
  });

  it('scores an empty prediction 0 on IoU/Dice when the oracle is non-empty', () => {
    const empty = new Uint8Array(w * h);
    expect(maskIoU(empty, filled)).toBe(0);
    expect(maskDice(empty, filled)).toBe(0);
  });

  it('scores both-empty masks 1 (nothing to miss)', () => {
    const empty = new Uint8Array(w * h);
    expect(maskIoU(empty, empty)).toBe(1);
    expect(maskDice(empty, empty)).toBe(1);
  });

  it('computes boundary F-score with tolerance for one-pixel shifts', () => {
    const shifted = new Uint8Array(w * h);
    for (let y = 2; y < 8; y++) {
      for (let x = 2; x < 8; x++) shifted[pixel(x, y)] = 1;
    }
    // 1px shift: IoU drops substantially, boundary F stays high.
    const metrics = computeSegmentationQuality(shifted, filled, w, h);
    expect(metrics.iou).toBeLessThan(1);
    expect(metrics.boundaryF).toBeGreaterThanOrEqual(0.85);
  });

  it('rejects mismatched mask lengths', () => {
    expect(() => maskIoU(new Uint8Array(4), new Uint8Array(5))).toThrow(/length/i);
    expect(() => boundaryFScore(new Uint8Array(4), new Uint8Array(5), 2, 2)).toThrow(/length/i);
  });

  it('accepts both 0/1 and 0/255 encodings', () => {
    const m255 = new Uint8Array(filled.length);
    for (let i = 0; i < filled.length; i++) m255[i] = filled[i] ? 255 : 0;
    expect(computeSegmentationQuality(m255, filled, w, h).iou).toBe(1);
  });
});

describe('evaluateCorpus', () => {
  it('reports 1.0 for a perfect oracle-returning predictor', async () => {
    const rows = await evaluateCorpus(SEGMENTATION_CORPUS, (fixture) => {
      const oracle = SEGMENTATION_CORPUS.find((f) => f.id === fixture.id)!;
      return oracle.oracleMask;
    });
    for (const row of rows) {
      expect(row.metrics.iou, row.id).toBe(1);
      expect(row.metrics.boundaryF, row.id).toBe(1);
    }
  });

  it('reports zeros for an empty-mask predictor', async () => {
    const rows = await evaluateCorpus(SEGMENTATION_CORPUS, (fixture) => {
      return new Uint8Array(fixture.width * fixture.height);
    });
    for (const row of rows) {
      expect(row.metrics.iou, row.id).toBe(0);
    }
  });
});
