import type { Platform, RecentFileRecord } from '@varve/platform';
import { useCallback, useEffect, useState } from 'react';
import type { RecentEntry } from './types';
import { MAX_ENTRIES } from './types';

export interface RecentFilesActions {
  entries: RecentEntry[];
  remove: (id: string) => void;
  clear: () => void;
  togglePin: (id: string) => void;
  refresh: () => void;
}

function recordToEntry(record: RecentFileRecord): RecentEntry {
  return {
    id: record.id,
    label: record.name,
    locator: { kind: 'library' },
    lastOpenedAt: record.lastOpenedAt,
    pinned: record.pinned,
  };
}

/**
 * The File → Open Recent surface, backed by the platform recent-file store
 * (SQLite on desktop, IndexedDB on web) — the same store Home's Recent rail
 * reads. Entries are library records, not raw path strings: a recent is
 * opened by document id, and its disk binding is restored from the file row
 * when one exists. Hidden and missing entries are excluded from the menu,
 * but never deleted here: a temporarily unavailable network/removable file
 * stays recoverable in Home.
 */
export function useRecentFiles(platform: Platform | undefined): RecentFilesActions {
  const [entries, setEntries] = useState<RecentEntry[]>([]);

  const refresh = useCallback(() => {
    if (!platform) {
      setEntries([]);
      return;
    }
    void platform
      .listRecentFiles()
      .then(async (records) => {
        // Recent history is durable metadata, while the file index is the
        // source of truth for whether a library target still exists. Keep
        // orphaned rows out of Open Recent even if Home has not run its
        // reconciliation pass yet. If the index read fails, retain the
        // history-based behavior so a transient storage failure does not
        // destroy the menu contents.
        const files = await platform.listFiles().catch(() => null);
        const fileIds = files ? new Set(files.map((file) => file.id)) : null;
        const visible = records
          .filter(
            (record) =>
              !record.hidden && !record.missing && (fileIds === null || fileIds.has(record.id)),
          )
          .slice(0, MAX_ENTRIES);
        setEntries(visible.map(recordToEntry));
      })
      .catch(() => setEntries([]));
  }, [platform]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const remove = useCallback(
    (id: string) => {
      if (!platform) return;
      void platform
        .removeRecentFile(id)
        .then(refresh)
        .catch(() => undefined);
    },
    [platform, refresh],
  );

  const clear = useCallback(() => {
    if (!platform) return;
    void platform
      .clearRecentHistory()
      .then(() => setEntries([]))
      .catch(() => undefined);
  }, [platform]);

  const togglePin = useCallback(
    (id: string) => {
      if (!platform) return;
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry) return;
      void platform
        .patchRecentFile(id, { pinned: !entry.pinned })
        .then(refresh)
        .catch(() => undefined);
    },
    [entries, platform, refresh],
  );

  return { entries, remove, clear, togglePin, refresh };
}
