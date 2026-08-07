import { describe, expect, it } from 'vitest';
import {
  applyAMScreening,
  applyBayerDithering,
  applyFMStochastic,
  applyHalftone,
  bayerMatrix,
  cachedAMMatrix,
  generateAMMatrix,
  HALFTONE_PRESETS,
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

// ── Improved halftone: threshold, intensity, softness ──────────────────

describe('halftone threshold parameter', () => {
  it('higher threshold produces less ink (AM)', () => {
    const w = 64;
    const h = 64;
    const dataLow = new ImageData(w, h);
    const dataHigh = new ImageData(w, h);
    fillGradient(dataLow, w, h);
    fillGradient(dataHigh, w, h);

    const baseParams: HalftoneParams = {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };

    applyAMScreening(dataLow, { ...baseParams, threshold: 64 });
    applyAMScreening(dataHigh, { ...baseParams, threshold: 200 });

    function countBlack(d: ImageData): number {
      let n = 0;
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i]! < 128) n++;
      }
      return n;
    }

    expect(countBlack(dataHigh)).toBeLessThan(countBlack(dataLow));
  });

  it('higher threshold produces less ink (Bayer)', () => {
    const w = 32;
    const h = 32;
    const dataLow = new ImageData(w, h);
    const dataHigh = new ImageData(w, h);
    fillGradient(dataLow, w, h);
    fillGradient(dataHigh, w, h);

    const baseParams: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };

    applyBayerDithering(dataLow, { ...baseParams, threshold: 64 }, 0, 0);
    applyBayerDithering(dataHigh, { ...baseParams, threshold: 200 }, 0, 0);

    function countBlack(d: ImageData): number {
      let n = 0;
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i]! < 128) n++;
      }
      return n;
    }

    expect(countBlack(dataHigh)).toBeLessThan(countBlack(dataLow));
  });

  it('threshold=128 matches default (no threshold specified) for AM', () => {
    const w = 32;
    const h = 32;
    const data1 = new ImageData(w, h);
    const data2 = new ImageData(w, h);
    fillGradient(data1, w, h);
    fillGradient(data2, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };

    applyAMScreening(data1, params);
    applyAMScreening(data2, { ...params, threshold: 128 });

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('threshold=128 matches default (no threshold specified) for Bayer', () => {
    const w = 32;
    const h = 32;
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
    applyBayerDithering(data2, { ...params, threshold: 128 }, 0, 0);

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('threshold=128 matches default (no threshold specified) for FM stochastic', () => {
    const w = 32;
    const h = 32;
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

    applyFMStochastic(data1, params);
    applyFMStochastic(data2, { ...params, threshold: 128 });

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('higher threshold produces less ink for FM stochastic', () => {
    const w = 32;
    const h = 32;
    const dataLow = new ImageData(w, h);
    const dataHigh = new ImageData(w, h);
    fillGradient(dataLow, w, h);
    fillGradient(dataHigh, w, h);

    const baseParams: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };

    applyFMStochastic(dataLow, { ...baseParams, threshold: 64 });
    applyFMStochastic(dataHigh, { ...baseParams, threshold: 200 });

    function countBlack(d: ImageData): number {
      let n = 0;
      for (let i = 0; i < d.data.length; i += 4) {
        if (d.data[i]! < 128) n++;
      }
      return n;
    }

    expect(countBlack(dataHigh)).toBeLessThan(countBlack(dataLow));
  });
});

describe('halftone intensity parameter', () => {
  it('intensity=0 is a no-op (AM)', () => {
    const w = 16;
    const h = 16;
    const data = new ImageData(w, h);
    const original = new ImageData(w, h);
    fillGradient(data, w, h);
    fillGradient(original, w, h);

    applyAMScreening(data, {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
      intensity: 0,
    });

    expect(Array.from(data.data)).toEqual(Array.from(original.data));
  });

  it('intensity=0 is a no-op (FM stochastic)', () => {
    const w = 16;
    const h = 16;
    const data = new ImageData(w, h);
    const original = new ImageData(w, h);
    fillGradient(data, w, h);
    fillGradient(original, w, h);

    applyFMStochastic(data, {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
      intensity: 0,
    });

    expect(Array.from(data.data)).toEqual(Array.from(original.data));
  });

  it('intensity=0 is a no-op (Bayer)', () => {
    const w = 16;
    const h = 16;
    const data = new ImageData(w, h);
    const original = new ImageData(w, h);
    fillGradient(data, w, h);
    fillGradient(original, w, h);

    applyBayerDithering(
      data,
      {
        pattern: 'dot',
        frequency: 10,
        angle: 0,
        dotShape: 'round',
        channel: 'k',
        method: 'fm',
        intensity: 0,
      },
      0,
      0,
    );

    expect(Array.from(data.data)).toEqual(Array.from(original.data));
  });

  it('intensity=0.5 produces values between original and full halftone (AM)', () => {
    const w = 32;
    const h = 32;
    const dataOrig = new ImageData(w, h);
    const dataHalf = new ImageData(w, h);
    const dataFull = new ImageData(w, h);
    fillGradient(dataOrig, w, h);
    fillGradient(dataHalf, w, h);
    fillGradient(dataFull, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };

    applyAMScreening(dataHalf, { ...params, intensity: 0.5 });
    applyAMScreening(dataFull, { ...params, intensity: 1 });

    for (let i = 0; i < dataHalf.data.length; i += 4) {
      const orig = dataOrig.data[i]!;
      const half = dataHalf.data[i]!;
      const full = dataFull.data[i]!;
      const lo = Math.min(orig, full);
      const hi = Math.max(orig, full);
      expect(half).toBeGreaterThanOrEqual(lo - 1);
      expect(half).toBeLessThanOrEqual(hi + 1);
    }
  });

  it('intensity=0.5 produces values between original and full halftone (Bayer)', () => {
    const w = 32;
    const h = 32;
    const dataOrig = new ImageData(w, h);
    const dataHalf = new ImageData(w, h);
    const dataFull = new ImageData(w, h);
    fillGradient(dataOrig, w, h);
    fillGradient(dataHalf, w, h);
    fillGradient(dataFull, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };

    applyBayerDithering(dataHalf, { ...params, intensity: 0.5 }, 0, 0);
    applyBayerDithering(dataFull, { ...params, intensity: 1 }, 0, 0);

    for (let i = 0; i < dataHalf.data.length; i += 4) {
      const orig = dataOrig.data[i]!;
      const half = dataHalf.data[i]!;
      const full = dataFull.data[i]!;
      const lo = Math.min(orig, full);
      const hi = Math.max(orig, full);
      expect(half).toBeGreaterThanOrEqual(lo - 1);
      expect(half).toBeLessThanOrEqual(hi + 1);
    }
  });

  it('intensity=0.5 produces values between original and full halftone (FM stochastic)', () => {
    const w = 32;
    const h = 32;
    const dataOrig = new ImageData(w, h);
    const dataHalf = new ImageData(w, h);
    const dataFull = new ImageData(w, h);
    fillGradient(dataOrig, w, h);
    fillGradient(dataHalf, w, h);
    fillGradient(dataFull, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };

    applyFMStochastic(dataHalf, { ...params, intensity: 0.5 });
    applyFMStochastic(dataFull, { ...params, intensity: 1 });

    for (let i = 0; i < dataHalf.data.length; i += 4) {
      const orig = dataOrig.data[i]!;
      const half = dataHalf.data[i]!;
      const full = dataFull.data[i]!;
      const lo = Math.min(orig, full);
      const hi = Math.max(orig, full);
      expect(half).toBeGreaterThanOrEqual(lo - 1);
      expect(half).toBeLessThanOrEqual(hi + 1);
    }
  });

  it('intensity > 1 is clamped to 1 (AM)', () => {
    const w = 16;
    const h = 16;
    const data1 = new ImageData(w, h);
    const data2 = new ImageData(w, h);
    fillGradient(data1, w, h);
    fillGradient(data2, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };

    applyAMScreening(data1, { ...params, intensity: 1 });
    applyAMScreening(data2, { ...params, intensity: 5 });

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('intensity < 0 is clamped to 0 (Bayer)', () => {
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

    applyBayerDithering(data1, { ...params, intensity: 0 }, 0, 0);
    applyBayerDithering(data2, { ...params, intensity: -3 }, 0, 0);

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });
});

describe('halftone softness parameter', () => {
  it('softness>0 produces non-binary values (AM)', () => {
    const w = 64;
    const h = 64;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);

    applyAMScreening(data, {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
      softness: 0.5,
    });

    let hasIntermediate = false;
    for (let i = 0; i < data.data.length; i += 4) {
      const v = data.data[i]!;
      if (v > 0 && v < 255) {
        hasIntermediate = true;
        break;
      }
    }
    expect(hasIntermediate).toBe(true);
  });

  it('softness>0 produces non-binary values (Bayer)', () => {
    const w = 64;
    const h = 64;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);

    applyBayerDithering(
      data,
      {
        pattern: 'dot',
        frequency: 10,
        angle: 0,
        dotShape: 'round',
        channel: 'k',
        method: 'fm',
        softness: 0.5,
      },
      0,
      0,
    );

    let hasIntermediate = false;
    for (let i = 0; i < data.data.length; i += 4) {
      const v = data.data[i]!;
      if (v > 0 && v < 255) {
        hasIntermediate = true;
        break;
      }
    }
    expect(hasIntermediate).toBe(true);
  });

  it('softness=0 matches default behavior (AM)', () => {
    const w = 32;
    const h = 32;
    const data1 = new ImageData(w, h);
    const data2 = new ImageData(w, h);
    fillGradient(data1, w, h);
    fillGradient(data2, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };

    applyAMScreening(data1, params);
    applyAMScreening(data2, { ...params, softness: 0 });

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('softness=0 matches default behavior (Bayer)', () => {
    const w = 32;
    const h = 32;
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
    applyBayerDithering(data2, { ...params, softness: 0 }, 0, 0);

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('softness > 1 is clamped to 1 (AM, does not crash)', () => {
    const w = 16;
    const h = 16;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);

    expect(() =>
      applyAMScreening(data, {
        pattern: 'dot',
        frequency: 15,
        angle: 45,
        dotShape: 'round',
        channel: 'k',
        method: 'am',
        softness: 5,
      }),
    ).not.toThrow();

    for (let i = 0; i < data.data.length; i += 4) {
      expect(data.data[i]!).toBeGreaterThanOrEqual(0);
      expect(data.data[i]!).toBeLessThanOrEqual(255);
    }
  });

  it('FM stochastic ignores softness (produces binary output regardless)', () => {
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

    applyFMStochastic(data1, params);
    applyFMStochastic(data2, { ...params, softness: 0.8 });

    // FM stochastic does not implement softness — output should be identical
    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
    // Both should be binary
    for (let i = 0; i < data1.data.length; i += 4) {
      expect(data1.data[i] === 0 || data1.data[i] === 255).toBe(true);
    }
  });
});

describe('halftone alpha preservation with new params', () => {
  it('AM screening preserves alpha with threshold and intensity', () => {
    const w = 16;
    const h = 16;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);
    for (let i = 3; i < data.data.length; i += 4) {
      data.data[i] = 200;
    }

    applyAMScreening(data, {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
      threshold: 160,
      intensity: 0.7,
    });

    for (let i = 3; i < data.data.length; i += 4) {
      expect(data.data[i]).toBe(200);
    }
  });

  it('AM screening preserves alpha with softness', () => {
    const w = 16;
    const h = 16;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);
    for (let i = 3; i < data.data.length; i += 4) {
      data.data[i] = 180;
    }

    applyAMScreening(data, {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
      softness: 0.8,
    });

    for (let i = 3; i < data.data.length; i += 4) {
      expect(data.data[i]).toBe(180);
    }
  });

  it('Bayer dithering preserves alpha with threshold, intensity, and softness', () => {
    const w = 16;
    const h = 16;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);
    for (let i = 3; i < data.data.length; i += 4) {
      data.data[i] = 150;
    }

    applyBayerDithering(
      data,
      {
        pattern: 'dot',
        frequency: 10,
        angle: 0,
        dotShape: 'round',
        channel: 'k',
        method: 'fm',
        threshold: 180,
        intensity: 0.6,
        softness: 0.4,
      },
      5,
      5,
    );

    for (let i = 3; i < data.data.length; i += 4) {
      expect(data.data[i]).toBe(150);
    }
  });

  it('FM stochastic preserves alpha with threshold and intensity', () => {
    const w = 16;
    const h = 16;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);
    for (let i = 3; i < data.data.length; i += 4) {
      data.data[i] = 220;
    }

    applyFMStochastic(data, {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
      threshold: 200,
      intensity: 0.5,
    });

    for (let i = 3; i < data.data.length; i += 4) {
      expect(data.data[i]).toBe(220);
    }
  });

  it('CMYK screening preserves alpha with threshold and intensity', () => {
    const w = 16;
    const h = 16;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);
    for (let i = 3; i < data.data.length; i += 4) {
      data.data[i] = 200;
    }

    applyAMScreening(data, {
      pattern: 'dot',
      frequency: 20,
      angle: 45,
      dotShape: 'round',
      channel: 'cmyk',
      method: 'am',
      threshold: 160,
      intensity: 0.7,
    });

    for (let i = 3; i < data.data.length; i += 4) {
      expect(data.data[i]).toBe(200);
    }
  });
});

describe('halftone combined params integration', () => {
  it('threshold + intensity + softness together produce valid output (AM)', () => {
    const w = 32;
    const h = 32;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);

    expect(() =>
      applyAMScreening(data, {
        pattern: 'dot',
        frequency: 15,
        angle: 45,
        dotShape: 'round',
        channel: 'k',
        method: 'am',
        threshold: 160,
        intensity: 0.6,
        softness: 0.3,
      }),
    ).not.toThrow();

    for (let i = 0; i < data.data.length; i += 4) {
      expect(data.data[i]!).toBeGreaterThanOrEqual(0);
      expect(data.data[i]!).toBeLessThanOrEqual(255);
      expect(data.data[i + 3]).toBe(255);
    }
  });

  it('threshold + intensity + softness together produce valid output (Bayer)', () => {
    const w = 32;
    const h = 32;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);

    expect(() =>
      applyBayerDithering(
        data,
        {
          pattern: 'dot',
          frequency: 10,
          angle: 0,
          dotShape: 'round',
          channel: 'k',
          method: 'fm',
          threshold: 160,
          intensity: 0.6,
          softness: 0.3,
        },
        3,
        7,
      ),
    ).not.toThrow();

    for (let i = 0; i < data.data.length; i += 4) {
      expect(data.data[i]!).toBeGreaterThanOrEqual(0);
      expect(data.data[i]!).toBeLessThanOrEqual(255);
      expect(data.data[i + 3]).toBe(255);
    }
  });

  it('applyHalftone dispatch passes threshold and intensity through (AM)', () => {
    const w = 32;
    const h = 32;
    const data1 = new ImageData(w, h);
    const data2 = new ImageData(w, h);
    fillGradient(data1, w, h);
    fillGradient(data2, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
      threshold: 200,
      intensity: 1,
    };

    applyHalftone(data1, params);
    applyAMScreening(data2, params);

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });

  it('applyHalftone dispatch passes threshold and intensity through (FM with offset → Bayer)', () => {
    const w = 32;
    const h = 32;
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
      threshold: 180,
      intensity: 0.8,
    };

    applyHalftone(data1, params, 5, 5);
    applyBayerDithering(data2, params, 5, 5);

    expect(Array.from(data1.data)).toEqual(Array.from(data2.data));
  });
});

