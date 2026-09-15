import { describe, expect, it } from 'vitest';
import { ditherImageData } from './dither';
import { quantizeToPalette } from './palette';
import { sharpenImageData } from './sharpen';

function imageData(width: number, height: number, pixels: number[]): ImageData {
  return new ImageData(new Uint8ClampedArray(pixels), width, height);
}

function px(image: ImageData, x: number, y: number): [number, number, number, number] {
  const o = (y * image.width + x) * 4;
  return [
    image.data[o] as number,
    image.data[o + 1] as number,
    image.data[o + 2] as number,
    image.data[o + 3] as number,
  ];
}

describe('sharpenImageData', () => {
  it('mode none returns a copy untouched', () => {
    const src = imageData(
      2,
      2,
      [10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255],
    );
    const r = sharpenImageData(src, { mode: 'none', amount: 0.9 });
    expect(r.applied).toBe(false);
    expect(Array.from(r.imageData.data)).toEqual(Array.from(src.data));
  });

  it('zero amount returns a copy untouched', () => {
    const src = imageData(1, 1, [200, 100, 50, 255]);
    const r = sharpenImageData(src, { mode: 'unsharp', amount: 0 });
    expect(r.applied).toBe(false);
    expect(r.imageData.data[0]).toBe(200);
  });

  it('leaves a flat image unchanged (delta is zero)', () => {
    const flat = imageData(
      8,
      8,
      new Array<number>(8 * 8 * 4).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 128)),
    );
    const r = sharpenImageData(flat, { mode: 'unsharp', amount: 0.9, radius: 2 });
    expect(px(r.imageData, 4, 4)[0]).toBe(128);
    expect(px(r.imageData, 4, 4)[3]).toBe(255);
  });

  it('increases local contrast across a hard edge', () => {
    // Left half dark (32), right half light (224).
    const src = imageData(2, 1, [32, 32, 32, 255, 224, 224, 224, 255]);
    const sharp = sharpenImageData(src, {
      mode: 'unsharp',
      amount: 0.8,
      radius: 1,
      luminanceOnly: false,
    });
    // The dark side should get darker and the light side lighter.
    const dark = sharp.imageData.data[0];
    const light = sharp.imageData.data[4];
    expect(dark).toBeLessThanOrEqual(32);
    expect(light).toBeGreaterThanOrEqual(224);
    // Fringe safety: neither side overshoots into the other's territory badly.
    expect(dark).toBeGreaterThanOrEqual(0);
    expect(light).toBeLessThanOrEqual(255);
  });

  it('luminance-only sharpening preserves hue', () => {
    // Pure green edge.
    const src = imageData(2, 1, [0, 200, 0, 255, 0, 255, 0, 255]);
    const r = sharpenImageData(src, {
      mode: 'unsharp',
      amount: 0.9,
      radius: 1,
      luminanceOnly: true,
    });
    // Red and blue channels must stay at 0 (no hue shift), green must separate.
    expect(r.imageData.data[1]).toBeLessThanOrEqual(r.imageData.data[5]!);
    expect(r.imageData.data[0]).toBe(0);
    expect(r.imageData.data[2]).toBe(0);
    expect(r.imageData.data[4]).toBe(0);
    expect(r.imageData.data[6]).toBe(0);
  });

  it('protectAlpha prevents amplifying transparent-edge RGB garbage', () => {
    // A low-alpha green pixel between opaque red-brown neighbours. The blurred
    // green at the centre is dominated by the neighbours (~50), so the unsharp
    // correction is large. protectAlpha scales the correction by alpha (30/255)
    // so the green stays near its source value instead of slamming to maximum.
    const src = imageData(
      5,
      1,
      [200, 50, 50, 255, 200, 50, 50, 255, 50, 200, 50, 30, 200, 50, 50, 255, 200, 50, 50, 255],
    );
    const protectedSharpen = sharpenImageData(src, {
      mode: 'unsharp',
      amount: 0.9,
      radius: 2,
      protectAlpha: true,
    });
    const unprotected = sharpenImageData(src, {
      mode: 'unsharp',
      amount: 0.9,
      radius: 2,
      protectAlpha: false,
    });
    const protectedGreen = protectedSharpen.imageData.data[9] as number;
    const unprotectedGreen = unprotected.imageData.data[9] as number;
    expect(protectedGreen).toBeLessThan(unprotectedGreen);
    expect(unprotectedGreen).toBeGreaterThanOrEqual(250);
    expect(protectedGreen).toBeLessThanOrEqual(240);
  });

  it('threshold suppresses sharpening in smooth regions', () => {
    // Two nearly identical values: delta below threshold → untouched.
    const src = imageData(2, 1, [128, 128, 128, 255, 130, 130, 130, 255]);
    const r = sharpenImageData(src, {
      mode: 'unsharp',
      amount: 0.9,
      radius: 1,
      threshold: 0.5,
    });
    expect(r.imageData.data[0]).toBe(128);
    expect(r.imageData.data[4]).toBe(130);
  });
});

