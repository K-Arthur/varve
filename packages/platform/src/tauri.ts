/**
 * @varve/platform — Tauri 2 desktop Platform implementation.
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

import type { Platform, PrinterInfo, PrintJobResult } from './platform';
import {
  classifyTauriSaveError,
  contentHash,
  defaultViewState,
  detectFileKind,
  directoryOfPath,
  mergeViewState,
  normalizeSaveFileName,
  stripExtension,
  uuid,
  withDocumentExt,
} from './pure';
import type {
  ActivityEvent,
  Asset,
  AssetFolder,
  Branch,
  Collection,
  CreateVersionInput,
  FileEntry,
  Folder,
  HomeViewState,
  Library,
  OpenFileResult,
  Permission,
  Project,
  ProjectTemplate,
  RecentFileRecord,
  SavedSearch,
  Tag,
  TemplateLibrary,
  ThumbnailRecord,
  VersionEntry,
  VersionStats,
  Workspace,
} from './types';

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

function arrayBufferForBytes(data: Uint8Array): ArrayBuffer {
  if (
    data.byteOffset === 0 &&
    data.byteLength === data.buffer.byteLength &&
    data.buffer instanceof ArrayBuffer
  ) {
    return data.buffer;
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

/**
 * Wrap an async Tauri-dialog call with focus save/restore.
 *
 * When a native Tauri dialog opens, the webview loses OS-level focus.
 * On close, the webview regains OS focus but no DOM element is focused.
 * This wrapper saves the active element before the dialog opens and
 * restores focus to it when the dialog closes. If the saved element is
 * no longer in the DOM (e.g. a panel was closed during the dialog),
 * focus falls back to document.body which is safe and predictable.
 */
async function withFocusRestore<T>(fn: () => Promise<T>): Promise<T> {
  const saved = document.activeElement as HTMLElement | null;
  try {
    return await fn();
  } finally {
    requestAnimationFrame(() => {
      if (saved && saved !== document.body && document.contains(saved)) {
        saved.focus({ preventScroll: true });
      } else if (saved) {
        // Element was removed from DOM — nothing meaningful to restore to.
        // Leaving focus on document.body is the correct fallback; the user
        // can Tab back into the UI from there.
      }
    });
  }
}

/** KV key holding the directory of the last successful document save. */
const LAST_SAVE_DIRECTORY_KEY = 'lastSaveDirectory';

async function loadLastSaveDirectory(): Promise<string | null> {
  try {
    return (await core().invoke('app_get_setting', { key: LAST_SAVE_DIRECTORY_KEY })) as
      | string
      | null;
  } catch {
    return null;
  }
}

async function storeLastSaveDirectory(dir: string): Promise<void> {
  try {
    await core().invoke('app_set_setting', { key: LAST_SAVE_DIRECTORY_KEY, value: dir });
  } catch {
    // Non-fatal: forgetting the folder is a convenience loss only.
  }
}