// ── Invert parameter ──────────────────────────────────────────────────

describe('halftone invert parameter', () => {
  it('invert swaps black and white output (AM)', () => {
    const w = 64;
    const h = 64;
    const dataNormal = new ImageData(w, h);
    const dataInverted = new ImageData(w, h);
    fillGradient(dataNormal, w, h);
    fillGradient(dataInverted, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };

    applyAMScreening(dataNormal, params);
    applyAMScreening(dataInverted, { ...params, invert: true });

    // Inverted should have roughly the same number of black and white pixels swapped
    let normalBlack = 0;
    let invertedBlack = 0;
    for (let i = 0; i < dataNormal.data.length; i += 4) {
      if (dataNormal.data[i] === 0) normalBlack++;
      if (dataInverted.data[i] === 0) invertedBlack++;
    }
    // Inverted should have fewer blacks than normal (since we inverted)
    expect(invertedBlack).not.toBe(normalBlack);
  });

  it('invert swaps black and white output (Bayer)', () => {
    const w = 32;
    const h = 32;
    const dataNormal = new ImageData(w, h);
    const dataInverted = new ImageData(w, h);
    fillGradient(dataNormal, w, h);
    fillGradient(dataInverted, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };

    applyBayerDithering(dataNormal, params, 0, 0);
    applyBayerDithering(dataInverted, { ...params, invert: true }, 0, 0);

    let normalBlack = 0;
    let invertedBlack = 0;
    for (let i = 0; i < dataNormal.data.length; i += 4) {
      if (dataNormal.data[i] === 0) normalBlack++;
      if (dataInverted.data[i] === 0) invertedBlack++;
    }
    expect(invertedBlack).not.toBe(normalBlack);
  });

  it('invert swaps black and white output (FM stochastic)', () => {
    const w = 32;
    const h = 32;
    const dataNormal = new ImageData(w, h);
    const dataInverted = new ImageData(w, h);
    fillGradient(dataNormal, w, h);
    fillGradient(dataInverted, w, h);

    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };

    applyFMStochastic(dataNormal, params);
    applyFMStochastic(dataInverted, { ...params, invert: true });

    let normalBlack = 0;
    let invertedBlack = 0;
    for (let i = 0; i < dataNormal.data.length; i += 4) {
      if (dataNormal.data[i] === 0) normalBlack++;
      if (dataInverted.data[i] === 0) invertedBlack++;
    }
    expect(invertedBlack).not.toBe(normalBlack);
  });
});

