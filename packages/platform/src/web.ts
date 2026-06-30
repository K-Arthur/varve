/**
 * @strata/platform — browser Platform implementation.
 *
 * Local-first in the browser: the file/project index lives in IndexedDB,
 * thumbnails are content-addressed IDB blobs, and the view state is a single
 * JSON record in a KV store. Native open/save use the File System Access API
 * where present and fall back to `<input type=file>` / Blob download otherwise.
 * `revealInFileManager` is a graceful no-op (browsers cannot shell out).
 *
 * Research basis:
 *  - "Local-First Software" (Kleppmann et al., 2019) — IndexedDB is the
 *    durable, origin-scoped store; everything works offline with no account.
 *  - WICG File System Access API (`showOpenFilePicker` / `showSaveFilePicker`)
 *    for native picker UX in Chromium; Firefox/Safari fall back transparently.
 */
import { type IDBPDatabase, openDB } from 'idb';
import type { Platform } from './platform';
import {
  contentHash,
  defaultViewState,
  detectFileKind,
  mergeViewState,
  stripExtension,
  uuid,
} from './pure';
import type { FileEntry, HomeViewState, OpenFileResult, Project, ThumbnailRecord } from './types';

const DB_NAME = 'strata-home';
const DB_VERSION = 1;
const STORE_FILES = 'files';
const STORE_PROJECTS = 'projects';
const STORE_THUMBS = 'thumbnails';
const STORE_KV = 'kv';
const KV_VIEW_STATE = 'view-state';

interface FileRecord {
  entry: FileEntry;
  json: string;
}

interface DbSchema {
  files: FileRecord;
  projects: Project;
  thumbnails: ThumbnailRecord;
  kv: { key: string; value: unknown };
}

async function openHomeDb(): Promise<IDBPDatabase<DbSchema>> {
  return openDB<DbSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        const store = db.createObjectStore(STORE_FILES, { keyPath: 'entry.id' });
        store.createIndex('updatedAt', 'entry.updatedAt');
        store.createIndex('openedAt', 'entry.openedAt');
        store.createIndex('projectId', 'entry.projectId');
      }
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_THUMBS)) {
        const store = db.createObjectStore(STORE_THUMBS, { keyPath: 'hash' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: 'key' });
      }
    },
  });
}

