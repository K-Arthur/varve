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
import type {
  ActivityEvent,
  Asset,
  AssetFolder,
  Branch,
  Collection,
  FileEntry,
  Folder,
  HomeViewState,
  Library,
  OpenFileResult,
  Permission,
  Project,
  ProjectTemplate,
  SavedSearch,
  Tag,
  TemplateLibrary,
  ThumbnailRecord,
  VersionEntry,
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
    async listVersions(fileId) {
      const c = core();
      return (await c.invoke('home_list_versions', { fileId })) as VersionEntry[];
    },
    async saveVersion(fileId, name, description) {
      const c = core();
      return (await c.invoke('home_save_version', { fileId, name, description })) as VersionEntry;
    },
    async restoreVersion(fileId, versionId) {
      const c = core();
      return (await c.invoke('home_restore_version', { fileId, versionId })) as string;
    },
    async deleteVersionInfo(versionId) {
      await core().invoke('home_delete_version', { versionId });
    },
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
    async saveBinaryFile(name, data, mimeType, extension) {
      const c = core();
      const ext = extension.replace(/^\./, '');
      const suggested = name.endsWith(`.${ext}`) ? name : `${name}.${ext}`;
      const path = (await c.invoke('plugin:dialog|save', {
        defaultPath: suggested,
        filters: [{ name: mimeType, extensions: [ext] }],
      })) as string | null;
      if (!path) return null;
      const bytes: number[] = Array.from(data);
      await c.invoke('write_binary_file', { path, data: bytes });
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