// ── Foreground / background color parameter ───────────────────────────

describe('halftone foreground/background colors', () => {
  it('default colors produce black and white output (AM)', () => {
    const w = 32;
    const h = 32;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);

    applyAMScreening(data, {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    });

    for (let i = 0; i < data.data.length; i += 4) {
      const r = data.data[i]!;
      const g = data.data[i + 1]!;
      const b = data.data[i + 2]!;
      // Should be either black (0,0,0) or white (255,255,255)
      expect((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255)).toBe(true);
    }
  });

  it('custom foreground color produces colored dots (Bayer)', () => {
    const w = 32;
    const h = 32;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);

    applyBayerDithering(
      data,
      {
        pattern: 'dot',
        frequency: 10,
        angle: 0,
        dotShape: 'round',
        channel: 'k',
        method: 'fm',
        foregroundColor: [255, 0, 0], // red ink
        backgroundColor: [255, 255, 0], // yellow paper
      },
      0,
      0,
    );

    let hasRed = false;
    let hasYellow = false;
    for (let i = 0; i < data.data.length; i += 4) {
      const r = data.data[i]!;
      const g = data.data[i + 1]!;
      const b = data.data[i + 2]!;
      if (r === 255 && g === 0 && b === 0) hasRed = true;
      if (r === 255 && g === 255 && b === 0) hasYellow = true;
    }
    expect(hasRed).toBe(true);
    expect(hasYellow).toBe(true);
  });

  it('custom foreground color produces colored dots (FM stochastic)', () => {
    const w = 32;
    const h = 32;
    const data = new ImageData(w, h);
    fillGradient(data, w, h);

    applyFMStochastic(data, {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
      foregroundColor: [0, 100, 200],
      backgroundColor: [240, 240, 240],
    });

    let hasInk = false;
    let hasPaper = false;
    for (let i = 0; i < data.data.length; i += 4) {
      const r = data.data[i]!;
      const g = data.data[i + 1]!;
      const b = data.data[i + 2]!;
      if (r === 0 && g === 100 && b === 200) hasInk = true;
      if (r === 240 && g === 240 && b === 240) hasPaper = true;
    }
    expect(hasInk).toBe(true);
    expect(hasPaper).toBe(true);
  });

  it('custom foreground/background with invert swaps colors', () => {
    const w = 32;
    const h = 32;
    const dataNormal = new ImageData(w, h);
    const dataInverted = new ImageData(w, h);
    fillGradient(dataNormal, w, h);
    fillGradient(dataInverted, w, h);

    const colors = {
      foregroundColor: [255, 0, 0] as [number, number, number],
      backgroundColor: [0, 0, 255] as [number, number, number],
    };

    applyAMScreening(dataNormal, {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
      ...colors,
    });
    applyAMScreening(dataInverted, {
      pattern: 'dot',
      frequency: 15,
      angle: 45,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
      invert: true,
      ...colors,
    });

    // The inverted version should have roughly opposite color distribution
    let normalRed = 0;
    let invertedRed = 0;
    for (let i = 0; i < dataNormal.data.length; i += 4) {
      if (dataNormal.data[i] === 255 && dataNormal.data[i + 1] === 0) normalRed++;
      if (dataInverted.data[i] === 255 && dataInverted.data[i + 1] === 0) invertedRed++;
    }
    // With inverted, the color that was used for ink should be used for paper and vice versa
    expect(normalRed).not.toBe(invertedRed);
  });
});