describe('ditherImageData', () => {
  it('algorithm none returns a copy untouched', () => {
    const src = imageData(
      2,
      2,
      new Array<number>(16).fill(0).map((_, i) => i * 15),
    );
    const r = ditherImageData(src, { algorithm: 'none', targetBitDepth: 4 });
    expect(Array.from(r.imageData.data)).toEqual(Array.from(src.data));
  });

  it('full bit depth returns a copy even with an algorithm selected', () => {
    const src = imageData(1, 1, [120, 130, 140, 255]);
    const r = ditherImageData(src, { algorithm: 'floyd-steinberg', targetBitDepth: 8 });
    expect(Array.from(r.imageData.data)).toEqual(Array.from(src.data));
  });

  it('floyd-steinberg quantizes to the requested bit depth per channel', () => {
    // 5-bit target → levels at multiples of 255/31.
    const gradient = imageData(
      64,
      1,
      Array.from({ length: 64 }, (_, x) => [x * 4, x * 4, x * 4, 255]).flat(),
    );
    const r = ditherImageData(gradient, { algorithm: 'floyd-steinberg', targetBitDepth: 5 });
    const levels = new Set<number>();
    for (let x = 0; x < 64; x += 1) levels.add(px(r.imageData, x, 0)[0]);
    expect(levels.size).toBeLessThanOrEqual(32);
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(255);
    }
  });

  it('is deterministic with a fixed seed', () => {
    const gradient = imageData(
      32,
      32,
      new Array<number>(32 * 32 * 4).fill(0).map((_, i) => i % 256),
    );
    const a = ditherImageData(gradient, { algorithm: 'blue-noise', targetBitDepth: 4, seed: 42 });
    const b = ditherImageData(gradient, { algorithm: 'blue-noise', targetBitDepth: 4, seed: 42 });
    expect(Array.from(a.imageData.data)).toEqual(Array.from(b.imageData.data));
  });

  it('different seeds produce different blue-noise output', () => {
    const gradient = imageData(
      32,
      32,
      new Array<number>(32 * 32 * 4).fill(0).map((_, i) => i % 256),
    );
    const a = ditherImageData(gradient, { algorithm: 'blue-noise', targetBitDepth: 4, seed: 1 });
    const b = ditherImageData(gradient, { algorithm: 'blue-noise', targetBitDepth: 4, seed: 2 });
    let different = 0;
    for (let i = 0; i < a.imageData.data.length; i += 1) {
      if (a.imageData.data[i] !== b.imageData.data[i]) different += 1;
    }
    expect(different).toBeGreaterThan(0);
  });

  it('serpentine scanning changes the output vs left-to-right', () => {
    const src = imageData(
      8,
      8,
      new Array<number>(8 * 8 * 4).fill(0).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256)),
    );
    const serp = ditherImageData(src, {
      algorithm: 'floyd-steinberg',
      targetBitDepth: 4,
      serpentine: true,
    });
    const flat = ditherImageData(src, {
      algorithm: 'floyd-steinberg',
      targetBitDepth: 4,
      serpentine: false,
    });
    expect(Array.from(serp.imageData.data)).not.toEqual(Array.from(flat.imageData.data));
  });

  it('alpha threshold forces low-alpha pixels transparent', () => {
    const src = imageData(2, 1, [200, 100, 50, 255, 200, 100, 50, 40]);
    const r = ditherImageData(src, {
      algorithm: 'bayer-4',
      targetBitDepth: 4,
      alphaThreshold: 0.5,
    });
    expect(px(r.imageData, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(px(r.imageData, 0, 0)[3]).toBe(255);
  });

  it('1-bit quantization produces a two-tone result', () => {
    const gradient = imageData(
      64,
      1,
      Array.from({ length: 64 }, (_, x) => [x * 4, x * 4, x * 4, 255]).flat(),
    );
    const r = ditherImageData(gradient, { algorithm: 'floyd-steinberg', targetBitDepth: 1 });
    const levels = new Set<number>();
    for (let x = 0; x < 64; x += 1) levels.add(px(r.imageData, x, 0)[0]);
    expect([...levels].every((v) => v === 0 || v === 255)).toBe(true);
  });

  it('luminance mode produces gray output', () => {
    const src = imageData(2, 1, [255, 0, 0, 255, 0, 255, 0, 255]);
    const r = ditherImageData(src, {
      algorithm: 'floyd-steinberg',
      targetBitDepth: 4,
      channelMode: 'luminance',
    });
    for (let x = 0; x < 2; x += 1) {
      const p = px(r.imageData, x, 0);
      expect(p[0]).toBe(p[1]);
      expect(p[1]).toBe(p[2]);
    }
  });
});

