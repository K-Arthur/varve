// COMPLEXITY: 15 — Pure transformation helpers; trivial complexity.

import type { FileEntry, Project } from './types';

/** Convenience for tests: build a FileEntry with sane defaults. */
export function makeFileEntry(
  partial: Partial<FileEntry> & { id: string; name: string },
): FileEntry {
  const now = Date.now();
  return {
    kind: 'strata',
    projectId: null,
    createdAt: now,
    updatedAt: now,
    openedAt: 0,
    size: 0,
    pinned: false,
    trashedAt: null,
    ordering: '',
    contentHash: '00000000',
    ...partial,
  };
}

/** Convenience for tests: build a Project with sane defaults. */
export function makeProject(partial: Partial<Project> & { id: string; name: string }): Project {
  const now = Date.now();
  return { createdAt: now, updatedAt: now, pinned: false, trashedAt: null, ...partial };
}