// ── Presets ───────────────────────────────────────────────────────────

describe('halftone presets', () => {
  it('exports at least 5 presets', () => {
    expect(HALFTONE_PRESETS.length).toBeGreaterThanOrEqual(5);
  });

  it('each preset has a unique id', () => {
    const ids = HALFTONE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each preset has required fields', () => {
    for (const preset of HALFTONE_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.params.pattern).toBeTruthy();
      expect(preset.params.frequency).toBeGreaterThan(0);
      expect(preset.params.dotShape).toBeTruthy();
      expect(preset.params.channel).toBeTruthy();
      expect(preset.params.method).toBeTruthy();
    }
  });

  it('preset params can be spread into applyHalftone without errors', () => {
    const data = new ImageData(16, 16);
    fillGradient(data, 16, 16);
    for (const preset of HALFTONE_PRESETS) {
      const { pattern, ...rest } = preset.params;
      expect(() => applyHalftone(data, { pattern, ...rest } as HalftoneParams)).not.toThrow();
    }
  });
});

// ── Malformed parameter robustness (persisted-document tolerance) ──────

describe('halftone malformed parameter robustness', () => {
  it('NaN frequency does not throw and still produces screened output (AM)', () => {
    const data = new ImageData(32, 32);
    fillGradient(data, 32, 32);
    expect(() =>
      applyAMScreening(data, {
        pattern: 'dot',
        frequency: Number.NaN,
        angle: 45,
        dotShape: 'round',
        channel: 'k',
        method: 'am',
      }),
    ).not.toThrow();
    // Degrades to the default 45 LPI — dots still appear
    let dark = 0;
    let light = 0;
    for (let i = 0; i < data.data.length; i += 4) {
      if (data.data[i]! < 110) dark++;
      if (data.data[i]! > 145) light++;
    }
    expect(dark).toBeGreaterThan(0);
    expect(light).toBeGreaterThan(0);
  });

  it('NaN angle does not throw (AM)', () => {
    const data = new ImageData(32, 32);
    fillGradient(data, 32, 32);
    expect(() =>
      applyAMScreening(data, {
        pattern: 'dot',
        frequency: 20,
        angle: Number.NaN,
        dotShape: 'round',
        channel: 'k',
        method: 'am',
      }),
    ).not.toThrow();
  });

  it('NaN threshold degrades to 128 (AM)', () => {
    const dataDefault = new ImageData(32, 32);
    const dataNan = new ImageData(32, 32);
    fillGradient(dataDefault, 32, 32);
    fillGradient(dataNan, 32, 32);
    const base = {
      pattern: 'dot' as const,
      frequency: 20,
      angle: 45,
      dotShape: 'round' as const,
      channel: 'k' as const,
      method: 'am' as const,
    };
    applyAMScreening(dataDefault, base);
    applyAMScreening(dataNan, { ...base, threshold: Number.NaN });
    expect(Array.from(dataDefault.data)).toEqual(Array.from(dataNan.data));
  });

  it('infinite threshold does not throw (Bayer)', () => {
    const data = new ImageData(32, 32);
    fillGradient(data, 32, 32);
    expect(() =>
      applyBayerDithering(
        data,
        {
          pattern: 'dot',
          frequency: 10,
          angle: 0,
          dotShape: 'round',
          channel: 'k',
          method: 'fm',
          threshold: Number.POSITIVE_INFINITY,
        },
        0,
        0,
      ),
    ).not.toThrow();
  });

  it('negative and >360 angles render without throwing and are periodic', () => {
    const dataNeg = new ImageData(32, 32);
    const dataPos = new ImageData(32, 32);
    fillGradient(dataNeg, 32, 32);
    fillGradient(dataPos, 32, 32);
    const base = {
      pattern: 'dot' as const,
      frequency: 20,
      dotShape: 'round' as const,
      channel: 'k' as const,
      method: 'am' as const,
    };
    // -30deg and 330deg are the same screen orientation
    applyAMScreening(dataNeg, { ...base, angle: -30 });
    applyAMScreening(dataPos, { ...base, angle: 330 });
    expect(Array.from(dataNeg.data)).toEqual(Array.from(dataPos.data));
  });

  it('zero-size ImageData does not throw across all paths', () => {
    const empty = new ImageData(0, 0);
    const base = {
      pattern: 'dot' as const,
      frequency: 20,
      angle: 45,
      dotShape: 'round' as const,
      channel: 'k' as const,
      method: 'am' as const,
    };
    expect(() => applyAMScreening(empty, base)).not.toThrow();
    expect(() => applyFMStochastic(empty, base)).not.toThrow();
    expect(() => applyBayerDithering(empty, base, 0, 0)).not.toThrow();
  });

  it('extreme frequency values clamp instead of corrupting (AM)', () => {
    const data = new ImageData(32, 32);
    fillGradient(data, 32, 32);
    expect(() =>
      applyAMScreening(data, {
        pattern: 'dot',
        frequency: 1e9,
        angle: 45,
        dotShape: 'round',
        channel: 'k',
        method: 'am',
      }),
    ).not.toThrow();
    for (let i = 0; i < data.data.length; i += 4) {
      expect(data.data[i]!).toBeGreaterThanOrEqual(0);
      expect(data.data[i]!).toBeLessThanOrEqual(255);
    }
  });

  it('negative intensity and softness clamp to their safe ranges (FM)', () => {
    const data = new ImageData(32, 32);
    fillGradient(data, 32, 32);
    expect(() =>
      applyFMStochastic(data, {
        pattern: 'dot',
        frequency: 10,
        angle: 0,
        dotShape: 'round',
        channel: 'k',
        method: 'fm',
        intensity: -5,
        softness: -1,
      }),
    ).not.toThrow();
  });
});

