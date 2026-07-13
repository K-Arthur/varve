// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSave,
  mockLoad,
  mockHas,
  mockDelete,
  mockSavePartial,
  mockLoadPartial,
  mockDeletePartial,
} = vi.hoisted(() => ({
  mockSave: vi.fn(),
  mockLoad: vi.fn(),
  mockHas: vi.fn(),
  mockDelete: vi.fn(),
  mockSavePartial: vi.fn(),
  mockLoadPartial: vi.fn(),
  mockDeletePartial: vi.fn(),
}));

vi.mock('../modelStore', () => ({
  saveModelBlob: mockSave,
  loadModelBlob: mockLoad,
  hasModelBlob: mockHas,
  deleteModelBlob: mockDelete,
  savePartialDownload: mockSavePartial,
  loadPartialDownload: mockLoadPartial,
  deletePartialDownload: mockDeletePartial,
  ModelStorageQuotaError: class ModelStorageQuotaError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ModelStorageQuotaError';
    }
  },
}));

function mockFetchResponse(opts: { ok: boolean; chunks?: Uint8Array[] }) {
  const chunks = opts.chunks ?? [new Uint8Array([1, 2, 3])];
  let i = 0;
  return {
    ok: opts.ok,
    statusText: opts.ok ? 'OK' : 'Not Found',
    headers: { get: () => String(chunks.reduce((n, c) => n + c.length, 0)) },
    body: {
      getReader: () => ({
        read: async () => {
          if (i < chunks.length) {
            const value = chunks[i++];
            return { done: false, value };
          }
          return { done: true, value: undefined };
        },
      }),
    },
  } as unknown as Response;
}

