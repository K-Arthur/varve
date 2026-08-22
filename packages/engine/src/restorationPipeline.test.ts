import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchDenoise } from './denoiseProviders/dispatch';
import { runRestoration } from './restorationPipeline';
import { dispatchUpscale } from './upscaleProviders/dispatch';

vi.mock('./denoiseProviders/dispatch', () => ({
  dispatchDenoise: vi.fn(),
}));

vi.mock('./upscaleProviders/dispatch', () => ({
  dispatchUpscale: vi.fn(),
}));

function image(width = 2, height = 2): ImageData {
  return new ImageData(width, height);
}

describe('runRestoration', () => {
  beforeEach(() => {
    vi.mocked(dispatchDenoise).mockReset();
    vi.mocked(dispatchUpscale).mockReset();
    vi.mocked(dispatchDenoise).mockResolvedValue({
      denoised: image(),
      processingTimeMs: 1,
      executionProvider: 'native',
      tilesUsed: 1,
    });
    vi.mocked(dispatchUpscale).mockResolvedValue(image(4, 4));
  });

  it('runs only denoise for a denoise request', async () => {
    const result = await runRestoration(image(), {
      operation: 'denoise',
      denoise: { strength: 'light' },
    });

    expect(dispatchDenoise).toHaveBeenCalledWith(
      expect.any(ImageData),
      expect.objectContaining({ strength: 0.3, modelId: 'scunet' }),
    );
    expect(dispatchUpscale).not.toHaveBeenCalled();
    expect(result.stages.map((stage) => stage.status)).toEqual(['completed']);
    expect(result.modelIds).toEqual(['scunet']);
  });

  it('executes restoration before super-resolution', async () => {
    const order: string[] = [];
    vi.mocked(dispatchDenoise).mockImplementation(async () => {
      order.push('denoise');
      return {
        denoised: image(),
        processingTimeMs: 1,
        executionProvider: 'worker',
        tilesUsed: 1,
      };
    });
    vi.mocked(dispatchUpscale).mockImplementation(async () => {
      order.push('upscale');
      return image(4, 4);
    });

    const result = await runRestoration(image(), {
      operation: 'restore-upscale',
      denoise: { strength: 'medium' },
      upscale: { method: 'bicubic', scale: 2 },
    });

    expect(order).toEqual(['denoise', 'upscale']);
    expect(result.imageData.width).toBe(4);
    expect(result.warnings[0]).toMatch(/before super-resolution/i);
  });

  it('forwards per-stage upscale progress to the live stage reporter', async () => {
    const snapshots: Array<{ id: string; status: string; progress: number }[]> = [];
    vi.mocked(dispatchUpscale).mockImplementation(async (_input, options) => {
      options?.onProgress?.(3, 4);
      return image(4, 4);
    });

    await runRestoration(
      image(),
      {
        operation: 'upscale',
        upscale: { method: 'ai', modelId: 'upscale-realesr-general', scale: 2 },
      },
      {
        onStageChange: (stages) => {
          snapshots.push(stages.map(({ id, status, progress }) => ({ id, status, progress })));
        },
      },
    );

    expect(snapshots).toContainEqual([{ id: 'upscale', status: 'running', progress: 0.75 }]);
    expect(snapshots.at(-1)).toEqual([{ id: 'upscale', status: 'completed', progress: 1 }]);
  });

  it('does not call providers for a no-op', async () => {
    const result = await runRestoration(image(), { operation: 'none' });
    expect(result.imageData.width).toBe(2);
    expect(result.stages).toEqual([]);
    expect(dispatchDenoise).not.toHaveBeenCalled();
    expect(dispatchUpscale).not.toHaveBeenCalled();
  });

  it('propagates cancellation before model work', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runRestoration(image(), { operation: 'denoise' }, { signal: controller.signal }),
    ).rejects.toThrow('cancelled');
    expect(dispatchDenoise).not.toHaveBeenCalled();
  });

  it('bounds preview pixels before dispatch', async () => {
    vi.mocked(dispatchDenoise).mockImplementation(async (input) => ({
      denoised: input,
      processingTimeMs: 1,
      executionProvider: 'worker',
      tilesUsed: 1,
    }));

    await runRestoration(image(1200, 800), {
      operation: 'denoise',
      denoise: { strength: 'light' },
      preview: true,
      previewMaxDimension: 256,
    });

    expect(vi.mocked(dispatchDenoise).mock.calls[0]?.[0]).toMatchObject({
      width: 256,
      height: 256,
    });
  });
});
