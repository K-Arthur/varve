/**
 * @strata/platform — in-memory Platform implementation.
 *
 * The reference implementation: every other backend must behave identically
 * to this one. Used directly by Vitest (no IndexedDB shim required) and as a
 * read-only demo/SSR fallback. All mutations are atomic and ordered by the
 * caller's await chain; reads observe the latest writes.
 *
 * Research basis: Local-First §3 (the app must work fully offline with no
 * account) — a memory backend preserves that contract for ephemeral contexts.
 */
import type { Platform } from './platform';
import { contentHash, defaultViewState, uuid } from './pure';
import type { FileEntry, HomeViewState, OpenFileResult, Project, ThumbnailRecord } from './types';

interface MemoryState {
  files: Map<string, { entry: FileEntry; json: string }>;
  projects: Map<string, Project>;
  thumbnails: Map<string, ThumbnailRecord>;
  view: HomeViewState;
}

function freshState(): MemoryState {
  return {
    files: new Map(),
    projects: new Map(),
    thumbnails: new Map(),
    view: defaultViewState(),
  };
}

export interface MemoryPlatformOptions {
  /** Seed files/projects for demos/tests. */
  files?: Array<{ entry: FileEntry; json: string }>;
  projects?: Project[];
  /** Initial view state (merged over defaults). */
  view?: Partial<HomeViewState>;
}

export function createMemoryPlatform(options: MemoryPlatformOptions = {}): Platform {
  const state: MemoryState = freshState();
  for (const f of options.files ?? []) state.files.set(f.entry.id, f);
  for (const p of options.projects ?? []) state.projects.set(p.id, p);
  if (options.view) {
    state.view = {
      ...state.view,
      ...options.view,
      sort: { ...state.view.sort, ...(options.view.sort ?? {}) },
      filter: { ...state.view.filter, ...(options.view.filter ?? {}) },
    };
  }

  const liveFiles = (): FileEntry[] =>
    [...state.files.values()].map((r) => r.entry).filter((e) => e.trashedAt === null);

  const trashedFiles = (): FileEntry[] =>
    [...state.files.values()].map((r) => r.entry).filter((e) => e.trashedAt !== null);

  const platform: Platform = {
    kind: 'memory',

    async listFiles() {
      return [...liveFiles()];
    },
    async listTrashedFiles() {
      return [...trashedFiles()];
    },
    async getFile(id) {
      return state.files.get(id)?.entry;
    },
    async readFile(id) {
      return state.files.get(id)?.json;
    },
    async upsertFile(entry, documentJson) {
      state.files.set(entry.id, {
        entry: {
          ...entry,
          contentHash: contentHash(documentJson),
          size: documentJson.length,
        },
        json: documentJson,
      });
    },
    async touchFile(id, openedAt = Date.now()) {
      const rec = state.files.get(id);
      if (!rec) return;
      rec.entry = { ...rec.entry, openedAt: openedAt };
    },
    async renameFile(id, name) {
      const rec = state.files.get(id);
      if (!rec) return;
      rec.entry = { ...rec.entry, name, updatedAt: Date.now() };
    },
    async setPinned(id, pinned) {
      const rec = state.files.get(id);
      if (!rec) return;
      rec.entry = { ...rec.entry, pinned };
    },
    async moveToProject(id, projectId) {
      const rec = state.files.get(id);
      if (!rec) return;
      rec.entry = { ...rec.entry, projectId, updatedAt: Date.now() };
    },
    async trashFile(id) {
      const rec = state.files.get(id);
      if (!rec) return;
      rec.entry = { ...rec.entry, trashedAt: Date.now() };
    },
    async restoreFile(id) {
      const rec = state.files.get(id);
      if (!rec) return;
      rec.entry = { ...rec.entry, trashedAt: null };
    },
    async purgeFile(id) {
      state.files.delete(id);
    },

    async listProjects() {
      return [...state.projects.values()].filter((p) => p.trashedAt === null);
    },
    async createProject(name) {
      const now = Date.now();
      const project: Project = {
        id: uuid(),
        name,
        createdAt: now,
        updatedAt: now,
        pinned: false,
        trashedAt: null,
      };
      state.projects.set(project.id, project);
      return project;
    },
    async renameProject(id, name) {
      const p = state.projects.get(id);
      if (!p) return;
      state.projects.set(id, { ...p, name, updatedAt: Date.now() });
    },
    async deleteProject(id) {
      state.projects.delete(id);
      for (const rec of state.files.values()) {
        if (rec.entry.projectId === id) rec.entry = { ...rec.entry, projectId: null };
      }
    },
    async setProjectPinned(id, pinned) {
      const p = state.projects.get(id);
      if (!p) return;
      state.projects.set(id, { ...p, pinned });
    },

    async searchFiles(query) {
      if (!query.trim()) return [];
      const q = query.toLowerCase();
      return [...state.files.values()]
        .map((r) => r.entry)
        .filter((e) => e.trashedAt === null && e.name.toLowerCase().includes(q))
        .slice(0, 100);
    },

    async reorderFile(id, ordering) {
      const rec = state.files.get(id);
      if (!rec) return;
      rec.entry = { ...rec.entry, ordering, updatedAt: Date.now() };
    },

    async listenForChanges() {
      return () => {};
    },

    async fileExists() {
      // Memory platform doesn't have file paths; always return true
      return true;
    },

    async getThumbnail(hash) {
      return state.thumbnails.get(hash)?.dataUrl;
    },
    async putThumbnail(record) {
      state.thumbnails.set(record.hash, record);
    },
    async evictThumbnails(keepCount) {
      const entries = [...state.thumbnails.values()].sort((a, b) => a.createdAt - b.createdAt);
      const toEvict = Math.max(0, entries.length - keepCount);
      for (let i = 0; i < toEvict; i++) {
        const rec = entries[i];
        if (rec) state.thumbnails.delete(rec.hash);
      }
      return toEvict;
    },

    async getViewState() {
      return { ...state.view, sort: { ...state.view.sort }, filter: { ...state.view.filter } };
    },
    async setViewState(next) {
      state.view = { ...next, sort: { ...next.sort }, filter: { ...next.filter } };
    },

    // No native dialogs in memory mode — these intentionally return null/empty
    // so the UI's "no-op" affordances (disabled Reveal, cancelled picker)
    // exercise correctly in tests and the demo build.
    async openDocumentFromDisk() {
      return null;
    },
    async importDocumentFromDisk() {
      return { result: null, unsupported: false };
    },
    async saveDocumentToDisk() {
      return null;
    },
    async revealInFileManager() {
      // No-op in memory/web.
    },
    fileManagerLabel() {
      return 'Reveal in Files';
    },

    async saveBlob() {
      return null;
    },
  };

  return platform;
}

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

/** Re-exported result type for callers that build OpenFileResults in tests. */
export type { OpenFileResult };
