/**
 * Cross-tab write safety for browser-local documents.
 *
 * Two editors on the same origin (a tab and the installed app, two tabs,
 * or a duplicate window) can both hold the same Varve Library document. The
 * background autosave is the dangerous writer: it fires on a timer with no
 * user intent and would silently replace whatever the other editor wrote
 * more recently.
 *
 * Two mechanisms, both optional and both bounded:
 *
 *   1. A Web Lock per document serializes writes across tabs/workers. Locks
 *      are held only for the write itself, and the browser releases a crashed
 *      writer's lock automatically, so this cannot deadlock forever.
 *   2. An optimistic version check. The tab remembers when it last wrote the
 *      record; if the stored `updatedAt` is newer than that, another writer
 *      got there first and this autosave is skipped. Skipping leaves the
 *      document dirty and its recovery copy in place — it never deletes or
 *      overwrites the other writer's work.
 *
 * This is deliberately not a merge engine. The user's later edit is not
 * silently replaced, which is the guarantee that matters; resolving the two
 * versions is left to the recovery copy and the next explicit save.
 */

export const DOC_WRITE_LOCK_PREFIX = 'varve-doc-write:';

/**
 * True when this write would replace a newer stored record.
 *
 * `lastWrittenAt` is null for the first write in this tab (nothing has been
 * written yet, so there is no baseline to compare against) and the write is
 * allowed.
 */
export function shouldSkipStaleWrite(
  storedUpdatedAt: number | undefined,
  lastWrittenAt: number | null,
): boolean {
  if (lastWrittenAt === null) return false;
  return typeof storedUpdatedAt === 'number' && storedUpdatedAt > lastWrittenAt;
}

export interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/** Serialize one document's write across tabs when Web Locks is available. */
export async function withDocumentWriteLock<T>(
  locks: LockManagerLike | undefined,
  fileId: string,
  write: () => Promise<T>,
): Promise<T> {
  if (!locks) return write();
  return locks.request(`${DOC_WRITE_LOCK_PREFIX}${fileId}`, write);
}
