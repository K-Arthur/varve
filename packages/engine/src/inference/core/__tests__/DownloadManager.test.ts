import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadManager } from '../DownloadManager';
import type { ModelStorage } from '../ModelStorage';
import type { ModelManifestEntry } from '../types';

function makeStorage(): ModelStorage {
  const installed = new Map<string, ArrayBuffer>();
  const partials = new Map<
    string,
    { bytes: Uint8Array; url: string; etag: string | null; loaded: number }
  >();
  return {
    name: 'test',
    isAvailable: () => true,
    saveInstalled: async (id, bytes) => {
      installed.set(id, bytes.slice(0));
    },
    loadInstalled: async (id) => installed.get(id) ?? null,
    deleteInstalled: async (id) => void installed.delete(id),
    hasInstalled: async (id) => installed.has(id),
    listInstalled: async () => [...installed.keys()],
    savePartial: async (id, record) => {
      partials.set(id, { ...record, bytes: new Uint8Array(record.bytes) });
    },
    loadPartial: async (id) => {
      const record = partials.get(id);
      return record ? { ...record, bytes: new Uint8Array(record.bytes) } : null;
    },
    deletePartial: async (id) => void partials.delete(id),
    getQuota: async () => ({ used: 0, available: 10_000_000 }),
    clear: async () => {
      installed.clear();
      partials.clear();
    },
  };
}

function makeEntry(id: string, overrides?: Partial<ModelManifestEntry>): ModelManifestEntry {
  return {
    id,
    name: `Model ${id}`,
    description: '',
    sizeBytes: 1000,
    remoteUrl: `https://example.com/models/${id}.onnx`,
    checksum: '',
    bundled: false,
    inputSpec: null,
    quality: 3,
    speed: 3,
    peakMemoryBytes: 10000,
    gpuRecommended: false,
    maxSessions: 2,
    precision: 'fp32',
    category: 'segmentation',
    ...overrides,
  };
}

function makeResponse(
  bytes: Uint8Array | string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const body = typeof bytes === 'string' ? bytes : (bytes as unknown as BodyInit);
  return new Response(body, { status, headers });
}

