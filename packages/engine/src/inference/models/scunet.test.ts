import { describe, expect, it } from 'vitest';
import type { ScunetInferenceInput } from './scunet';
import {
  alignTo8,
  blendTiles,
  computeTiles,
  extractTile,
  postprocessScunet,
  preprocessScunet,
  SCUNET_INPUT_SIZE,
  SCUNET_TENSOR_SPEC,
  validateScunetInput,
} from './scunet';

function makeImageData(width: number, height: number, fill = 200, alpha = 255): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill;
    data[i * 4 + 1] = Math.min(255, fill + 10);
    data[i * 4 + 2] = Math.min(255, fill + 20);
    data[i * 4 + 3] = alpha;
  }
  return { data, width, height, colorSpace: 'srgb' } as unknown as ImageData;
}

describe('scunet', () => {
  describe('constants', () => {
    it('dynamic input size is 0', () => {
      expect(SCUNET_INPUT_SIZE).toBe(0);
    });
    it('tensor spec uses identity normalization', () => {
      expect(SCUNET_TENSOR_SPEC.mean).toEqual([0, 0, 0]);
      expect(SCUNET_TENSOR_SPEC.std).toEqual([1, 1, 1]);
    });
  });

  describe('alignTo8', () => {
    it('rounds UP to multiple of 64 (the graph-safe padding for the baked attention reshape)', () => {
      expect(alignTo8(64)).toBe(64);
      expect(alignTo8(65)).toBe(128);
      expect(alignTo8(127)).toBe(128);
      expect(alignTo8(128)).toBe(128);
    });
    it('clamps minimum at 64', () => {
      expect(alignTo8(1)).toBe(64);
      expect(alignTo8(63)).toBe(64);
    });
    it('handles large values', () => {
      expect(alignTo8(512)).toBe(512);
      expect(alignTo8(513)).toBe(576);
      expect(alignTo8(1080)).toBe(1088);
      expect(alignTo8(1000)).toBe(1024);
    });
  });

  describe('computeTiles', () => {
    it('single tile for small images', () => {
      expect(computeTiles(100, 100, 512, 64)).toHaveLength(1);
    });
    it('multiple tiles for large images', () => {
      expect(computeTiles(1000, 800, 512, 64).length).toBeGreaterThan(1);
    });
    it('throws when overlap >= tileSize', () => {
      expect(() => computeTiles(100, 100, 64, 64)).toThrow();
    });
    it('covers entire image', () => {
      const tiles = computeTiles(600, 400, 256, 32);
      let maxX = 0,
        maxY = 0;
      for (const t of tiles) {
        maxX = Math.max(maxX, t.x + t.width);
        maxY = Math.max(maxY, t.y + t.height);
      }
      expect(maxX).toBeGreaterThanOrEqual(600);
      expect(maxY).toBeGreaterThanOrEqual(400);
    });
  });

  describe('extractTile', () => {
    it('extracts correct region', () => {
      const data = new Uint8ClampedArray(16 * 16 * 4).fill(128);
      for (let y = 4; y < 8; y++)
        for (let x = 4; x < 8; x++) {
          data[(y * 16 + x) * 4] = 255;
          data[(y * 16 + x) * 4 + 1] = 255;
          data[(y * 16 + x) * 4 + 2] = 255;
        }
      const img = { data, width: 16, height: 16, colorSpace: 'srgb' } as unknown as ImageData;
      const ext = extractTile(img, { x: 4, y: 4, width: 4, height: 4 });
      // alignment is to 64 (the graph-safe padding), edge-clamped content
      expect(ext.alignedWidth).toBe(64);
      expect(ext.alignedHeight).toBe(64);
      expect(ext.tensor[0]).toBeCloseTo(1);
    });
    it('clamps at boundaries', () => {
      const img = makeImageData(8, 8, 100);
      const ext = extractTile(img, { x: 4, y: 4, width: 8, height: 8 });
      expect(ext.alignedWidth).toBe(64);
      expect(ext.alignedHeight).toBe(64);
      for (const v of ext.tensor) expect(Number.isNaN(v)).toBe(false);
    });
    it('extracts alpha', () => {
      expect(
        extractTile(makeImageData(8, 8, 200, 128), { x: 0, y: 0, width: 8, height: 8 }).alphaData,
      ).not.toBeNull();
    });
    it('null alpha when opaque', () => {
      expect(
        extractTile(makeImageData(8, 8, 200, 255), { x: 0, y: 0, width: 8, height: 8 }).alphaData,
      ).toBeNull();
    });
  });

  describe('blendTiles', () => {
    it('produces correct dimensions', () => {
      const tiles = [
        { x: 0, y: 0, width: 8, height: 8 },
        { x: 4, y: 0, width: 8, height: 8 },
      ];
      // results are aligned to 64x64 planes
      const results = [
        new Float32Array(64 * 64 * 3).fill(0.5),
        new Float32Array(64 * 64 * 3).fill(0.7),
      ];
      expect(blendTiles(tiles, results, 12, 8, 4).length).toBe(12 * 8 * 3);
    });
    it('averages overlaps', () => {
      const tiles = [
        { x: 0, y: 0, width: 8, height: 8 },
        { x: 0, y: 0, width: 8, height: 8 },
      ];
      const t1 = new Float32Array(64 * 64 * 3).fill(0.4);
      const t2 = new Float32Array(64 * 64 * 3).fill(0.6);
      // both tiles cover the pixel with equal weight
      expect(blendTiles(tiles, [t1, t2], 8, 8, 4)[4 * 8 + 4]).toBeCloseTo(0.5, 1);
    });
    it('preserves non-overlapping edges', () => {
      const tensor = new Float32Array(64 * 64 * 3).fill(0.3);
      expect(blendTiles([{ x: 0, y: 0, width: 8, height: 8 }], [tensor], 8, 8, 4)[10]).toBeCloseTo(
        0.3,
      );
    });
  });

  describe('postprocessScunet', () => {
    it('strength=1 returns model output', () => {
      const data = new Uint8ClampedArray(4 * 4 * 4).fill(128);
      for (let i = 0; i < 16; i++) {
        data[i * 4] = 100;
        data[i * 4 + 1] = 150;
        data[i * 4 + 2] = 200;
        data[i * 4 + 3] = 255;
      }
      const r = postprocessScunet(new Float32Array(16 * 3).fill(0.8), 4, 4, 4, 4, null, 1, data);
      expect(r.data[0]).toBe(204);
    });
    it('strength=0 returns original', () => {
      const data = new Uint8ClampedArray(4 * 4 * 4);
      for (let i = 0; i < 16; i++) {
        data[i * 4] = 100;
        data[i * 4 + 1] = 150;
        data[i * 4 + 2] = 200;
        data[i * 4 + 3] = 255;
      }
      const r = postprocessScunet(new Float32Array(16 * 3).fill(0.9), 4, 4, 4, 4, null, 0, data);
      expect(r.data[0]).toBe(100);
    });
    it('strength=0.5 blends', () => {
      const data = new Uint8ClampedArray(4 * 4 * 4);
      for (let i = 0; i < 16; i++) data[i * 4 + 3] = 255;
      const r = postprocessScunet(new Float32Array(16 * 3).fill(1), 4, 4, 4, 4, null, 0.5, data);
      expect(r.data[0]).toBe(128);
    });
    it('preserves alpha', () => {
      const data = new Uint8ClampedArray(4 * 4 * 4);
      for (let i = 0; i < 16; i++) data[i * 4 + 3] = 64;
      const alpha = new Uint8ClampedArray(16).fill(64);
      expect(
        postprocessScunet(new Float32Array(16 * 3).fill(0.5), 4, 4, 4, 4, alpha, 1, data).data[3],
      ).toBe(64);
    });
    it('bilinear resize', () => {
      const data = new Uint8ClampedArray(64 * 4).fill(128);
      for (let i = 0; i < 64; i++) data[i * 4 + 3] = 255;
      const r = postprocessScunet(new Float32Array(64 * 3).fill(0.6), 8, 8, 4, 4, null, 1, data);
      expect(r.width).toBe(4);
      expect(r.height).toBe(4);
      expect(r.data[0]).toBe(153);
    });
    it('clamps output', () => {
      const data = new Uint8ClampedArray(4 * 4 * 4).fill(128);
      for (let i = 0; i < 16; i++) data[i * 4 + 3] = 255;
      expect(
        postprocessScunet(new Float32Array(48).fill(2), 4, 4, 4, 4, null, 1, data).data[0],
      ).toBe(255);
    });
  });

  describe('preprocessScunet', () => {
    it('correct dims for aligned input', () => {
      const r = preprocessScunet(makeImageData(64, 64, 200));
      expect(r.alignedWidth).toBe(64);
      expect(r.originalWidth).toBe(64);
    });
    it('pads to next 64-aligned (graph-safe for the baked attention reshape)', () => {
      const r = preprocessScunet(makeImageData(15, 17, 200));
      expect(r.alignedWidth).toBe(64);
      expect(r.alignedHeight).toBe(64);
      const r2 = preprocessScunet(makeImageData(1080, 1920, 200));
      expect(r2.alignedWidth).toBe(1088);
      expect(r2.alignedHeight).toBe(1920);
    });
    it('normalizes to [0,1]', () => {
      expect(preprocessScunet(makeImageData(8, 8, 200)).tensor[0]).toBeCloseTo(200 / 255, 4);
    });
    it('edge clamps padding', () => {
      const d = new Uint8ClampedArray(400).fill(100);
      for (let y = 0; y < 10; y++) d[(y * 10 + 9) * 4] = 255;
      const img = { data: d, width: 10, height: 10, colorSpace: 'srgb' } as unknown as ImageData;
      const r = preprocessScunet(img);
      expect(r.alignedWidth).toBe(64);
      expect(r.tensor[10]).toBeCloseTo(1);
    });
    it('detects alpha', () => {
      const r = preprocessScunet(makeImageData(8, 8, 200, 128));
      expect(r.hasAlpha).toBe(true);
      expect(r.alphaData![0]).toBe(128);
    });
    it('tensor length correct', () => {
      const r = preprocessScunet(makeImageData(10, 10, 200));
      expect(r.tensor.length).toBe(r.alignedWidth * r.alignedHeight * 3);
    });
  });

  describe('validateScunetInput', () => {
    it('accepts valid input', () => {
      const input: ScunetInferenceInput = { imageData: makeImageData(8, 8) };
      expect(validateScunetInput(input)).toBeNull();
    });
    it('rejects null', () => {
      expect(validateScunetInput(null)).toBeTruthy();
    });
    it('rejects missing imageData', () => {
      expect(validateScunetInput({})).toBeTruthy();
    });
    it('rejects zero dimensions', () => {
      expect(
        validateScunetInput({ imageData: new ImageData(new Uint8ClampedArray(0), 0, 0) }),
      ).toBeTruthy();
    });
    it('accepts strength in range', () => {
      expect(validateScunetInput({ imageData: makeImageData(8, 8), strength: 0 })).toBeNull();
      expect(validateScunetInput({ imageData: makeImageData(8, 8), strength: 1 })).toBeNull();
    });
    it('rejects strength out of range', () => {
      expect(validateScunetInput({ imageData: makeImageData(8, 8), strength: -0.1 })).toBeTruthy();
      expect(validateScunetInput({ imageData: makeImageData(8, 8), strength: 1.1 })).toBeTruthy();
    });
  });
});
