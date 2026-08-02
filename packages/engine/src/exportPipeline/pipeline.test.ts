import { describe, expect, it } from 'vitest';
import { runRasterPipeline } from './pipeline';

function imageData(width: number, height: number, value = 128): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    data[o] = (i + value) % 256;
    data[o + 1] = (i * 2 + value) % 256;
    data[o + 2] = (i * 3 + value) % 256;
    data[o + 3] = 255;
  }
  return new ImageData(data, width, height);
}

describe('runRasterPipeline', () => {
  it('returns the input when no stage applies', async () => {
    const src = imageData(4, 4);
    const result = await runRasterPipeline(src, {});
    expect(result.imageData.width).toBe(4);
    expect(result.imageData.height).toBe(4);
    expect(result.log).toEqual([]);
    expect(result.resized).toBe(false);
  });

  it('runs resize when the target dimensions differ', async () => {
    const src = imageData(4, 4);
    const result = await runRasterPipeline(src, {
      resize: {
        algorithm: 'nearest',
        workingSpace: 'srgb',
        maxPixels: 1_000_000,
        tileHeight: 0,
        targetWidth: 8,
        targetHeight: 8,
      },
    });
    expect(result.imageData.width).toBe(8);
    expect(result.imageData.height).toBe(8);
    expect(result.resized).toBe(true);
    expect(result.log.some((l) => l.includes('resize'))).toBe(true);
  });

  it('skips resize when dimensions already match', async () => {
    const src = imageData(8, 8);
    const result = await runRasterPipeline(src, {
      resize: {
        algorithm: 'lanczos3',
        workingSpace: 'srgb',
        maxPixels: 1_000_000,
        tileHeight: 0,
        targetWidth: 8,
        targetHeight: 8,
      },
    });
    expect(result.log.some((l) => l.includes('resize'))).toBe(false);
  });

  it('runs sharpen, dither and palette in order', async () => {
    const src = imageData(32, 32);
    const result = await runRasterPipeline(src, {
      sharpen: {
        mode: 'unsharp',
        amount: 0.5,
        radius: 1,
        threshold: 0.02,
        luminanceOnly: true,
        protectAlpha: true,
        workingSpace: 'srgb',
      },
      dither: {
        algorithm: 'floyd-steinberg',
        strength: 1,
        targetBitDepth: 4,
        paletteSize: 0,
        serpentine: true,
        seed: 0,
        channelMode: 'all',
        alphaThreshold: 0,
      },
      paletteSize: 16,
    });
    const log = result.log.join('\n');
    const sharpenIdx = log.indexOf('sharpen');
    const ditherIdx = log.indexOf('dither');
    const paletteIdx = log.indexOf('palette');
    expect(sharpenIdx).toBeGreaterThanOrEqual(0);
    expect(ditherIdx).toBeGreaterThan(sharpenIdx);
    expect(paletteIdx).toBeGreaterThan(ditherIdx);
    // Palette quantization must have produced ≤ 16 distinct colours.
    const seen = new Set<number>();
    const data = result.imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    }
    expect(seen.size).toBeLessThanOrEqual(16);
  });

  it('invokes the colour-conversion hook with the stage contract', async () => {
    const src = imageData(2, 2);
    let hookSeen = false;
    const result = await runRasterPipeline(src, {
      colorConversion: {
        operation: 'convert',
        sourceProfile: 'assume-srgb',
        destinationProfile: 'FOGRA39',
        renderingIntent: 'relative',
        blackPointCompensation: true,
        convert: async (pixels, contract) => {
          hookSeen = contract.operation === 'convert' && contract.destinationProfile === 'FOGRA39';
          return pixels;
        },
      },
    });
    expect(hookSeen).toBe(true);
    expect(result.log.some((l) => l.includes('colour convert'))).toBe(true);
  });

  it('aborts on a cancelled signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runRasterPipeline(imageData(4, 4), {
        resize: {
          algorithm: 'nearest',
          workingSpace: 'srgb',
          maxPixels: 1_000_000,
          tileHeight: 0,
          targetWidth: 8,
          targetHeight: 8,
        },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
