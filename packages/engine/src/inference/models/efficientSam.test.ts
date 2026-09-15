import { describe, expect, it } from 'vitest';
import {
  decodeEfficientSamDecoderOutput,
  EFFICIENT_SAM_MAX_CANDIDATES,
  EFFICIENT_SAM_MAX_INPUT_POINTS,
  encodeEfficientSamPrompts,
  preprocessEfficientSamImageData,
  resizeEfficientSamDimensions,
  validateEfficientSamPrompts,
} from './efficientSam';

describe('EfficientSAM-Ti provider contract', () => {
  it('resizes to the longest-side-1024 geometry with rounded integer dimensions', () => {
    expect(resizeEfficientSamDimensions(1280, 960)).toEqual({
      width: 1024,
      height: 768,
      scaleX: 0.8,
      scaleY: 0.8,
    });
    const portrait = resizeEfficientSamDimensions(1920, 2383);
    expect(portrait.width).toBe(825);
    expect(portrait.height).toBe(1024);
    // Coordinates map through the integer dimensions, not the unrounded scale.
    expect(portrait.scaleX).toBeCloseTo(825 / 1920, 12);
    expect(portrait.scaleY).toBeCloseTo(1024 / 2383, 12);
  });

  it('emits NCHW RGB in [0,1] without pre-normalizing (the graph normalizes internally)', () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
    ]);
    const image = { data: pixels, width: 2, height: 1 };
    const result = preprocessEfficientSamImageData(image, 2);
    expect(result.width).toBe(2);
    expect(result.height).toBe(1);
    const plane = 2;
    // Plane order is CHW: R plane, G plane, B plane. Pixel 0 is red, pixel 1 green.
    expect(result.tensor[0]).toBeCloseTo(1, 6);
    expect(result.tensor[1]).toBeCloseTo(0, 6);
    expect(result.tensor[plane + 0]).toBeCloseTo(0, 6);
    expect(result.tensor[plane + 1]).toBeCloseTo(1, 6);
    expect(result.tensor[plane * 2 + 0]).toBeCloseTo(0, 6);
    expect(result.tensor[plane * 2 + 1]).toBeCloseTo(0, 6);
  });

  it('pads prompts to the official six-point maximum with -1 coordinates and labels', () => {
    const encoded = encodeEfficientSamPrompts(
      { points: [{ x: 0.5, y: 0.25, label: 1 }] },
      1024,
      512,
    );
    expect(encoded.batched_point_coords.dims).toEqual([1, 1, EFFICIENT_SAM_MAX_INPUT_POINTS, 2]);
    expect(encoded.batched_point_labels.dims).toEqual([1, 1, EFFICIENT_SAM_MAX_INPUT_POINTS]);
    expect(encoded.batched_point_coords.data[0]).toBeCloseTo(512, 4);
    expect(encoded.batched_point_coords.data[1]).toBeCloseTo(128, 4);
    expect(encoded.batched_point_labels.data[0]).toBe(1);
    for (let index = 1; index < EFFICIENT_SAM_MAX_INPUT_POINTS; index += 1) {
      expect(encoded.batched_point_coords.data[index * 2]).toBe(-1);
      expect(encoded.batched_point_coords.data[index * 2 + 1]).toBe(-1);
      expect(encoded.batched_point_labels.data[index]).toBe(-1);
    }
    expect(encoded.orig_im_size.dims).toEqual([2]);
    expect(encoded.orig_im_size.data[0]).toBe(BigInt(512));
    expect(encoded.orig_im_size.data[1]).toBe(BigInt(1024));
  });

  it('represents a box with corner labels 2 and 3 after the points', () => {
    const encoded = encodeEfficientSamPrompts(
      {
        points: [{ x: 0.5, y: 0.5, label: 1 }],
        box: { x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 },
      },
      800,
      800,
    );
    // 800x800 scales by 1024/800 before the graph's internal square stretch.
    expect(encoded.batched_point_labels.data[0]).toBe(1);
    expect(encoded.batched_point_labels.data[1]).toBe(2);
    expect(encoded.batched_point_labels.data[2]).toBe(3);
    expect(encoded.batched_point_coords.data[2]).toBeCloseTo(256, 3);
    expect(encoded.batched_point_coords.data[4]).toBeCloseTo(768, 3);
  });

  it('truncates prompts beyond six rather than re-ordering them', () => {
    const points = Array.from({ length: 9 }, (_, index) => ({
      x: index / 10,
      y: index / 10,
      label: 1 as const,
    }));
    const encoded = encodeEfficientSamPrompts({ points }, 100, 100);
    expect(encoded.batched_point_coords.data).toHaveLength(EFFICIENT_SAM_MAX_INPUT_POINTS * 2);
    // Point index 5 passes through: 0.5 * 100 * 10.24 = 512.
    expect(encoded.batched_point_coords.data[10]).toBeCloseTo(512, 3);
    expect(encoded.batched_point_labels.data[5]).toBe(1);
  });

  it('decodes candidate logits at the 0.0 official threshold and ranks by raw score', () => {
    const width = 2;
    const height = 2;
    const candidateCount = 3;
    const maskData = new Float32Array(candidateCount * width * height);
    // Candidate 0: all negative. Candidate 1: all positive. Candidate 2: mixed.
    maskData.fill(-1, 0, 4);
    maskData.fill(1, 4, 8);
    maskData[8] = 1;
    const scoreData = new Float32Array([0.1, 0.9, 0.5]);
    const decoded = decodeEfficientSamDecoderOutput(
      maskData,
      [1, 1, candidateCount, height, width],
      scoreData,
      [1, 1, candidateCount],
      width,
      height,
    );
    expect(decoded.selectedIndex).toBe(1);
    expect(decoded.scoreSource).toBe('predicted-iou');
    expect(Array.from(decoded.masks[0]!.mask)).toEqual([0, 0, 0, 0]);
    expect(Array.from(decoded.masks[1]!.mask)).toEqual([255, 255, 255, 255]);
    expect(Array.from(decoded.masks[2]!.mask)).toEqual([255, 0, 0, 0]);
  });

  it('upscales candidate logits to the source resolution when the graph emits resized masks', () => {
    const maskData = new Float32Array([1, 1, 1, 1]);
    const decoded = decodeEfficientSamDecoderOutput(
      maskData,
      [1, 1, 1, 2, 2],
      new Float32Array([0.4]),
      [1, 1, 1],
      4,
      4,
    );
    expect(decoded.masks[0]!.width).toBe(4);
    expect(decoded.masks[0]!.height).toBe(4);
    expect(decoded.masks[0]!.mask.every((value) => value === 255)).toBe(true);
  });

  it('rejects malformed decoder tensors and prompt ranges instead of guessing', () => {
    expect(() =>
      decodeEfficientSamDecoderOutput(
        new Float32Array(4),
        [1, 1, 3, 2, 2],
        new Float32Array([0.1, 0.2, 0.3]),
        [1, 1, 3],
        4,
        4,
      ),
    ).toThrow();
    expect(() =>
      decodeEfficientSamDecoderOutput(
        new Float32Array([1, 1, 1, 1]),
        [1, 1, 1, 2, 2],
        new Float32Array([Number.NaN]),
        [1, 1, 1],
        2,
        2,
      ),
    ).toThrow();
    expect(() => validateEfficientSamPrompts({ points: [] })).toThrow();
    expect(() => validateEfficientSamPrompts({ points: [{ x: 1.2, y: 0.5, label: 1 }] })).toThrow();
    expect(() =>
      validateEfficientSamPrompts({ box: { x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.9 } }),
    ).toThrow();
  });

  it('exposes the official three-candidate maximum', () => {
    expect(EFFICIENT_SAM_MAX_CANDIDATES).toBe(3);
  });
});