describe('quantizeToPalette', () => {
  it('produces the requested palette size', () => {
    const src = imageData(
      64,
      64,
      new Array<number>(64 * 64 * 4).fill(0).map((_, i) => {
        const o = i * 4;
        return [i % 256, (i * 3) % 256, (i * 7) % 256, 255][o % 4]!;
      }),
    );
    const r = quantizeToPalette(src, { paletteSize: 16 });
    expect(r.palette.length / 4).toBeLessThanOrEqual(16);
    expect(r.transparentIndex).toBe(false);
  });

  it('is deterministic: same input → identical palette and output', () => {
    const pixels = Array.from({ length: 32 * 32 }, (_, i) => [
      (i * 5) % 256,
      (i * 11) % 256,
      (i * 17) % 256,
      255,
    ]).flat();
    const src = imageData(32, 32, pixels);
    const a = quantizeToPalette(src, { paletteSize: 8 });
    const b = quantizeToPalette(src, { paletteSize: 8 });
    expect(Array.from(a.palette)).toEqual(Array.from(b.palette));
    expect(Array.from(a.imageData.data)).toEqual(Array.from(b.imageData.data));
  });

  it('reserves a transparent index when the image has low-alpha pixels', () => {
    const pixels = new Array<number>(16 * 16 * 4);
    for (let i = 0; i < 16 * 16; i += 1) {
      const o = i * 4;
      pixels[o] = (i * 7) % 256;
      pixels[o + 1] = (i * 13) % 256;
      pixels[o + 2] = (i * 23) % 256;
      pixels[o + 3] = i % 10 === 0 ? 0 : 255;
    }
    const src = imageData(16, 16, pixels);
    const r = quantizeToPalette(src, { paletteSize: 8, alphaThreshold: 0.5 });
    expect(r.transparentIndex).toBe(true);
    expect(r.palette[0]).toBe(0);
    expect(r.palette[1]).toBe(0);
    expect(r.palette[2]).toBe(0);
    expect(r.palette[3]).toBe(0);
    // Every output pixel uses palette entries only.
    for (let i = 0; i < 16 * 16; i += 1) {
      const p = px(r.imageData, i % 16, Math.floor(i / 16));
      expect([0, 255].includes(p[3])).toBe(true);
    }
  });

  it('output pixels match palette entries exactly', () => {
    const pixels = Array.from({ length: 20 * 20 }, (_, i) => [
      i % 256,
      (i * 3) % 256,
      (i * 5) % 256,
      255,
    ]).flat();
    const src = imageData(20, 20, pixels);
    const r = quantizeToPalette(src, { paletteSize: 4 });
    const seen = new Set<number>();
    for (let i = 0; i < r.palette.length; i += 4) {
      seen.add((r.palette[i]! << 16) | (r.palette[i + 1]! << 8) | r.palette[i + 2]!);
    }
    for (let i = 0; i < 20 * 20; i += 1) {
      const p = px(r.imageData, i % 20, Math.floor(i / 20));
      expect(seen.has((p[0] << 16) | (p[1] << 8) | p[2])).toBe(true);
    }
  });
});
