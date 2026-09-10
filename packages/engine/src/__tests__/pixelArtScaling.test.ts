import { describe, expect, it } from 'vitest';
import { scalePixelArt } from '../pixelArtScaling';

function createTestImage(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return new ImageData(data, width, height);
}

function fillWhite(_x: number, _y: number): [number, number, number, number] {
  return [255, 255, 255, 255];
}

function fillChecker(x: number, y: number): [number, number, number, number] {
  const v = (x + y) % 2 === 0 ? 255 : 0;
  return [v, v, v, 255];
}

function fillDiagonal(x: number, y: number): [number, number, number, number] {
  return x === y ? [255, 0, 0, 255] : [0, 0, 0, 255];
}

function fillTransparent(x: number, _y: number): [number, number, number, number] {
  return x < 2 ? [255, 255, 255, 0] : [255, 255, 255, 255];
}

describe('scalePixelArt', () => {
  describe('nearest neighbor', () => {
    it('scales a 2x2 white image to 4x4', () => {
      const src = createTestImage(2, 2, fillWhite);
      const result = scalePixelArt(src, { algorithm: 'nearest', scale: 2 });
      expect(result.width).toBe(4);
      expect(result.height).toBe(4);
      for (let i = 0; i < result.data.length; i += 4) {
        expect(result.data[i]).toBe(255);
        expect(result.data[i + 1]).toBe(255);
        expect(result.data[i + 2]).toBe(255);
        expect(result.data[i + 3]).toBe(255);
      }
    });

    it('rejects non-integer scale', () => {
      const src = createTestImage(2, 2, fillWhite);
      expect(() => scalePixelArt(src, { algorithm: 'nearest', scale: 2.5 })).toThrow();
    });
  });

  describe('EPX/Scale2x', () => {
    it('preserves exact 2x dimensions', () => {
      const src = createTestImage(4, 4, fillChecker);
      const result = scalePixelArt(src, { algorithm: 'epx', scale: 2 });
      expect(result.width).toBe(8);
      expect(result.height).toBe(8);
    });

    it('preserves alpha values', () => {
      const src = createTestImage(4, 4, fillTransparent);
      const result = scalePixelArt(src, { algorithm: 'epx', scale: 2 });
      const firstAlpha = result.data[3];
      expect(firstAlpha).toBe(0);
      const opaqueCount = result.data.filter(
        (_, i) => i % 4 === 3 && result.data[i] === 255,
      ).length;
      expect(opaqueCount).toBeGreaterThan(0);
    });

    it('produces deterministic output', () => {
      const src = createTestImage(4, 4, fillDiagonal);
      const r1 = scalePixelArt(src, { algorithm: 'epx', scale: 2 });
      const r2 = scalePixelArt(src, { algorithm: 'epx', scale: 2 });
      expect(Buffer.from(r1.data)).toEqual(Buffer.from(r2.data));
    });
  });

  describe('hqx', () => {
    it('preserves exact 2x dimensions', () => {
      const src = createTestImage(4, 4, fillChecker);
      const result = scalePixelArt(src, { algorithm: 'hqx', scale: 2 });
      expect(result.width).toBe(8);
      expect(result.height).toBe(8);
    });

    it('produces deterministic output', () => {
      const src = createTestImage(4, 4, fillDiagonal);
      const r1 = scalePixelArt(src, { algorithm: 'hqx', scale: 2 });
      const r2 = scalePixelArt(src, { algorithm: 'hqx', scale: 2 });
      expect(Buffer.from(r1.data)).toEqual(Buffer.from(r2.data));
    });
  });

  describe('xBR', () => {
    it('preserves exact 2x dimensions', () => {
      const src = createTestImage(4, 4, fillChecker);
      const result = scalePixelArt(src, { algorithm: 'xbr', scale: 2 });
      expect(result.width).toBe(8);
      expect(result.height).toBe(8);
    });

    it('produces deterministic output', () => {
      const src = createTestImage(4, 4, fillDiagonal);
      const r1 = scalePixelArt(src, { algorithm: 'xbr', scale: 2 });
      const r2 = scalePixelArt(src, { algorithm: 'xbr', scale: 2 });
      expect(Buffer.from(r1.data)).toEqual(Buffer.from(r2.data));
    });
  });

  describe('scale3x and scale4x', () => {
    it('scale3x produces 3x dimensions', () => {
      const src = createTestImage(4, 4, fillWhite);
      const result = scalePixelArt(src, { algorithm: 'scale3x', scale: 3 });
      expect(result.width).toBe(12);
      expect(result.height).toBe(12);
    });

    it('scale4x produces 4x dimensions', () => {
      const src = createTestImage(4, 4, fillWhite);
      const result = scalePixelArt(src, { algorithm: 'scale4x', scale: 4 });
      expect(result.width).toBe(16);
      expect(result.height).toBe(16);
    });
  });

  describe('edge cases', () => {
    it('handles 1x1 image', () => {
      const src = createTestImage(1, 1, (_x, _y) => [128, 64, 32, 255]);
      const result = scalePixelArt(src, { algorithm: 'epx', scale: 2 });
      expect(result.width).toBe(2);
      expect(result.height).toBe(2);
      expect(result.data[0]).toBe(128);
      expect(result.data[1]).toBe(64);
      expect(result.data[2]).toBe(32);
    });

    it('handles scale 1 (no-op)', () => {
      const src = createTestImage(4, 4, fillChecker);
      const result = scalePixelArt(src, { algorithm: 'nearest', scale: 1 });
      expect(result.width).toBe(4);
      expect(result.height).toBe(4);
    });
  });
});
