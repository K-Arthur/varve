import { describe, expect, it, vi } from 'vitest';
import { dispatchUpscale } from './dispatch';
import type { UpscaleProvider } from './types';

function img(w = 8, h = 8) {
  return new ImageData(new Uint8ClampedArray(w * h * 4).fill(128), w, h);
}

describe('dispatchUpscale error normalization', () => {
  it('does not rethrow a bare Tauri string when a provider reports cancelled', async () => {
    const stringRejecting: UpscaleProvider = {
      id: 'p',
      label: 'p',
      isAvailable: () => true,
      // Tauri rejects with the raw Err(String), not an Error
      upscale: () => Promise.reject('cancelled'),
    };
    let caught: unknown;
    try {
      await dispatchUpscale(img(), { method: 'lanczos3', scale: 2 }, undefined, [stringRejecting]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('cancelled');
  });

  it('surfaces a native string failure message and still falls back', async () => {
    const native: UpscaleProvider = {
      id: 'native-upscale',
      label: 'n',
      isAvailable: () => true,
      upscale: () => Promise.reject('Upscale cancelled'),
    };
    const failing: UpscaleProvider = {
      id: 'other',
      label: 'o',
      isAvailable: () => true,
      upscale: () => Promise.reject('boom'),
    };
    let caught: unknown;
    try {
      await dispatchUpscale(img(), { method: 'lanczos3', scale: 2 }, undefined, [native, failing]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    // the real backend messages must survive to the UI
    expect((caught as Error).message).toContain('Upscale cancelled');
    expect((caught as Error).message).toContain('boom');
  });
});

describe('worker options cloning', () => {
  it('strips the onProgress function so postMessage can structured-clone', async () => {
    const posted: unknown[] = [];
    class FakeWorker {
      onmessage: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      postMessage(msg: Record<string, unknown>) {
        // real postMessage throws DataCloneError on functions
        structuredClone({ ...msg, buffer: undefined });
        posted.push(msg);
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    const { runUpscaleInWorker, resetEnhancementWorkerForTests } = await import(
      './enhancementWorkerHost'
    );
    resetEnhancementWorkerForTests();
    void runUpscaleInWorker(img(), {
      method: 'lanczos3',
      scale: 2,
      onProgress: () => {},
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 10));
    expect(posted.length).toBe(1);
    const opts = (posted[0] as { options: Record<string, unknown> }).options;
    expect(opts.onProgress).toBeUndefined();
    expect(opts.method).toBe('lanczos3');
    resetEnhancementWorkerForTests();
    vi.unstubAllGlobals();
  });
});
