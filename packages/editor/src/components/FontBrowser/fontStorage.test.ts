import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getStoredFont,
  getStoredFontByIdentity,
  getStoredFontCount,
  listStoredFonts,
  releaseDocumentFontsInIndexedDb,
  removeStoredFont,
  removeStoredFontByIdentity,
  resetFontStorageMigrationForTests,
  storeFont,
} from './fontStorage';

const metadata = {
  providerId: 'fontsource',
  familyId: 'inter',
  packageVersion: '5.3.0',
  upstreamVersion: 'v20',
  weight: 400,
  style: 'normal' as const,
  subset: 'latin',
  variable: false,
};

async function readArtifactBlob(hash: string): Promise<{ refCount: number } | undefined> {
  const request = indexedDB.open('varve-font-storage-v2');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const transaction = db.transaction('artifactBlobs', 'readonly');
    const result = await new Promise<{ refCount: number } | undefined>((resolve, reject) => {
      const get = transaction.objectStore('artifactBlobs').get(`sha256:${hash}`);
      get.onsuccess = () => resolve(get.result as { refCount: number } | undefined);
      get.onerror = () => reject(get.error);
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return result;
  } finally {
    db.close();
  }
}

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    // fake-indexeddb can report a blocked delete when a previous test is
    // still closing a connection. Resolving keeps the following open call
    // responsible for the authoritative state.
    request.onblocked = () => resolve();
  });
}

async function seedLegacyFont(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('varve-font-storage', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('fonts', { keyPath: 'key' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('fonts', 'readwrite');
      transaction.objectStore('fonts').put({
        key: 'Legacy Imported',
        familyName: 'Legacy Imported',
        data: new Uint8Array([31, 32, 33]).buffer,
        metadata: { providerId: 'legacy' },
        storedAt: Date.now(),
      });
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error);
      };
    };
  });
}

beforeEach(async () => {
  resetFontStorageMigrationForTests();
  await deleteDatabase('varve-font-storage-v2');
  await deleteDatabase('varve-font-storage');
});