/** Join a directory and a filename with a platform separator. */
function joinPath(dir: string, name: string): string {
  if (dir.endsWith('/') || dir.endsWith('\\')) return `${dir}${name}`;
  return `${dir}/${name}`;
}

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
    async setFavorited(id, favoritedAt) {
      await core().invoke('home_set_favorited', { id, favoritedAt });
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
      const file = await this.getFile(id);
      if (file?.contentHash) {
        await this.deleteThumbnail(file.contentHash);
      }
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

    // ─── Phase 1: Drafts ────────────────────────────────────────────────────
    async listDrafts() {
      const c = core();
      return (await c.invoke('home_list_drafts')) as FileEntry[];
    },
    async moveFileToDrafts(id) {
      await core().invoke('home_move_drafts', { id });
    },
    async promoteFromDrafts(id, projectId) {
      await core().invoke('home_promote_drafts', { id, projectId });
    },

    // ─── Phase 2: Folders ───────────────────────────────────────────────────
    async listFolders(projectId) {
      const c = core();
      return (await c.invoke('home_list_folders', { projectId })) as Folder[];
    },
    async createFolder(projectId, name, parentId) {
      const c = core();
      return (await c.invoke('home_create_folder', { projectId, name, parentId })) as Folder;
    },
    async renameFolder(id, name) {
      await core().invoke('home_rename_folder', { id, name });
    },
    async deleteFolder(id) {
      await core().invoke('home_delete_folder', { id });
    },
    async moveFileToFolder(fileId, folderId) {
      await core().invoke('home_move_file_folder', { fileId, folderId });
    },
    async reorderFolder(id, ordering) {
      await core().invoke('home_reorder_folder', { id, ordering });
    },

    // ─── Phase 2: Collections ───────────────────────────────────────────────
    async listCollections() {
      const c = core();
      return (await c.invoke('home_list_collections')) as Collection[];
    },
    async createCollection(name, opts) {
      const c = core();
      return (await c.invoke('home_create_collection', { name, ...opts })) as Collection;
    },
    async updateCollection(id, patch) {
      await core().invoke('home_update_collection', { id, patch });
    },
    async deleteCollection(id) {
      await core().invoke('home_delete_collection', { id });
    },
    async addFileToCollection(collectionId, fileId) {
      await core().invoke('home_add_file_collection', { collectionId, fileId });
    },
    async removeFileFromCollection(collectionId, fileId) {
      await core().invoke('home_remove_file_collection', { collectionId, fileId });
    },
    async listCollectionFiles(collectionId) {
      const c = core();
      return (await c.invoke('home_list_collection_files', { collectionId })) as FileEntry[];
    },
    async reorderCollection(id, ordering) {
      await core().invoke('home_reorder_collection', { id, ordering });
    },

    // ─── Phase 3: Workspaces ────────────────────────────────────────────────
    async listWorkspaces() {
      const c = core();
      return (await c.invoke('home_list_workspaces')) as Workspace[];
    },
    async createWorkspace(name, kind) {
      const c = core();
      return (await c.invoke('home_create_workspace', { name, kind })) as Workspace;
    },
    async renameWorkspace(id, name) {
      await core().invoke('home_rename_workspace', { id, name });
    },
    async deleteWorkspace(id) {
      await core().invoke('home_delete_workspace', { id });
    },
    async moveProjectToWorkspace(projectId, workspaceId) {
      await core().invoke('home_move_project_workspace', { projectId, workspaceId });
    },

    // ─── Phase 3: Shared Libraries ──────────────────────────────────────────
    async listLibraries(workspaceId) {
      const c = core();
      return (await c.invoke('home_list_libraries', { workspaceId })) as Library[];
    },
    async createLibrary(workspaceId, name, kind) {
      const c = core();
      return (await c.invoke('home_create_library', { workspaceId, name, kind })) as Library;
    },
    async enableLibrary(id, enabled) {
      await core().invoke('home_enable_library', { id, enabled });
    },
    async deleteLibrary(id) {
      await core().invoke('home_delete_library', { id });
    },

    // ─── Phase 4: Content-Aware Search ──────────────────────────────────────
    async searchFileContent(fileId, query) {
      const c = core();
      return (await c.invoke('home_search_file_content', { fileId, query })) as string[];
    },

    // ─── Phase 5: Templates ─────────────────────────────────────────────────
    async listTemplates(source) {
      const c = core();
      return (await c.invoke('home_list_templates', { source })) as TemplateLibrary[];
    },
    async createTemplateFromFile(fileId, name, category) {
      const c = core();
      return (await c.invoke('home_create_template', {
        fileId,
        name,
        category,
      })) as TemplateLibrary;
    },
    async deleteTemplate(id) {
      await core().invoke('home_delete_template', { id });
    },
    async searchTemplates(query) {
      const c = core();
      return (await c.invoke('home_search_templates', { query })) as TemplateLibrary[];
    },
    async listProjectTemplates() {
      const c = core();
      return (await c.invoke('home_list_project_templates')) as ProjectTemplate[];
    },
    async createProjectFromTemplate(templateId, name) {
      await core().invoke('home_create_project_template', { templateId, name });
    },

    // ─── Phase 6: Assets ────────────────────────────────────────────────────
    async listAssets(workspaceId, folderId) {
      const c = core();
      return (await c.invoke('home_list_assets', { workspaceId, folderId })) as Asset[];
    },
    async importAsset(workspaceId, name, data, mimeType) {
      const c = core();
      const bytes: number[] = Array.from(data);
      return (await c.invoke('home_import_asset', {
        workspaceId,
        name,
        data: bytes,
        mimeType,
      })) as Asset;
    },
    async deleteAsset(id) {
      await core().invoke('home_delete_asset', { id });
    },
    async getAssetBytes() {
      // Native asset commands are not implemented in the Rust backend; the
      // desktop app currently runs the web platform adapter, which stores
      // asset bytes in IndexedDB. Keep the contract explicit rather than
      // invoking a command that does not exist.
      return null;
    },
    async searchAssets(query) {
      const c = core();
      return (await c.invoke('home_search_assets', { query })) as Asset[];
    },
    async createAssetFolder(workspaceId, name, parentId) {
      const c = core();
      return (await c.invoke('home_create_asset_folder', {
        workspaceId,
        name,
        parentId,
      })) as AssetFolder;
    },
    async deleteAssetFolder(id) {
      await core().invoke('home_delete_asset_folder', { id });
    },

    // ─── Phase 7: Version History ───────────────────────────────────────────
    // Native SQLite version commands are a documented follow-up. The Tauri
    // webview has localStorage, so we back version history with a
    // content-addressed localStorage store here — durable across app restarts
    // and dedups identical document JSON the same way memory/web do.
    ...createLocalVersionDelegates(),
    async listBranches(fileId) {
      const c = core();
      return (await c.invoke('home_list_branches', { fileId })) as Branch[];
    },
    async createBranch(fileId, name, baseVersionId) {
      const c = core();
      return (await c.invoke('home_create_branch', {
        fileId,
        name,
        baseVersionId,
      })) as Branch;
    },

    // ─── Phase 8: Collaboration Foundation ──────────────────────────────────
    async listPermissions(fileId) {
      const c = core();
      return (await c.invoke('home_list_permissions', { fileId })) as Permission[];
    },
    async setPermission(fileId, role, email) {
      await core().invoke('home_set_permission', { fileId, role, email });
    },
    async listActivity(workspaceId, limit) {
      const c = core();
      return (await c.invoke('home_list_activity', { workspaceId, limit })) as ActivityEvent[];
    },
    async recordActivity(event) {
      await core().invoke('home_record_activity', { event });
    },

    // ─── Phase 9: Tags & Metadata ─────────────────────────────────────────
    async listTags(workspaceId) {
      const c = core();
      return (await c.invoke('home_list_tags', { workspaceId })) as Tag[];
    },
    async createTag(workspaceId, name, color) {
      const c = core();
      return (await c.invoke('home_create_tag', { workspaceId, name, color })) as Tag;
    },
    async renameTag(id, name) {
      await core().invoke('home_rename_tag', { id, name });
    },
    async deleteTag(id) {
      await core().invoke('home_delete_tag', { id });
    },
    async listFileTags(fileId) {
      const c = core();
      return (await c.invoke('home_list_file_tags', { fileId })) as Tag[];
    },
    async addFileTag(fileId, tagId) {
      await core().invoke('home_add_file_tag', { fileId, tagId });
    },
    async removeFileTag(fileId, tagId) {
      await core().invoke('home_remove_file_tag', { fileId, tagId });
    },
    async listFilesByTag(tagId) {
      const c = core();
      return (await c.invoke('home_list_files_by_tag', { tagId })) as FileEntry[];
    },

    // ─── Phase 9: Saved Searches ──────────────────────────────────────────
    async listSavedSearches() {
      const c = core();
      return (await c.invoke('home_list_saved_searches')) as SavedSearch[];
    },
    async createSavedSearch(name, query, kinds, tagIds) {
      const c = core();
      return (await c.invoke('home_create_saved_search', {
        name,
        query,
        kinds,
        tagIds,
      })) as SavedSearch;
    },
    async deleteSavedSearch(id) {
      await core().invoke('home_delete_saved_search', { id });
    },

    async getThumbnail(hash) {
      const c = core();
      return (await c.invoke('home_get_thumbnail', { hash })) as string | undefined;
    },
    async setThumbnailPreference(fileId, preference) {
      const c = core();
      const rec = (await c.invoke('home_get_file', { id: fileId })) as FileEntry | undefined;
      if (!rec) return;
      const documentJson = (await c.invoke('home_read_file', { id: fileId })) as string | undefined;
      const hash = documentJson ? contentHash(documentJson) : rec.contentHash;
      await c.invoke('home_upsert_file', {
        entry: { ...rec, thumbnailPreference: preference, contentHash: hash },
        json: documentJson ?? '',
      });
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
    async deleteThumbnail(hash) {
      const c = core();
      await c.invoke('home_delete_thumbnail', { hash });
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
    async checkFilesExist(paths) {
      const c = core();
      try {
        return (await c.invoke('home_check_files_exist', { paths })) as boolean[];
      } catch {
        return paths.map(() => false);
      }
    },

    async getViewState() {
      try {
        const raw = (await core().invoke('home_get_view_state')) as string | null;
        return mergeViewState(raw ? (JSON.parse(raw) as Partial<HomeViewState>) : undefined);
      } catch {
        return defaultViewState();
      }
    },
    async setViewState(next) {
      try {
        await core().invoke('home_set_view_state', { value: JSON.stringify(next) });
      } catch {
        // IPC failure — non-fatal.
      }
    },

    async getAppSetting(key) {
      try {
        return (await core().invoke('app_get_setting', { key })) as string | null;
      } catch {
        return null;
      }
    },
    async setAppSetting(key, value) {
      try {
        await core().invoke('app_set_setting', { key, value });
      } catch {
        // IPC failure — non-fatal.
      }
    },

    async openDocumentFromDisk() {
      return withFocusRestore(async () => {
        const c = core();
        const picked = (await c.invoke('plugin:dialog|open', {
          options: {
            multiple: false,
            filters: [{ name: 'Varve document', extensions: ['varve', 'strata'] }],
          },
        })) as Array<{ path?: string; name?: string; content?: string }> | null;
        const first = picked?.[0];
        if (!first?.path) return null;
        const text = (await c.invoke('home_read_text_file_approved', {
          path: first.path,
        })) as string;
        return ingest(first.name ?? 'untitled.varve', text, first.path);
      });
    },

    async importDocumentFromDisk(extensions) {
      return withFocusRestore(async () => {
        const c = core();
        const picked = (await c.invoke('plugin:dialog|open', {
          options: {
            multiple: false,
            filters: [{ name: 'Import', extensions: extensions.map((e) => e.replace(/^\./, '')) }],
          },
        })) as Array<{ path?: string; name?: string }> | null;
        const first = picked?.[0];
        if (!first?.path || !first.name) return { result: null, unsupported: false };
        const kind = detectFileKind(first.name);
        if (kind === 'unknown') return { result: null, unsupported: true };
        const text = (await c.invoke('home_read_text_file_approved', {
          path: first.path,
        })) as string;
        if (kind !== 'strata') {
          const entry = capture(first.name, text, kind);
          return { result: { entry, documentJson: text }, unsupported: false };
        }
        return { result: ingest(first.name, text), unsupported: false };
      });
    },

    async saveDocumentToDisk(name, documentJson) {
      const choice = await this.chooseDocumentSaveTarget(name);
      if (choice.kind !== 'target') return null;
      const written = await this.writeSaveTarget(choice.target, documentJson);
      if (written.kind !== 'written') return null;
      return choice.target.kind === 'native-file' ? choice.target.path : null;
    },

    async writeDocumentToPath(path, documentJson) {
      const written = await this.writeSaveTarget({ kind: 'native-file', path }, documentJson);
      return written.kind === 'written' ? path : null;
    },

    async chooseDocumentSaveTarget(suggestedName) {
      return withFocusRestore(async () => {
        const c = core();
        const suggested = withDocumentExt(normalizeSaveFileName(suggestedName));
        // Optional convenience: start the dialog in the folder of the last
        // successful save. The user still confirms every location; this only
        // sets the dialog's starting point. Stored as a local app setting
        // (SQLite KV) — never serialized into the document.
        const lastDir = await loadLastSaveDirectory();
        const defaultPath = lastDir ? joinPath(lastDir, suggested) : suggested;
        const path = (await c.invoke('plugin:dialog|save', {
          options: {
            defaultPath,
            // New saves produce the canonical format only. Legacy .strata
            // files still open and import; they round-trip through their
            // existing path on plain Save. The dialog deliberately does not
            // present .strata as an equal new-document output format.
            filters: [{ name: 'Varve document', extensions: ['varve'] }],
          },
        })) as string | null;
        if (!path) return { kind: 'cancelled' };
        return { kind: 'target', target: { kind: 'native-file', path } };
      });
    },

    async writeSaveTarget(target, contents) {
      if (target.kind !== 'native-file') {
        return {
          kind: 'failed',
          error: {
            category: 'unsupported',
            message: 'This runtime only writes to native filesystem paths.',
          },
        };
      }
      try {
        await core().invoke('home_write_text_file_approved', {
          path: target.path,
          contents,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { kind: 'failed', error: classifyTauriSaveError(message) };
      }
      const dir = directoryOfPath(target.path);
      if (dir) void storeLastSaveDirectory(dir);
      return { kind: 'written' };
    },

    async readDocumentText(path) {
      try {
        const text = (await core().invoke('home_read_text_file_approved', {
          path,
        })) as string;
        return { ok: true, text };
      } catch (err) {
        const detail = (err ?? {}) as { kind?: string; message?: string };
        if (detail.kind === 'NOT_FOUND') {
          return { ok: false, reason: 'missing' };
        }
        return {
          ok: false,
          reason: 'unreadable',
          message: detail.message ?? String(err),
        };
      }
    },
    async saveBinaryFile(name, data, mimeType, extension) {
      return withFocusRestore(async () => {
        const c = core();
        const ext = extension.replace(/^\./, '');
        const suggested = name.endsWith(`.${ext}`) ? name : `${name}.${ext}`;
        try {
          const path = (await c.invoke('plugin:dialog|save', {
            options: {
              defaultPath: suggested,
              filters: [{ name: mimeType, extensions: [ext] }],
            },
          })) as string | null;
          if (!path) return null;
          await c.invoke('write_binary_file', { path, data: arrayBufferForBytes(data) });
          return path;
        } catch (e) {
          // Tauri IPC rejects with the raw error payload (often a plain string,
          // not an Error), which loses its message when callers assume `.message`.
          throw e instanceof Error ? e : new Error(String(e));
        }
      });
    },
    async chooseExportFolder() {
      return withFocusRestore(async () => {
        const selected = (await core().invoke('plugin:dialog|open', {
          options: { directory: true, multiple: false },
        })) as string | null;
        return selected;
      });
    },
    async writeBinaryFileToFolder(folder, relativePath, data) {
      // Export plans use the portable `/` separator. Native joining and
      // containment are performed by the Rust command after this cheap
      // intent check; this function never rewrites separators for a host OS.
      if (
        relativePath.length === 0 ||
        relativePath.startsWith('/') ||
        relativePath.startsWith('\\') ||
        /^[a-zA-Z]:/.test(relativePath) ||
        relativePath.includes('\\') ||
        relativePath.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
      ) {
        throw new Error('Export path must be a safe relative path');
      }
      return (await core().invoke('write_binary_file_to_folder', {
        folder,
        relativePath,
        data: arrayBufferForBytes(data),
      })) as string;
    },

    async listPrinters() {
      const c = core();
      return (await c.invoke('list_printers')) as PrinterInfo[];
    },
    async printPdf(data, jobTitle, options) {
      const c = core();
      const bytes: number[] = Array.from(data);
      return (await c.invoke('print_pdf', {
        data: bytes,
        jobTitle,
        printerName: options.printerName,
        copies: options.copies ?? 1,
        duplex: options.duplex ?? false,
        colorMode: options.colorMode ?? 'color',
        pageSize: options.pageSize ?? 'A4',
      })) as PrintJobResult;
    },
    async cancelPrintJob(printerName, jobId) {
      const c = core();
      return (await c.invoke('cancel_print_job', { printerName, jobId })) as string;
    },

    async readClipboardImage() {
      const c = core();
      const bytes = (await c.invoke('read_clipboard_image_png')) as number[] | null;
      return bytes ? new Uint8Array(bytes) : null;
    },

    async onNativeFileDrop(handler) {
      const w = (typeof window !== 'undefined' ? window : globalThis) as
        | WindowWithTauri
        | undefined;
      const ev = w?.__TAURI__?.event;
      if (!ev || typeof ev.listen !== 'function') {
        return () => {};
      }
      // Tauri labels drag positions PhysicalPosition, but wry's GTK
      // backend forwards GTK *widget* coordinates, which are already
      // logical (CSS-pixel) units — tauri-runtime-wry wraps them in
      // PhysicalPosition::new() without any scale conversion (verified
      // against wry 0.55 webkitgtk/drag_drop.rs + tauri-runtime-wry 2.11
      // lib.rs). Dividing those by devicePixelRatio double-applies the
      // display scale on Linux. Windows/macOS backends report true
      // physical pixels, which do need the division.
      const isGtk = typeof navigator !== 'undefined' && navigator.userAgent.includes('Linux');
      const dpr = !isGtk && typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const toLogical = (p: { x: number; y: number }) => ({ x: p.x / dpr, y: p.y / dpr });
      type RawPayload = { paths?: string[]; position?: { x: number; y: number } };

      const unlistens = await Promise.all([
        ev.listen('tauri://drag-enter', (raw: unknown) => {
          const e = raw as { payload: RawPayload };
          handler({
            type: 'enter',
            paths: e.payload.paths ?? [],
            position: toLogical(e.payload.position ?? { x: 0, y: 0 }),
          });
        }),
        ev.listen('tauri://drag-over', (raw: unknown) => {
          const e = raw as { payload: RawPayload };
          handler({ type: 'over', position: toLogical(e.payload.position ?? { x: 0, y: 0 }) });
        }),
        ev.listen('tauri://drag-drop', (raw: unknown) => {
          const e = raw as { payload: RawPayload };
          handler({
            type: 'drop',
            paths: e.payload.paths ?? [],
            position: toLogical(e.payload.position ?? { x: 0, y: 0 }),
          });
        }),
        ev.listen('tauri://drag-leave', () => {
          handler({ type: 'leave' });
        }),
      ]);
      return () => {
        for (const un of unlistens) un();
      };
    },
    async readFileBytes(path) {
      const c = core();
      const bytes = (await c.invoke('read_dropped_file', { path })) as number[];
      return new Uint8Array(bytes);
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

    // ─── Recent Files ──────────────────────────────────────────────────────────
    async listRecentFiles() {
      const c = core();
      return (await c.invoke('home_list_recent_files')) as RecentFileRecord[];
    },
    async touchRecentFile(id, name, sourceWorkspaceId, contentHash) {
      const c = core();
      return (await c.invoke('home_touch_recent_file', {
        id,
        name,
        sourceWorkspaceId: sourceWorkspaceId ?? null,
        contentHash: contentHash ?? null,
      })) as RecentFileRecord;
    },
    async patchRecentFile(id, patch) {
      const c = core();
      await c.invoke('home_patch_recent_file', { id, patch });
    },
    async removeRecentFile(id) {
      const c = core();
      await c.invoke('home_remove_recent_file', { id });
    },
    async clearRecentHistory() {
      const c = core();
      await c.invoke('home_clear_recent_history');
    },
  };

  return platform;
}

const VERSIONS_KEY = 'varve-versions';
const VERSION_CONTENT_KEY = 'varve-version-content';
/** Legacy pre-rename keys — read as a migration fallback, never written. */
const LEGACY_VERSIONS_KEY = 'strata-versions';
const LEGACY_VERSION_CONTENT_KEY = 'strata-version-content';

function loadLocalVersions(): Map<string, VersionEntry[]> {
  try {
    const raw = localStorage.getItem(VERSIONS_KEY) ?? localStorage.getItem(LEGACY_VERSIONS_KEY);
    if (!raw) return new Map();
    const entries: VersionEntry[] = JSON.parse(raw);
    const byFile = new Map<string, VersionEntry[]>();
    for (const e of entries) {
      const list = byFile.get(e.fileId) ?? [];
      list.push(e);
      byFile.set(e.fileId, list);
    }
    return byFile;
  } catch {
    return new Map();
  }
}

function saveLocalVersions(byFile: Map<string, VersionEntry[]>): void {
  const all: VersionEntry[] = [];
  for (const list of byFile.values()) all.push(...list);
  localStorage.setItem(VERSIONS_KEY, JSON.stringify(all));
}

function loadLocalContent(): Map<string, string> {
  try {
    const raw =
      localStorage.getItem(VERSION_CONTENT_KEY) ?? localStorage.getItem(LEGACY_VERSION_CONTENT_KEY);
    return raw ? new Map(JSON.parse(raw)) : new Map();
  } catch {
    return new Map();
  }
}

function saveLocalContent(content: Map<string, string>): void {
  localStorage.setItem(VERSION_CONTENT_KEY, JSON.stringify([...content.entries()]));
}

function createLocalVersionDelegates(): Pick<
  Platform,
  | 'listVersions'
  | 'saveVersion'
  | 'restoreVersion'
  | 'deleteVersionInfo'
  | 'createVersion'
  | 'restoreVersionById'
  | 'renameVersion'
  | 'updateVersionThumbnail'
  | 'pinVersion'
  | 'pruneVersions'
  | 'getVersionStats'
> {
  return {
    async listVersions(fileId) {
      return [...(loadLocalVersions().get(fileId) ?? [])];
    },
    async saveVersion(fileId, name, description) {
      const byFile = loadLocalVersions();
      const list = byFile.get(fileId) ?? [];
      const entry: VersionEntry = {
        id: uuid(),
        fileId,
        name,
        description,
        documentHash: '00000000',
        timestamp: Date.now(),
        kind: name ? 'named' : 'checkpoint',
        origin: 'manual',
        size: 0,
        pinned: false,
      };
      list.push(entry);
      byFile.set(fileId, list);
      saveLocalVersions(byFile);
      return entry;
    },
    async restoreVersion(_fileId, versionId) {
      const byFile = loadLocalVersions();
      for (const list of byFile.values()) {
        const v = list.find((e) => e.id === versionId);
        if (v) return loadLocalContent().get(v.documentHash) ?? '';
      }
      return '';
    },
    async deleteVersionInfo(versionId) {
      const byFile = loadLocalVersions();
      for (const [fileId, list] of byFile) {
        const filtered = list.filter((v) => v.id !== versionId);
        if (filtered.length !== list.length) {
          byFile.set(fileId, filtered);
          saveLocalVersions(byFile);
          return;
        }
      }
    },
    async createVersion(input: CreateVersionInput): Promise<VersionEntry> {
      const content = loadLocalContent();
      if (!content.has(input.contentHash)) {
        content.set(input.contentHash, input.documentJson);
      }
      saveLocalContent(content);
      const byFile = loadLocalVersions();
      const list = byFile.get(input.fileId) ?? [];
      const entry: VersionEntry = {
        id: uuid(),
        fileId: input.fileId,
        name: input.name,
        description: input.description,
        documentHash: input.contentHash,
        timestamp: Date.now(),
        kind: input.kind,
        origin: input.origin,
        size: input.size,
        schemaVersion: input.schemaVersion,
        thumbnail: input.thumbnail,
        pinned: input.pinned ?? false,
      };
      list.push(entry);
      byFile.set(input.fileId, list);
      saveLocalVersions(byFile);
      return entry;
    },
    async restoreVersionById(versionId: string): Promise<string> {
      const byFile = loadLocalVersions();
      for (const list of byFile.values()) {
        const v = list.find((e) => e.id === versionId);
        if (v) return loadLocalContent().get(v.documentHash) ?? '';
      }
      return '';
    },
    async renameVersion(versionId: string, name?: string, description?: string): Promise<void> {
      const byFile = loadLocalVersions();
      for (const list of byFile.values()) {
        const v = list.find((e) => e.id === versionId);
        if (v) {
          v.name = name;
          v.description = description;
          saveLocalVersions(byFile);
          return;
        }
      }
    },
    async updateVersionThumbnail(versionId: string, thumbnail: string | undefined): Promise<void> {
      const byFile = loadLocalVersions();
      for (const list of byFile.values()) {
        const v = list.find((e) => e.id === versionId);
        if (v) {
          v.thumbnail = thumbnail;
          saveLocalVersions(byFile);
          return;
        }
      }
    },
    async pinVersion(versionId: string, pinned: boolean): Promise<void> {
      const byFile = loadLocalVersions();
      for (const list of byFile.values()) {
        const v = list.find((e) => e.id === versionId);
        if (v) {
          v.pinned = pinned;
          saveLocalVersions(byFile);
          return;
        }
      }
    },
    async pruneVersions(fileId: string, maxAuto: number): Promise<number> {
      const byFile = loadLocalVersions();
      const list = byFile.get(fileId);
      if (!list) return 0;
      const keep = list.filter((v) => v.kind === 'named' || v.pinned);
      const prunable = list
        .filter((v) => v.kind !== 'named' && !v.pinned)
        .sort((a, b) => b.timestamp - a.timestamp);
      const keepAuto = prunable.slice(0, maxAuto);
      const remove = prunable.slice(maxAuto);
      byFile.set(
        fileId,
        [...keep, ...keepAuto].sort((a, b) => b.timestamp - a.timestamp),
      );
      saveLocalVersions(byFile);
      const referenced = new Set<string>();
      for (const l of byFile.values()) for (const v of l) referenced.add(v.documentHash);
      const content = loadLocalContent();
      for (const hash of content.keys()) {
        if (!referenced.has(hash)) content.delete(hash);
      }
      saveLocalContent(content);
      return remove.length;
    },
    async getVersionStats(fileId: string): Promise<VersionStats> {
      const list = loadLocalVersions().get(fileId) ?? [];
      const content = loadLocalContent();
      return {
        totalVersions: list.length,
        namedVersions: list.filter((v) => v.kind === 'named').length,
        totalBytes: [...content.values()].reduce(
          (sum, json) => sum + new TextEncoder().encode(json).length,
          0,
        ),
      };
    },
  };
}

function ingest(filename: string, text: string, filePath?: string): OpenFileResult {
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
    ...(filePath ? { filePath } : {}),
  };
  return { entry, documentJson: text, filePath };
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
