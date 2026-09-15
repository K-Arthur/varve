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

  it('rejects a candidate dominated by an unprompted disconnected region', () => {
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

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('ambiguous-unanchored-region');
    expect(result.diagnostics).toMatchObject({
      componentCount: 2,
      anchoredComponentCount: 1,
      ambiguous: true,
    });
    expect(result.diagnostics?.anchoredCoverage).toBeLessThan(0.5);
    expect(result.diagnostics?.warnings[1]).toContain('connected to the prompt');
  });

  it('prunes a small disconnected island when the prompted target is dominant', () => {
    const pixels: Array<[number, number]> = [];
    for (let y = 1; y < 7; y += 1) {
      for (let x = 1; x < 7; x += 1) pixels.push([x, y]);
    }
    for (let y = 8; y < 10; y += 1) {
      for (let x = 8; x < 10; x += 1) pixels.push([x, y]);
    }
    const result = rankPromptedMaskCandidates(
      [candidate(10, 10, pixels, 0.9)],
      { points: [{ x: 3 / 9, y: 3 / 9, label: 1 }] },
      10,
      10,
    );

    expect(result.rejectedCount).toBe(0);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.mask[3 * 10 + 3]).toBe(255);
    expect(result.candidates[0]?.mask[8 * 10 + 8]).toBe(0);
    expect(result.candidates[0]?.promptDiagnostics?.warnings[0]).toContain(
      'Removed 4% unprompted disconnected coverage',
    );
  });

  it('keeps high-resolution photographic specks from merging into the target component', () => {
    const width = 1280;
    const height = 960;
    const pixels = new Uint8Array(width * height);
    for (let y = 200; y <= 700; y += 1) {
      for (let x = 200; x <= 800; x += 1) pixels[y * width + x] = 255;
    }
    // Leave a one-source-pixel gap. A coarse review grid can collapse this
    // gap and incorrectly treat the noise as part of the prompted object.
    for (let y = 500; y <= 519; y += 1) {
      for (let x = 802; x <= 820; x += 1) pixels[y * width + x] = 255;
    }

    const result = rankPromptedMaskCandidates(
      [{ mask: pixels, width, height, score: 0.9 }],
      { points: [{ x: 500 / (width - 1), y: 450 / (height - 1), label: 1 }] },
      width,
      height,
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.mask[450 * width + 500]).toBe(255);
    expect(result.candidates[0]?.mask[510 * width + 810]).toBe(0);
    expect(result.candidates[0]?.promptDiagnostics?.componentCount).toBe(1);
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

  it('treats a broad box as a hint instead of endorsing adjacent disconnected objects', () => {
    const pixels: Array<[number, number]> = [];
    for (let y = 3; y <= 7; y += 1) {
      for (let x = 3; x <= 7; x += 1) pixels.push([x, y]);
    }
    for (let y = 0; y <= 1; y += 1) {
      for (let x = 0; x <= 1; x += 1) pixels.push([x, y]);
    }
    const result = rankPromptedMaskCandidates(
      [candidate(10, 10, pixels, 0.9)],
      { box: { x1: 0, y1: 0, x2: 1, y2: 1 } },
      10,
      10,
    );

    expect(result.rejectedCount).toBe(0);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.mask[5 * 10 + 5]).toBe(255);
    expect(result.candidates[0]?.mask[10]).toBe(0);
    expect(result.candidates[0]?.promptDiagnostics).toMatchObject({
      componentCount: 1,
      anchoredComponentCount: 1,
      anchoredCoverage: 1,
    });
  });

  it('keeps an edge-touching candidate previewable but requires an extent prompt before apply', () => {
    const pixels: Array<[number, number]> = [];
    for (let y = 3; y <= 6; y += 1) {
      for (let x = 7; x <= 9; x += 1) pixels.push([x, y]);
    }
    const pointOnly = validatePromptedMaskCandidate(
      candidate(10, 10, pixels, 0.9),
      { points: [{ x: 6 / 9, y: 4 / 9, label: 1 }] },
      10,
      10,
    );
    expect(pointOnly.valid).toBe(true);
    expect(pointOnly.diagnostics).toMatchObject({
      edgeContact: { right: true },
      requiresRefinement: true,
    });
    expect(pointOnly.diagnostics?.warnings.at(-1)).toContain('extent prompt');

    const boxed = validatePromptedMaskCandidate(
      candidate(10, 10, pixels, 0.9),
      { box: { x1: 0.6, y1: 0.2, x2: 1, y2: 0.8 } },
      10,
      10,
    );
    expect(boxed.valid).toBe(true);
    expect(boxed.diagnostics?.requiresRefinement).not.toBe(true);
  });

  it('requires interior evidence when a point-only prompt lands on a candidate boundary', () => {
    const boundaryPixels: Array<[number, number]> = [];
    for (let y = 20; y <= 60; y += 1) {
      for (let x = 20; x <= 60; x += 1) boundaryPixels.push([x, y]);
    }
    const boundary = validatePromptedMaskCandidate(
      candidate(128, 128, boundaryPixels, 0.95),
      { points: [{ x: 20 / 127, y: 40 / 127, label: 1 }] },
      128,
      128,
    );
    expect(boundary.valid).toBe(true);
    expect(boundary.diagnostics?.positiveAnchorSupport?.[0]?.coveredFraction).toBeLessThan(0.75);
    expect(boundary.diagnostics?.requiresRefinement).toBe(true);
    expect(boundary.diagnostics?.warnings.at(-1)).toContain('candidate boundary');

    const interior = validatePromptedMaskCandidate(
      candidate(128, 128, boundaryPixels, 0.95),
      { points: [{ x: 40 / 127, y: 40 / 127, label: 1 }] },
      128,
      128,
    );
    expect(interior.valid).toBe(true);
    expect(interior.diagnostics?.positiveAnchorSupport?.[0]?.coveredFraction).toBe(1);
    expect(interior.diagnostics?.requiresRefinement).not.toBe(true);
  });

  it('defaults to a safe candidate when a higher-scoring alternative needs prompt refinement', () => {
    const boundaryPixels: Array<[number, number]> = [];
    const expandedPixels: Array<[number, number]> = [];
    for (let y = 20; y <= 60; y += 1) {
      for (let x = 20; x <= 60; x += 1) boundaryPixels.push([x, y]);
    }
    for (let y = 18; y <= 65; y += 1) {
      for (let x = 18; x <= 65; x += 1) expandedPixels.push([x, y]);
    }
    const result = rankPromptedMaskCandidates(
      [candidate(128, 128, boundaryPixels, 0.99), candidate(128, 128, expandedPixels, 0.5)],
      { points: [{ x: 20 / 127, y: 40 / 127, label: 1 }] },
      128,
      128,
    );

    expect(result.candidates).toHaveLength(2);
    expect(result.selectedIndex).toBe(1);
    expect(result.selectedScore).toBe(0.5);
    expect(result.candidates[0]?.promptDiagnostics?.requiresRefinement).toBe(true);
    expect(result.candidates[1]?.promptDiagnostics?.requiresRefinement).not.toBe(true);
  });
});