describe('canonical font storage', () => {
  it('does not collide for distinct faces that share a family', async () => {
    const regular = await storeFont('Inter', new Uint8Array([1, 2, 3]).buffer, metadata);
    const italic = await storeFont('Inter', new Uint8Array([4, 5, 6]).buffer, {
      ...metadata,
      style: 'italic',
    });
    expect(regular.key).not.toBe(italic.key);
    expect(await getStoredFontCount()).toBe(2);
    expect(await getStoredFont('Inter')).toBeNull();
  });

  it('persists the content hash and can remove one exact artifact', async () => {
    const record = await storeFont('Inter', new Uint8Array([7, 8, 9]).buffer, metadata);
    expect(record.metadata.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await listStoredFonts())[0]?.metadata.familyId).toBe('inter');
    await removeStoredFont(record.key);
    expect(await getStoredFontCount()).toBe(0);
  });

  it('rejects a supplied hash that does not match the original bytes', async () => {
    await expect(
      storeFont('Inter', new Uint8Array([10, 11, 12]).buffer, {
        ...metadata,
        contentHash: '0'.repeat(64),
      }),
    ).rejects.toThrow(/does not match/i);
    expect(await getStoredFontCount()).toBe(0);
  });

  it('rejects a face identity that points at a different artifact', async () => {
    await expect(
      storeFont('Inter', new Uint8Array([10, 11, 12]).buffer, {
        ...metadata,
        faceKey: `sha256:${'0'.repeat(64)}:single`,
      }),
    ).rejects.toThrow(/face identity/i);
    expect(await getStoredFontCount()).toBe(0);
  });

  it('keeps collection members distinct while sharing an artifact digest', async () => {
    const data = new Uint8Array([13, 14, 15]).buffer;
    const regular = await storeFont('Collection', data, {
      ...metadata,
      collectionIndex: 0,
      postScriptName: 'Collection-Regular',
    });
    const bold = await storeFont('Collection', data, {
      ...metadata,
      collectionIndex: 1,
      postScriptName: 'Collection-Bold',
    });
    expect(regular.artifactHash).toBe(bold.artifactHash);
    expect(regular.faceKey).toBe(`sha256:${regular.artifactHash}:0`);
    expect(bold.faceKey).toBe(`sha256:${bold.artifactHash}:1`);
    expect(await readArtifactBlob(regular.artifactHash)).toMatchObject({ refCount: 2 });
    expect(
      await getStoredFontByIdentity({ artifactHash: regular.artifactHash, collectionIndex: 1 }),
    ).toEqual(bold);
    expect(await getStoredFontCount()).toBe(2);
    expect(
      await removeStoredFontByIdentity({ artifactHash: regular.artifactHash, collectionIndex: 0 }),
    ).toBe(true);
    expect(
      await getStoredFontByIdentity({ artifactHash: regular.artifactHash, collectionIndex: 0 }),
    ).toBeNull();
    expect(await getStoredFontCount()).toBe(1);
    expect(await readArtifactBlob(regular.artifactHash)).toMatchObject({ refCount: 1 });
    expect(
      await removeStoredFontByIdentity({ artifactHash: regular.artifactHash, collectionIndex: 1 }),
    ).toBe(true);
    expect(await readArtifactBlob(regular.artifactHash)).toBeUndefined();
  });

  it('releases project faces only after the last document closes', async () => {
    const bytes = new Uint8Array([40, 41, 42]).buffer;
    const first = await storeFont('Project Face', bytes, { ...metadata, documentId: 'doc-a' });
    await storeFont('Project Face', bytes, { ...metadata, documentId: 'doc-b' });
    expect((await listStoredFonts())[0]?.metadata.scope).toBe('project');
    expect(await releaseDocumentFontsInIndexedDb('doc-a')).toBe(0);
    expect(await getStoredFontByIdentity(first.faceKey)).not.toBeNull();
    expect(await releaseDocumentFontsInIndexedDb('doc-b')).toBe(1);
    expect(await getStoredFontByIdentity(first.faceKey)).toBeNull();
    expect(await readArtifactBlob(first.artifactHash)).toBeUndefined();
    // Closing the same document twice is harmless and cannot resurrect a
    // removed face through the migration path.
    expect(await releaseDocumentFontsInIndexedDb('doc-b')).toBe(0);
  });

  it('promotes a project face to persistent storage without later release', async () => {
    const bytes = new Uint8Array([43, 44, 45]).buffer;
    const project = await storeFont('Promoted Face', bytes, {
      ...metadata,
      documentId: 'doc-promote',
    });
    await storeFont('Promoted Face', bytes, metadata);
    expect((await listStoredFonts())[0]?.metadata.scope).toBe('persistent');
    expect(await releaseDocumentFontsInIndexedDb('doc-promote')).toBe(0);
    expect(await getStoredFontByIdentity(project.faceKey)).not.toBeNull();
  });

  it('quarantines bytes changed behind a verified record', async () => {
    const record = await storeFont('Inter', new Uint8Array([16, 17, 18]).buffer, metadata);
    const dbRequest = indexedDB.open('varve-font-storage-v2');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      dbRequest.onsuccess = () => resolve(dbRequest.result);
      dbRequest.onerror = () => reject(dbRequest.error);
    });
    const transaction = db.transaction('artifacts', 'readwrite');
    transaction.objectStore('artifacts').put({ ...record, data: new Uint8Array([99]).buffer });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    expect(await listStoredFonts()).toEqual([]);
    expect(await getStoredFontCount()).toBe(0);
  });

  it('quarantines malformed records without crashing restoration', async () => {
    const seed = await storeFont('Seed', new Uint8Array([20, 21, 22]).buffer, metadata);
    const dbRequest = indexedDB.open('varve-font-storage-v2');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      dbRequest.onsuccess = () => resolve(dbRequest.result);
      dbRequest.onerror = () => reject(dbRequest.error);
    });
    const transaction = db.transaction('artifacts', 'readwrite');
    transaction.objectStore('artifacts').put({ key: 'legacy-corrupt', data: { nope: true } });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    await expect(listStoredFonts()).resolves.toEqual([seed]);
    expect(await getStoredFontCount()).toBe(1);
  });

  it('retries an interrupted legacy migration on the next database open', async () => {
    await seedLegacyFont();

    const idb = indexedDB as IDBFactory;
    const originalOpen = idb.open.bind(indexedDB);
    idb.open = ((name: string, version?: number) => {
      if (name === 'varve-font-storage') throw new Error('simulated migration interruption');
      return originalOpen(name, version);
    }) as IDBFactory['open'];
    await storeFont('Interrupted', new Uint8Array([24, 25, 26]).buffer, metadata);
    idb.open = originalOpen;

    await storeFont('After Retry', new Uint8Array([27, 28, 29]).buffer, metadata);

    expect((await listStoredFonts()).map((record) => record.familyName)).toEqual(
      expect.arrayContaining(['Legacy Imported']),
    );
  });
});
