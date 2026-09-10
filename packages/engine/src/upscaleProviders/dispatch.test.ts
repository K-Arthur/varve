/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchUpscale, UPSCALE_PROVIDER_CHAIN } from './dispatch';
import { mapNativePathsToTraceResult } from './mapNativePaths';
import { decodeImageBytesToImageData } from './pngDecode';
import { TRACE_PROVIDER_CHAIN } from './traceDispatch';
import type { UpscaleProvider } from './types';

function solidImage(
  w: number,
  h: number,
  rgba: [number, number, number, number] = [10, 20, 30, 255],
) {
  const data = new ImageData(w, h);
  for (let i = 0; i < w * h; i += 1) {
    data.data[i * 4] = rgba[0];
    data.data[i * 4 + 1] = rgba[1];
    data.data[i * 4 + 2] = rgba[2];
    data.data[i * 4 + 3] = rgba[3];
  }
  return data;
}

describe('trace provider chain', () => {
  it('prefers the full-featured worker path before direct and wasm on web', () => {
    // Under a non-Tauri runtime the chain is worker-first with TS fallbacks.
    // Under Tauri the native engine is reordered to the front (native-first
    // dispatch, see traceDispatch.ts) — that ordering is not observable from
    // a jsdom test, so the gating contract is asserted separately below.
    expect(TRACE_PROVIDER_CHAIN.map((p) => p.id)).toEqual([
      'worker-trace',
      'direct-trace',
      'wasm-trace',
    ]);
  });

  it('gates the native provider behind the Tauri runtime', async () => {
    const { nativeTraceProvider } = await import('./traceDispatch');
    expect(nativeTraceProvider.id).toBe('native-trace');
    // Outside Tauri the native IPC provider must never claim availability.
    expect(nativeTraceProvider.isAvailable({}, undefined)).toBe(false);
  });
});

describe('dispatchUpscale', () => {
  it('ships worker AI with native and direct fallbacks', () => {
    expect(UPSCALE_PROVIDER_CHAIN.map((provider) => provider.id)).toEqual([
      'worker-upscale',
      'native-upscale',
      'direct-cpu',
    ]);
  });

  it('prefers the first available provider in the chain', async () => {
    const calls: string[] = [];
    const chain: UpscaleProvider[] = [
      {
        id: 'unavailable',
        label: 'Unavailable',
        isAvailable: () => false,
        upscale: async () => {
          calls.push('unavailable');
          return solidImage(1, 1);
        },
      },
      {
        id: 'native',
        label: 'Native',
        isAvailable: () => true,
        upscale: async () => {
          calls.push('native');
          return solidImage(4, 4);
        },
      },
      {
        id: 'worker',
        label: 'Worker',
        isAvailable: () => true,
        upscale: async () => {
          calls.push('worker');
          return solidImage(2, 2);
        },
      },
    ];

    const result = await dispatchUpscale(solidImage(2, 2), { scale: 2 }, undefined, chain);
    expect(calls).toEqual(['native']);
    expect(result.width).toBe(4);
  });

  it('falls back when an earlier provider throws', async () => {
    const chain: UpscaleProvider[] = [
      {
        id: 'native',
        label: 'Native',
        isAvailable: () => true,
        upscale: async () => {
          throw new Error('IPC failed');
        },
      },
      {
        id: 'worker',
        label: 'Worker',
        isAvailable: () => true,
        upscale: async () => solidImage(4, 4),
      },
    ];
    const result = await dispatchUpscale(solidImage(2, 2), { scale: 2 }, undefined, chain);
    expect(result.width).toBe(4);
  });

  it('rejects AI with an actionable message when no provider accepts it', async () => {
    const chain: UpscaleProvider[] = [
      {
        id: 'worker',
        label: 'Worker',
        isAvailable: (opts) => opts.method !== 'ai',
        upscale: async () => solidImage(1, 1),
      },
    ];
    await expect(
      dispatchUpscale(solidImage(2, 2), { method: 'ai' }, undefined, chain),
    ).rejects.toThrow(/unavailable/i);
  });
});

describe('mapNativePathsToTraceResult', () => {
  it('maps native path points into RasterTraceResult', () => {
    const result = mapNativePathsToTraceResult(10, 10, [
      {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
          { x: 0, y: 4 },
        ],
      },
    ]);
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.bounds).toEqual({ x: 0, y: 0, w: 4, h: 4 });
    expect(result.paths[0]?.curveFitted).toBe(true);
    expect(result.omittedHoles).toBe(0);
  });
});

describe('decodeImageBytesToImageData', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({
        width: 2,
        height: 2,
        close: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes PNG bytes via bitmap + canvas (not as raw RGBA)', async () => {
    const put = vi.fn();
    const getImageData = vi.fn(() => solidImage(2, 2, [1, 2, 3, 255]));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: put,
      getImageData,
    } as never);

    // PNG signature bytes — content is irrelevant because createImageBitmap is stubbed.
    const pngish = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = await decodeImageBytesToImageData(pngish);
    expect(put).toHaveBeenCalled();
    expect(result.width).toBe(2);
    expect(result.data[0]).toBe(1);
  });
});
