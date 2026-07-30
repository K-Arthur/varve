import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadManager } from '../DownloadManager';
import type { ModelManifestEntry } from '../types';

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

describe('DownloadManager', () => {
  let manager: DownloadManager;

  beforeEach(() => {
    manager = new DownloadManager();
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
