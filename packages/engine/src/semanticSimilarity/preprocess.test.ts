import { describe, expect, it } from 'vitest';
import {
  DINOV2_PREPROCESS_SPEC,
  letterboxF64,
  matteToOpaqueRgb,
  preprocessSemanticInput,
  resizeBilinearF64,
  shorterSideCenterCropF64,
  SIGLIP_PREPROCESS_SPEC,
} from './preprocess';

function solidRgba(width: number, height: number, rgb: [number, number, number]): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

describe('matteToOpaqueRgb', () => {
  it('composites transparency onto the neutral matte', () => {
    const data = new Uint8ClampedArray([200, 100, 50, 0]);
    const out = matteToOpaqueRgb({ data, width: 1, height: 1 });
    expect(out[0]).toBeCloseTo(128, 5);
    expect(out[1]).toBeCloseTo(128, 5);
    expect(out[2]).toBeCloseTo(128, 5);
  });

  it('passes opaque pixels through unchanged', () => {
    const data = new Uint8ClampedArray([200, 100, 50, 255]);
    const out = matteToOpaqueRgb({ data, width: 1, height: 1 });
    expect(out[0]).toBe(200);
    expect(out[1]).toBe(100);
    expect(out[2]).toBe(50);
  });

  it('half-transparent pixels blend halfway to the matte', () => {
    const data = new Uint8ClampedArray([200, 100, 50, 128]);
    const out = matteToOpaqueRgb({ data, width: 1, height: 1 });
    // alpha 128/255 = 0.502 → 200*0.502 + 128*0.498 = 164.14
    expect(out[0]).toBeCloseTo(164.1412, 4);
    expect(out[1]).toBeCloseTo(113.9451, 4);
    expect(out[2]).toBeCloseTo(88.8471, 4);
  });
});

describe('resizeBilinearF64', () => {
  it('keeps a uniform plane constant', () => {
    const src = new Float64Array(4 * 4 * 3);
    for (let i = 0; i < src.length; i++) src[i] = 42;
    const out = resizeBilinearF64(src, 4, 4, 8, 8);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBe(42);
  });

  it('upscaling a gradient interpolates between planes', () => {
    // 1x2 image: top red (255,0,0), bottom blue (0,0,255) → 1x3 output.
    // Planar layout: R plane at 0..1, G at 2..3, B at 4..5.
    const src = new Float64Array(1 * 2 * 3);
    src[0] = 255; // R top
    src[1] = 0; // R bottom
    src[2] = 0; // G top
    src[3] = 0; // G bottom
    src[4] = 0; // B top
    src[5] = 255; // B bottom
    const out = resizeBilinearF64(src, 1, 2, 1, 3);
    // Middle row is the average of red and blue.
    expect(out[1]).toBeCloseTo(127.5, 5); // R
    expect(out[7]).toBeCloseTo(127.5, 5); // B
    expect(out[4]).toBe(0); // G
  });

  it('is deterministic', () => {
    const src = new Float64Array(4 * 3 * 3).map((_, i) => (i * 7) % 251);
    const a = resizeBilinearF64(src, 4, 3, 7, 5);
    const b = resizeBilinearF64(src, 4, 3, 7, 5);
    expect(a).toEqual(b);
  });
});

describe('letterboxF64', () => {
  it('pads a wide image with the neutral color', () => {
    const src = new Float64Array(8 * 4 * 3).map(() => 200);
    const out = letterboxF64(src, 8, 4, 8, [128, 128, 128]);
    // Fit height 4 into 8 → content occupies rows 2..5, rows 0-1 and 6-7 pad.
    const padRow0 = out.subarray(0, 8);
    expect(Array.from(padRow0)).toEqual([128, 128, 128, 128, 128, 128, 128, 128]);
    const contentRow2 = out.subarray(2 * 8, 3 * 8);
    expect(Array.from(contentRow2)).toEqual([200, 200, 200, 200, 200, 200, 200, 200]);
  });
});

describe('shorterSideCenterCropF64', () => {
  it('resizes a portrait image to square via shortest side + center crop', () => {
    const src = new Float64Array(4 * 8 * 3).map(() => 90);
    const out = shorterSideCenterCropF64(src, 4, 8, 4, 4);
    expect(out.length).toBe(4 * 4 * 3);
    expect(Array.from(out).every((v) => v === 90)).toBe(true);
  });
});

describe('preprocessSemanticInput', () => {
  it('produces the expected tensor shape and normalization for SigLIP', () => {
    const input = solidRgba(64, 64, [255, 128, 0]);
    const result = preprocessSemanticInput(input, SIGLIP_PREPROCESS_SPEC);
    expect(result.width).toBe(224);
    expect(result.height).toBe(224);
    expect(result.tensor.length).toBe(3 * 224 * 224);
    // Solid color (square input → no letterbox): R=(1-.5)/.5=1, G=(.502-.5)/.5, B=(0-.5)/.5=-1
    expect(result.tensor[0]).toBeCloseTo(1, 5);
    expect(result.tensor[224 * 224]).toBeCloseTo((128 / 255 - 0.5) / 0.5, 5);
    expect(result.tensor[2 * 224 * 224]).toBeCloseTo(-1, 5);
  });

  it('letterboxes a non-square input with the neutral color', () => {
    const input = solidRgba(128, 64, [200, 200, 200]);
    const result = preprocessSemanticInput(input, SIGLIP_PREPROCESS_SPEC);
    // 128x64 in 224x224: content fills all columns, rows 0..55 and 168..223 pad.
    const padValue = (128 / 255 - 0.5) / 0.5;
    expect(result.tensor[0]).toBeCloseTo(padValue, 5);
    const contentRow = result.tensor.subarray(64 * 224, 64 * 224 + 224);
    const expected = (200 / 255 - 0.5) / 0.5;
    expect(contentRow.every((v) => Math.abs(v - expected) < 1e-5)).toBe(true);
  });

  it('produces the ImageNet-normalized tensor for DINOv2', () => {
    const input = solidRgba(64, 128, [128, 128, 128]);
    const result = preprocessSemanticInput(input, DINOV2_PREPROCESS_SPEC);
    expect(result.width).toBe(224);
    expect(result.height).toBe(224);
    expect(result.tensor.length).toBe(3 * 224 * 224);
    // Neutral gray: (128/255 - 0.485)/0.229 ≈ 0.0223
    expect(result.tensor[0]).toBeCloseTo((128 / 255 - 0.485) / 0.229, 4);
  });

  it('rejects nothing for degenerate tiny inputs and stays finite', () => {
    const input = solidRgba(1, 1, [10, 20, 30]);
    const result = preprocessSemanticInput(input, SIGLIP_PREPROCESS_SPEC);
    expect(result.tensor.every((v) => Number.isFinite(v))).toBe(true);
  });
});
