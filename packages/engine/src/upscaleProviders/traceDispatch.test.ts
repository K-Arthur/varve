/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Provider-chain ordering and capability gating for raster tracing.
 *
 * Desktop builds must prefer the native engine (it is the production path:
 * full option support, cancellation, progress, centerline). Web builds use
 * worker → direct → wasm and must report centerline as unavailable instead
 * of silently emitting filled silhouettes.
 *
 * The first import of the dispatch graph transforms ~10s of modules in the
 * jsdom environment, so every test declares an explicit generous timeout.
 */

const TIMEOUT = 30_000;

/**
 * The provider graph resolves its own instance of `@varve/platform` when
 * dynamically imported, so the platform view must be injected with
 * `vi.doMock` — `setPlatformInfoForTest` would only affect the test file's
 * statically-imported instance.
 */
function setKind(kind: 'tauri' | 'web'): void {
  const isTauriRuntime = () => kind === 'tauri';
  vi.doMock('@varve/platform', () => ({ isTauriRuntime }));
}

async function loadDispatch() {
  return await import('./traceDispatch');
}

afterEach(() => {
  vi.resetModules();
});

describe('trace dispatch', () => {
  it(
    'prefers the native provider when running under Tauri',
    async () => {
      setKind('tauri');
      const { TRACE_PROVIDER_CHAIN } = await loadDispatch();
      expect(TRACE_PROVIDER_CHAIN[0]?.id).toBe('native-trace');
      expect(TRACE_PROVIDER_CHAIN.some((p) => p.id === 'worker-trace')).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'uses worker/direct/wasm order on web',
    async () => {
      setKind('web');
      const { TRACE_PROVIDER_CHAIN } = await loadDispatch();
      expect(TRACE_PROVIDER_CHAIN[0]?.id).toBe('worker-trace');
      expect(TRACE_PROVIDER_CHAIN[1]?.id).toBe('direct-trace');
      expect(TRACE_PROVIDER_CHAIN.some((p) => p.id === 'native-trace')).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'reports centerline as unavailable on web with a clear reason',
    async () => {
      setKind('web');
      const { traceCapabilityReport } = await loadDispatch();
      const report = await traceCapabilityReport({ traceMode: 'centerline' });
      expect(report.available).toBe(false);
      expect(report.reason).toContain('desktop');
    },
    TIMEOUT,
  );

  it(
    'reports centerline as available on desktop',
    async () => {
      setKind('tauri');
      const { traceCapabilityReport } = await loadDispatch();
      const report = await traceCapabilityReport({ traceMode: 'centerline' });
      expect(report.available).toBe(true);
      expect(report.providerIds).toContain('native-trace');
    },
    TIMEOUT,
  );

  it(
    'reports pixel-art available on both platforms',
    async () => {
      setKind('web');
      const web = await loadDispatch();
      expect((await web.traceCapabilityReport({ mode: 'pixel-art' })).available).toBe(true);
      setKind('tauri');
      const desktop = await loadDispatch();
      expect((await desktop.traceCapabilityReport({ mode: 'pixel-art' })).available).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'falls through providers when the first fails and aggregates errors',
    async () => {
      setKind('tauri');
      // Native IPC is unavailable in the test host: the provider must fail
      // fast (and jsdom's toBlob never settles, so the PNG encode is stubbed).
      vi.doMock('./pngDecode', () => ({
        encodeImageDataToPngBytes: async () => new Uint8Array([1]),
        decodeImageBytesToImageData: (_b: Uint8Array) => new ImageData(2, 2),
      }));
      vi.doMock('@tauri-apps/api/core', () => ({
        invoke: async () => {
          throw new Error('native ipc unavailable');
        },
      }));
      vi.doMock('./workerTraceProvider', () => ({
        workerTraceProvider: {
          id: 'worker-trace',
          label: 'CPU (worker)',
          isAvailable: async () => true,
          trace: async () => {
            throw new Error('worker exploded');
          },
        },
      }));
      vi.doMock('./directTraceProvider', () => ({
        directTraceProvider: {
          id: 'direct-trace',
          label: 'CPU (direct)',
          isAvailable: async () => true,
          trace: async () => ({
            width: 2,
            height: 2,
            paths: [],
            omittedHoles: 0,
          }),
        },
      }));
      const { dispatchTrace } = await loadDispatch();
      const result = await dispatchTrace(new ImageData(2, 2), {}, undefined);
      expect(result.paths).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'surfaces a combined error when every provider fails',
    async () => {
      setKind('tauri');
      vi.doMock('./workerTraceProvider', () => ({
        workerTraceProvider: {
          id: 'worker-trace',
          label: 'CPU (worker)',
          isAvailable: async () => true,
          trace: async () => {
            throw new Error('boom');
          },
        },
      }));
      vi.doMock('./directTraceProvider', () => ({
        directTraceProvider: {
          id: 'direct-trace',
          label: 'CPU (direct)',
          isAvailable: async () => true,
          trace: async () => {
            throw new Error('also boom');
          },
        },
      }));
      vi.doMock('./nativeTraceProvider', () => ({
        nativeTraceProvider: {
          id: 'native-trace',
          label: 'Native (Desktop)',
          isAvailable: async () => true,
          trace: async () => {
            throw new Error('native boom');
          },
        },
      }));
      const { dispatchTrace } = await loadDispatch();
      await expect(dispatchTrace(new ImageData(2, 2), {})).rejects.toThrow(/worker-trace: boom/);
    },
    TIMEOUT,
  );
});
