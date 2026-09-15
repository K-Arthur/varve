import { describe, expect, it } from 'vitest';
import {
  rankPromptedMaskCandidates,
  validatePromptedImageAnchors,
  validatePromptedMaskCandidate,
} from './promptedMaskValidation';

function mask(width: number, height: number, pixels: Array<[number, number]>): Uint8Array {
  const result = new Uint8Array(width * height);
  for (const [x, y] of pixels) result[y * width + x] = 255;
  return result;
}

function candidate(width: number, height: number, pixels: Array<[number, number]>, score: number) {
  return { mask: mask(width, height, pixels), width, height, score };
}

describe('prompted mask validation', () => {
  it('rejects a higher-scoring candidate that misses the include point', () => {
    const result = rankPromptedMaskCandidates(
      [
        candidate(
          8,
          8,
          [
            [0, 0],
            [1, 0],
            [0, 1],
          ],
          0.99,
        ),
        candidate(
          8,
          8,
          [
            [4, 4],
            [4, 5],
            [5, 4],
            [5, 5],
          ],
          0.8,
        ),
      ],
      { points: [{ x: 4 / 7, y: 4 / 7, label: 1 }] },
      8,
      8,
    );

    expect(result.rejectedCount).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.selectedIndex).toBe(0);
    expect(result.selectedScore).toBe(0.8);
    expect(result.candidates[0]?.promptContainment).toBe(1);
  });

  it('requires exclude points to remain outside the candidate', () => {
    const result = validatePromptedMaskCandidate(
      candidate(
        8,
        8,
        [
          [4, 4],
          [4, 5],
          [5, 4],
          [5, 5],
        ],
        0.8,
      ),
      {
        points: [
          { x: 4 / 7, y: 4 / 7, label: 1 },
          { x: 0, y: 0, label: 0 },
        ],
      },
      8,
      8,
    );
    expect(result.valid).toBe(true);
    expect(result.promptContainment).toBe(1);

    const rejected = validatePromptedMaskCandidate(
      candidate(
        8,
        8,
        [
          [0, 0],
          [4, 4],
        ],
        0.8,
      ),
      {
        points: [
          { x: 4 / 7, y: 4 / 7, label: 1 },
          { x: 0, y: 0, label: 0 },
        ],
      },
      8,
      8,
    );
    expect(rejected.valid).toBe(false);
    expect(rejected.reason).toBe('exclude-point-covered');
  });

  it('rejects a point-only request that has no positive object anchor', () => {
    const result = validatePromptedMaskCandidate(
      candidate(
        8,
        8,
        [
          [4, 4],
          [4, 5],
          [5, 4],
          [5, 5],
        ],
        0.99,
      ),
      { points: [{ x: 4 / 7, y: 4 / 7, label: 0 }] },
      8,
      8,
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('positive-anchor-required');
  });

  it('reports disconnected coverage that is not supported by the prompt', () => {
    const pixels: Array<[number, number]> = [];
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 2; x += 1) pixels.push([x + 8, y + 8]);
    }
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) pixels.push([x, y]);
    }
    const result = validatePromptedMaskCandidate(
      candidate(10, 10, pixels, 0.8),
      { points: [{ x: 8 / 9, y: 8 / 9, label: 1 }] },
      10,
      10,
    );

    expect(result.valid).toBe(true);
    expect(result.diagnostics).toMatchObject({
      componentCount: 2,
      anchoredComponentCount: 1,
      ambiguous: true,
    });
    expect(result.diagnostics?.anchoredCoverage).toBeLessThan(0.5);
    expect(result.diagnostics?.warnings[1]).toContain('connected to the prompt');
  });

  it('rejects a positive prompt in a transparent image hole', () => {
    const imageData = new ImageData(8, 8);
    for (let index = 3; index < imageData.data.length; index += 4) imageData.data[index] = 255;
    for (let y = 3; y <= 5; y += 1) {
      for (let x = 3; x <= 5; x += 1) imageData.data[(y * 8 + x) * 4 + 3] = 0;
    }

    expect(validatePromptedImageAnchors(imageData, [{ x: 4 / 7, y: 4 / 7, label: 1 }])).toEqual({
      valid: false,
      pointIndex: 0,
    });
    expect(validatePromptedImageAnchors(imageData, [{ x: 0, y: 0, label: 1 }])).toEqual({
      valid: true,
    });
  });

  it('rejects non-normalized image-anchor prompts instead of clamping them', () => {
    const imageData = new ImageData(2, 2);
    for (let index = 3; index < imageData.data.length; index += 4) imageData.data[index] = 255;
    expect(validatePromptedImageAnchors(imageData, [{ x: -0.1, y: 0.5, label: 1 }])).toEqual({
      valid: false,
      pointIndex: 0,
    });
  });

  it('rejects a one-pixel box overlap from a broad wrong mask', () => {
    const result = validatePromptedMaskCandidate(
      candidate(
        10,
        10,
        Array.from(
          { length: 91 },
          (_, index) => [index % 10, Math.floor(index / 10)] as [number, number],
        ),
        0.9,
      ),
      { box: { x1: 0.8, y1: 0.8, x2: 1, y2: 1 } },
      10,
      10,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('box-overlap-too-small');
  });

  it('accepts a meaningful box-contained candidate and rejects malformed geometry', () => {
    const valid = validatePromptedMaskCandidate(
      candidate(
        10,
        10,
        [
          [4, 4],
          [4, 5],
          [5, 4],
          [5, 5],
        ],
        0.8,
      ),
      { box: { x1: 0.3, y1: 0.3, x2: 0.7, y2: 0.7 } },
      10,
      10,
    );
    expect(valid.valid).toBe(true);
    expect(valid.promptContainment).toBe(1);

    const malformed = validatePromptedMaskCandidate(
      candidate(9, 10, [[4, 4]], 0.8),
      { points: [{ x: 0.5, y: 0.5, label: 1 }] },
      10,
      10,
    );
    expect(malformed.valid).toBe(false);
    expect(malformed.reason).toBe('invalid-geometry');
  });
});
