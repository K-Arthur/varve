/**
 * @strata/platform — Tauri 2 desktop Platform implementation.
 *
 * Persists to the native SQLite store (crates/strata-sync) over Tauri IPC, and
 * uses the official `tauri-plugin-dialog` + `tauri-plugin-opener` for native
 * file pickers and "reveal in file manager". Thumbnails are kept in an
 * in-memory LRU for this phase (cheap to regenerate from the persisted
 * document JSON); durable thumbnail caching is a follow-up.
 *
 * Research basis:
 *  - Strata ADR-0001 (native engine on desktop, no WASM ceiling) — persistence
 *    likewise belongs to the native process, not the webview.
 *  - Tauri 2 plugin model: `window.__TAURI__.core.invoke('plugin:dialog|open')`
 *    works with `withGlobalTauri: true` without bundling the JS plugin.
 */

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

interface TauriCore {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}
interface TauriEvent {
  listen(event: string, handler: (...args: unknown[]) => void): Promise<() => void>;
}
interface TauriGlobal {
  __TAURI__?: { core: TauriCore; event: TauriEvent };
}

interface WindowWithTauri {
  __TAURI__?: { core: TauriCore; event: TauriEvent };
}

function core(): TauriCore {
  const w = (typeof window !== 'undefined' ? window : globalThis) as WindowWithTauri | undefined;
  const coreObj = w?.__TAURI__?.core;
  if (!coreObj) {
    throw new Error(
      'createTauriPlatform() used outside a Tauri webview (window.__TAURI__ missing)',
    );
  }
  return coreObj;
}

const VIEW_STATE_KV = 'strata-home-view-state';

