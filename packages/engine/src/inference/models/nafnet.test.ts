import { describe, expect, it } from 'vitest';
import {
  alignTo16,
  extractTileNafnet,
  NAFNET_PADDING_MULTIPLE,
  postprocessNafnet,
  preprocessNafnet,
} from './nafnet';

function rgbaImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 200; // R
    data[i * 4 + 1] = 100; // G
    data[i * 4 + 2] = 50; // B
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, width, height);
}

describe('preprocessNafnet', () => {
  it('pads dimensions to a multiple of 16 with edge replication', () => {
    const result = preprocessNafnet(rgbaImage(100, 60));
    expect(result.alignedWidth).toBe(112);
    expect(result.alignedHeight).toBe(64);
    expect(alignTo16(100)).toBe(112);
    expect(NAFNET_PADDING_MULTIPLE).toBe(16);
  });

  it('feeds BGR channel order', () => {
    const result = preprocessNafnet(rgbaImage(16, 16));
    const pixels = 16 * 16;
    // Channel 0 = source blue (50/255), channel 2 = source red (200/255).
    expect(result.tensor[0]).toBeCloseTo(50 / 255);
    expect(result.tensor[pixels]).toBeCloseTo(100 / 255);
    expect(result.tensor[pixels * 2]).toBeCloseTo(200 / 255);
  });

  it('extracts alpha separately', () => {
    const img = rgbaImage(16, 16);
    img.data[3] = 128;
    const result = preprocessNafnet(img);
    expect(result.hasAlpha).toBe(true);
    expect(result.alphaData?.[0]).toBe(128);
  });

  it('keeps BGR channel order for edge tiles', () => {
    const result = extractTileNafnet(rgbaImage(20, 20), { x: 4, y: 4, width: 5, height: 6 });
    const pixels = result.alignedWidth * result.alignedHeight;
    expect(result.alignedWidth).toBe(16);
    expect(result.alignedHeight).toBe(16);
    expect(result.tensor[0]).toBeCloseTo(50 / 255);
    expect(result.tensor[pixels]).toBeCloseTo(100 / 255);
    expect(result.tensor[pixels * 2]).toBeCloseTo(200 / 255);
  });
});

describe('postprocessNafnet', () => {
  it('swaps BGR planes back to RGBA and blends with strength', () => {
    const w = 16;
    const h = 16;
    const pixels = w * h;
    // Model output planes: B=0.0, G=0.5, R=1.0
    const out = new Float32Array(pixels * 3);
    out.fill(0); // B plane
    out.fill(0.5, pixels, pixels * 2); // G plane
    out.fill(1.0, pixels * 2); // R plane
    const original = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) original[i * 4 + 3] = 255;

    const result = postprocessNafnet(out, w, h, w, h, null, 1.0, original);
    // R channel = plane 2 = 1.0 -> 255; B channel = plane 0 = 0 -> 0.
    expect(result.data[0]).toBe(255);
    expect(result.data[1]).toBe(128);
    expect(result.data[2]).toBe(0);
    expect(result.data[3]).toBe(255);
  });

  it('blends against the original when strength < 1', () => {
    const w = 16;
    const h = 16;
    const pixels = w * h;
    const out = new Float32Array(pixels * 3); // all zeros -> black BGR
    const original = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      original[i * 4] = 100; // R
      original[i * 4 + 1] = 100;
      original[i * 4 + 2] = 100;
      original[i * 4 + 3] = 255;
    }
    const result = postprocessNafnet(out, w, h, w, h, null, 0.5, original);
    expect(result.data[0]).toBe(50); // 100 * 0.5 + 0 * 0.5
    expect(result.data[2]).toBe(50);
  });

  it('preserves alpha and crops back from padded dimensions', () => {
    const w = 16;
    const h = 16;
    const pixels = w * h;
    const out = new Float32Array(pixels * 3);
    const alphaData = new Uint8ClampedArray(w * h).fill(77);
    const original = new Uint8ClampedArray(w * h * 4);
    original.fill(0);
    for (let i = 0; i < w * h; i++) original[i * 4 + 3] = 77;
    const result = postprocessNafnet(out, w, h, w, h, alphaData, 0.7, original);
    expect(result.data[3]).toBe(77);
  });
});