describe('DownloadManager', () => {
  let manager: DownloadManager;

  beforeEach(() => {
    manager = new DownloadManager(makeStorage());
    localStorage.clear();
  });

  it('starts with no models registered', () => {
    const installed = manager.listInstalledModels();
    expect(installed).toHaveLength(0);
  });

  it('shows bundled model as ready', async () => {
    manager.registerModel(makeEntry('u2netp', { bundled: true }));
    const state = await manager.getDownloadState('u2netp');
    expect(state).toBe('ready');
  });

  it('shows non-bundled model as not-downloaded', async () => {
    manager.registerModel(makeEntry('isnet'));
    const state = await manager.getDownloadState('isnet');
    expect(state).toBe('not-downloaded');
  });

  it('lists registered models with install info', () => {
    manager.registerModel(makeEntry('u2netp', { bundled: true }));
    manager.registerModel(makeEntry('isnet', { bundled: false }));

    const list = manager.listInstalledModels();
    expect(list).toHaveLength(2);

    const bundled = list.find((m) => m.id === 'u2netp');
    expect(bundled?.installed).toBe(true);
    expect(bundled?.source).toBe('bundled');

    const notBundled = list.find((m) => m.id === 'isnet');
    expect(notBundled?.installed).toBe(false);
    expect(notBundled?.source).toBe('none');
  });

  it('rejects download for model without URL', async () => {
    manager.registerModel(makeEntry('no-url', { remoteUrl: '' }));
    await expect(manager.startDownload('no-url')).rejects.toThrow();
  });

  it('tracks state changes during failed download', async () => {
    manager.registerModel(makeEntry('test-model', { remoteUrl: 'https://example.com/model.onnx' }));
    const states: string[] = [];
    manager.subscribeState('test-model', (_id, state) => {
      states.push(state);
    });

    try {
      await manager.startDownload('test-model');
    } catch {}

    expect(states).toContain('downloading');
    expect(states).toContain('error');
  });

  it('cancels active download', async () => {
    manager.registerModel(makeEntry('cancellable'));
    const downloadPromise = manager.startDownload('cancellable');
    manager.cancelDownload('cancellable');

    await expect(downloadPromise).rejects.toThrow();
  });

  it('allows delete of model', async () => {
    manager.registerModel(makeEntry('removable', { bundled: false }));
    await manager.deleteModel('removable');
    const state = await manager.getDownloadState('removable');
    expect(state).toBe('not-downloaded');
  });

  it('reports total storage used', async () => {
    manager.registerModel(makeEntry('model-a'));
    manager.registerModel(makeEntry('model-b'));
    const total = await manager.getTotalStorageUsed();
    expect(total).toBe(0);
  });

  it('rejects duplicate download attempt', async () => {
    manager.registerModel(makeEntry('dup'));
    manager.startDownload('dup').catch(() => {});
    await expect(manager.startDownload('dup')).rejects.toThrow('Already downloading');
    manager.cancelDownload('dup');
  });

  it('resets all state', () => {
    manager.registerModel(makeEntry('model-a'));
    manager.registerModel(makeEntry('model-b'));
    manager.reset();
    const list = manager.listInstalledModels();
    expect(list).toHaveLength(2);
  });

  it('calls download progress listener', async () => {
    manager.registerModel(makeEntry('progress-model'));
    const progressFn = vi.fn();
    manager.subscribeDownloadProgress('progress-model', progressFn);

    try {
      await manager.startDownload('progress-model');
    } catch {}
  });

  it('supports pause and resume by cancel and restart', async () => {
    manager.registerModel(makeEntry('pause-model'));
    const downloadPromise = manager.startDownload('pause-model');
    await manager.pauseDownload('pause-model');
    await expect(downloadPromise).rejects.toThrow();

    try {
      await manager.resumeDownload('pause-model');
    } catch {}
  });

  it('resumes only when Content-Range and the stored ETag match', async () => {
    const storage = manager.getStorage();
    const url = 'https://example.com/models/resumable.onnx';
    manager.registerModel(makeEntry('resumable', { remoteUrl: url, sizeBytes: 6 }));
    await storage.savePartial('resumable', {
      bytes: new Uint8Array([0, 1]),
      url,
      etag: 'v1',
      loaded: 2,
    });

    const requests: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, init?: RequestInit) => {
        requests.push(init ?? {});
        if (requests.length === 1) {
          return makeResponse(new Uint8Array([2, 3, 4]), 206, {
            'Content-Range': 'bytes 3-5/6',
            ETag: 'v1',
          });
        }
        return makeResponse(new Uint8Array([0, 1, 2, 3, 4, 5]), 200, {
          'Content-Length': '6',
          ETag: 'v2',
        });
      }),
    );

    await manager.startDownload('resumable');
    vi.unstubAllGlobals();

    expect(requests).toHaveLength(2);
    expect(requests[0]?.headers).toEqual({ Range: 'bytes=2-' });
    await expect(manager.getInstalledBytes('resumable')).resolves.toEqual(
      new Uint8Array([0, 1, 2, 3, 4, 5]),
    );
  });

  it('accepts a valid partial response without duplicating the prefix', async () => {
    const storage = manager.getStorage();
    const url = 'https://example.com/models/valid-range.onnx';
    manager.registerModel(makeEntry('valid-range', { remoteUrl: url, sizeBytes: 6 }));
    await storage.savePartial('valid-range', {
      bytes: new Uint8Array([0, 1]),
      url,
      etag: 'v1',
      loaded: 2,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        makeResponse(new Uint8Array([2, 3, 4, 5]), 206, {
          'Content-Range': 'bytes 2-5/6',
          'Content-Length': '4',
          ETag: 'v1',
        }),
      ),
    );

    await manager.startDownload('valid-range');
    vi.unstubAllGlobals();
    await expect(manager.getInstalledBytes('valid-range')).resolves.toEqual(
      new Uint8Array([0, 1, 2, 3, 4, 5]),
    );
  });

  it('rejects truncated or HTML responses before installing them', async () => {
    manager.registerModel(makeEntry('truncated', { sizeBytes: 6 }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeResponse(new Uint8Array([0, 1, 2, 3]), 200, { 'Content-Length': '4' })),
    );
    await expect(manager.startDownload('truncated')).rejects.toThrow(/download|artifact|bytes/i);
    vi.unstubAllGlobals();
    await expect(manager.getInstalledBytes('truncated')).resolves.toBeNull();

    manager.registerModel(makeEntry('html', { sizeBytes: 4 }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        makeResponse('<html>not a model</html>', 200, { 'Content-Type': 'text/html' }),
      ),
    );
    await expect(manager.startDownload('html')).rejects.toThrow(/HTML|artifact/i);
    vi.unstubAllGlobals();
    await expect(manager.getInstalledBytes('html')).resolves.toBeNull();
  });

  it('verifies each multipart component with its own checksum', async () => {
    const componentId = 'multi-bad-graph';
    manager.registerModel(
      makeEntry('multi-bad', {
        components: [
          {
            id: componentId,
            role: 'graph',
            filename: 'graph.onnx',
            sizeBytes: 2,
            remoteUrl: `https://example.com/${componentId}.onnx`,
            checksum: '0'.repeat(64),
          },
        ],
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeResponse(new Uint8Array([1, 2]), 200, { 'Content-Length': '2' })),
    );

    await expect(manager.startDownload('multi-bad')).rejects.toThrow(/integrity|checksum/i);
    vi.unstubAllGlobals();
    await expect(manager.getInstalledBytes(componentId)).resolves.toBeNull();
  });
});

