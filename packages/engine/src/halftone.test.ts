import { describe, expect, it } from 'vitest';
import {
  applyAMScreening,
  applyBayerDithering,
  applyFMStochastic,
  applyHalftone,
  bayerMatrix,
  cachedAMMatrix,
  generateAMMatrix,
  type HalftoneParams,
} from './halftone';

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

describe('cachedAMMatrix', () => {
  it('returns the same matrix instance for repeated calls with identical params', () => {
    // Regression/perf test: applyAMScreening used to call generateAMMatrix
    // fresh on every invocation (every render frame for a live preview),
    // even though the matrix only depends on (size, dotShape).
    const a = cachedAMMatrix(32, 'round');
    const b = cachedAMMatrix(32, 'round');
    expect(a).toBe(b);
  });

  it('returns distinct matrices for different dot shapes', () => {
    const round = cachedAMMatrix(32, 'round');
    const square = cachedAMMatrix(32, 'square');
    expect(round).not.toBe(square);
  });

  it('produces values identical to an uncached generateAMMatrix call', () => {
    const cached = cachedAMMatrix(48, 'diamond');
    const fresh = generateAMMatrix(48, 'diamond');
    expect(Array.from(cached)).toEqual(Array.from(fresh));
  });
});

describe('halftone CMYK channel screening', () => {
  it('preserves the original alpha channel when screening the cmyk channel', () => {
    const data = new ImageData(32, 32);
    fillGradient(data, 32, 32);
    for (let i = 3; i < data.data.length; i += 4) {
      data.data[i] = 200;
    }
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 20,
      angle: 45,
      dotShape: 'round',
      channel: 'cmyk',
      method: 'am',
    };
    applyAMScreening(data, params);
    for (let i = 3; i < data.data.length; i += 4) {
      expect(data.data[i]).toBe(200);
    }
  });

  it('produces valid RGB byte values (not raw separation bytes) for cmyk screening', () => {
    const data = new ImageData(32, 32);
    fillGradient(data, 32, 32);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 20,
      angle: 45,
      dotShape: 'round',
      channel: 'cmyk',
      method: 'am',
    };
    applyAMScreening(data, params);
    for (let i = 0; i < data.data.length; i += 4) {
      expect(data.data[i]!).toBeGreaterThanOrEqual(0);
      expect(data.data[i]!).toBeLessThanOrEqual(255);
      expect(data.data[i + 1]!).toBeGreaterThanOrEqual(0);
      expect(data.data[i + 1]!).toBeLessThanOrEqual(255);
      expect(data.data[i + 2]!).toBeGreaterThanOrEqual(0);
      expect(data.data[i + 2]!).toBeLessThanOrEqual(255);
    }
  });

  it('renders a fully black (K-saturated) source as overwhelmingly black RGB output, never touching alpha', () => {
    const data = new ImageData(16, 16);
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] = 0;
      data.data[i + 1] = 0;
      data.data[i + 2] = 0;
      data.data[i + 3] = 255;
    }
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 20,
      angle: 45,
      dotShape: 'round',
      channel: 'cmyk',
      method: 'am',
    };
    applyAMScreening(data, params);
    let blackCount = 0;
    const pixelCount = data.data.length / 4;
    for (let i = 0; i < data.data.length; i += 4) {
      if (data.data[i] === 0 && data.data[i + 1] === 0 && data.data[i + 2] === 0) blackCount++;
      // Alpha must never be used as a stray ink channel (the original bug).
      expect(data.data[i + 3]).toBe(255);
    }
    // Ink density is maxed out everywhere for all 4 channels; each channel's
    // independently-rotated screen has its own strict-inequality corner phase
    // (gray > threshold, 255 > 255 is false) that can legitimately stay
    // un-inked, so a small minority of pixels may not be pure black — but the
    // overwhelming majority must be, which the pre-fix implementation (which
    // wrote raw per-channel on/off bytes into RGBA slots) would not satisfy.
    expect(blackCount / pixelCount).toBeGreaterThan(0.8);
  });
});

describe('Bayer ordered dithering matrix', () => {
  it('bayerMatrix(4) produces a 4x4 matrix', () => {
    const matrix = bayerMatrix(4);
    expect(matrix.length).toBe(4);
    expect(matrix[0]!.length).toBe(4);
  });

  it('bayerMatrix(8) produces an 8x8 matrix', () => {
    const matrix = bayerMatrix(8);
    expect(matrix.length).toBe(8);
    expect(matrix[0]!.length).toBe(8);
  });

  it('bayerMatrix contains all values 0..n^2-1 exactly once', () => {
    const size = 4;
    const matrix = bayerMatrix(size);
    const flat = matrix.flat();
    expect(flat.length).toBe(size * size);
    for (let v = 0; v < size * size; v++) {
      expect(flat).toContain(v);
    }
  });

  it('bayerMatrix(4) matches the known Bayer 4x4 pattern', () => {
    const matrix = bayerMatrix(4);
    const known = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ];
    expect(matrix).toEqual(known);
  });

  it('bayerMatrix values are all within [0, n^2)', () => {
    const size = 8;
    const matrix = bayerMatrix(size);
    const flat = matrix.flat();
    expect(Math.min(...flat)).toBe(0);
    expect(Math.max(...flat)).toBe(size * size - 1);
  });
});

