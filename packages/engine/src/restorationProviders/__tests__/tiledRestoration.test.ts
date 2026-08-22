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
      const result = new ImageData(request.targetWidth, request.targetHeight);
      for (let y = 0; y < request.targetHeight; y += 1) {
        for (let x = 0; x < request.targetWidth; x += 1) {
          const index = (y * request.targetWidth + x) * 4;
          result.data[index] = (x + y * request.targetWidth) & 0xff;
          result.data[index + 3] = 255;
        }
      }
      return {
        imageData: result,
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

    // The bottom-right pixel belongs to the 22x22 edge tile. Its value proves
    // recomposition used the visible tile stride (21 * 22 + 21), rather than
    // reading that tile as if it were a 64x64 packed buffer.
    const bottomRight = source.width * source.height * 4 - 4;
    const edgeTile = await runTiledRestoration(source, {
      modelId: 'scunet',
      strength: 1,
      tileSize: 64,
      overlap: 16,
      adapter,
      providers: [providerFor([])],
    });
    expect(edgeTile.imageData.width).toBe(source.width);
    expect(edgeTile.imageData.height).toBe(source.height);
    expect(edgeTile.imageData.data[bottomRight]).toBe(227);
  });
});