export function createTauriPlatform(): Platform {
  const platform: Platform = {
    kind: 'tauri',

    async listFiles() {
      const c = core();
      const rows = (await c.invoke('home_list_files')) as FileEntry[];
      return rows.filter((r) => r.trashedAt === null);
    },
    async listTrashedFiles() {
      const c = core();
      const rows = (await c.invoke('home_list_trashed')) as FileEntry[];
      return rows.filter((r) => r.trashedAt !== null);
    },
    async getFile(id) {
      const c = core();
      return (await c.invoke('home_get_file', { id })) as FileEntry | undefined;
    },
    async readFile(id) {
      const c = core();
      return (await c.invoke('home_read_file', { id })) as string | undefined;
    },
    async upsertFile(entry, documentJson) {
      const c = core();
      const hash = contentHash(documentJson);
      await c.invoke('home_upsert_file', {
        entry: { ...entry, contentHash: hash, size: documentJson.length },
        json: documentJson,
      });
    },
    async touchFile(id, openedAt = Date.now()) {
      await core().invoke('home_touch_file', { id, openedAt });
    },
    async renameFile(id, name) {
      await core().invoke('home_rename_file', { id, name });
    },
    async setPinned(id, pinned) {
      await core().invoke('home_set_pinned', { id, pinned });
    },
    async moveToProject(id, projectId) {
      await core().invoke('home_move_project', { id, projectId });
    },
    async trashFile(id) {
      await core().invoke('home_trash', { id });
    },
    async restoreFile(id) {
      await core().invoke('home_restore', { id });
    },
    async purgeFile(id) {
      await core().invoke('home_purge', { id });
    },

    async listProjects() {
      const c = core();
      const rows = (await c.invoke('home_list_projects')) as Project[];
      return rows.filter((p) => p.trashedAt === null);
    },
    async createProject(name) {
      const c = core();
      return (await c.invoke('home_create_project', { name })) as Project;
    },
    async renameProject(id, name) {
      await core().invoke('home_rename_project', { id, name });
    },
    async deleteProject(id) {
      await core().invoke('home_delete_project', { id });
    },
    async setProjectPinned(id, pinned) {
      await core().invoke('home_set_project_pinned', { id, pinned });
    },

    async getThumbnail(hash) {
      const c = core();
      return (await c.invoke('home_get_thumbnail', { hash })) as string | undefined;
    },
    async putThumbnail(record: ThumbnailRecord) {
      const c = core();
      await c.invoke('home_put_thumbnail', {
        input: {
          hash: record.hash,
          dataUrl: record.dataUrl,
          width: record.width,
          height: record.height,
          createdAt: record.createdAt,
        },
      });
    },
    async evictThumbnails(keepCount) {
      const c = core();
      return (await c.invoke('home_evict_thumbnails', { keepCount })) as number;
    },

    async searchFiles(query) {
      const c = core();
      return (await c.invoke('home_search_files', { query })) as FileEntry[];
    },

    async reorderFile(id, ordering) {
      const c = core();
      await c.invoke('home_reorder_file', { id, ordering });
    },

    async listenForChanges(callback) {
      const w = (typeof window !== 'undefined' ? window : globalThis) as
        | WindowWithTauri
        | undefined;
      const ev = w?.__TAURI__?.event;
      if (ev && typeof ev.listen === 'function') {
        return ev.listen('home:files-changed', callback);
      }
      return () => {};
    },

    async fileExists(path) {
      const c = core();
      try {
        return (await c.invoke('home_file_exists', { path })) as boolean;
      } catch {
        return false;
      }
    },

    async getViewState() {
      try {
        const raw = localStorage.getItem(VIEW_STATE_KV);
        return mergeViewState(raw ? (JSON.parse(raw) as Partial<HomeViewState>) : undefined);
      } catch {
        return defaultViewState();
      }
    },
    async setViewState(next) {
      try {
        localStorage.setItem(VIEW_STATE_KV, JSON.stringify(next));
      } catch {
        // Private mode / quota — non-fatal.
      }
    },

    async openDocumentFromDisk() {
      const c = core();
      const picked = (await c.invoke('plugin:dialog|open', {
        multiple: false,
        filters: [{ name: 'Strata document', extensions: ['strata'] }],
      })) as Array<{ path?: string; name?: string; content?: string }> | null;
      const first = picked?.[0];
      if (!first?.path) return null;
      const text = (await c.invoke('home_read_text_file', { path: first.path })) as string;
      return ingest(first.name ?? 'untitled.strata', text);
    },

    async importDocumentFromDisk(extensions) {
      const c = core();
      const picked = (await c.invoke('plugin:dialog|open', {
        multiple: false,
        filters: [{ name: 'Import', extensions: extensions.map((e) => e.replace(/^\./, '')) }],
      })) as Array<{ path?: string; name?: string }> | null;
      const first = picked?.[0];
      if (!first?.path || !first.name) return { result: null, unsupported: false };
      const kind = detectFileKind(first.name);
      if (kind === 'unknown') return { result: null, unsupported: true };
      const text = (await c.invoke('home_read_text_file', { path: first.path })) as string;
      if (kind !== 'strata') {
        const entry = capture(first.name, text, kind);
        return { result: { entry, documentJson: text }, unsupported: false };
      }
      return { result: ingest(first.name, text), unsupported: false };
    },

    async saveDocumentToDisk(name, documentJson) {
      const c = core();
      const suggested = name.endsWith('.strata') ? name : `${name}.strata`;
      const path = (await c.invoke('plugin:dialog|save', {
        defaultPath: suggested,
        filters: [{ name: 'Strata document', extensions: ['strata'] }],
      })) as string | null;
      if (!path) return null;
      await c.invoke('home_write_text_file', { path, contents: documentJson });
      return path;
    },

    async revealInFileManager(path) {
      await core().invoke('plugin:opener|reveal_item_in_dir', { path });
    },
    fileManagerLabel() {
      if (typeof navigator !== 'undefined' && /mac/i.test(navigator.platform))
        return 'Reveal in Finder';
      if (typeof navigator !== 'undefined' && /win/i.test(navigator.platform))
        return 'Reveal in Explorer';
      return 'Reveal in Files';
    },

    async saveBlob(name, data, _mimeType) {
      const c = core();
      const path = (await c.invoke('plugin:dialog|save', {
        defaultPath: name,
        filters: [{ name: 'Export', extensions: [name.split('.').pop() ?? 'png'] }],
      })) as string | null;
      if (!path) return null;
      await c.invoke('save_file_bytes', { path, bytes: Array.from(data) });
      return path;
    },
  };

  return platform;
}

function ingest(filename: string, text: string): OpenFileResult {
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

function capture(
  filename: string,
  text: string,
  kind: ReturnType<typeof detectFileKind>,
): FileEntry {
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

export type { TauriGlobal };
