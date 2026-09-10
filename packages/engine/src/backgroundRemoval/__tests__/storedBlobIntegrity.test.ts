/**
 * Stored-blob integrity: getModelPath must verify a downloaded blob against
 * the manifest checksum before returning it. A corrupt copy (legacy writer,
 * partial commit, disk corruption) must be evicted and reported unavailable,
 * so the UI falls back to the download path instead of handing broken bytes
 * to the ONNX runtime.
 */
// @vitest-environment node

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

// The loader branches on window + indexedDB presence; fake-indexeddb provides
// the store, and the window shim makes the blob path reachable in node.
globalThis.window = globalThis as unknown as Window & typeof globalThis;

const { getModelLoader } = await import('../modelLoader');
const { saveModelBlob, hasModelBlob } = await import('../modelStore');

const manifestMock = vi.hoisted(() => ({
  getManifestEntry: vi.fn(),
}));

vi.mock('../modelManifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modelManifest')>();
  return { ...actual, getManifestEntry: manifestMock.getManifestEntry };
});

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const CORRUPT_BYTES = (() => {
  const b = new Uint8Array(1024);
  b[0] = 0x4f;
  b[1] = 0x4e;
  b[2] = 0x4e;
  b[3] = 0x58;
  for (let i = 4; i < b.length; i++) b[i] = i % 251;
  return b;
})();

const GOOD_BYTES = new Uint8Array([1, 2, 3, 4, 5]);

const ENTRY = {
  id: 'integrity-model',
  filename: 'integrity-model.onnx',
  localPath: '/models/integrity-model.onnx',
  bundled: false,
  remoteUrl: 'https://example.invalid/integrity-model.onnx',
  precision: 'fp32',
  modelVersion: '1.0.0',
  sourceRevision: 'test',
  sourceLicense: 'MIT',
  preprocessingVersion: 1,
  postprocessingVersion: 1,
  supportedProviders: ['wasm'],
  tensorContract: null,
};

describe('modelLoader stored-blob integrity', () => {
  it('returns a valid blob that matches the manifest checksum', async () => {
    manifestMock.getManifestEntry.mockResolvedValue({ ...ENTRY, sha256: sha256(GOOD_BYTES) });
    await saveModelBlob('integrity-model', new Blob([GOOD_BYTES]));
    const loader = getModelLoader();
    const path = await loader.getModelPath('integrity-model');
    expect(path).toBeTruthy();
  });

  it('evicts a corrupt blob and reports the model unavailable', async () => {
    manifestMock.getManifestEntry.mockResolvedValue({ ...ENTRY, sha256: sha256(GOOD_BYTES) });
    await saveModelBlob('integrity-model', new Blob([CORRUPT_BYTES]));
    expect(await hasModelBlob('integrity-model')).toBe(true);

    const loader = getModelLoader();
    const path = await loader.getModelPath('integrity-model');
    expect(path).toBeNull();
    expect(await hasModelBlob('integrity-model')).toBe(false);
  });
});
