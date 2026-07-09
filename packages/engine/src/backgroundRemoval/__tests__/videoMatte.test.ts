import { describe, expect, it, vi } from 'vitest';
import type { VideoFrame, VideoMatteOptions, VideoMatteResult } from '../videoMatte';
import { processVideoMatte } from '../videoMatte';
import { computeBlockFlow, warpMask } from '../opticalFlow';

function makeFrame(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  index = 0,
  timestampMs = 0,
): VideoFrame {
  return { index, data, width, height, timestampMs };
}

function makeUniformFrame(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  index = 0,
  timestampMs = 0,
): VideoFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { index, data, width, height, timestampMs };
}

function makeSplitFrame(
  width: number,
  height: number,
  splitX: number,
  fgR: number,
  fgG: number,
  fgB: number,
  bgR: number,
  bgG: number,
  bgB: number,
  index = 0,
  timestampMs = 0,
): VideoFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (x < splitX) {
        data[i] = fgR;
        data[i + 1] = fgG;
        data[i + 2] = fgB;
      } else {
        data[i] = bgR;
        data[i + 1] = bgG;
        data[i + 2] = bgB;
      }
      data[i + 3] = 255;
    }
  }
  return { index, data, width, height, timestampMs };
}

const OPTIONS: VideoMatteOptions = {
  blockSize: 8,
  searchRadius: 4,
  temporalWeight: 0.3,
  medianWindow: 3,
  temporalSmoothing: true,
  keyframeInterval: 1,
};

