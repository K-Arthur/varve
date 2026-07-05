import { describe, expect, it } from 'vitest';
import { generateAMMatrix, applyAMScreening, applyHalftone, type HalftoneParams } from './halftone';

describe('halftone AM matrix generation', () => {
  it('generates a 32x32 matrix for round dots', () => {
    const matrix = generateAMMatrix(32, 'round');
    expect(matrix.length).toBe(1024); // 32*32
    // Matrix values should be in 0-255 range
    expect(Math.max(...matrix)).toBeLessThanOrEqual(255);
    expect(Math.min(...matrix)).toBeGreaterThanOrEqual(0);
  });

  it('generates a 64x64 matrix for elliptical dots', () => {
    const matrix = generateAMMatrix(64, 'elliptical');
    expect(matrix.length).toBe(4096);
  });

  it('generates a 32x32 matrix for square dots', () => {
    const matrix = generateAMMatrix(32, 'square');
    expect(matrix.length).toBe(1024);
  });

  it('generates a 32x32 matrix for diamond dots', () => {
    const matrix = generateAMMatrix(32, 'diamond');
    expect(matrix.length).toBe(1024);
  });

  it('generates a 32x32 matrix for line dots', () => {
    const matrix = generateAMMatrix(32, 'line');
    expect(matrix.length).toBe(1024);
    // Line screen: threshold varies only in one direction
    const row0 = matrix[0]!;
    const row1 = matrix[32]!;
    // Rows should differ (line screen varies by row)
    expect(row0).not.toBe(row1);
  });

  it('matrix center values are low (dots start growing from center)', () => {
    const size = 32;
    const matrix = generateAMMatrix(size, 'round');
    const center = size / 2;
    const centerVal = matrix[center * size + center]!;
    const cornerVal = matrix[0]!;
    // Center should have lower threshold (dots start there)
    expect(centerVal).toBeLessThan(cornerVal);
  });
});

describe('halftone AM screening application', () => {
  it('applies AM screening to grayscale image', () => {
    const w = 64;
    const h = 64;
    const data = new ImageData(w, h);
    // Fill with gradient
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const val = Math.round((x / w) * 255);
        data.data[idx] = val;
        data.data[idx + 1] = val;
        data.data[idx + 2] = val;
        data.data[idx + 3] = 255;
      }
    }

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 20,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };

    applyAMScreening(data, params);
    // After screening, pixels should be either 0 or 255 (binary)
    let hasBlack = false;
    let hasWhite = false;
    for (let i = 0; i < data.data.length; i += 4) {
      if (data.data[i] === 0) hasBlack = true;
      if (data.data[i] === 255) hasWhite = true;
    }
    expect(hasBlack).toBe(true);
    expect(hasWhite).toBe(true);
  });

  it('applies AM screening with elliptical dots', () => {
    const data = new ImageData(32, 32);
    fillGradient(data, 32, 32);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 15,
      angle: 0,
      dotShape: 'elliptical',
      channel: 'k',
      method: 'am',
    };
    expect(() => applyAMScreening(data, params)).not.toThrow();
  });

  it('applies AM screening at different angles', () => {
    const data = new ImageData(32, 32);
    fillGradient(data, 32, 32);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 15,
      angle: 75,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };
    expect(() => applyAMScreening(data, params)).not.toThrow();
  });
});

describe('halftone dispatch', () => {
  it('applyHalftone dispatches to AM method', () => {
    const data = new ImageData(32, 32);
    fillGradient(data, 32, 32);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };
    const result = applyHalftone(data, params);
    expect(result.width).toBe(32);
    expect(result.height).toBe(32);
  });

  it('applyHalftone dispatches to FM method', () => {
    const data = new ImageData(32, 32);
    fillGradient(data, 32, 32);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 15,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };
    const result = applyHalftone(data, params);
    expect(result.width).toBe(32);
    expect(result.height).toBe(32);
  });

  it('FM screening produces binary output', () => {
    const data = new ImageData(16, 16);
    fillGradient(data, 16, 16);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };
    applyHalftone(data, params);
    let hasBlack = false;
    let hasWhite = false;
    for (let i = 0; i < data.data.length; i += 4) {
      if (data.data[i] === 0) hasBlack = true;
      if (data.data[i] === 255) hasWhite = true;
    }
    expect(hasBlack).toBe(true);
    expect(hasWhite).toBe(true);
  });

  it('preserves alpha channel', () => {
    const data = new ImageData(16, 16);
    fillGradient(data, 16, 16);
    // Set alpha to semi-transparent
    for (let i = 3; i < data.data.length; i += 4) {
      data.data[i] = 128;
    }
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };
    applyHalftone(data, params);
    // Alpha should still be 128
    for (let i = 3; i < data.data.length; i += 4) {
      expect(data.data[i]).toBe(128);
    }
  });
});

function fillGradient(data: ImageData, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const val = Math.round(((x + y) / (w + h)) * 255);
      data.data[idx] = val;
      data.data[idx + 1] = val;
      data.data[idx + 2] = val;
      data.data[idx + 3] = 255;
    }
  }
}