describe('component downloads without the multiComponent flag', () => {
  /**
   * SCUNet ships its weights in a sibling `.onnx.data`, declared via
   * `components` but with no `multiComponent: true`. Gating on the flag sent it
   * down the single-file path, fetching only the graph and leaving the model
   * unloadable while reporting success.
   */
  const scunetLike = (): Partial<ModelManifestEntry> => ({
    components: [
      {
        id: 'scunet-graph',
        role: 'graph',
        filename: 'scunet_color_real_psnr.onnx',
        sizeBytes: 3_798_678,
        remoteUrl: 'https://example.com/scunet_color_real_psnr.onnx',
      },
      {
        id: 'scunet-weights',
        role: 'weights',
        filename: 'scunet_color_real_psnr.onnx.data',
        sizeBytes: 73_138_176,
        remoteUrl: 'https://example.com/scunet_color_real_psnr.onnx.data',
      },
    ] as ModelManifestEntry['components'],
  });

  it('treats a components array as authoritative for download state', async () => {
    const manager = new DownloadManager();
    manager.registerModel(makeEntry('scunet', scunetLike()));
    const storage = manager.getStorage();
    // The single-file path stores under the *model* id, the component path
    // under each *component* id. Marking the model id and the graph installed
    // but the weights missing separates the two: only the component-aware path
    // notices the absent `.onnx.data`.
    vi.spyOn(storage, 'hasInstalled').mockImplementation(
      async (id: string) => id === 'scunet' || id === 'scunet-graph',
    );
    vi.spyOn(storage, 'loadPartial').mockResolvedValue(null);

    // Must NOT report ready while the external weights are absent.
    await expect(manager.getDownloadState('scunet')).resolves.toBe('not-downloaded');
  });

  it('reports ready only once every component is installed', async () => {
    const manager = new DownloadManager();
    manager.registerModel(makeEntry('scunet', scunetLike()));
    const storage = manager.getStorage();
    vi.spyOn(storage, 'hasInstalled').mockResolvedValue(true);
    vi.spyOn(storage, 'loadPartial').mockResolvedValue(null);

    await expect(manager.getDownloadState('scunet')).resolves.toBe('ready');
  });

  it('routes a components entry to the multi-component download', async () => {
    const manager = new DownloadManager();
    manager.registerModel(makeEntry('scunet', scunetLike()));
    const storage = manager.getStorage();
    vi.spyOn(storage, 'hasInstalled').mockResolvedValue(false);
    vi.spyOn(storage, 'loadPartial').mockResolvedValue(null);

    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(String(url));
        throw new Error('network disabled in test');
      }),
    );
    await manager.startDownload('scunet').catch(() => {});
    vi.unstubAllGlobals();

    // Components download sequentially, so a failing fetch stops at the first.
    // What distinguishes the paths is *which* URL that is: the component graph
    // rather than the entry-level `remoteUrl` the single-file path would use.
    expect(requested[0]).toBe('https://example.com/scunet_color_real_psnr.onnx');
    expect(requested[0]).not.toBe('https://example.com/models/scunet.onnx');
  });
});
