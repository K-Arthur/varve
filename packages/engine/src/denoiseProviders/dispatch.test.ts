import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fakeDenoise, mockIsModelAvailable } = vi.hoisted(() => ({
  fakeDenoise: vi.fn(
    async (
      req: import('./types').DenoiseTileRequest,
    ): Promise<import('./types').DenoiseTileResult> => {
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
vi.mock('./workerProvider', () => ({
  workerDenoiseProvider: { id: 'fake-worker', isAvailable: () => false, denoise: fakeDenoise },
}));
vi.mock('./nativeProvider', () => ({
  nativeDenoiseProvider: { id: 'native-fake', isAvailable: () => true, denoise: fakeDenoise },
}));

import { dispatchDenoise } from './dispatch';

beforeEach(() => {
  mockIsModelAvailable.mockReset().mockResolvedValue(true);
  fakeDenoise.mockClear();
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
    expect(fakeDenoise.mock.calls.length).toBeGreaterThan(1);
  });

  it('throws on pre-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      dispatchDenoise(makeImageData(32, 32), { strength: 0.5, signal: controller.signal }),
    ).rejects.toThrow();
  });

  it('rejects when model is not downloaded', async () => {
    mockIsModelAvailable.mockResolvedValue(false);
    await expect(
      dispatchDenoise(makeImageData(32, 32), { strength: 0.5, modelId: 'scunet' }),
    ).rejects.toThrow(/not downloaded/i);
  });

  it('produces valid output at strength=1', async () => {
    const src = makeImageData(32, 32, 128);
    const result = await dispatchDenoise(src, { strength: 1.0, modelId: 'scunet' });
    expect(result.denoised.width).toBe(32);
    expect(result.denoised.height).toBe(32);
    const centerIdx = (16 * 32 + 16) * 4;
    expect(result.denoised.data[centerIdx]).toBeGreaterThan(0);
  });
});
