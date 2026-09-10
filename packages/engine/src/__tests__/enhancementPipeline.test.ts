import { describe, expect, it, vi } from 'vitest';

const { dispatchDenoise } = vi.hoisted(() => ({
  dispatchDenoise: vi.fn(async (source: ImageData) => ({
    denoised: source,
    processingTimeMs: 1,
    executionProvider: 'test-scunet',
    tilesUsed: 1,
  })),
}));

vi.mock('../denoiseProviders/dispatch', () => ({
  dispatchDenoise,
}));

import { runEnhancementPipeline } from '../upscaleProviders/enhancementPipeline';

function createTestImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = Math.round((x / width) * 255);
      data[i + 1] = Math.round((y / height) * 255);
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  return new ImageData(data, width, height);
}

describe('enhancement pipeline', () => {
  it('runs CPU upscale without denoise', async () => {
    const src = createTestImage(16, 16);
    const result = await runEnhancementPipeline({
      source: src,
      denoiseStrength: 'none',
      upscaleMethod: 'bicubic',
      upscaleScale: 2,
    });

    expect(result.imageData.width).toBe(32);
    expect(result.imageData.height).toBe(32);
    expect(result.stages.length).toBe(2);
    expect(result.stages[0]?.status).toBe('completed');
    expect(result.stages[1]?.status).toBe('completed');
    expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('passes the SCUNet result into the upscale stage', async () => {
    const src = createTestImage(16, 8);
    const result = await runEnhancementPipeline({
      source: src,
      denoiseStrength: 'light',
      upscaleMethod: 'bicubic',
      upscaleScale: 2,
    });

    expect(dispatchDenoise).toHaveBeenCalledWith(src, expect.objectContaining({ strength: 0.3 }));
    expect(result.imageData.width).toBe(32);
    expect(result.imageData.height).toBe(16);
    expect(result.stages.map((stage) => stage.status)).toEqual(['completed', 'completed']);
  });

  it('runs pixel-art upscale', async () => {
    const src = createTestImage(8, 8);
    const result = await runEnhancementPipeline({
      source: src,
      denoiseStrength: 'none',
      upscaleMethod: 'nearest',
      upscaleScale: 2,
      pixelArtAlgorithm: 'epx',
    });

    expect(result.imageData.width).toBe(16);
    expect(result.imageData.height).toBe(16);
    expect(result.stages[1]?.status).toBe('completed');
  });

  it('honours cancellation signal', async () => {
    const src = createTestImage(16, 16);
    const abort = new AbortController();
    abort.abort();

    await expect(
      runEnhancementPipeline({
        source: src,
        signal: abort.signal,
      }),
    ).rejects.toThrow('cancelled');
  });

  it('reports stage changes via callback', async () => {
    const src = createTestImage(16, 16);
    const stageLog: string[] = [];

    await runEnhancementPipeline({
      source: src,
      upscaleMethod: 'bicubic',
      upscaleScale: 2,
      onStageChange: (stages) => {
        stageLog.push(stages.map((s) => `${s.name}=${s.status}`).join(','));
      },
    });

    expect(stageLog.length).toBeGreaterThanOrEqual(2);
  });

  it('produces valid pixel data', () => {
    const src = createTestImage(8, 8);
    return runEnhancementPipeline({
      source: src,
      upscaleMethod: 'bicubic',
      upscaleScale: 2,
    }).then((result) => {
      const data = result.imageData.data;
      for (let i = 0; i < data.length; i++) {
        expect(data[i]).toBeGreaterThanOrEqual(0);
        expect(data[i]).toBeLessThanOrEqual(255);
      }
    });
  });
});
