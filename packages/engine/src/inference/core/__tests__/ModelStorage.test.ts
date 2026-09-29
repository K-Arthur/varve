import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createModelStorage, type ModelArtifactMetadata } from '../ModelStorage';

const MODEL_ID = 'staged-model-test';
const SHA_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('staged model artifacts', () => {
  beforeEach(async () => {
    await createModelStorage('indexeddb').clear();
  });

  it('streams chunks into a staged install and publishes only a verified artifact', async () => {
    const storage = createModelStorage('indexeddb');
    const writer = await storage.beginInstalledWrite(MODEL_ID, {
      expectedSizeBytes: 3,
      expectedSha256: SHA_ABC,
    });
    await writer.write(new Uint8Array([0x61]));
    await writer.write(new Uint8Array([0x62, 0x63]));

    expect(await storage.hasInstalled(MODEL_ID)).toBe(false);
    const metadata = await writer.commit();

    expect(metadata).toMatchObject({ modelId: MODEL_ID, sizeBytes: 3, sha256: SHA_ABC });
    const artifact = await storage.openInstalledArtifact(MODEL_ID);
    expect(await artifact?.toBlob().then((blob) => blob.text())).toBe('abc');
    expect(await artifact?.readPrefix(2)).toEqual(new Uint8Array([0x61, 0x62]));
  });

  it('discards checksum failures without replacing the installed artifact', async () => {
    const storage = createModelStorage('indexeddb');
    await storage.saveInstalled(MODEL_ID, new Uint8Array([9, 8, 7]).buffer);
    const writer = await storage.beginInstalledWrite(MODEL_ID, { expectedSha256: SHA_ABC });
    await writer.write(new Uint8Array([0x61, 0x62, 0x64]));

    await expect(writer.commit()).rejects.toMatchObject({ code: 'checksum_mismatch' });
    expect(await storage.loadInstalled(MODEL_ID)).toEqual(new Uint8Array([9, 8, 7]).buffer);
  });

  it('persists paused bytes as a partial artifact and reads them incrementally', async () => {
    const storage = createModelStorage('indexeddb');
    const writer = await storage.beginInstalledWrite(MODEL_ID);
    await writer.write(new Uint8Array([1, 2]));
    await writer.pause({ url: 'https://example.test/model.onnx', etag: 'v1' });

    expect(await storage.getPartialMetadata(MODEL_ID)).toEqual({
      modelId: MODEL_ID,
      url: 'https://example.test/model.onnx',
      etag: 'v1',
      loaded: 2,
    });
    const partial = await storage.openPartialArtifact(MODEL_ID);
    expect(partial?.artifact.metadata.sizeBytes).toBe(2);
    expect(new Uint8Array(await partial!.artifact.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
    expect(await storage.hasInstalled(MODEL_ID)).toBe(false);
  });

  it('publishes a multipart install only after every staged artifact exists', async () => {
    const storage = createModelStorage('indexeddb');
    await storage.saveInstalled('graph', new Uint8Array([1, 2]).buffer);
    await storage.saveInstalled('weights', new Uint8Array([3, 4]).buffer);

    await storage.publishInstalledBatch([
      { stagedId: 'graph', modelId: 'model-graph' },
      { stagedId: 'weights', modelId: 'model-weights' },
    ]);

    expect(await storage.hasInstalled('graph')).toBe(false);
    expect(await storage.hasInstalled('weights')).toBe(false);
    expect(new Uint8Array((await storage.loadInstalled('model-graph'))!)).toEqual(
      new Uint8Array([1, 2]),
    );
    expect(new Uint8Array((await storage.loadInstalled('model-weights'))!)).toEqual(
      new Uint8Array([3, 4]),
    );
  });

  it('keeps old public artifacts intact when a multipart set is incomplete', async () => {
    const storage = createModelStorage('indexeddb');
    await storage.saveInstalled('model-graph', new Uint8Array([8, 8]).buffer);
    await storage.saveInstalled('verified-graph', new Uint8Array([1, 2]).buffer);

    await expect(
      storage.publishInstalledBatch([
        { stagedId: 'verified-graph', modelId: 'model-graph' },
        { stagedId: 'missing-weights', modelId: 'model-weights' },
      ]),
    ).rejects.toThrow(/incomplete/i);

    expect(new Uint8Array((await storage.loadInstalled('model-graph'))!)).toEqual(
      new Uint8Array([8, 8]),
    );
    expect(await storage.hasInstalled('model-weights')).toBe(false);
    expect(await storage.hasInstalled('verified-graph')).toBe(true);
  });

  it('continues to read legacy Blob and ArrayBuffer records', async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('varve-model-store', 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('models', 'readwrite');
      tx.objectStore('models').put(
        { modelId: 'legacy-arraybuffer', bytes: new Uint8Array([4, 5]).buffer, installedAt: 1 },
        'legacy-arraybuffer',
      );
      tx.objectStore('models').put(new Blob([new Uint8Array([6, 7, 8])]), 'legacy-blob');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    const storage = createModelStorage('indexeddb');
    expect(new Uint8Array((await storage.loadInstalled('legacy-arraybuffer'))!)).toEqual(
      new Uint8Array([4, 5]),
    );
    expect((await storage.statInstalled('legacy-blob'))?.sizeBytes).toBe(3);
    expect(
      await (await storage.openInstalledArtifact('legacy-blob'))
        ?.toBlob()
        .then((blob) => blob.size),
    ).toBe(3);
  });

  it('does not write model weights to localStorage JSON', async () => {
    const storage = createModelStorage('localstorage');
    await expect(storage.saveInstalled(MODEL_ID, new ArrayBuffer(1))).rejects.toThrow(/read-only/);
    expect(localStorage.getItem(`varve-model-${MODEL_ID}`)).toBeNull();
    const legacy: ModelArtifactMetadata = {
      modelId: MODEL_ID,
      sizeBytes: 2,
      sha256: null,
      installedAt: 0,
    };
    localStorage.setItem(`strata-model-${MODEL_ID}`, JSON.stringify({ data: [1, 2] }));
    expect(await storage.statInstalled(MODEL_ID)).toEqual(legacy);
  });
});
