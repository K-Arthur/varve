/**
 * Shared model-store interoperability: the model loader writes raw Blob
 * values and the inference DownloadManager writes `{ bytes, modelId,
 * installedAt }` records in the same IndexedDB store. Both readers must
 * normalize the other schema so availability checks and state accounting
 * work regardless of which manager installed a model.
 *
 * Runs in the node environment: fake-indexeddb preserves Blob instances
 * there (jsdom's cross-realm Blobs are mangled by the clone step).
 */
// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { DownloadManager } from '../../inference/core/DownloadManager';
import type { ModelManifestEntry } from '../../inference/core/types';
import { deleteModelBlob, hasModelBlob, loadModelBlob, saveModelBlob } from '../modelStore';

function makeManager(): DownloadManager {
  const dm = new DownloadManager();
  dm.registerModel({
    id: 'interop-model',
    name: 'Interop Model',
    description: 'test',
    sizeBytes: 3,
    remoteUrl: 'https://example.invalid/model.onnx',
    checksum: 'a'.repeat(64),
    bundled: false,
    inputSpec: null,
    quality: 1,
    category: 'embedding',
  } as ModelManifestEntry);
  return dm;
}

describe('modelStore blob normalization', () => {
  it('round-trips raw Blob records', async () => {
    await saveModelBlob('model-blob', new Blob(['abc'], { type: 'application/octet-stream' }));
    const loaded = await loadModelBlob('model-blob');
    expect(loaded).toBeInstanceOf(Blob);
    expect(await loaded!.text()).toBe('abc');
  });

  it('exposes DownloadManager-installed models as Blobs (availability path)', async () => {
    const dm = makeManager();
    await dm
      .getStorage()
      .saveInstalled('model-record', new TextEncoder().encode('manager-bytes').buffer);
    const loaded = await loadModelBlob('model-record');
    expect(loaded).toBeInstanceOf(Blob);
    expect(await loaded!.text()).toBe('manager-bytes');
    expect(await hasModelBlob('model-record')).toBe(true);
  });

  it('DownloadManager reports loader-installed Blob models as ready with size', async () => {
    const dm = makeManager();
    await saveModelBlob('interop-model', new Blob([new Uint8Array([1, 2, 3])]));
    expect(await dm.getDownloadState('interop-model')).toBe('ready');
    expect(await dm.getInstalledSize('interop-model')).toBe(3);
  });

  it('returns null for unknown ids', async () => {
    expect(await loadModelBlob('does-not-exist')).toBeNull();
    await deleteModelBlob('model-blob');
    await deleteModelBlob('model-record');
    expect(await loadModelBlob('model-blob')).toBeNull();
  });
});