interface WindowWithFsAccess {
  showOpenFilePicker?: (opts: {
    multiple?: boolean;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<Array<FileSystemFileHandle>>;
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
}

function getWindow(): (Window & WindowWithFsAccess) | undefined {
  return typeof window !== 'undefined' ? (window as Window & WindowWithFsAccess) : undefined;
}

const STRATA_ACCEPT = [
  { description: 'Strata document', accept: { 'application/json': ['.strata'] } },
];

export type WebPlatformOptions = {};

export async function createWebPlatform(_options: WebPlatformOptions = {}): Promise<Platform> {
  const db = await openHomeDb();

  const platform: Platform = {
    kind: 'web',

    async listFiles() {
      const all = await db.getAllFromIndex(STORE_FILES, 'updatedAt');
      return all.map((r) => r.entry).filter((e) => e.trashedAt === null);
    },
    async listTrashedFiles() {
      const all = await db.getAll(STORE_FILES);
      return all.map((r) => r.entry).filter((e) => e.trashedAt !== null);
    },
    async getFile(id) {
      const rec = await db.get(STORE_FILES, id);
      return rec?.entry;
    },
    async readFile(id) {
      const rec = await db.get(STORE_FILES, id);
      return rec?.json;
    },
    async upsertFile(entry, documentJson) {
      const hash = contentHash(documentJson);
      const rec: FileRecord = {
        entry: { ...entry, contentHash: hash, size: documentJson.length },
        json: documentJson,
      };
      await db.put(STORE_FILES, rec);
    },
    async touchFile(id, openedAt = Date.now()) {
      const rec = await db.get(STORE_FILES, id);
      if (!rec) return;
      await db.put(STORE_FILES, { ...rec, entry: { ...rec.entry, openedAt } });
    },
    async renameFile(id, name) {
      const rec = await db.get(STORE_FILES, id);
      if (!rec) return;
      await db.put(STORE_FILES, {
        ...rec,
        entry: { ...rec.entry, name, updatedAt: Date.now() },
      });
    },
    async setPinned(id, pinned) {
      const rec = await db.get(STORE_FILES, id);
      if (!rec) return;
      await db.put(STORE_FILES, { ...rec, entry: { ...rec.entry, pinned } });
    },
    async moveToProject(id, projectId) {
      const rec = await db.get(STORE_FILES, id);
      if (!rec) return;
      await db.put(STORE_FILES, {
        ...rec,
        entry: { ...rec.entry, projectId, updatedAt: Date.now() },
      });
    },
    async trashFile(id) {
      const rec = await db.get(STORE_FILES, id);
      if (!rec) return;
      await db.put(STORE_FILES, { ...rec, entry: { ...rec.entry, trashedAt: Date.now() } });
    },
    async restoreFile(id) {
      const rec = await db.get(STORE_FILES, id);
      if (!rec) return;
      await db.put(STORE_FILES, { ...rec, entry: { ...rec.entry, trashedAt: null } });
    },
    async purgeFile(id) {
      await db.delete(STORE_FILES, id);
    },

    async listProjects() {
      const all = await db.getAll(STORE_PROJECTS);
      return all.filter((p) => p.trashedAt === null);
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
      await db.put(STORE_PROJECTS, project);
      return project;
    },
    async renameProject(id, name) {
      const p = await db.get(STORE_PROJECTS, id);
      if (!p) return;
      await db.put(STORE_PROJECTS, { ...p, name, updatedAt: Date.now() });
    },
    async deleteProject(id) {
      await db.delete(STORE_PROJECTS, id);
      const all = await db.getAllFromIndex(STORE_FILES, 'projectId', id);
      for (const rec of all) {
        if (rec.entry.projectId === id) {
          await db.put(STORE_FILES, { ...rec, entry: { ...rec.entry, projectId: null } });
        }
      }
    },
    async setProjectPinned(id, pinned) {
      const p = await db.get(STORE_PROJECTS, id);
      if (!p) return;
      await db.put(STORE_PROJECTS, { ...p, pinned });
    },

    async searchFiles(query) {
      if (!query.trim()) return [];
      const q = query.toLowerCase();
      const all = await db.getAllFromIndex(STORE_FILES, 'updatedAt');
      return all
        .map((r) => r.entry)
        .filter((e) => e.trashedAt === null && e.name.toLowerCase().includes(q))
        .slice(0, 100);
    },

    async reorderFile(id, ordering) {
      const rec = await db.get(STORE_FILES, id);
      if (!rec) return;
      await db.put(STORE_FILES, {
        ...rec,
        entry: { ...rec.entry, ordering, updatedAt: Date.now() },
      });
    },

    async listenForChanges() {
      return () => {};
    },

    async fileExists() {
      // Web platform doesn't have file paths; always return true
      return true;
    },

    async getThumbnail(hash) {
      const rec = await db.get(STORE_THUMBS, hash);
      return rec?.dataUrl;
    },
    async putThumbnail(record) {
      await db.put(STORE_THUMBS, record);
    },
    async evictThumbnails(keepCount) {
      const indexed = await db.getAllFromIndex(STORE_THUMBS, 'createdAt');
      const sorted = indexed.sort((a, b) => a.createdAt - b.createdAt);
      const toEvict = Math.max(0, sorted.length - keepCount);
      const tx = db.transaction(STORE_THUMBS, 'readwrite');
      for (let i = 0; i < toEvict; i++) {
        const rec = sorted[i];
        if (rec) await tx.store.delete(rec.hash);
      }
      await tx.done;
      return toEvict;
    },

    async getViewState() {
      const row = await db.get(STORE_KV, KV_VIEW_STATE);
      return mergeViewState((row?.value as Partial<HomeViewState> | undefined) ?? undefined);
    },
    async setViewState(next) {
      await db.put(STORE_KV, { key: KV_VIEW_STATE, value: next });
    },

    async openDocumentFromDisk() {
      const w = getWindow();
      if (w?.showOpenFilePicker) {
        let handles: Array<FileSystemFileHandle> | undefined;
        try {
          handles = await w.showOpenFilePicker({ multiple: false, types: STRATA_ACCEPT });
        } catch {
          return null; // user cancelled
        }
        const handle = handles?.[0];
        if (!handle) return null;
        const file = await handle.getFile();
        const text = await file.text();
        return ingestFile(file.name, text);
      }
      // Fallback: hidden <input type=file>. Resolves once on change/cancel.
      const picked = await pickViaInput(['.strata']);
      if (!picked) return null;
      return ingestFile(picked.name, picked.text);
    },

    async importDocumentFromDisk(extensions) {
      const picked = await pickViaInput(extensions);
      if (!picked) return { result: null, unsupported: false };
      const kind = detectFileKind(picked.name);
      if (kind === 'unknown') {
        return { result: null, unsupported: true };
      }
      // Phase 1: only `.strata` payloads are real documents. Foreign formats
      // (.fig/.AI/image) are captured into the index as placeholders so the
      // user sees them; full parsers land behind the same interface later.
      if (kind !== 'strata') {
        const entry = await capturePlaceholder(picked.name, picked.text, kind);
        return {
          result: { entry, documentJson: picked.text } satisfies OpenFileResult,
          unsupported: false,
        };
      }
      return { result: ingestFile(picked.name, picked.text), unsupported: false };
    },

    async saveDocumentToDisk(name, documentJson) {
      const w = getWindow();
      const suggested = name.endsWith('.strata') ? name : `${name}.strata`;
      if (w?.showSaveFilePicker) {
        let handle: FileSystemFileHandle | undefined;
        try {
          handle = await w.showSaveFilePicker({ suggestedName: suggested, types: STRATA_ACCEPT });
        } catch {
          return null; // user cancelled
        }
        if (!handle) return null;
        const writable = await (
          handle as unknown as {
            createWritable: () => Promise<{
              write: (s: string) => Promise<void>;
              close: () => Promise<void>;
            }>;
          }
        ).createWritable();
        await writable.write(documentJson);
        await writable.close();
        return handle.name;
      }
      // Fallback: Blob download.
      const blob = new Blob([documentJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = suggested;
      a.click();
      URL.revokeObjectURL(url);
      return suggested;
    },

    async revealInFileManager() {
      // Browsers cannot shell out to the OS file manager.
    },
    fileManagerLabel() {
      return 'Reveal in Files';
    },

    async saveBlob(name, data, mimeType) {
      const blob = new Blob([data as BlobPart], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return name;
    },
  };

  return platform;
}

function ingestFile(filename: string, text: string): OpenFileResult {
  const name = stripExtension(filename);
  const now = Date.now();
  const entry: FileEntry = {
    id: uuid(),
    name,
    kind: detectFileKind(filename),
    projectId: null,
    createdAt: now,
    updatedAt: now,
    openedAt: now,
    size: text.length,
    pinned: false,
    trashedAt: null,
    ordering: '',
    contentHash: contentHash(text),
  };
  return { entry, documentJson: text };
}

async function capturePlaceholder(
  filename: string,
  text: string,
  kind: ReturnType<typeof detectFileKind>,
): Promise<FileEntry> {
  const name = stripExtension(filename);
  const now = Date.now();
  return {
    id: uuid(),
    name,
    kind,
    projectId: null,
    createdAt: now,
    updatedAt: now,
    openedAt: 0,
    size: text.length,
    pinned: false,
    trashedAt: null,
    ordering: '',
    contentHash: contentHash(text),
  };
}

function pickViaInput(extensions: string[]): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = extensions.join(',');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    let settled = false;
    const cleanup = () => {
      input.remove();
      window.removeEventListener('focus', onFocus);
    };
    const onFocus = () => {
      // If focus returns to the window without a file, the picker was cancelled.
      setTimeout(() => {
        if (!settled) {
          cleanup();
          resolve(null);
        }
      }, 300);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        settled = true;
        cleanup();
        resolve(null);
        return;
      }
      settled = true;
      cleanup();
      file.text().then((text) => resolve({ name: file.name, text }));
    });
    document.body.appendChild(input);
    input.click();
    window.addEventListener('focus', onFocus, { once: true });
  });
}

// Exported for tests + callers that need the default view state on web.
export { defaultViewState };