describe('processVideoMatte', () => {
  it('single frame returns mask via AI inference', async () => {
    const frame = makeUniformFrame(16, 16, 255, 0, 0, 0);
    const mockAi = vi.fn().mockResolvedValue({
      mask: new Uint8Array(256).fill(255),
      confidence: 0.95,
    });

    const result = await processVideoMatte([frame], mockAi, OPTIONS);

    expect(result.masks).toHaveLength(1);
    expect(result.masks[0]).toBeDefined();
    expect(result.masks[0]!.length).toBe(256);
    expect(result.confidences).toHaveLength(1);
    expect(result.confidences[0]).toBe(0.95);
    expect(result.frameTimingsMs).toHaveLength(1);
    expect(result.consistencyScore).toBe(1);
    expect(mockAi).toHaveBeenCalledTimes(1);
  });

  it('two identical frames produce identical masks', async () => {
    const frame0 = makeUniformFrame(16, 16, 255, 0, 0, 0);
    const frame1 = makeUniformFrame(16, 16, 255, 0, 0, 1);

    const mask = new Uint8Array(256);
    for (let i = 0; i < 256; i++) mask[i] = i < 128 ? 255 : 0;

    const mockAi = vi.fn().mockResolvedValue({ mask: new Uint8Array(mask), confidence: 0.9 });

    const result = await processVideoMatte([frame0, frame1], mockAi, OPTIONS);

    expect(result.masks).toHaveLength(2);
    expect(Array.from(result.masks[0]!)).toEqual(Array.from(result.masks[1]!));
  });

  it('mask propagation with zero flow preserves mask when AI unavailable', async () => {
    const width = 16;
    const height = 16;
    const frame0 = makeSplitFrame(width, height, 8, 255, 0, 0, 0, 0, 0, 0);
    const frame1 = makeSplitFrame(width, height, 8, 255, 0, 0, 0, 0, 0, 1);

    let callCount = 0;
    const mockAi = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const mask = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            mask[y * width + x] = x < 8 ? 255 : 0;
          }
        }
        return Promise.resolve({ mask, confidence: 0.9 });
      }
      return Promise.reject(new Error('AI unavailable'));
    });

    const result = await processVideoMatte([frame0, frame1], mockAi, {
      ...OPTIONS,
      temporalSmoothing: true,
      keyframeInterval: 2,
    });

    expect(result.masks).toHaveLength(2);
    expect(mockAi).toHaveBeenCalledTimes(2);
  });

  it('temporal blending produces smoother results across shifts', async () => {
    const width = 16;
    const height = 16;

    const frame0 = makeSplitFrame(width, height, 8, 255, 0, 0, 0, 0, 0, 0);
    const frame1 = makeSplitFrame(width, height, 10, 255, 0, 0, 0, 0, 0, 1);

    let callCount = 0;
    const mockAi = vi.fn().mockImplementation(() => {
      callCount++;
      const mask = new Uint8Array(width * height);
      const split = callCount === 1 ? 8 : 10;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          mask[y * width + x] = x < split ? 255 : 0;
        }
      }
      return Promise.resolve({ mask, confidence: 0.85 });
    });

    const result = await processVideoMatte([frame0, frame1], mockAi, OPTIONS);

    expect(result.masks).toHaveLength(2);
    expect(result.confidences).toHaveLength(2);
  });

  it('keyframeInterval=2 processes every other frame with AI', async () => {
    const width = 16;
    const height = 16;

    const frames = [
      makeUniformFrame(width, height, 255, 0, 0, 0),
      makeUniformFrame(width, height, 0, 255, 0, 1),
      makeUniformFrame(width, height, 0, 0, 255, 2),
    ];

    const mockAi = vi.fn().mockResolvedValue({
      mask: new Uint8Array(width * height).fill(255),
      confidence: 0.9,
    });

    const result = await processVideoMatte(frames, mockAi, {
      ...OPTIONS,
      keyframeInterval: 2,
      temporalSmoothing: false,
    });

    expect(result.masks).toHaveLength(3);
    expect(result.masks[0]).toBeDefined();
    expect(result.masks[1]).toBeDefined();
    expect(result.masks[2]).toBeDefined();
  });

  it('empty frame array returns empty result', async () => {
    const mockAi = vi.fn();
    const result = await processVideoMatte([], mockAi, OPTIONS);
    expect(result).toEqual({
      masks: [],
      frameTimingsMs: [],
      confidences: [],
      consistencyScore: 1,
    });
    expect(mockAi).not.toHaveBeenCalled();
  });

  it('confidence-weighted blending assigns higher weight to AI predictions', async () => {
    const width = 16;
    const height = 16;

    const frame = makeSplitFrame(width, height, 8, 255, 0, 0, 0, 0, 0, 0);
    const mockAi = vi.fn().mockResolvedValue({
      mask: new Uint8Array(width * height).fill(255),
      confidence: 0.95,
    });

    const result = await processVideoMatte([frame], mockAi, OPTIONS);

    expect(result.masks[0]).toBeDefined();
    expect(mockAi).toHaveBeenCalledTimes(1);
  });

  it('median window of 1 produces no temporal filtering', async () => {
    const width = 16;
    const height = 16;

    const frame0 = makeUniformFrame(width, height, 255, 0, 0, 0);
    const frame1 = makeUniformFrame(width, height, 0, 255, 0, 1);

    const mockAi = vi
      .fn()
      .mockResolvedValue({ mask: new Uint8Array(width * height).fill(255), confidence: 0.9 });

    const resultNoMedian = await processVideoMatte([frame0, frame1], mockAi, {
      ...OPTIONS,
      medianWindow: 1,
    });

    expect(resultNoMedian.masks).toHaveLength(2);
  });

  it('consistency score is 1 for a single frame', async () => {
    const frame = makeUniformFrame(8, 8, 128, 128, 128, 0);
    const mockAi = vi.fn().mockResolvedValue({
      mask: new Uint8Array(64).fill(255),
      confidence: 0.9,
    });

    const result = await processVideoMatte([frame], mockAi, OPTIONS);
    expect(result.consistencyScore).toBe(1);
  });

  it('optical flow module integration with computeBlockFlow', () => {
    const w = 32;
    const h = 32;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = (i * 7) % 256;
      data[i * 4 + 1] = (i * 13) % 256;
      data[i * 4 + 2] = (i * 19) % 256;
      data[i * 4 + 3] = 255;
    }

    const flow = computeBlockFlow(data, data, w, h, 8, 4);

    for (const row of flow) {
      for (const vec of row) {
        expect(vec.dx).toBe(0);
        expect(vec.dy).toBe(0);
      }
    }
  });

  it('warpMask correctly shifts mask content position with known displacement', () => {
    const w = 16;
    const h = 16;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        mask[y * w + x] = x < 8 ? 255 : 0;
      }
    }

    const blockSize = 4;
    const cols = Math.ceil(w / blockSize);
    const rows = Math.ceil(h / blockSize);
    const flow = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ dx: 3, dy: 0, confidence: 1 })),
    );

    const result = warpMask(mask, flow, w, h, blockSize);

    expect(result.length).toBe(w * h);

    const origLeftHalf = mask.filter((_v, i) => i % w < 4).filter((v) => v! > 128).length;
    const resultLeftHalf = result.filter((_v, i) => i % w < 4).filter((v) => v! > 128).length;
    expect(resultLeftHalf).toBeLessThan(origLeftHalf);

    const origMidBand = mask
      .filter((_v, i) => {
        const x = i % w;
        return x >= 3 && x < 11;
      })
      .filter((v) => v! > 128).length;
    const resultMidBand = result
      .filter((_v, i) => {
        const x = i % w;
        return x >= 3 && x < 11;
      })
      .filter((v) => v! > 128).length;
    expect(resultMidBand).toBeGreaterThan(origMidBand);
  });
});

describe('processVideoMatte with temporal consistency', () => {
  it('temporalSmoothing disabled returns AI masks with post-processing applied', async () => {
    const frame = makeUniformFrame(8, 8, 100, 150, 200, 0);
    const aiRawMask = new Uint8Array(64).fill(255);
    const mockAi = vi.fn().mockResolvedValue({
      mask: new Uint8Array(aiRawMask),
      confidence: 0.8,
    });

    const result = await processVideoMatte([frame], mockAi, {
      ...OPTIONS,
      temporalSmoothing: false,
    });

    expect(result.masks[0]).toBeDefined();
    expect(result.masks[0]!.length).toBe(64);
    const avg = Array.from(result.masks[0]!).reduce((s, v) => s + v, 0) / 64;
    expect(avg).toBeGreaterThan(200);
  });

  it('returns consistency score close to 1 for slowly changing scene', async () => {
    const width = 8;
    const height = 8;

    const frames = [
      makeUniformFrame(width, height, 200, 200, 200, 0),
      makeUniformFrame(width, height, 201, 200, 199, 1),
      makeUniformFrame(width, height, 202, 200, 198, 2),
    ];

    const mockAi = vi.fn().mockResolvedValue({
      mask: new Uint8Array(width * height).fill(255),
      confidence: 0.9,
    });

    const result = await processVideoMatte(frames, mockAi, OPTIONS);

    expect(result.consistencyScore).toBeGreaterThan(0.8);
  });
});
