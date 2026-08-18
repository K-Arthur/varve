// COMPLEXITY: 177 cyclo (over component ceiling) — see docs/plans/architecture-health-remediation-2026-07-26.md
/**
 * @varve/platform — in-memory Platform implementation.
 *
 * The reference implementation: every other backend must behave identically
 * to this one. Used directly by Vitest (no IndexedDB shim required) and as a
 * read-only demo/SSR fallback. All mutations are atomic and ordered by the
 * caller's await chain; reads observe the latest writes.
 *
 * Research basis: Local-First §3 (the app must work fully offline with no
 * account) — a memory backend preserves that contract for ephemeral contexts.
 */

import { searchAssets as rankAssets } from './assetSearch';
import type { Platform } from './platform';
import { contentHash, contentHashOf, defaultViewState, uuid } from './pure';
import type { ContentSearchMatch } from './searchIndex';
import { indexDocumentContent, searchContentIndex } from './searchIndex';
import type {
  ActivityEvent,
  Asset,
  AssetFolder,
  Branch,
  Collection,
  CollectionEntry,
  CreateVersionInput,
  FileEntry,
  FileTag,
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
import { MAX_RECENT_FILES, RECENT_FILE_SCHEMA_VERSION } from './types';

interface MemoryState {
  files: Map<string, { entry: FileEntry; json: string }>;
  projects: Map<string, Project>;
  thumbnails: Map<string, ThumbnailRecord>;
  view: HomeViewState;
  recentFiles: Map<string, RecentFileRecord>;
  folders: Map<string, Folder>;
  collections: Map<string, Collection>;
  collectionEntries: Map<string, CollectionEntry[]>;
  workspaces: Map<string, Workspace>;
  libraries: Map<string, Library>;
  templates: Map<string, TemplateLibrary>;
  projectTemplates: Map<string, ProjectTemplate>;
  assets: Map<string, Asset>;
  assetBytes: Map<string, Uint8Array>;
  assetFolders: Map<string, AssetFolder>;
  versions: Map<string, VersionEntry[]>;
  /** Content-addressed document store: hash → JSON string (dedup across versions). */
  versionContent: Map<string, string>;
  branches: Map<string, Branch[]>;
  permissions: Map<string, Permission[]>;
  activity: ActivityEvent[];
  tags: Map<string, Tag>;
  fileTags: Map<string, FileTag[]>;
  savedSearches: Map<string, SavedSearch>;
  /** Separate maps for associations not on the entity types. */
  fileFolderIds: Map<string, string | null>;
  assetFolderIds: Map<string, string | null>;
  projectWorkspaceIds: Map<string, string>;
  /** Cached content search index per file id to avoid re-indexing. */
  contentIndexCache: Map<string, Map<string, ContentSearchMatch>>;
  appSettings: Map<string, string>;
}

function freshState(): MemoryState {
  return {
    files: new Map(),
    projects: new Map(),
    thumbnails: new Map(),
    view: defaultViewState(),
    recentFiles: new Map(),
    folders: new Map(),
    collections: new Map(),
    collectionEntries: new Map(),
    workspaces: new Map(),
    libraries: new Map(),
    templates: new Map(),
    projectTemplates: new Map(),
    assets: new Map(),
    assetBytes: new Map(),
    assetFolders: new Map(),
    versions: new Map(),
    versionContent: new Map(),
    branches: new Map(),
    permissions: new Map(),
    activity: [],
    tags: new Map(),
    fileTags: new Map(),
    savedSearches: new Map(),
    fileFolderIds: new Map(),
    assetFolderIds: new Map(),
    projectWorkspaceIds: new Map(),
    contentIndexCache: new Map(),
    appSettings: new Map(),
  };
}

export interface MemoryPlatformOptions {
  /** Seed files/projects for demos/tests. */
  files?: Array<{ entry: FileEntry; json: string }>;
  projects?: Project[];
  folders?: Folder[];
  collections?: Collection[];
  workspaces?: Workspace[];
  libraries?: Library[];
  templates?: TemplateLibrary[];
  projectTemplates?: ProjectTemplate[];
  assets?: Asset[];
  assetFolders?: AssetFolder[];
  /** Initial view state (merged over defaults). */
  view?: Partial<HomeViewState>;
}

export function createMemoryPlatform(options: MemoryPlatformOptions = {}): Platform {
  const state: MemoryState = freshState();
  for (const f of options.files ?? []) state.files.set(f.entry.id, f);
  for (const p of options.projects ?? []) state.projects.set(p.id, p);
  for (const f of options.folders ?? []) state.folders.set(f.id, f);
  for (const c of options.collections ?? []) state.collections.set(c.id, c);
  for (const w of options.workspaces ?? []) state.workspaces.set(w.id, w);
  for (const l of options.libraries ?? []) state.libraries.set(l.id, l);
  for (const t of options.templates ?? []) state.templates.set(t.id, t);
  for (const t of options.projectTemplates ?? []) state.projectTemplates.set(t.id, t);
  for (const a of options.assets ?? []) state.assets.set(a.id, a);
  for (const f of options.assetFolders ?? []) state.assetFolders.set(f.id, f);
  if (options.view) {
    state.view = {
      ...state.view,
      ...options.view,
      sort: { ...state.view.sort, ...(options.view.sort ?? {}) },
      filter: { ...state.view.filter, ...(options.view.filter ?? {}) },
    };
  }

  // Auto-create a "Personal" workspace if none exist
  if (state.workspaces.size === 0) {
    const now = Date.now();
    const personal: Workspace = {
      id: uuid(),
      name: 'Personal',
      kind: 'personal',
      createdAt: now,
      updatedAt: now,
    };
    state.workspaces.set(personal.id, personal);
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
      state.contentIndexCache.delete(entry.id);
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
    async setFavorited(id, favoritedAt) {
      const rec = state.files.get(id);
      if (!rec) return;
      rec.entry = { ...rec.entry, favoritedAt: favoritedAt ?? undefined };
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
      const rec = state.files.get(id);
      if (rec?.entry.contentHash) {
        state.thumbnails.delete(rec.entry.contentHash);
      }
      state.files.delete(id);
    },

    // ─── Recent Files ───────────────────────────────────────────────────────
    async listRecentFiles() {
      const records = [...state.recentFiles.values()].sort(
        (a, b) => b.lastOpenedAt - a.lastOpenedAt,
      );
      return records;
    },
    async touchRecentFile(id, name, sourceWorkspaceId, contentHash) {
      const existing = state.recentFiles.get(id);
      const now = Date.now();
      const record: RecentFileRecord = existing
        ? {
            ...existing,
            name,
            lastOpenedAt: now,
            openedCount: existing.openedCount + 1,
            sourceWorkspaceId: sourceWorkspaceId ?? existing.sourceWorkspaceId,
            contentHash: contentHash ?? existing.contentHash,
            version: RECENT_FILE_SCHEMA_VERSION,
          }
        : {
            id,
            name,
            lastOpenedAt: now,
            openedCount: 1,
            pinned: false,
            hidden: false,
            workspaceRelevance: [],
            userWorkspaceTag: null,
            encrypted: false,
            missing: false,
            version: RECENT_FILE_SCHEMA_VERSION,
            sourceWorkspaceId,
            contentHash,
          };
      state.recentFiles.set(id, record);

      // Enforce maximum
      const ids = [...state.recentFiles.keys()];
      if (ids.length > MAX_RECENT_FILES) {
        const sorted = ids
          .map((k) => ({ id: k, record: state.recentFiles.get(k)! }))
          .sort((a, b) => a.record.lastOpenedAt - b.record.lastOpenedAt);
        const toRemove = sorted.slice(0, sorted.length - MAX_RECENT_FILES);
        for (const { id: rid } of toRemove) {
          state.recentFiles.delete(rid);
        }
      }

      return record;
    },
    async patchRecentFile(id, patch) {
      const existing = state.recentFiles.get(id);
      if (!existing) return;
      state.recentFiles.set(id, { ...existing, ...patch });
    },
    async removeRecentFile(id) {
      state.recentFiles.delete(id);
    },
    async clearRecentHistory() {
      state.recentFiles.clear();
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
    async checkFilesExist(paths) {
      return paths.map(() => true);
    },

    async getThumbnail(hash) {
      return state.thumbnails.get(hash)?.dataUrl;
    },
    async setThumbnailPreference(fileId, preference) {
      const rec = state.files.get(fileId);
      if (!rec) return;
      rec.entry = { ...rec.entry, thumbnailPreference: preference };
    },
    async putThumbnail(record) {
      state.thumbnails.set(record.hash, record);
    },
    async deleteThumbnail(hash) {
      state.thumbnails.delete(hash);
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

    async getAppSetting(key) {
      return state.appSettings.get(key) ?? null;
    },
    async setAppSetting(key, value) {
      state.appSettings.set(key, value);
    },

    // ─── Phase 1: Drafts ─────────────────────────────────────────────────
    async listDrafts() {
      return [...state.files.values()]
        .map((r) => r.entry)
        .filter((e) => e.projectId === '__drafts__' && e.trashedAt === null);
    },
    async moveFileToDrafts(id) {
      const rec = state.files.get(id);
      if (!rec) return;
      rec.entry = { ...rec.entry, projectId: '__drafts__', updatedAt: Date.now() };
    },
    async promoteFromDrafts(id, projectId) {
      const rec = state.files.get(id);
      if (!rec) return;
      rec.entry = { ...rec.entry, projectId, updatedAt: Date.now() };
    },

    // ─── Phase 2: Folders ────────────────────────────────────────────────
    async listFolders(projectId) {
      return [...state.folders.values()].filter((f) => f.projectId === projectId);
    },
    async createFolder(projectId, name, parentId) {
      const now = Date.now();
      const folder: Folder = {
        id: uuid(),
        name,
        projectId,
        parentId: parentId ?? null,
        createdAt: now,
        updatedAt: now,
        ordering: '',
      };
      state.folders.set(folder.id, folder);
      return folder;
    },
    async renameFolder(id, name) {
      const f = state.folders.get(id);
      if (!f) return;
      state.folders.set(id, { ...f, name, updatedAt: Date.now() });
    },
    async deleteFolder(id) {
      state.folders.delete(id);
    },
    async moveFileToFolder(fileId, folderId) {
      state.fileFolderIds.set(fileId, folderId);
    },
    async reorderFolder(id, ordering) {
      const f = state.folders.get(id);
      if (!f) return;
      state.folders.set(id, { ...f, ordering, updatedAt: Date.now() });
    },

    // ─── Phase 2: Collections ────────────────────────────────────────────
    async listCollections() {
      return [...state.collections.values()];
    },
    async createCollection(name, opts) {
      const now = Date.now();
      const collection: Collection = {
        id: uuid(),
        name,
        createdAt: now,
        updatedAt: now,
        ordering: '',
        ...opts,
      };
      state.collections.set(collection.id, collection);
      return collection;
    },
    async updateCollection(id, patch) {
      const c = state.collections.get(id);
      if (!c) return;
      state.collections.set(id, { ...c, ...patch, updatedAt: Date.now() });
    },
    async deleteCollection(id) {
      state.collections.delete(id);
      state.collectionEntries.delete(id);
    },
    async addFileToCollection(collectionId, fileId) {
      const existing = state.collectionEntries.get(collectionId) ?? [];
      if (existing.some((ce) => ce.fileId === fileId)) return;
      existing.push({ id: uuid(), collectionId, fileId, addedAt: Date.now() });
      state.collectionEntries.set(collectionId, existing);
    },
    async removeFileFromCollection(collectionId, fileId) {
      const existing = state.collectionEntries.get(collectionId);
      if (!existing) return;
      state.collectionEntries.set(
        collectionId,
        existing.filter((ce) => ce.fileId !== fileId),
      );
    },
    async listCollectionFiles(collectionId) {
      const entries = state.collectionEntries.get(collectionId);
      if (!entries) return [];
      const fileIds = new Set(entries.map((ce) => ce.fileId));
      return [...state.files.values()]
        .map((r) => r.entry)
        .filter((e) => fileIds.has(e.id) && e.trashedAt === null);
    },
    async reorderCollection(id, ordering) {
      const c = state.collections.get(id);
      if (!c) return;
      state.collections.set(id, { ...c, ordering, updatedAt: Date.now() });
    },

    // ─── Phase 3: Workspaces ─────────────────────────────────────────────
    async listWorkspaces() {
      return [...state.workspaces.values()];
    },
    async createWorkspace(name, kind) {
      const now = Date.now();
      const workspace: Workspace = {
        id: uuid(),
        name,
        kind: kind ?? 'personal',
        createdAt: now,
        updatedAt: now,
      };
      state.workspaces.set(workspace.id, workspace);
      return workspace;
    },
    async renameWorkspace(id, name) {
      const w = state.workspaces.get(id);
      if (!w) return;
      state.workspaces.set(id, { ...w, name, updatedAt: Date.now() });
    },
    async deleteWorkspace(id) {
      state.workspaces.delete(id);
    },
    async moveProjectToWorkspace(projectId, workspaceId) {
      state.projectWorkspaceIds.set(projectId, workspaceId);
      const p = state.projects.get(projectId);
      if (p) {
        state.projects.set(projectId, { ...p, workspaceId, updatedAt: Date.now() });
      }
    },

    // ─── Phase 3: Libraries ──────────────────────────────────────────────
    async listLibraries(workspaceId) {
      return [...state.libraries.values()].filter((l) => l.workspaceId === workspaceId);
    },
    async createLibrary(workspaceId, name, kind) {
      const now = Date.now();
      const library: Library = {
        id: uuid(),
        workspaceId,
        name,
        kind: kind ?? 'components',
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };
      state.libraries.set(library.id, library);
      return library;
    },
    async enableLibrary(id, enabled) {
      const l = state.libraries.get(id);
      if (!l) return;
      state.libraries.set(id, { ...l, enabled, updatedAt: Date.now() });
    },
    async deleteLibrary(id) {
      state.libraries.delete(id);
    },

    // ─── Phase 4: Content-Aware Search ──────────────────────────────────
    async searchFileContent(fileId, query) {
      const rec = state.files.get(fileId);
      if (!rec || !query.trim()) return [];
      let index = state.contentIndexCache.get(fileId);
      if (!index) {
        index = indexDocumentContent(fileId, rec.json);
        state.contentIndexCache.set(fileId, index);
      }
      const results = searchContentIndex(index, query);
      return results.map((r) => JSON.stringify(r));
    },

    // ─── Phase 5: Templates ──────────────────────────────────────────────
    async listTemplates(source) {
      const all = [...state.templates.values()];
      if (!source || source.length === 0) return all;
      return all.filter((t) => source.includes(t.source));
    },
    async createTemplateFromFile(fileId, name, category) {
      const rec = state.files.get(fileId);
      const now = Date.now();
      const template: TemplateLibrary = {
        id: uuid(),
        name,
        description: '',
        category,
        previewHash: rec?.entry.contentHash ?? '00000000',
        source: 'user',
        documentJson: rec?.json ?? '',
        tags: [],
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      state.templates.set(template.id, template);
      return template;
    },
    async deleteTemplate(id) {
      state.templates.delete(id);
    },
    async searchTemplates(query) {
      if (!query.trim()) return [...state.templates.values()];
      const q = query.toLowerCase();
      return [...state.templates.values()].filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q),
      );
    },
    async listProjectTemplates() {
      return [...state.projectTemplates.values()];
    },
    async createProjectFromTemplate(templateId, name) {
      const template = state.projectTemplates.get(templateId);
      if (!template) return;
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
    },

    // ─── Phase 6: Assets ──────────────────────────────────────────────────
    async listAssets(workspaceId, folderId) {
      return [...state.assets.values()].filter((a) => {
        if (a.workspaceId !== workspaceId) return false;
        if (folderId !== undefined && state.assetFolderIds.get(a.id) !== folderId) return false;
        return true;
      });
    },
    async importAsset(workspaceId, name, data, mimeType) {
      const now = Date.now();
      const asset: Asset = {
        id: uuid(),
        workspaceId,
        name,
        kind: 'other',
        mimeType,
        size: data.length,
        contentHash: (await contentHashOf(data)) ?? undefined,
        tags: [],
        createdAt: now,
        updatedAt: now,
      };
      state.assets.set(asset.id, asset);
      if (data.length > 0) state.assetBytes.set(asset.id, data);
      return asset;
    },
    async deleteAsset(id) {
      state.assets.delete(id);
      state.assetBytes.delete(id);
    },
    async getAssetBytes(id) {
      return state.assetBytes.get(id) ?? null;
    },
    async searchAssets(query) {
      return rankAssets([...state.assets.values()], query).map((result) => result.asset);
    },
    async createAssetFolder(workspaceId, name, parentId) {
      const now = Date.now();
      const folder: AssetFolder = {
        id: uuid(),
        workspaceId,
        name,
        parentId: parentId ?? null,
        createdAt: now,
      };
      state.assetFolders.set(folder.id, folder);
      return folder;
    },
    async deleteAssetFolder(id) {
      state.assetFolders.delete(id);
    },

    // ─── Phase 7: Version History ─────────────────────────────────────────
    async listVersions(fileId) {
      return [...(state.versions.get(fileId) ?? [])];
    },
    async saveVersion(fileId, name, description) {
      const rec = state.files.get(fileId);
      const now = Date.now();
      const version: VersionEntry = {
        id: uuid(),
        fileId,
        name,
        description,
        documentHash: rec?.entry.contentHash ?? '00000000',
        timestamp: now,
        kind: name ? 'named' : 'checkpoint',
        origin: 'manual',
        size: rec?.entry.size ?? 0,
        pinned: false,
      };
      const list = state.versions.get(fileId) ?? [];
      list.push(version);
      state.versions.set(fileId, list);
      return version;
    },
    async restoreVersion(fileId, versionId) {
      const list = state.versions.get(fileId);
      if (!list) return '';
      const version = list.find((v) => v.id === versionId);
      return version?.documentHash ?? '';
    },
    async deleteVersionInfo(versionId) {
      for (const [fileId, list] of state.versions) {
        const filtered = list.filter((v) => v.id !== versionId);
        if (filtered.length !== list.length) {
          state.versions.set(fileId, filtered);
          return;
        }
      }
    },
    async createVersion(input: CreateVersionInput): Promise<VersionEntry> {
      if (!state.versionContent.has(input.contentHash)) {
        state.versionContent.set(input.contentHash, input.documentJson);
      }
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
      const list = state.versions.get(input.fileId) ?? [];
      list.push(entry);
      state.versions.set(input.fileId, list);
      return entry;
    },
    async restoreVersionById(versionId: string): Promise<string> {
      for (const list of state.versions.values()) {
        const version = list.find((v) => v.id === versionId);
        if (version) {
          return state.versionContent.get(version.documentHash) ?? '';
        }
      }
      return '';
    },
    async renameVersion(versionId: string, name?: string, description?: string): Promise<void> {
      for (const list of state.versions.values()) {
        const version = list.find((v) => v.id === versionId);
        if (version) {
          version.name = name;
          version.description = description;
          return;
        }
      }
    },
    async updateVersionThumbnail(versionId: string, thumbnail: string | undefined): Promise<void> {
      for (const list of state.versions.values()) {
        const version = list.find((v) => v.id === versionId);
        if (version) {
          version.thumbnail = thumbnail;
          return;
        }
      }
    },
    async pinVersion(versionId: string, pinned: boolean): Promise<void> {
      for (const list of state.versions.values()) {
        const version = list.find((v) => v.id === versionId);
        if (version) {
          version.pinned = pinned;
          return;
        }
      }
    },
    async pruneVersions(fileId: string, maxAuto: number): Promise<number> {
      const list = state.versions.get(fileId);
      if (!list) return 0;
      const keep = list.filter((v) => v.kind === 'named' || v.pinned);
      const prunable = list
        .filter((v) => v.kind !== 'named' && !v.pinned)
        .sort((a, b) => b.timestamp - a.timestamp);
      const keepAuto = prunable.slice(0, maxAuto);
      const remove = prunable.slice(maxAuto);
      const next = [...keep, ...keepAuto].sort((a, b) => b.timestamp - a.timestamp);
      state.versions.set(fileId, next);
      const referenced = new Set<string>();
      for (const l of state.versions.values()) {
        for (const v of l) referenced.add(v.documentHash);
      }
      for (const hash of state.versionContent.keys()) {
        if (!referenced.has(hash)) state.versionContent.delete(hash);
      }
      return remove.length;
    },
    async getVersionStats(fileId: string): Promise<VersionStats> {
      const list = state.versions.get(fileId) ?? [];
      const content = state.versionContent;
      return {
        totalVersions: list.length,
        namedVersions: list.filter((v) => v.kind === 'named').length,
        totalBytes: [...content.values()].reduce(
          (sum, json) => sum + new TextEncoder().encode(json).length,
          0,
        ),
      };
    },
    async listBranches(fileId) {
      return [...(state.branches.get(fileId) ?? [])];
    },
    async createBranch(fileId, name, baseVersionId) {
      const now = Date.now();
      const branch: Branch = {
        id: uuid(),
        name,
        fileId,
        baseVersionId,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      };
      const list = state.branches.get(fileId) ?? [];
      list.push(branch);
      state.branches.set(fileId, list);
      return branch;
    },

    // ─── Phase 8: Collaboration Foundation ────────────────────────────────
    async listPermissions(fileId) {
      return [...(state.permissions.get(fileId) ?? [])];
    },
    async setPermission(fileId, role, email) {
      const list = state.permissions.get(fileId) ?? [];
      list.push({ fileId, role, email, grantedAt: Date.now() });
      state.permissions.set(fileId, list);
    },
    async listActivity(workspaceId, limit) {
      const filtered = state.activity.filter((e) => e.workspaceId === workspaceId);
      const sorted = filtered.sort((a, b) => b.timestamp - a.timestamp);
      return limit ? sorted.slice(0, limit) : sorted;
    },
    async recordActivity(event) {
      const activityEvent: ActivityEvent = {
        ...event,
        id: uuid(),
        timestamp: Date.now(),
      };
      state.activity.push(activityEvent);
    },

    // ─── Phase 9: Tags & Metadata ─────────────────────────────────────────
    async listTags(workspaceId) {
      return [...state.tags.values()].filter((t) => t.workspaceId === workspaceId);
    },
    async createTag(workspaceId, name, color) {
      const now = Date.now();
      const tag: Tag = {
        id: uuid(),
        workspaceId,
        name,
        color,
        createdAt: now,
        updatedAt: now,
      };
      state.tags.set(tag.id, tag);
      return tag;
    },
    async renameTag(id, name) {
      const t = state.tags.get(id);
      if (!t) return;
      state.tags.set(id, { ...t, name, updatedAt: Date.now() });
    },
    async deleteTag(id) {
      state.tags.delete(id);
      for (const [fileId, tags] of state.fileTags) {
        state.fileTags.set(
          fileId,
          tags.filter((ft) => ft.tagId !== id),
        );
      }
    },
    async listFileTags(fileId) {
      const tags = state.fileTags.get(fileId) ?? [];
      return tags.map((ft) => state.tags.get(ft.tagId)).filter((t): t is Tag => t !== undefined);
    },
    async addFileTag(fileId, tagId) {
      const existing = state.fileTags.get(fileId) ?? [];
      if (existing.some((ft) => ft.tagId === tagId)) return;
      existing.push({ fileId, tagId, addedAt: Date.now() });
      state.fileTags.set(fileId, existing);
    },
    async removeFileTag(fileId, tagId) {
      const existing = state.fileTags.get(fileId);
      if (!existing) return;
      state.fileTags.set(
        fileId,
        existing.filter((ft) => ft.tagId !== tagId),
      );
    },
    async listFilesByTag(tagId) {
      const fileIds = new Set(
        [...state.fileTags.values()]
          .flat()
          .filter((ft) => ft.tagId === tagId)
          .map((ft) => ft.fileId),
      );
      return [...state.files.values()]
        .map((r) => r.entry)
        .filter((e) => fileIds.has(e.id) && e.trashedAt === null);
    },

    // ─── Phase 9: Saved Searches ──────────────────────────────────────────
    async listSavedSearches() {
      return [...state.savedSearches.values()];
    },
    async createSavedSearch(name, query, kinds, tagIds) {
      const now = Date.now();
      const search: SavedSearch = {
        id: uuid(),
        name,
        query,
        kinds: kinds as SavedSearch['kinds'],
        tagIds,
        createdAt: now,
        updatedAt: now,
      };
      state.savedSearches.set(search.id, search);
      return search;
    },
    async deleteSavedSearch(id) {
      state.savedSearches.delete(id);
    },

    // No native dialogs in memory mode — these intentionally return null/empty
    // so the UI's "no-op" affordances (disabled Reveal, cancelled picker)
    // exercise correctly in tests and the demo build.
    async openDocumentFromDisk() {
      return null;
    },
    /** In-memory mode has no OS paths to open. */
    async openDocumentFromPath() {
      return null;
    },
    async importDocumentFromDisk() {
      return { result: null, unsupported: false };
    },
    async saveDocumentToDisk() {
      return null;
    },
    async writeDocumentToPath() {
      return null;
    },
    async chooseDocumentSaveTarget() {
      // No native dialogs in memory mode — the "choose" affordance is
      // unsupported, which is distinct from a user cancellation.
      return { kind: 'unsupported' };
    },
    async writeSaveTarget() {
      return {
        kind: 'failed',
        error: { category: 'unsupported', message: 'In-memory platform cannot write files.' },
      };
    },
    async readDocumentText() {
      return { ok: false, reason: 'unsupported' };
    },
    async listPrinters() {
      return [
        {
          name: 'Mock Printer',
          description: 'In-memory mock printer for testing',
          isColor: true,
          paperSizes: ['A4', 'Letter'],
          supportsDuplex: true,
          acceptingJobs: true,
        },
      ];
    },
    async printPdf(_data, _jobTitle, _options) {
      return { jobId: 1, message: 'Mock print job submitted (memory platform)', success: true };
    },
    async cancelPrintJob(_printerName, _jobId) {
      return 'Mock print job cancelled (memory platform)';
    },

    async saveBinaryFile(name) {
      return `memory://${name}`;
    },
    async chooseExportFolder() {
      return 'memory://exports';
    },
    async writeBinaryFileToFolder(folder, relativePath) {
      return `${folder.replace(/\/$/, '')}/${relativePath}`;
    },
    async onNativeFileDrop() {
      return () => {};
    },
    async readFileBytes(path) {
      const record = [...state.files.values()].find(
        ({ entry }) => entry.id === path || entry.filePath === path,
      );
      if (!record) throw new Error(`Memory file not found: ${path}`);
      return new TextEncoder().encode(record.json);
    },
    async readClipboardImage() {
      return null;
    },
    async revealInFileManager() {
      // No-op in memory/web.
    },
    fileManagerLabel() {
      return 'Reveal in Files';
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
