import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fakeRestore, mockIsModelAvailable } = vi.hoisted(() => ({
  fakeRestore: vi.fn(
    async (
      req: import('../restorationProviders/types').RestorationTileRequest,
    ): Promise<import('../restorationProviders/types').RestorationTileResult> => {
      const img = new ImageData(req.targetWidth, req.targetHeight);
      const s = req.strength;
      for (let i = 0; i < req.targetWidth * req.targetHeight; i++) {
        const oi = Math.min(i, req.originalData.length / 4 - 1) * 4;
        img.data[i * 4] = Math.round(
          (req.originalData[oi] ?? 0) * (1 - s) + (req.originalData[oi] ?? 0) * s,
        );
        img.data[i * 4 + 1] = req.originalData[oi + 1] ?? 0;
        img.data[i * 4 + 2] = req.originalData[oi + 2] ?? 0;
        img.data[i * 4 + 3] = 255;
      }
      return { imageData: img, executionProvider: 'fake', processingTimeMs: 1 };
    },
  ),
  mockIsModelAvailable: vi.fn(async (..._args: unknown[]) => true),
}));

function makeImageData(width: number, height: number, fill = 200, alpha = 255): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill;
    data[i * 4 + 1] = Math.min(255, fill + 10);
    data[i * 4 + 2] = Math.min(255, fill + 20);
    data[i * 4 + 3] = alpha;
  }
  return { data, width, height, colorSpace: 'srgb' } as unknown as ImageData;
}

vi.mock('../backgroundRemoval/modelLoader', () => ({
  getModelLoader: () => ({
    isModelAvailable: (...args: unknown[]) => mockIsModelAvailable(...args),
  }),
}));
vi.mock('../restorationProviders/workerProvider', () => ({
  workerRestorationProvider: { id: 'fake-worker', isAvailable: () => true, restore: fakeRestore },
}));
vi.mock('../restorationProviders/nativeProvider', () => ({
  nativeRestorationProvider: { id: 'native-fake', isAvailable: () => true, restore: fakeRestore },
}));

import { dispatchDenoise } from './dispatch';

beforeEach(() => {
  mockIsModelAvailable.mockReset().mockResolvedValue(true);
  fakeRestore.mockClear();
});

describe('dispatchDenoise', () => {
  it('uses a single tile for images within tileSize', async () => {
    const src = makeImageData(64, 64);
    const result = await dispatchDenoise(src, { strength: 0.5, modelId: 'scunet', tileSize: 512 });
    expect(result.tilesUsed).toBe(1);
    expect(result.denoised.width).toBe(64);
    expect(result.denoised.height).toBe(64);
  });

  it('splits large images into multiple tiles', async () => {
    const src = makeImageData(100, 100);
    const result = await dispatchDenoise(src, {
      strength: 1.0,
      modelId: 'scunet',
      tileSize: 64,
      overlap: 16,
    });
    expect(result.tilesUsed).toBeGreaterThan(1);
    expect(result.denoised.width).toBe(100);
    expect(result.denoised.height).toBe(100);
  });

  it('preserves image dimensions for non-square inputs', async () => {
    const src = makeImageData(128, 64);
    const result = await dispatchDenoise(src, { strength: 0.8, modelId: 'scunet' });
    expect(result.denoised.width).toBe(128);
    expect(result.denoised.height).toBe(64);
  });

  it('invokes progress callback per tile', async () => {
    const progress: Array<[number, number]> = [];
    const src = makeImageData(200, 200);
    await dispatchDenoise(src, {
      strength: 0.5,
      modelId: 'scunet',
      tileSize: 64,
      overlap: 16,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(progress.length).toBeGreaterThan(0);
    const last = progress[progress.length - 1]!;
    expect(last[0]).toBe(last[1]);
    expect(last[1]).toBeGreaterThan(1);
  });

  it('calls provider once per tile', async () => {
    const src = makeImageData(200, 200);
    await dispatchDenoise(src, { strength: 0.5, modelId: 'scunet', tileSize: 64, overlap: 16 });
    expect(fakeRestore.mock.calls.length).toBeGreaterThan(1);
  });

  it('throws on pre-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      dispatchDenoise(makeImageData(32, 32), { strength: 0.5, signal: controller.signal }),
    ).rejects.toThrow('cancelled');
    expect(fakeRestore).not.toHaveBeenCalled();
  });

  it('falls back to the worker when the native provider fails', async () => {
    const src = makeImageData(64, 64);
    const workerOnly = vi.fn(
      async (
        req: import('../restorationProviders/types').RestorationTileRequest,
      ): Promise<import('../restorationProviders/types').RestorationTileResult> => ({
        imageData: new ImageData(req.targetWidth, req.targetHeight),
        executionProvider: 'worker',
        processingTimeMs: 1,
      }),
    );
    // Force the native provider to fail, worker to succeed.
    vi.mocked(fakeRestore)
      .mockImplementationOnce(async () => {
        throw new Error('native boom');
      })
      .mockImplementation(workerOnly);
    const result = await dispatchDenoise(src, { strength: 0.5, modelId: 'scunet' });
    expect(result.executionProvider).toBe('worker');
  });

  it('rejects a checkpoint that is not validated for denoise', async () => {
    await expect(
      dispatchDenoise(makeImageData(32, 32), {
        strength: 0.5,
        modelId: 'nafnet-deblur-gopro',
      }),
    ).rejects.toThrow(/not validated for denoise/i);
    expect(fakeRestore).not.toHaveBeenCalled();
  });
});
