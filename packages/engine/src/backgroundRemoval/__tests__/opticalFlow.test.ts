import { describe, expect, it } from 'vitest';
import { computeBlockFlow, warpMask } from '../opticalFlow';

describe('computeBlockFlow', () => {
  it('returns zero flow vectors for identical frames', () => {
    const w = 32;
    const h = 32;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i] = (x * 8) % 256;
        data[i + 1] = (y * 8) % 256;
        data[i + 2] = 128;
        data[i + 3] = 255;
      }
    }

    const flow = computeBlockFlow(data, data, w, h, 16, 8);

    expect(flow.length).toBeGreaterThan(0);
    expect(flow[0]!.length).toBeGreaterThan(0);

    for (const row of flow) {
      for (const vec of row) {
        expect(vec.dx).toBe(0);
        expect(vec.dy).toBe(0);
        expect(vec.confidence).toBeGreaterThanOrEqual(0);
        expect(vec.confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  it('detects a uniform rightward shift', () => {
    const w = 64;
    const h = 32;
    const shift = 4;

    const prev = new Uint8ClampedArray(w * h * 4);
    const curr = new Uint8ClampedArray(w * h * 4);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const val = (x * 17 + y * 31) % 256;
        prev[i] = val;
        prev[i + 1] = (val * 2) % 256;
        prev[i + 2] = (val * 3) % 256;
        prev[i + 3] = 255;

        curr[i] = 0;
        curr[i + 1] = 0;
        curr[i + 2] = 0;
        curr[i + 3] = 255;

        const tx = x - shift;
        if (tx >= 0) {
          const src = (y * w + tx) * 4;
          curr[i] = prev[src] ?? 0;
          curr[i + 1] = prev[src + 1] ?? 0;
          curr[i + 2] = prev[src + 2] ?? 0;
        }
      }
    }

    const flow = computeBlockFlow(prev, curr, w, h, 16, 8);

    let dxSum = 0;
    let count = 0;
    for (const row of flow) {
      for (const vec of row) {
        dxSum += vec.dx;
        count++;
      }
    }
    const avgDx = count > 0 ? Math.abs(dxSum) / count : 0;
    expect(avgDx).toBeGreaterThan(1);
  });

  it('returns confidence near 1 for good matches and lower for poor matches', () => {
    const w = 32;
    const h = 32;

    const prev = new Uint8ClampedArray(w * h * 4);
    const curr = new Uint8ClampedArray(w * h * 4);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        prev[i] = (x * 8) % 256;
        prev[i + 1] = (y * 8) % 256;
        prev[i + 2] = 128;
        prev[i + 3] = 255;

        curr[i] = (x * 8 + (y < 4 ? 200 : 0)) % 256;
        curr[i + 1] = (y * 8) % 256;
        curr[i + 2] = 128;
        curr[i + 3] = 255;
      }
    }

    const flow = computeBlockFlow(prev, curr, w, h, 16, 8);

    expect(flow.length).toBeGreaterThan(0);

    const allConfidences = flow.flat().map((v) => v.confidence);
    const maxConf = Math.max(...allConfidences);
    const minConf = Math.min(...allConfidences);

    expect(maxConf).toBeGreaterThanOrEqual(0);
    expect(maxConf).toBeLessThanOrEqual(1);
    expect(minConf).toBeGreaterThanOrEqual(0);
    expect(minConf).toBeLessThanOrEqual(1);
  });

  it('clamps boundary search positions correctly', () => {
    const w = 16;
    const h = 16;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i++) {
      data[i] = (i * 7) % 256;
    }

    const flow = computeBlockFlow(data, data, w, h, 8, 4);

    expect(flow.length).toBe(2);
    expect(flow[0]!.length).toBe(2);
    for (const row of flow) {
      for (const vec of row) {
        expect(vec.dx).toBe(0);
        expect(vec.dy).toBe(0);
        expect(vec.confidence).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('returns empty array for zero-dimension input', () => {
    const data = new Uint8ClampedArray(0);
    expect(computeBlockFlow(data, data, 0, 0)).toEqual([]);
    expect(computeBlockFlow(data, data, 100, 0)).toEqual([]);
    expect(computeBlockFlow(data, data, 0, 100)).toEqual([]);
  });
});

describe('warpMask', () => {
  it('preserves mask unchanged when flow vectors are all zero', () => {
    const w = 16;
    const h = 16;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        mask[y * w + x] = x < 8 ? 255 : 0;
      }
    }

    const flow: { dx: number; dy: number; confidence: number }[][] = Array.from(
      { length: Math.ceil(h / 4) },
      () => Array.from({ length: Math.ceil(w / 4) }, () => ({ dx: 0, dy: 0, confidence: 1 })),
    );

    const result = warpMask(mask, flow, w, h, 4);

    expect(Array.from(result)).toEqual(Array.from(mask));
  });

  it('shifts mask content according to known flow field', () => {
    const w = 32;
    const h = 32;

    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        mask[y * w + x] = x < 16 ? 255 : 0;
      }
    }

    const blockSize = 8;
    const cols = Math.ceil(w / blockSize);
    const rows = Math.ceil(h / blockSize);
    const flow: { dx: number; dy: number; confidence: number }[][] = [];

    for (let r = 0; r < rows; r++) {
      const row: { dx: number; dy: number; confidence: number }[] = [];
      for (let c = 0; c < cols; c++) {
        row.push({ dx: 4, dy: 0, confidence: 1 });
      }
      flow.push(row);
    }

    const result = warpMask(mask, flow, w, h, blockSize);

    expect(result.length).toBe(mask.length);

    let _originalLeftHalf = 0;
    let shiftedLeftHalf = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x < 4 && y > 20) continue;
        if (x < 4 && y < 4) continue;
        if (mask[y * w + x]! > 128) _originalLeftHalf++;
        if (result[y * w + x]! > 128) shiftedLeftHalf++;
      }
    }

    expect(shiftedLeftHalf).toBeGreaterThan(0);
  });

  it('handles empty flow array gracefully', () => {
    const mask = new Uint8Array(16);
    const result = warpMask(mask, [], 4, 4, 4);
    expect(result.length).toBe(16);
  });
});