describe('ModelLoader', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    mockSave.mockReset().mockResolvedValue(undefined);
    mockLoad.mockReset().mockResolvedValue(null);
    mockHas.mockReset().mockResolvedValue(false);
    mockDelete.mockReset().mockResolvedValue(undefined);
    mockSavePartial.mockReset().mockResolvedValue(undefined);
    mockLoadPartial.mockReset().mockResolvedValue(null);
    mockDeletePartial.mockReset().mockResolvedValue(undefined);
    localStorage.clear();
    const { resetModelManifestCache } = await import('../modelManifest');
    resetModelManifestCache();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:mock-url'),
        revokeObjectURL: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts in the unavailable state with no current model', async () => {
    const { getModelLoader, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    const loader = getModelLoader();
    expect(loader.getState()).toBe('unavailable');
    expect(loader.getCurrentModelId()).toBe('');
  });

  it('downloadModel transitions unavailable -> downloading -> ready and stores the blob', async () => {
    const { getModelLoaderReady, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    // Let the constructor's implicit `syncFromStorage()` settle *before*
    // installing the fetch mock this test cares about — otherwise the
    // background sync (which also probes every `AVAILABLE_MODELS` bundled
    // path) races with `downloadModel()` against the same mock and can emit
    // an extra spurious 'ready' notification.
    const loader = await getModelLoaderReady();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockFetchResponse({ ok: true, chunks: [new Uint8Array(10)] })),
    );

    const states: string[] = [];
    loader.subscribe((s) => states.push(s));

    await loader.downloadModel('u2netp');

    expect(states).toEqual(['downloading', 'ready']);
    expect(loader.getState()).toBe('ready');
    expect(loader.isModelDownloaded('u2netp')).toBe(true);
    expect(mockSave).toHaveBeenCalledWith('u2netp', expect.any(Blob));
  });

  it('downloadModel reports progress via onProgress callback', async () => {
    const { getModelLoader, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    const loader = getModelLoader();

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          mockFetchResponse({ ok: true, chunks: [new Uint8Array(5), new Uint8Array(5)] }),
        ),
    );

    const progressCalls: Array<[number, number]> = [];
    await loader.downloadModel('u2netp', (loaded, total) => progressCalls.push([loaded, total]));

    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls.at(-1)?.[0]).toBe(10);
  });

  it('downloadModel transitions to error state and rethrows when both sources fail', async () => {
    const { getModelLoader, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    const loader = getModelLoader();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse({ ok: false })));

    await expect(loader.downloadModel('u2netp')).rejects.toThrow();
    expect(loader.getState()).toBe('error');
    expect(loader.getCurrentModelId()).toBe('');
  });

  it('downloadModel rejects unknown model ids without additional network activity', async () => {
    const { getModelLoaderReady, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchSpy);
    const loader = await getModelLoaderReady();
    const callsBefore = fetchSpy.mock.calls.length;

    await expect(loader.downloadModel('not-a-real-model')).rejects.toThrow('Unknown model');
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });

  it('getModelPath returns the bundled path when the asset exists', async () => {
    const { getModelLoader, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    const loader = getModelLoader();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const path = await loader.getModelPath('u2netp');
    expect(path).toBe('/models/u2netp.onnx');
  });

  it('getModelPath falls back to an IndexedDB blob object URL when not bundled', async () => {
    const { getModelLoader, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    const loader = getModelLoader();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    mockLoad.mockResolvedValue(new Blob(['fake-model-bytes']));

    const path = await loader.getModelPath('birefnet-general-lite');
    expect(path).toBe('blob:mock-url');
    expect(mockLoad).toHaveBeenCalledWith('birefnet-general-lite');
  });

  it('getModelPath returns null when neither bundled nor downloaded', async () => {
    const { getModelLoader, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    const loader = getModelLoader();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    mockLoad.mockResolvedValue(null);

    const path = await loader.getModelPath('birefnet-general-lite');
    expect(path).toBeNull();
  });

  it('clearModel deletes the stored blob, revokes the object URL, and resets state', async () => {
    const { getModelLoaderReady, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    const loader = await getModelLoaderReady();

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL, init?: RequestInit) => {
        const path = String(url);
        if (init?.method === 'HEAD') {
          return Promise.resolve({ ok: false });
        }
        if (path.includes('u2netp')) {
          return Promise.resolve(mockFetchResponse({ ok: true, chunks: [new Uint8Array(4)] }));
        }
        return Promise.resolve(mockFetchResponse({ ok: false }));
      }),
    );
    await loader.downloadModel('u2netp');
    mockLoad.mockResolvedValue(new Blob(['x']));
    await loader.getModelPath('birefnet-general-lite'); // populate activeBlobUrl

    await loader.clearModel();

    expect(mockDelete).toHaveBeenCalledWith('u2netp');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(loader.getState()).toBe('unavailable');
    expect(loader.getCurrentModelId()).toBe('');
  });

  it('hasDownloadedBlob reflects the IndexedDB store independent of in-memory state', async () => {
    const { getModelLoader, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    const loader = getModelLoader();

    mockHas.mockResolvedValue(true);
    await expect(loader.hasDownloadedBlob('birefnet-general')).resolves.toBe(true);
  });

  it('syncFromStorage restores ready state when IndexedDB has a downloaded blob', async () => {
    const { getModelLoader, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    mockLoad.mockResolvedValue(new Blob(['model-bytes']));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const loader = getModelLoader();
    await loader.syncFromStorage();

    expect(loader.getState()).toBe('ready');
    expect(loader.getCurrentModelId()).toBe('u2netp');
  });

  it('syncFromStorage clears stale ready state when blob was deleted', async () => {
    const { getModelLoader, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    localStorage.setItem(
      'strata-bg-model-state',
      JSON.stringify({ state: 'ready', modelId: 'u2netp' }),
    );
    mockLoad.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const loader = getModelLoader();
    await loader.syncFromStorage();

    expect(loader.getState()).toBe('unavailable');
    expect(loader.getCurrentModelId()).toBe('');
  });

  it('isModelAvailable returns true when bundled path responds ok', async () => {
    const { getModelLoader, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const loader = getModelLoader();
    await expect(loader.isModelAvailable('u2netp')).resolves.toBe(true);
  });

  it('deleteModel removes blob and resets in-memory state', async () => {
    const { getModelLoader, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    localStorage.setItem(
      'strata-bg-model-state',
      JSON.stringify({ state: 'ready', modelId: 'u2netp' }),
    );
    mockLoad.mockResolvedValue(new Blob(['x']));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const loader = getModelLoader();
    await loader.deleteModel('u2netp');

    expect(mockDelete).toHaveBeenCalledWith('u2netp');
    expect(loader.getState()).toBe('unavailable');
  });

  it('downloadModel fails loudly (not silently corrupt) when IndexedDB is unavailable', async () => {
    const { getModelLoaderReady, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockFetchResponse({ ok: true, chunks: [new Uint8Array(4)] })),
    );
    const loader = await getModelLoaderReady();

    // Simulate a restricted embedding (e.g. a webview with storage
    // partitioning disabled) where `window` exists but `indexedDB` does not.
    vi.stubGlobal('indexedDB', undefined);

    await expect(loader.downloadModel('u2netp')).rejects.toThrow(/IndexedDB unavailable/);
    expect(loader.getState()).toBe('error');
    // Quick mode must remain reachable — this failure must not leave the
    // singleton stuck in a state that blocks retrying or falling back.
    expect(loader.getCurrentModelId()).toBe('');
  });

  it('getModelPath degrades to null (not a crash) when IndexedDB is unavailable and nothing is bundled', async () => {
    const { getModelLoader, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    vi.stubGlobal('indexedDB', undefined);
    const loader = getModelLoader();

    await expect(loader.getModelPath('birefnet-general-lite')).resolves.toBeNull();
  });

  it('getModelPath trusts the manifest for bundled models and skips HEAD fetch', async () => {
    const { getModelLoaderReady, resetModelLoader } = await import('../modelLoader');
    const { resetModelManifestCache } = await import('../modelManifest');
    resetModelLoader();
    resetModelManifestCache();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('manifest.json')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            version: 1,
            models: [
              {
                id: 'u2netp',
                filename: 'u2netp.onnx',
                localPath: '/models/u2netp.onnx',
                sha256: null,
                bundled: true,
                remoteUrl: 'https://example.com/u2netp.onnx',
              },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    const loader = await getModelLoaderReady();

    // bundled=true in the manifest means the file ships with the app; we
    // should not rely on a HEAD fetch that can 404 in Vite dev.
    await expect(loader.getModelPath('u2netp')).resolves.toBe('/models/u2netp.onnx');
    expect(fetchMock).toHaveBeenCalledWith(
      '/models/manifest.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith('/models/u2netp.onnx', expect.anything());
  });

  it('resolveDownloadSources returns manifest local-first then remote for a known model', async () => {
    const { getModelLoader, resetModelLoader } = await import('../modelLoader');
    const { resetModelManifestCache } = await import('../modelManifest');
    resetModelLoader();
    resetModelManifestCache();
    const loader = getModelLoader();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: 1,
          models: [
            {
              id: 'u2netp',
              filename: 'u2netp.onnx',
              localPath: '/models/u2netp.onnx',
              sha256: null,
              bundled: true,
              remoteUrl: 'https://example.com/u2netp.onnx',
            },
          ],
        }),
      }),
    );

    const sources = await loader.resolveDownloadSources('u2netp');
    expect(sources?.local).toBe('/models/u2netp.onnx');
    expect(sources?.bundled).toBe(true);
    expect(sources?.remote).toContain('u2netp');
  });

  it('rejects corrupted download when checksum mismatches', async () => {
    const { getModelLoaderReady, resetModelLoader } = await import('../modelLoader');
    const { resetModelManifestCache } = await import('../modelManifest');
    resetModelLoader();
    resetModelManifestCache();
    const loader = await getModelLoaderReady();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('manifest.json')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              version: 1,
              models: [
                {
                  id: 'u2netp',
                  filename: 'u2netp.onnx',
                  localPath: '/models/u2netp.onnx',
                  sha256: 'deadbeef',
                  bundled: false,
                  remoteUrl: 'https://example.com/u2netp.onnx',
                },
              ],
            }),
          });
        }
        return Promise.resolve(
          mockFetchResponse({ ok: true, chunks: [new Uint8Array([9, 9, 9])] }),
        );
      }),
    );

    await expect(loader.downloadModel('u2netp')).rejects.toThrow(/SHA-256/);
    expect(loader.getState()).toBe('error');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('cancel mid-download aborts fetch and resets state to unavailable', async () => {
    const { getModelLoaderReady, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    const loader = await getModelLoaderReady();
    const controller = new AbortController();

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).includes('manifest.json')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ version: 1, models: [] }),
          });
        }
        if (init?.method === 'HEAD') {
          return Promise.resolve({ ok: false });
        }
        if (init?.signal?.aborted) {
          return Promise.reject(new DOMException('Aborted', 'AbortError'));
        }
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
      }),
    );

    const download = loader.downloadModel('u2netp', undefined, controller.signal);
    controller.abort();
    await expect(download).rejects.toThrow(/cancelled/i);
    expect(loader.getState()).toBe('unavailable');
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockDeletePartial).toHaveBeenCalledWith('u2netp');
  });

  it('resumes interrupted download from partial bytes with Range header', async () => {
    const { getModelLoaderReady, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    const loader = await getModelLoaderReady();
    const firstHalf = new Uint8Array([1, 2, 3, 4]);
    const secondHalf = new Uint8Array([5, 6, 7, 8]);
    mockLoadPartial.mockResolvedValue({
      bytes: firstHalf,
      meta: { url: 'https://example.com/u2netp.onnx', etag: 'etag-1', loaded: 4 },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const path = String(url);
        if (path.includes('manifest.json')) {
          return Promise.resolve({ ok: true, json: async () => ({ version: 1, models: [] }) });
        }
        if (path.startsWith('/models/')) {
          return Promise.resolve({ ok: false, statusText: 'Not Found' });
        }
        if (init?.headers && (init.headers as Record<string, string>).Range) {
          expect((init.headers as Record<string, string>).Range).toBe('bytes=4-');
          return Promise.resolve({
            ok: true,
            status: 206,
            statusText: 'Partial Content',
            headers: {
              get: (h: string) =>
                h.toLowerCase() === 'content-range'
                  ? 'bytes 4-7/8'
                  : h.toLowerCase() === 'etag'
                    ? 'etag-1'
                    : null,
            },
            body: {
              getReader: () => ({
                read: async () => ({ done: false, value: secondHalf }),
              }),
            },
          });
        }
        return Promise.resolve(mockFetchResponse({ ok: true, chunks: [firstHalf, secondHalf] }));
      }),
    );

    await loader.downloadModel('u2netp');
    expect(mockSave).toHaveBeenCalled();
    expect(mockDeletePartial).toHaveBeenCalledWith('u2netp');
    expect(loader.getState()).toBe('ready');
  });

  it('surfaces actionable message when storage quota is exceeded', async () => {
    const { getModelLoaderReady, resetModelLoader } = await import('../modelLoader');
    const { ModelStorageQuotaError } = await import('../modelStore');
    resetModelLoader();
    const loader = await getModelLoaderReady();
    mockSave.mockRejectedValue(new ModelStorageQuotaError('QuotaExceededError'));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockFetchResponse({ ok: true, chunks: [new Uint8Array(4)] })),
    );

    await expect(loader.downloadModel('u2netp')).rejects.toThrow(/Offline Models/i);
  });

  it('getModelPath returns null when the HEAD probe times out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { getModelLoader, resetModelLoader } = await import('../modelLoader');
    const { resetModelManifestCache } = await import('../modelManifest');
    resetModelLoader();
    resetModelManifestCache();

    const fetchMock = vi.fn((url: string) => {
      if (url.includes('manifest.json')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            version: 1,
            models: [
              {
                id: 'birefnet-general-lite',
                filename: 'birefnet-general-lite.onnx',
                localPath: '/models/birefnet-general-lite.onnx',
                sha256: null,
                bundled: false,
                remoteUrl: 'https://example.com/birefnet-general-lite.onnx',
              },
            ],
          }),
        });
      }
      return new Promise(() => {
        // never resolves
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const loader = getModelLoader();
    const promise = loader.getModelPath('birefnet-general-lite');
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(promise).resolves.toBeNull();
    vi.useRealTimers();
  });

  it('downloadModel times out and aborts a hanging fetch', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { getModelLoader, resetModelLoader } = await import('../modelLoader');
    resetModelLoader();
    const loader = getModelLoader();
    const fetchMock = vi.fn((_url: string) => {
      if (String(_url).includes('manifest.json')) {
        return Promise.resolve({ ok: true, json: async () => ({ version: 1, models: [] }) });
      }
      return new Promise(() => {
        // never resolves
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = loader.downloadModel('u2netp');
    const assertion = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1_850_000);
    await assertion;
    vi.useRealTimers();
  });
});
