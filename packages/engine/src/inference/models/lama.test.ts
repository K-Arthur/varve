import { describe, expect, it } from 'vitest';
import { decodeLamaOutput, LAMA_INPUT_SIZE, LAMA_TENSOR_SPEC } from './lama';

describe('lama', () => {
  it('exposes the verified fixed input size', () => {
    expect(LAMA_INPUT_SIZE).toBe(512);
  });

  it('uses no normalization — output is already 0-255 scaled by the ONNX export', () => {
    expect(LAMA_TENSOR_SPEC.mean).toEqual([0, 0, 0]);
    expect(LAMA_TENSOR_SPEC.std).toEqual([1, 1, 1]);
  });

  describe('decodeLamaOutput', () => {
    it('maps already-0-255-scaled planar RGB output directly into interleaved RGBA', () => {
      // 1x1 "image": R=10, G=20, B=30 (already in 0-255 range).
      const data = new Float32Array([10, 20, 30]);
      const result = decodeLamaOutput(data, 1, 1, 1, 1);
      expect(result.data[0]).toBe(10);
      expect(result.data[1]).toBe(20);
      expect(result.data[2]).toBe(30);
      expect(result.data[3]).toBe(255);
    });

    it('clamps out-of-range values', () => {
      const data = new Float32Array([-10, 300, 128]);
      const result = decodeLamaOutput(data, 1, 1, 1, 1);
      expect(result.data[0]).toBe(0);
      expect(result.data[1]).toBe(255);
      expect(result.data[2]).toBe(128);
    });

    it('crops out letterbox padding before resizing to target (non-square source)', () => {
      // 4x4 model output, planar RGB, where only rows 1-2 are "real
      // content" (left half=0, right half=255), rows 0/3 are padding.
      const w = 4;
      const h = 4;
      const pixelCount = w * h;
      const r = new Float32Array(pixelCount);
      // biome-ignore format: readability of the grid layout
      const pattern = [
        128, 128, 128, 128, // padding row
        0, 0, 255, 255,     // real content
        0, 0, 255, 255,     // real content
        128, 128, 128, 128, // padding row
      ];
      r.set(pattern);
      const data = new Float32Array(pixelCount * 3);
      data.set(r, 0);
      data.set(r, pixelCount);
      data.set(r, pixelCount * 2);

      const withCrop = decodeLamaOutput(data, w, h, 8, 4, { offsetX: 0, offsetY: 1 });
      for (let y = 0; y < 4; y++) {
        const rowStart = y * 8 * 4;
        expect(withCrop.data[rowStart]).toBe(0); // left = black
        expect(withCrop.data[rowStart + 7 * 4]).toBe(255); // right = white
      }
    });

    it('leaves output unchanged when letterbox offsets are zero (square source)', () => {
      const data = new Float32Array([10, 20, 30, 40, 5, 6, 7, 8, 9, 11, 12, 13]);
      const withZeroOffset = decodeLamaOutput(data, 2, 2, 2, 2, { offsetX: 0, offsetY: 0 });
      const withoutParam = decodeLamaOutput(data, 2, 2, 2, 2);
      expect(Array.from(withZeroOffset.data)).toEqual(Array.from(withoutParam.data));
    });

    it('uses the worker-reported content extent for odd non-square frames', () => {
      const outputWidth = 10;
      const outputHeight = 10;
      const contentX = 2;
      const contentY = 2;
      const contentWidth = 8;
      const contentHeight = 7;
      const pixelCount = outputWidth * outputHeight;
      const data = new Float32Array(pixelCount * 3);
      for (let y = contentY; y < contentY + contentHeight; y += 1) {
        for (let x = contentX; x < contentX + contentWidth; x += 1) {
          const index = y * outputWidth + x;
          data[index] = 200;
          data[pixelCount + index] = 100;
          data[pixelCount * 2 + index] = 50;
        }
      }

      const result = decodeLamaOutput(
        data,
        outputWidth,
        outputHeight,
        contentWidth,
        contentHeight,
        { offsetX: 1.5, offsetY: 1.5, contentWidth, contentHeight },
      );

      expect(result.width).toBe(contentWidth);
      expect(result.height).toBe(contentHeight);
      expect(
        Array.from(result.data).every((value, index) => {
          if (index % 4 === 0) return value === 200;
          if (index % 4 === 1) return value === 100;
          if (index % 4 === 2) return value === 50;
          return value === 255;
        }),
      ).toBe(true);
    });

    it('rejects an output buffer whose planar channels are incomplete', () => {
      expect(() => decodeLamaOutput(new Float32Array(2), 1, 1, 1, 1)).toThrow('does not match');
    });
  });
});
