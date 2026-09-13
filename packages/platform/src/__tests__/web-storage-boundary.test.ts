// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DB_NAME,
  getStorageWriteMetrics,
  openHomeDb,
  resetStorageWriteMetrics,
  STORE_FILE_CONTENT,
  STORE_FILES,
} from '..';
import { createWebPlatform } from '../web';

const fileId = 'storage-boundary-test';
const legacyFileId = 'storage-boundary-legacy-test';

afterEach(() => {
  resetStorageWriteMetrics();
});

describe('web document storage boundary', () => {
  it('keeps file metadata small and deduplicates content writes', async () => {
    const platform = await createWebPlatform();
    const json = JSON.stringify({ payload: 'x'.repeat(32_000) });
    await platform.upsertFile(
      {
        id: fileId,
        name: 'Storage boundary',
        kind: 'strata',
        projectId: null,
        createdAt: 0,
        updatedAt: 0,
        openedAt: 0,
        size: 0,
        pinned: false,
        trashedAt: null,
        ordering: '',
        contentHash: '',
      },
      json,
    );
    await platform.touchFile(fileId, 123);
    expect(await platform.readFile(fileId)).toBe(json);

    const db = await openHomeDb();
    const metadata = await db.get(STORE_FILES, fileId);
    const contentHash = metadata?.entry.contentHash;
    const content = contentHash ? await db.get(STORE_FILE_CONTENT, contentHash) : undefined;
    db.close();

    expect(metadata?.json).toBeUndefined();
    expect(content?.json).toBe(json);
    expect(getStorageWriteMetrics().byKind['document-content'].writes).toBe(1);
    expect(getStorageWriteMetrics().byKind['file-metadata'].writes).toBe(1);
    expect(DB_NAME).toBe('varve-home');
  });

  it('lazily migrates an inline legacy record without losing content', async () => {
    const legacyJson = JSON.stringify({ legacy: true, payload: 'y'.repeat(512) });
    const db = await openHomeDb();
    await db.put(STORE_FILES, {
      entry: {
        id: legacyFileId,
        name: 'Legacy',
        kind: 'strata',
        projectId: null,
        createdAt: 0,
        updatedAt: 0,
        openedAt: 0,
        size: legacyJson.length,
        pinned: false,
        trashedAt: null,
        ordering: '',
        contentHash: 'legacy-hash',
      },
      json: legacyJson,
    });
    db.close();

    const platform = await createWebPlatform();
    expect(await platform.readFile(legacyFileId)).toBe(legacyJson);
    const migratedDb = await openHomeDb();
    const migrated = await migratedDb.get(STORE_FILES, legacyFileId);
    const content = await migratedDb.get(STORE_FILE_CONTENT, 'legacy-hash');
    migratedDb.close();
    expect(migrated?.json).toBeUndefined();
    expect(content?.json).toBe(legacyJson);
  });
});
