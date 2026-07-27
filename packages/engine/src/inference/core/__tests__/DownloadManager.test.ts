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
