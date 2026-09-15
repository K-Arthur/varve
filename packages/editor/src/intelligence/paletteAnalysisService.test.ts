import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyzePaletteInWorker,
  clearPaletteAnalysisCache,
  disposePaletteAnalysisWorker,
  paletteAnalysisCacheKey,
} from './paletteAnalysisService';

function source() {
  return {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]),
    source: { assetId: 'asset-1', contentHash: 'hash-1', width: 2, height: 1 },
  };
}

afterEach(() => {
  disposePaletteAnalysisWorker();
  clearPaletteAnalysisCache();
  vi.unstubAllGlobals();
});

describe('paletteAnalysisCacheKey', () => {
  it('includes algorithm, asset, crop, and requested color count', () => {
    const base = source();
    const cropped = {
      ...base,
      source: { ...base.source, crop: { x: 0, y: 0, w: 1, h: 1 } },
    };

    expect(paletteAnalysisCacheKey(base, { colorCount: 6 })).not.toBe(
      paletteAnalysisCacheKey(base, { colorCount: 8 }),
    );
    expect(paletteAnalysisCacheKey(base, { colorCount: 6 })).not.toBe(
      paletteAnalysisCacheKey(cropped, { colorCount: 6 }),
    );
    expect(paletteAnalysisCacheKey(base, { colorCount: 6 })).toContain('hash-1');
  });
});

describe('analyzePaletteInWorker', () => {
  it('uses the cancellable fallback and caches compact results', async () => {
    const first = await analyzePaletteInWorker(source(), { colorCount: 2 });
    const second = await analyzePaletteInWorker(source(), { colorCount: 2 });

    expect(first.extracted).toHaveLength(2);
    expect(second).toBe(first);
  });

  it('rejects a cancelled fallback before doing work', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      analyzePaletteInWorker(source(), { colorCount: 2 }, controller.signal),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('rejects a stale worker response after cancellation', async () => {
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(message: { id: number }) {
        setTimeout(() => {
          this.onmessage?.({
            data: { type: 'success', id: message.id, result: { extracted: [] } },
          } as MessageEvent);
        }, 5);
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);

    const controller = new AbortController();
    const promise = analyzePaletteInWorker(source(), { colorCount: 2 }, controller.signal);
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
