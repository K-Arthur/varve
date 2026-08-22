import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preprocessScunet } from '../../inference/models/scunet';
import { type RestorationAdapter, runTiledRestoration } from '../tiledRestoration';
import type { RestorationTileProvider } from '../types';

vi.mock('../../backgroundRemoval/modelLoader', () => ({
  getModelLoader: () => ({
    isModelAvailable: vi.fn().mockResolvedValue(true),
  }),
}));

const adapter: RestorationAdapter = { preprocess: preprocessScunet };

function providerFor(
  calls: Array<{ width: number; height: number; dataLength: number }>,
): RestorationTileProvider {
  return {
    id: 'test-restoration',
    isAvailable: () => true,
    async restore(request) {
      calls.push({
        width: request.targetWidth,
        height: request.targetHeight,
        dataLength: request.originalData.length,
      });
      return {
        imageData: new ImageData(request.targetWidth, request.targetHeight),
        executionProvider: 'test',
        processingTimeMs: 0,
      };
    },
  };
}

describe('runTiledRestoration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes actual tile dimensions alongside padded inference tensors', async () => {
    const calls: Array<{ width: number; height: number; dataLength: number }> = [];
    const source = new ImageData(70, 70);

    await runTiledRestoration(source, {
      modelId: 'scunet',
      strength: 1,
      tileSize: 64,
      overlap: 16,
      adapter,
      providers: [providerFor(calls)],
    });

    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) {
      expect(call.dataLength).toBe(call.width * call.height * 4);
      expect(call.width).toBeLessThanOrEqual(64);
      expect(call.height).toBeLessThanOrEqual(64);
    }
  });
});
