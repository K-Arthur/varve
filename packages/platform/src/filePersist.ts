/**
 * Helpers for persisting home index FileEntry rows without clobbering metadata.
 *
 * Research basis: Home index (`openedAt` / `pinned` / `favoritedAt` / `projectId`)
 * is orthogonal to document JSON; editor saves must merge, not replace with defaults.
 */

import { makeFileEntry } from './memory';
import type { Platform } from './platform';

/** Optional overrides applied on top of the preserved existing metadata.
 *  `filePath` moves the Home index entry to a new location (Save As) without
 *  disturbing pin/favorite/project/workspace metadata. */
export interface UpsertPreservingMetaOptions {
  filePath?: string;
}

/** Upsert document JSON while preserving existing index metadata on the FileEntry. */
export async function upsertPreservingMeta(
  platform: Platform,
  fileId: string,
  name: string,
  json: string,
  options?: UpsertPreservingMetaOptions,
): Promise<void> {
  const existing = await platform.getFile(fileId);
  const now = Date.now();
  const size = new TextEncoder().encode(json).byteLength;
  await platform.upsertFile(
    makeFileEntry({
      ...(existing ?? {}),
      id: fileId,
      name,
      updatedAt: now,
      size,
      ...(options?.filePath !== undefined ? { filePath: options.filePath } : {}),
    }),
    json,
  );
}
