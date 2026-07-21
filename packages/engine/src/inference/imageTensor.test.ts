import { describe, expect, it } from 'vitest';
import {
  applySigmoid,
  computeLetterboxTransform,
  normalizeToUint8,
  packNchwTensor,
  packNchwTensorRgb,
  resizeMaskBilinear,
  type TensorSpec,
  thresholdMask,
} from './imageTensor';

const TEST_SPEC: TensorSpec = {
  inputWidth: 320,
  inputHeight: 320,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  paddingRgb: [0, 0, 0],
};

describe('imageTensor', () => {
  describe('computeLetterboxTransform', () => {
    it('computes uniform scale for square source', () => {
      const t = computeLetterboxTransform(640, 640, 320, 320);
      expect(t.scaleX).toBeCloseTo(0.5);
      expect(t.scaleY).toBeCloseTo(0.5);
      expect(t.offsetX).toBe(0);
      expect(t.offsetY).toBe(0);
    });

    it('preserves aspect ratio for wide source', () => {
      const t = computeLetterboxTransform(640, 320, 320, 320);
      expect(t.scaleX).toBeCloseTo(0.5);
      expect(t.scaleY).toBeCloseTo(0.5);
      expect(t.offsetX).toBe(0);
      expect(t.offsetY).toBe(80); // (320 - 320*0.5) / 2
    });

    it('preserves aspect ratio for tall source', () => {
      const t = computeLetterboxTransform(320, 640, 320, 320);
      expect(t.scaleX).toBeCloseTo(0.5);
      expect(t.scaleY).toBeCloseTo(0.5);
      expect(t.offsetX).toBe(80);
      expect(t.offsetY).toBe(0);
    });
  });

  describe('packNchwTensor', () => {
    it('packs a 2x2 RGBA image into NCHW format', () => {
      const data = new Uint8ClampedArray([
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
      ]);
      const imageData = { data, width: 2, height: 2 } as unknown as ImageData;
      const tensor = packNchwTensor(imageData, TEST_SPEC);

      // 2*2*3 = 12 floats
      expect(tensor.length).toBe(12);

      // First pixel (255,0,0) normalized: R = (1 - 0.485) / 0.229
      const r0 = (1 - TEST_SPEC.mean[0]) / TEST_SPEC.std[0];
      expect(tensor[0]).toBeCloseTo(r0, 5); // R channel, pixel 0

      // G channel, pixel 0: (0 - 0.456) / 0.224
      const g0 = (0 - TEST_SPEC.mean[1]) / TEST_SPEC.std[1];
      expect(tensor[4]).toBeCloseTo(g0, 5); // G channel starts at pixelCount=4

      // B channel, pixel 0: (0 - 0.406) / 0.225
      const b0 = (0 - TEST_SPEC.mean[2]) / TEST_SPEC.std[2];
      expect(tensor[8]).toBeCloseTo(b0, 5); // B channel starts at pixelCount*2=8
    });

    it('handles all-zero image', () => {
      const data = new Uint8ClampedArray(16); // 2x2 all zeros
      const imageData = { data, width: 2, height: 2 } as unknown as ImageData;
      const tensor = packNchwTensor(imageData, TEST_SPEC);

      // All normalized values should be -mean/std
      const expectedR = (0 - TEST_SPEC.mean[0]) / TEST_SPEC.std[0];
      expect(tensor[0]).toBeCloseTo(expectedR, 5);
    });
  });

  describe('packNchwTensorRgb', () => {
    it('packs RGB data without alpha', () => {
      const data = new Uint8Array([255, 0, 0, 0, 255, 0]);
      const tensor = packNchwTensorRgb(data, 2, 1, TEST_SPEC);
      expect(tensor.length).toBe(6); // 2*1*3

      const r0 = (1 - TEST_SPEC.mean[0]) / TEST_SPEC.std[0];
      expect(tensor[0]).toBeCloseTo(r0, 5);
    });
  });

  describe('resizeMaskBilinear', () => {
    it('upsamples a 2x2 mask to 4x4', () => {
      const mask = new Float32Array([0, 1, 1, 0]);
      const result = resizeMaskBilinear(mask, 2, 2, 4, 4);
      expect(result.length).toBe(16);
    });

    it('preserves corner values after resize', () => {
      const mask = new Float32Array([0.5, 0.5, 0.5, 0.5]);
      const result = resizeMaskBilinear(mask, 2, 2, 4, 4);
      // All values should be 0.5 for uniform input
      for (const v of result) {
        expect(v).toBeCloseTo(0.5, 5);
      }
    });

    it('downsamples a 4x4 mask to 2x2', () => {
      const mask = new Float32Array(16).fill(0.8);
      const result = resizeMaskBilinear(mask, 4, 4, 2, 2);
      expect(result.length).toBe(4);
      for (const v of result) {
        expect(v).toBeCloseTo(0.8, 5);
      }
    });
  });

  describe('applySigmoid', () => {
    it('returns 0.5 for input 0', () => {
      const data = new Float32Array([0]);
      applySigmoid(data);
      expect(data[0]).toBeCloseTo(0.5, 5);
    });

    it('approaches 1 for large positive input', () => {
      const data = new Float32Array([10]);
      applySigmoid(data);
      expect(data[0]).toBeGreaterThan(0.99);
    });

    it('approaches 0 for large negative input', () => {
      const data = new Float32Array([-10]);
      applySigmoid(data);
      expect(data[0]).toBeLessThan(0.01);
    });
  });

  describe('normalizeToUint8', () => {
    it('normalizes min to 0 and max to 255', () => {
      const data = new Float32Array([0.2, 0.5, 0.8, 1.0]);
      const result = normalizeToUint8(data);
      expect(result[0]).toBe(0);
      expect(result[result.length - 1]).toBe(255);
    });

    it('handles uniform input (all same value → all 0)', () => {
      const data = new Float32Array([0.5, 0.5, 0.5]);
      const result = normalizeToUint8(data);
      expect(result[0]).toBe(0);
    });
  });

  describe('thresholdMask', () => {
    it('binarizes at default threshold', () => {
      const data = new Float32Array([0.3, 0.5, 0.7]);
      const result = thresholdMask(data);
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(255);
      expect(result[2]).toBe(255);
    });

    it('respects custom threshold', () => {
      const data = new Float32Array([0.3, 0.5, 0.7]);
      const result = thresholdMask(data, 0.6);
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(0);
      expect(result[2]).toBe(255);
    });
  });
});
