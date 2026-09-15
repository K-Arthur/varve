import { describe, expect, it } from 'vitest';
import { decodeFontClassifyOutput, FONT_CLASSIFY_NUM_CLASSES } from './fontClassify';

describe('decodeFontClassifyOutput', () => {
  it('returns empty array for empty logits', () => {
    expect(decodeFontClassifyOutput(new Float32Array(0))).toEqual([]);
  });

  it('returns top-k candidates sorted by confidence', () => {
    const logits = new Float32Array(FONT_CLASSIFY_NUM_CLASSES);
    logits[10] = 5.0;
    logits[20] = 3.0;
    logits[30] = 1.0;

    const result = decodeFontClassifyOutput(logits, 3);
    expect(result).toHaveLength(3);
    expect(result[0]!.classIndex).toBe(10);
    expect(result[1]!.classIndex).toBe(20);
    expect(result[2]!.classIndex).toBe(30);
    expect(result[0]!.confidence).toBeGreaterThan(result[1]!.confidence);
    expect(result[1]!.confidence).toBeGreaterThan(result[2]!.confidence);
  });

  it('probabilities sum to approximately 1', () => {
    const logits = new Float32Array(FONT_CLASSIFY_NUM_CLASSES);
    logits[0] = 2.0;
    logits[1] = 1.0;
    logits[2] = 0.5;

    const result = decodeFontClassifyOutput(logits, FONT_CLASSIFY_NUM_CLASSES);
    const totalProb = result.reduce((sum, r) => sum + r.confidence, 0);
    expect(totalProb).toBeCloseTo(1.0, 1);
  });

  it('handles uniform logits (no clear winner)', () => {
    const logits = new Float32Array(FONT_CLASSIFY_NUM_CLASSES).fill(1.0);
    const result = decodeFontClassifyOutput(logits, 3);
    expect(result).toHaveLength(3);
    const expected = 1 / FONT_CLASSIFY_NUM_CLASSES;
    for (const r of result) {
      expect(r.confidence).toBeCloseTo(expected, 3);
    }
  });

  it('caps top-k at the number of classes', () => {
    const logits = new Float32Array(10);
    logits[5] = 2.0;
    const result = decodeFontClassifyOutput(logits, 100);
    expect(result.length).toBeLessThanOrEqual(10);
  });
});
