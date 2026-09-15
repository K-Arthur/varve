import { describe, expect, it } from 'vitest';
import type { YuNetFaceDetection } from '../inference/models/faceDetect';
import {
  cropWindowRgba,
  FACE_WINDOW_BUDGET,
  mergeFaceDetections,
  planFaceWindows,
  type RgbaImage,
} from './faceWindows';

function face(
  x: number,
  y: number,
  width: number,
  height: number,
  score: number,
): YuNetFaceDetection {
  return {
    box: { x, y, width, height },
    landmarks: [],
    landmarksInFrame: [],
    score,
  };
}

describe('planFaceWindows', () => {
  it('skips the window tier when the whole-image pass is already near native', () => {
    const plan = planFaceWindows(800, 600);
    expect(plan.windows).toHaveLength(0);
    expect(plan.skipReason).toBe('native-scale-already');
    // 640 / 800 = 0.8 >= 0.75
    expect(plan.globalScale).toBeCloseTo(0.8, 6);
  });

  it('plans native-scale windows for an image the whole-image pass downscales', () => {
    const plan = planFaceWindows(1920, 1159);
    expect(plan.skipReason).toBeNull();
    expect(plan.scale).toBe(1);
    expect(plan.windows.length).toBeGreaterThan(1);
    expect(plan.windows.length).toBeLessThanOrEqual(FACE_WINDOW_BUDGET);
    if (plan.scale >= 1) {
      for (const window of plan.windows) {
        expect(window.width).toBe(640);
        expect(window.height).toBe(640);
        expect(window.x).toBeGreaterThanOrEqual(0);
        expect(window.y).toBeGreaterThanOrEqual(0);
        expect(window.x + window.width).toBeLessThanOrEqual(1920);
        expect(window.y + window.height).toBeLessThanOrEqual(1159);
      }
    }
  });

  it('never plans more windows than the budget, even for a huge source', () => {
    for (const [width, height] of [
      [5171, 6402],
      [8000, 1000],
      [1000, 9000],
      [12000, 12000],
    ] as const) {
      const plan = planFaceWindows(width, height);
      expect(plan.windows.length).toBeLessThanOrEqual(FACE_WINDOW_BUDGET);
      // The plan is never worse than the whole-image letterbox.
      expect(plan.scale).toBeGreaterThanOrEqual(plan.globalScale - 1e-9);
    }
  });

  it('covers the full frame with overlapping windows', () => {
    const plan = planFaceWindows(1920, 1159);
    if (plan.windows.length === 0) throw new Error('expected a window plan');
    const right = Math.max(...plan.windows.map((window) => window.x + window.width));
    const bottom = Math.max(...plan.windows.map((window) => window.y + window.height));
    expect(right).toBeGreaterThanOrEqual(1920);
    expect(bottom).toBeGreaterThanOrEqual(1159);
    const left = Math.min(...plan.windows.map((window) => window.x));
    const top = Math.min(...plan.windows.map((window) => window.y));
    expect(left).toBe(0);
    expect(top).toBe(0);
  });

  it('degrades to a single-window skip for a tiny source', () => {
    const plan = planFaceWindows(200, 150);
    expect(plan.windows).toHaveLength(0);
    expect(plan.skipReason).toBe('native-scale-already');
  });

  it('returns an empty plan for invalid dimensions instead of throwing', () => {
    const plan = planFaceWindows(0, 100);
    expect(plan.windows).toHaveLength(0);
    expect(plan.skipReason).toBe('single-window');
  });

  it('is deterministic for the same source', () => {
    const first = planFaceWindows(3000, 2000);
    const second = planFaceWindows(3000, 2000);
    expect(second).toEqual(first);
  });
});

describe('cropWindowRgba', () => {
  function source(width: number, height: number): RgbaImage {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      data[index * 4] = index % 256;
      data[index * 4 + 1] = (index * 7) % 256;
      data[index * 4 + 2] = (index * 13) % 256;
      data[index * 4 + 3] = 255;
    }
    return { data, width, height };
  }

  it('copies the requested region at native pixels', () => {
    const image = source(100, 80);
    const crop = cropWindowRgba(image, { x: 10, y: 20, width: 30, height: 25 });
    expect(crop.width).toBe(30);
    expect(crop.height).toBe(25);
    const expectedStart = (20 * 100 + 10) * 4;
    expect(Array.from(crop.data.subarray(0, 4))).toEqual(
      Array.from(image.data.subarray(expectedStart, expectedStart + 4)),
    );
    const lastRowStart = ((20 + 24) * 100 + 10) * 4;
    expect(Array.from(crop.data.subarray(crop.data.length - 120, crop.data.length - 116))).toEqual(
      Array.from(image.data.subarray(lastRowStart, lastRowStart + 4)),
    );
  });

  it('zero-fills the part of a window that falls outside the source', () => {
    const image = source(50, 50);
    const crop = cropWindowRgba(image, { x: 40, y: 40, width: 20, height: 20 });
    // Top-left 10x10 is real data; the rest is transparent black.
    expect(crop.data[0]).toBe(image.data[(40 * 50 + 40) * 4]);
    const outside = (5 * 20 + 15) * 4; // x=15 (past the source), y=5
    expect(Array.from(crop.data.subarray(outside, outside + 4))).toEqual([0, 0, 0, 0]);
  });

  it('handles fully out-of-source windows without throwing', () => {
    const crop = cropWindowRgba(source(10, 10), { x: -100, y: -100, width: 4, height: 4 });
    expect(crop.data.every((value) => value === 0)).toBe(true);
  });
});

describe('mergeFaceDetections', () => {
  it('keeps the primary box when the native tier fragmented a large face', () => {
    const primary = [face(100, 100, 600, 600, 0.9)];
    const fragment = [face(150, 150, 340, 340, 0.95)];
    const merged = mergeFaceDetections(primary, fragment);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.box.width).toBe(600);
  });

  it('adds a small face the whole-image pass missed', () => {
    const primary = [face(0, 0, 100, 100, 0.8)];
    const small = [face(900, 700, 15, 15, 0.6)];
    const merged = mergeFaceDetections(primary, small);
    expect(merged).toHaveLength(2);
    expect(merged.map((detection) => detection.box.width)).toEqual([100, 15]);
  });

  it('suppresses a secondary duplicate of an overlapping primary face', () => {
    const primary = [face(100, 100, 200, 200, 0.9)];
    const duplicate = [face(105, 104, 202, 198, 0.99)];
    expect(mergeFaceDetections(primary, duplicate)).toHaveLength(1);
  });

  it('never merges two nearby faces into one', () => {
    const primary = [face(100, 100, 200, 200, 0.9)];
    const nearby = [face(260, 100, 190, 200, 0.85)];
    const merged = mergeFaceDetections(primary, nearby);
    expect(merged).toHaveLength(2);
  });

  it('suppresses a secondary box mostly contained in a kept box', () => {
    const primary = [face(0, 0, 100, 100, 0.9)];
    // 64% of this candidate's area lies inside the kept box while IoU (0.27)
    // stays below the suppression threshold — the tile-fragment case.
    const contained = [face(55, 15, 70, 70, 0.95)];
    const merged = mergeFaceDetections(primary, contained);
    expect(merged).toHaveLength(1);
  });

  it('is deterministic and score-ordered within each tier', () => {
    const primary = [face(0, 0, 10, 10, 0.5), face(500, 0, 10, 10, 0.9)];
    const merged = mergeFaceDetections(primary, []);
    expect(merged.map((detection) => detection.score)).toEqual([0.9, 0.5]);
  });
});
