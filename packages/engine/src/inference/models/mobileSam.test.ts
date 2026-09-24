import { describe, expect, it } from 'vitest';
import {
  decodeMobileSamDecoderOutput,
  encodeMobileSamPrompts,
  preprocessMobileSamImageData,
  resizeLongestSideDimensions,
  validateMobileSamPrompts,
} from '../models/mobileSam';

describe('MobileSAM ONNX contract', () => {
  it('emits raw RGB HWC input with provider-owned longest-side resizing', () => {
    const result = preprocessMobileSamImageData(
      {
        width: 2,
        height: 1,
        data: new Uint8ClampedArray([10, 20, 30, 0, 100, 110, 120, 255]),
      } as ImageData,
      2,
    );
    expect(result.width).toBe(2);
    expect(result.height).toBe(1);
    expect(Array.from(result.tensor)).toEqual([10, 20, 30, 100, 110, 120]);
  });

  it('uses SAM ResizeLongestSide rounding and top-left padding geometry', () => {
    expect(resizeLongestSideDimensions(1920, 1080)).toEqual({
      width: 1024,
      height: 576,
      scaleX: 1024 / 1920,
      scaleY: 576 / 1080,
    });
    expect(resizeLongestSideDimensions(1080, 1920)).toEqual({
      width: 576,
      height: 1024,
      scaleX: 576 / 1080,
      scaleY: 1024 / 1920,
    });
  });

  it('maps a wide-image point and box into the resized encoder space', () => {
    const point = encodeMobileSamPrompts({ points: [{ x: 0.5, y: 0.5, label: 1 }] }, 1920, 1080);
    expect(point.point_coords.data).toEqual(new Float32Array([512, 288]));
    expect(point.point_labels.data).toEqual(new Float32Array([1]));
    expect(point.orig_im_size.data).toEqual(new Float32Array([1080, 1920]));

    const box = encodeMobileSamPrompts({ box: { x1: 0, y1: 0, x2: 1, y2: 1 } }, 1920, 1080);
    expect(box.point_coords.data).toEqual(new Float32Array([0, 0, 1024, 576]));
    expect(box.point_labels.data).toEqual(new Float32Array([2, 3]));
  });

  it('preserves negative prompts and supplies the required empty mask input', () => {
    const encoded = encodeMobileSamPrompts(
      {
        points: [
          { x: 0.2, y: 0.3, label: 1 },
          { x: 0.8, y: 0.7, label: 0 },
        ],
      },
      1000,
      1000,
    );
    expect(encoded.point_labels.data).toEqual(new Float32Array([1, 0]));
    expect(encoded.mask_input.dims).toEqual([1, 1, 256, 256]);
    expect(encoded.mask_input.data.every((value) => value === 0)).toBe(true);
    expect(encoded.has_mask_input.data[0]).toBe(0);
    expect(encoded.has_mask_input.dims).toEqual([1]);
  });

  it('resizes previous logits and marks the mask prompt as present', () => {
    const previous = new Float32Array([0, 1, 2, 3]);
    const encoded = encodeMobileSamPrompts(
      {
        points: [{ x: 0.5, y: 0.5, label: 1 }],
        previousMask: { data: previous, width: 2, height: 2 },
      },
      800,
      600,
    );
    expect(encoded.has_mask_input.data[0]).toBe(1);
    expect(encoded.mask_input.data.length).toBe(256 * 256);
    expect(encoded.mask_input.data[0]).toBe(0);
    expect(encoded.mask_input.data[255]).toBeCloseTo(1);
    expect(encoded.mask_input.data[256 * 255]).toBeCloseTo(2);
    expect(encoded.mask_input.data[256 * 256 - 1]).toBeCloseTo(3);
  });

  it('accepts raw predicted-IoU scores above one and preserves all four candidates', () => {
    const maskData = new Float32Array(4 * 2 * 2);
    maskData.set([1, 1, 1, 1], 0);
    maskData.set([-1, -1, -1, -1], 4);
    maskData.set([1, -1, 1, -1], 8);
    maskData.set([-1, 1, -1, 1], 12);
    const decoded = decodeMobileSamDecoderOutput(
      maskData,
      [1, 4, 2, 2],
      new Float32Array([0.91, 1.01, 0.82, 0.96]),
      [1, 4],
      2,
      2,
    );
    expect(decoded.selectedIndex).toBe(1);
    expect(decoded.selectedScore).toBeCloseTo(1.01);
    expect(decoded.scoreSource).toBe('predicted-iou');
    expect(decoded.masks).toHaveLength(4);
    expect(decoded.masks[0]?.mask).toEqual(new Uint8Array([255, 255, 255, 255]));
    expect(decoded.masks[1]?.mask).toEqual(new Uint8Array([0, 0, 0, 0]));
    expect(decoded.masks[2]?.scoreSource).toBe('predicted-iou');
  });

  it('keeps low-resolution logits attached to their stable candidate identity', () => {
    const lowRes = new Float32Array(2 * 2 * 2);
    lowRes.set([1, 2, 3, 4], 0);
    lowRes.set([5, 6, 7, 8], 4);
    const decoded = decodeMobileSamDecoderOutput(
      new Float32Array([1, -1, 1, -1, -1, 1, -1, 1]),
      [1, 2, 2, 2],
      new Float32Array([0.4, 0.8]),
      [1, 2],
      2,
      2,
      lowRes,
      [1, 2, 2, 2],
    );
    expect(decoded.masks[0]?.lowResMask?.data).toEqual(new Float32Array([1, 2, 3, 4]));
    expect(decoded.masks[1]?.lowResMask?.data).toEqual(new Float32Array([5, 6, 7, 8]));
  });

  it('rejects malformed, non-finite, and overlarge decoder output', () => {
    expect(() => validateMobileSamPrompts({})).toThrow(/point or box/);
    expect(() =>
      decodeMobileSamDecoderOutput(
        new Float32Array([0, 0, 0, Number.NaN]),
        [1, 1, 2, 2],
        new Float32Array([0.5]),
        [1, 1],
        2,
        2,
      ),
    ).toThrow(/non-finite/);
    expect(() =>
      decodeMobileSamDecoderOutput(
        new Float32Array(5),
        [1, 1, 2, 2],
        new Float32Array([0.5]),
        [1, 1],
        2,
        2,
      ),
    ).toThrow(/data length/);
    expect(() =>
      decodeMobileSamDecoderOutput(
        new Float32Array([0, 0, 0, 0]),
        [1, 1, 2, 2],
        new Float32Array([0.5]),
        [1, 2],
        2,
        2,
      ),
    ).toThrow(/predicted-IoU dimensions/);
  });
});