// ── Document anchoring: pan/zoom phase stability ───────────────────────

describe('halftone document anchoring', () => {
  function flatGray(w: number, h: number, gray: number): ImageData {
    const data = new ImageData(w, h);
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] = gray;
      data.data[i + 1] = gray;
      data.data[i + 2] = gray;
      data.data[i + 3] = 255;
    }
    return data;
  }

  it('AM pattern phase is invariant under region offsets (pan stability)', () => {
    // The same flat fill screened at region origin (0,0) and at region
    // origin (10,5) must produce identical pixels at matching document
    // positions: doc (x+10, y+5) in the offset image == doc (x, y) in the
    // origin image.
    const w = 64;
    const h = 64;
    const origin = flatGray(w, h, 128);
    const offset = flatGray(w, h, 128);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 12,
      angle: 25,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };
    applyAMScreening(origin, params, 1, 0, 0);
    applyAMScreening(offset, params, 1, 10, 5);

    // Offset-image pixel (x, y) sits at doc (x+10, y+5); origin-image pixel
    // (x+10, y+5) sits at the same document position. Both must be equal.
    for (let y = 0; y < h - 5; y++) {
      for (let x = 0; x < w - 10; x++) {
        const iOrigin = ((y + 5) * w + (x + 10)) * 4;
        const iOffset = (y * w + x) * 4;
        expect(offset.data[iOffset]!).toBe(origin.data[iOrigin]!);
        expect(offset.data[iOffset + 1]!).toBe(origin.data[iOrigin + 1]!);
      }
    }
  });

  it('AM cell count across an object is zoom-invariant', () => {
    // Zoom 1: 64 device px cover 64 doc px. Zoom 2: 128 device px cover
    // the same 64 doc px. The number of dark/light transitions across the
    // full row must be identical — dot density is a document-space
    // property, not a viewport one.
    const zoom1 = flatGray(64, 64, 128);
    const zoom2 = flatGray(128, 128, 128);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 16,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };
    applyAMScreening(zoom1, params, 1, 0, 0);
    applyAMScreening(zoom2, params, 2, 0, 0);

    const transitions = (d: ImageData, row: number): number => {
      let n = 0;
      let prev: 'dark' | 'light' | null = null;
      for (let x = 0; x < d.width; x++) {
        const i = (row * d.width + x) * 4;
        const cur = d.data[i]! < 110 ? 'dark' : 'light';
        if (prev && cur !== prev) n++;
        prev = cur;
      }
      return n;
    };
    const t1 = transitions(zoom1, 32);
    const t2 = transitions(zoom2, 64);
    expect(t1).toBeGreaterThan(0);
    expect(t2).toBe(t1);
  });

  it('Bayer FM pattern phase is invariant under region offsets (pan stability)', () => {
    const w = 64;
    const h = 64;
    const origin = flatGray(w, h, 128);
    const offset = flatGray(w, h, 128);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 10,
      angle: 0,
      dotShape: 'round',
      channel: 'k',
      method: 'fm',
    };
    applyBayerDithering(origin, params, 0, 0);
    applyBayerDithering(offset, params, 10, 5);

    // Offset-image pixel (x, y) sits at doc (x+10, y+5); origin-image pixel
    // (x+10, y+5) sits at the same document position. Both must be equal.
    for (let y = 0; y < h - 5; y++) {
      for (let x = 0; x < w - 10; x++) {
        const iOrigin = ((y + 5) * w + (x + 10)) * 4;
        const iOffset = (y * w + x) * 4;
        expect(offset.data[iOffset]!).toBe(origin.data[iOrigin]!);
      }
    }
  });

  it('applyHalftone forwards document offsets and pixelScale to the AM path', () => {
    const viaDispatch = flatGray(32, 32, 128);
    const direct = flatGray(32, 32, 128);
    const params: HalftoneParams = {
      pattern: 'dot',
      frequency: 12,
      angle: 30,
      dotShape: 'round',
      channel: 'k',
      method: 'am',
    };
    applyHalftone(viaDispatch, params, 7, 3, 2);
    applyAMScreening(direct, params, 2, 7, 3);
    expect(Array.from(viaDispatch.data)).toEqual(Array.from(direct.data));
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