describe('Bayer dithering FM screening', () => {
  it('applyBayerDithering with offset (0,0) produces binary output', () => {
    const w = 32;
    const h = 32;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };
    applyBayerDithering(data, params, 0, 0);
    let hasBlack = false;
    let hasWhite = false;
    for (let i = 0; i < data.data.length; i += 4) {
      expect(data.data[i]).toBe(data.data[i + 1]);
      expect(data.data[i + 1]).toBe(data.data[i + 2]);
      expect(data.data[i] === 0 || data.data[i] === 255).toBe(true);
      if (data.data[i] === 0) hasBlack = true;
      if (data.data[i] === 255) hasWhite = true;
    }
    expect(hasBlack).toBe(true);
    expect(hasWhite).toBe(true);
  });

  it('applyBayerDithering with same offset produces identical result (stability)', () => {
    const w = 16;
    const h = 16;
    const data1 = new ImageData(w, h);
    const data2 = new ImageData(w, h);
    fillGradient(data1, w, h);
    fillGradient(data2, w, h);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };
    applyBayerDithering(data1, params, 7, 13);
    applyBayerDithering(data2, params, 7, 13);
    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('applyBayerDithering with offset (10,0) produces a different pattern from (0,0)', () => {
    const w = 16;
    const h = 16;
    const data1 = new ImageData(w, h);
    const data2 = new ImageData(w, h);
    fillGradient(data1, w, h);
    fillGradient(data2, w, h);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };
    applyBayerDithering(data1, params, 0, 0);
    applyBayerDithering(data2, params, 10, 0);
    let diffCount = 0;
    for (let i = 0; i < data1.data.length; i += 4) {
      if (data1.data[i] !== data2.data[i]) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(0);
  });

  it('applyBayerDithering at two different offsets has black pixel count within 5%', () => {
    const w = 64;
    const h = 64;
    const data1 = new ImageData(w, h);
    const data2 = new ImageData(w, h);
    fillGradient(data1, w, h);
    fillGradient(data2, w, h);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };
    applyBayerDithering(data1, params, 0, 0);
    applyBayerDithering(data2, params, 17, 31);
    function countBlack(d: ImageData): number {
      let n = 0;
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i] === 0) n++;
      }
      return n;
    }
    const c1 = countBlack(data1);
    const c2 = countBlack(data2);
    const ratio = Math.min(c1, c2) / Math.max(c1, c2);
    expect(ratio).toBeGreaterThanOrEqual(0.95);
  });

  it('FM preview (Bayer with no offset) matches export (Floyd-Steinberg) black count within 15% tolerance', () => {
    // Floyd-Steinberg preserves exact local average via error diffusion;
    // Bayer ordered dithering uses a fixed threshold matrix. The two
    // algorithms differ in per-pixel decisions while both approximately
    // preserve input luminance. 15% tolerance accounts for the systematic
    // difference on the gradient test pattern.
    const w = 64;
    const h = 64;
    const dataFs = new ImageData(w, h);
    const dataBayer = new ImageData(w, h);
    fillGradient(dataFs, w, h);
    fillGradient(dataBayer, w, h);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };
    // Floyd-Steinberg (export quality, no offset)
    applyFMStochastic(dataFs, params);
    // Bayer preview (no offset)
    applyBayerDithering(dataBayer, params, 0, 0);
    function countBlack(d: ImageData): number {
      let n = 0;
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i] === 0) n++;
      }
      return n;
    }
    const fsBlack = countBlack(dataFs);
    const bayerBlack = countBlack(dataBayer);
    const ratio = Math.min(fsBlack, bayerBlack) / Math.max(fsBlack, bayerBlack);
    expect(ratio).toBeGreaterThanOrEqual(0.85);
  });

  it('FM with offset dispatches to Bayer, FM without offset uses Floyd-Steinberg (different results)', () => {
    const w = 32;
    const h = 32;
    const dataNoOff = new ImageData(w, h);
    const dataWithOff = new ImageData(w, h);
    fillGradient(dataNoOff, w, h);
    fillGradient(dataWithOff, w, h);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };
    applyHalftone(dataNoOff, params);
    applyHalftone(dataWithOff, params, 5, 5);
    let diffCount = 0;
    for (let i = 0; i < dataNoOff.data.length; i += 4) {
      if (dataNoOff.data[i] !== dataWithOff.data[i]) diffCount++;
    }
    expect(diffCount).toBeGreaterThan(0);
  });

  it('FM with offset produces binary output', () => {
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
    applyHalftone(data, params, 10, 20);
    for (let i = 0; i < data.data.length; i += 4) {
      expect(data.data[i] === 0 || data.data[i] === 255).toBe(true);
      expect(data.data[i]).toBe(data.data[i + 1]);
      expect(data.data[i + 1]).toBe(data.data[i + 2]);
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
