// @vitest-environment node
/**
 * Content-addressed storage reclamation: permanently deleting a file or a
 * version must not leave its document JSON behind once no record references
 * the hash. Shared hashes must survive until the last reference goes away.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openHomeDb, STORE_FILE_CONTENT, STORE_FILES, STORE_VERSION_CONTENT } from '..';
import { createWebPlatform } from '../web';

function makeEntry(id: string, name: string) {
  return {
    id,
    name,
    kind: 'strata' as const,
    projectId: null,
    createdAt: 0,
    updatedAt: 0,
    openedAt: 0,
    size: 0,
    pinned: false,
    trashedAt: null,
    ordering: '',
    contentHash: '',
  };
}

describe('web content reclamation', () => {
  it('keeps shared file content until the last referencing file is purged', async () => {
    const platform = await createWebPlatform();
    const json = JSON.stringify({ payload: 'gc-shared-content' });
    await platform.upsertFile(makeEntry('gc-shared-a', 'A'), json);
    await platform.upsertFile(makeEntry('gc-shared-b', 'B'), json);

    const db = await openHomeDb();
    const rec = await db.get(STORE_FILES, 'gc-shared-a');
    const hash = rec?.entry.contentHash;
    expect(hash).toBeTruthy();
    expect(await db.get(STORE_FILE_CONTENT, hash as string)).toBeTruthy();

    await platform.purgeFile('gc-shared-a');
    expect(
      await db.get(STORE_FILE_CONTENT, hash as string),
      'content must survive while another file references it',
    ).toBeTruthy();

    await platform.purgeFile('gc-shared-b');
    expect(
      await db.get(STORE_FILE_CONTENT, hash as string),
      'content must be reclaimed once the last reference is purged',
    ).toBeFalsy();
    db.close();
  });

  it('reclaims version content only when the last version referencing it is deleted', async () => {
    const platform = await createWebPlatform();
    const alpha = await platform.createVersion({
      fileId: 'gc-version-file',
      kind: 'checkpoint',
      origin: 'manual',
      documentJson: '{"version":"alpha"}',
      contentHash: 'gc-hash-alpha',
      size: 19,
    });
    const beta = await platform.createVersion({
      fileId: 'gc-version-file',
      kind: 'checkpoint',
      origin: 'manual',
      documentJson: '{"version":"beta"}',
      contentHash: 'gc-hash-beta',
      size: 18,
    });
    const betaCopy = await platform.createVersion({
      fileId: 'gc-version-file',
      kind: 'checkpoint',
      origin: 'manual',
      documentJson: '{"version":"beta"}',
      contentHash: 'gc-hash-beta',
      size: 18,
    });

    const db = await openHomeDb();
    expect(await db.get(STORE_VERSION_CONTENT, 'gc-hash-alpha')).toBeTruthy();
    expect(await db.get(STORE_VERSION_CONTENT, 'gc-hash-beta')).toBeTruthy();

    await platform.deleteVersionInfo(alpha.id);
    expect(await db.get(STORE_VERSION_CONTENT, 'gc-hash-alpha')).toBeFalsy();
    expect(await db.get(STORE_VERSION_CONTENT, 'gc-hash-beta')).toBeTruthy();

    await platform.deleteVersionInfo(beta.id);
    expect(
      await db.get(STORE_VERSION_CONTENT, 'gc-hash-beta'),
      'shared version content must survive while another version references it',
    ).toBeTruthy();

    await platform.deleteVersionInfo(betaCopy.id);
    expect(await db.get(STORE_VERSION_CONTENT, 'gc-hash-beta')).toBeFalsy();
    db.close();
  });
});
