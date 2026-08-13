import { describe, expect, it } from 'vitest';
import { suggestFaceAwareCrop } from './cropSolver';

const face = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  confidence = 0.95,
) => ({
  id,
  confidence,
  box: { x, y, width, height, score: confidence },
});

describe('suggestFaceAwareCrop', () => {
  it('keeps a face and its safety margin inside a square crop', () => {
    const result = suggestFaceAwareCrop({ width: 1600, height: 900 }, { width: 1, height: 1 }, [
      face('a', 1180, 260, 180, 220),
    ]);
    expect(result.usedFallback).toBe(false);
    expect(result.coveredFaceIds).toContain('a');
    expect(result.crop.x + result.crop.width).toBeLessThanOrEqual(1600);
    expect(result.crop.y + result.crop.height).toBeLessThanOrEqual(900);
    expect(result.crop.x).toBeGreaterThan(0);
  });

  it('handles multiple faces without selecting the first face implicitly', () => {
    const result = suggestFaceAwareCrop({ width: 1600, height: 900 }, { width: 16, height: 9 }, [
      face('left', 80, 260, 180, 210),
      face('right', 1340, 260, 180, 210),
    ]);
    expect(result.detectedFaces).toBe(2);
    expect(result.coveredFaceIds).toEqual(['left', 'right']);
  });

  it('falls back to ordinary centered crop when there are no reliable faces', () => {
    const result = suggestFaceAwareCrop({ width: 1200, height: 800 }, { width: 1, height: 1 }, [
      face('weak', 10, 10, 100, 100, 0.1),
    ]);
    expect(result.usedFallback).toBe(true);
    expect(result.detectedFaces).toBe(0);
    expect(result.crop).toEqual({ x: 200, y: 0, width: 800, height: 800 });
  });

  it('does not allow an invalid detection to create an invalid crop', () => {
    const result = suggestFaceAwareCrop({ width: 500, height: 500 }, { width: 9, height: 16 }, [
      face('bad', Number.NaN, 0, 100, 100),
      face('edge', -50, -50, 200, 200),
    ]);
    expect(result.crop.x).toBeGreaterThanOrEqual(0);
    expect(result.crop.y).toBeGreaterThanOrEqual(0);
    expect(result.crop.x + result.crop.width).toBeLessThanOrEqual(500);
    expect(result.crop.y + result.crop.height).toBeLessThanOrEqual(500);
  });
});
