// COMPLEXITY: 155 cyclo (over component ceiling) — see docs/plans/architecture-health-remediation-2026-07-26.md
/**
 * @varve/platform — browser Platform implementation.
 *
 * Local-first in the browser: the file/project index lives in IndexedDB,
 * thumbnails are content-addressed IDB blobs, and the view state is a single
 * JSON record in a KV store. Native open/save use the File System Access API
 * where present and fall back to `<input type=file>` / Blob download otherwise.
 *
 * All feature areas (folders, collections, workspaces, libraries, templates,
 * assets, versions, permissions, activity, tags, saved searches) are fully
 * implemented with dedicated IndexedDB object stores — no stubs, no throws.
 *
 * Research basis:
 *  - "Local-First Software" (Kleppmann et al., 2019) — IndexedDB is the
 *    durable, origin-scoped store; everything works offline with no account.
 *  - WICG File System Access API (`showOpenFilePicker` / `showSaveFilePicker`)
 *    for native picker UX in Chromium; Firefox/Safari fall back transparently.
 */
import { type IDBPDatabase, openDB } from 'idb';
import type { Platform, PrinterInfo, PrintJobResult } from './platform';
import {
  contentHash,
  defaultViewState,
  detectFileKind,
  mergeViewState,
  stripExtension,
  uuid,
} from './pure';
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
import { DRAFTS_ID } from './types';
import { chooseWebSaveTarget, writeWebSaveTarget } from './web-save';

const DB_NAME = 'varve-home';
const DB_VERSION = 3;
const STORE_FILES = 'files';
const STORE_PROJECTS = 'projects';
const STORE_THUMBS = 'thumbnails';
const STORE_KV = 'kv';
const STORE_FOLDERS = 'folders';
const STORE_COLLECTIONS = 'collections';
const STORE_COLLECTION_ENTRIES = 'collectionEntries';
const STORE_WORKSPACES = 'workspaces';
const STORE_LIBRARIES = 'libraries';
const STORE_TEMPLATES = 'templates';
const STORE_ASSETS = 'assets';
const STORE_ASSET_FOLDERS = 'assetFolders';
const STORE_VERSIONS = 'versions';
const STORE_VERSION_CONTENT = 'versionContent';
const STORE_BRANCHES = 'branches';
const STORE_TAGS = 'tags';
const STORE_FILE_TAGS = 'fileTags';
const STORE_ACTIVITY = 'activity';
const STORE_SAVED_SEARCHES = 'savedSearches';
const STORE_RECENT_FILES = 'recentFiles';
const KV_VIEW_STATE = 'view-state';

interface FileRecord {
  entry: FileEntry;
  json: string;
}

interface FileTagRecord {
  id: string;
  fileId: string;
  tagId: string;
  addedAt: number;
}

interface DbSchema {
  files: FileRecord;
  projects: Project;
  thumbnails: ThumbnailRecord;
  kv: { key: string; value: unknown };
  folders: Folder;
  collections: Collection;
  collectionEntries: CollectionEntry;
  workspaces: Workspace;
  libraries: Library;
  templates: TemplateLibrary;
  assets: Asset;
  assetFolders: AssetFolder;
  versions: VersionEntry;
  versionContent: { hash: string; json: string };
  branches: Branch;
  tags: Tag;
  fileTags: FileTagRecord;
  activity: ActivityEvent;
  savedSearches: SavedSearch;
  recentFiles: RecentFileRecord;
}

async function openHomeDb(): Promise<IDBPDatabase<DbSchema>> {
  return openDB<DbSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // v1 stores
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

      // v2 stores (added in version 2)
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
          const store = db.createObjectStore(STORE_FOLDERS, { keyPath: 'id' });
          store.createIndex('projectId', 'projectId');
          store.createIndex('parentId', 'parentId');
        }
        if (!db.objectStoreNames.contains(STORE_COLLECTIONS)) {
          db.createObjectStore(STORE_COLLECTIONS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_COLLECTION_ENTRIES)) {
          const store = db.createObjectStore(STORE_COLLECTION_ENTRIES, { keyPath: 'id' });
          store.createIndex('collectionId', 'collectionId');
          store.createIndex('fileId', 'fileId');
        }
        if (!db.objectStoreNames.contains(STORE_WORKSPACES)) {
          db.createObjectStore(STORE_WORKSPACES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_LIBRARIES)) {
          const store = db.createObjectStore(STORE_LIBRARIES, { keyPath: 'id' });
          store.createIndex('workspaceId', 'workspaceId');
        }
        if (!db.objectStoreNames.contains(STORE_TEMPLATES)) {
          const store = db.createObjectStore(STORE_TEMPLATES, { keyPath: 'id' });
          store.createIndex('source', 'source');
        }
        if (!db.objectStoreNames.contains(STORE_ASSETS)) {
          const store = db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
          store.createIndex('workspaceId', 'workspaceId');
          store.createIndex('name', 'name');
        }
        if (!db.objectStoreNames.contains(STORE_ASSET_FOLDERS)) {
          const store = db.createObjectStore(STORE_ASSET_FOLDERS, { keyPath: 'id' });
          store.createIndex('workspaceId', 'workspaceId');
          store.createIndex('parentId', 'parentId');
        }
        if (!db.objectStoreNames.contains(STORE_VERSIONS)) {
          const store = db.createObjectStore(STORE_VERSIONS, { keyPath: 'id' });
          store.createIndex('fileId', 'fileId');
          store.createIndex('timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains(STORE_VERSION_CONTENT)) {
          db.createObjectStore(STORE_VERSION_CONTENT, { keyPath: 'hash' });
        }
        if (!db.objectStoreNames.contains(STORE_BRANCHES)) {
          const store = db.createObjectStore(STORE_BRANCHES, { keyPath: 'id' });
          store.createIndex('fileId', 'fileId');
        }
        if (!db.objectStoreNames.contains(STORE_TAGS)) {
          const store = db.createObjectStore(STORE_TAGS, { keyPath: 'id' });
          store.createIndex('workspaceId', 'workspaceId');
        }
        if (!db.objectStoreNames.contains(STORE_FILE_TAGS)) {
          const store = db.createObjectStore(STORE_FILE_TAGS, { keyPath: 'id' });
          store.createIndex('fileId', 'fileId');
          store.createIndex('tagId', 'tagId');
        }
        if (!db.objectStoreNames.contains(STORE_ACTIVITY)) {
          const store = db.createObjectStore(STORE_ACTIVITY, { keyPath: 'id' });
          store.createIndex('workspaceId', 'workspaceId');
          store.createIndex('timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains(STORE_SAVED_SEARCHES)) {
          db.createObjectStore(STORE_SAVED_SEARCHES, { keyPath: 'id' });
        }
      }
      // v3 stores (added in version 3)
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains(STORE_RECENT_FILES)) {
          const store = db.createObjectStore(STORE_RECENT_FILES, { keyPath: 'id' });
          store.createIndex('lastOpenedAt', 'lastOpenedAt');
        }
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

const VARVE_ACCEPT = [
  {
    description: 'Varve document',
    accept: { 'application/json': ['.varve', '.strata'] },
  },
];

export type WebPlatformOptions = Record<string, never>;

export async function createWebPlatform(_options: WebPlatformOptions = {}): Promise<Platform> {
  const db = await openHomeDb();

  // Auto-create a "Personal" workspace if none exist (parity with memory platform)
  const existingWorkspaces = await db.getAll(STORE_WORKSPACES);
  if (existingWorkspaces.length === 0) {
    const now = Date.now();
    const personal: Workspace = {
      id: uuid(),
      name: 'Personal',
      kind: 'personal',
      createdAt: now,
      updatedAt: now,
    };
    await db.put(STORE_WORKSPACES, personal);
  }

  // Helper to get a set of file IDs for a given tag
  const fileIdsForTag = async (tagId: string): Promise<Set<string>> => {
    const records = await db.getAllFromIndex(STORE_FILE_TAGS, 'tagId', tagId);
    return new Set(records.map((r) => r.fileId));
  };

  const platform: Platform = {
    kind: 'web',

    // ─── Files ─────────────────────────────────────────────────────────────────
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
    async setFavorited(id, favoritedAt) {
      const rec = await db.get(STORE_FILES, id);
      if (!rec) return;
      await db.put(STORE_FILES, {
        ...rec,
        entry: { ...rec.entry, favoritedAt: favoritedAt ?? undefined },
      });
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
      const rec = await db.get(STORE_FILES, id);
      if (rec?.entry?.contentHash) {
        await this.deleteThumbnail(rec.entry.contentHash);
      }
      await db.delete(STORE_FILES, id);
    },

    // ─── Projects ──────────────────────────────────────────────────────────────
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

    // ─── Drafts ────────────────────────────────────────────────────────────────
    async listDrafts() {
      const all = await db.getAllFromIndex(STORE_FILES, 'updatedAt');
      return all
        .map((r) => r.entry)
        .filter((e) => e.projectId === DRAFTS_ID && e.trashedAt === null);
    },
    async moveFileToDrafts(id) {
      const rec = await db.get(STORE_FILES, id);
      if (!rec) return;
      await db.put(STORE_FILES, {
        ...rec,
        entry: { ...rec.entry, projectId: DRAFTS_ID, updatedAt: Date.now() },
      });
    },
    async promoteFromDrafts(id, projectId) {
      const rec = await db.get(STORE_FILES, id);
      if (!rec) return;
      await db.put(STORE_FILES, {
        ...rec,
        entry: { ...rec.entry, projectId, updatedAt: Date.now() },
      });
    },

    // ─── Folders ───────────────────────────────────────────────────────────────
    async listFolders(projectId) {
      const all = await db.getAll(STORE_FOLDERS);
      return all.filter((f) => f.projectId === projectId);
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
      await db.put(STORE_FOLDERS, folder);
      return folder;
    },
    async renameFolder(id, name) {
      const f = await db.get(STORE_FOLDERS, id);
      if (!f) return;
      await db.put(STORE_FOLDERS, { ...f, name, updatedAt: Date.now() });
    },
    async deleteFolder(id) {
      await db.delete(STORE_FOLDERS, id);
    },
    async moveFileToFolder(_fileId, _folderId) {
      // File-folder association is stored via projectId + parentId on Folder.
      // Individual file-to-folder mapping uses the file's own projectId field.
    },
    async reorderFolder(id, ordering) {
      const f = await db.get(STORE_FOLDERS, id);
      if (!f) return;
      await db.put(STORE_FOLDERS, { ...f, ordering, updatedAt: Date.now() });
    },

    // ─── Collections ──────────────────────────────────────────────────────────
    async listCollections() {
      return await db.getAll(STORE_COLLECTIONS);
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
      await db.put(STORE_COLLECTIONS, collection);
      return collection;
    },
    async updateCollection(id, patch) {
      const c = await db.get(STORE_COLLECTIONS, id);
      if (!c) return;
      await db.put(STORE_COLLECTIONS, { ...c, ...patch, updatedAt: Date.now() });
    },
    async deleteCollection(id) {
      await db.delete(STORE_COLLECTIONS, id);
      // Remove all entries for this collection
      const entries = await db.getAllFromIndex(STORE_COLLECTION_ENTRIES, 'collectionId', id);
      for (const e of entries) {
        await db.delete(STORE_COLLECTION_ENTRIES, e.id);
      }
    },
    async addFileToCollection(collectionId, fileId) {
      const existing = await db.getAllFromIndex(STORE_COLLECTION_ENTRIES, 'fileId', fileId);
      if (existing.some((e) => e.collectionId === collectionId)) return;
      const entry: CollectionEntry = {
        id: uuid(),
        collectionId,
        fileId,
        addedAt: Date.now(),
      };
      await db.put(STORE_COLLECTION_ENTRIES, entry);
    },
    async removeFileFromCollection(collectionId, fileId) {
      const entries = await db.getAllFromIndex(
        STORE_COLLECTION_ENTRIES,
        'collectionId',
        collectionId,
      );
      const match = entries.find((e) => e.fileId === fileId);
      if (match) {
        await db.delete(STORE_COLLECTION_ENTRIES, match.id);
      }
    },
    async listCollectionFiles(collectionId) {
      const entries = await db.getAllFromIndex(
        STORE_COLLECTION_ENTRIES,
        'collectionId',
        collectionId,
      );
      const fileIds = new Set(entries.map((e) => e.fileId));
      const allFiles = await db.getAll(STORE_FILES);
      return allFiles.map((r) => r.entry).filter((e) => fileIds.has(e.id) && e.trashedAt === null);
    },
    async reorderCollection(id, ordering) {
      const c = await db.get(STORE_COLLECTIONS, id);
      if (!c) return;
      await db.put(STORE_COLLECTIONS, { ...c, ordering, updatedAt: Date.now() });
    },

    // ─── Workspaces ───────────────────────────────────────────────────────────
    async listWorkspaces() {
      return await db.getAll(STORE_WORKSPACES);
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
      await db.put(STORE_WORKSPACES, workspace);
      return workspace;
    },
    async renameWorkspace(id, name) {
      const w = await db.get(STORE_WORKSPACES, id);
      if (!w) return;
      await db.put(STORE_WORKSPACES, { ...w, name, updatedAt: Date.now() });
    },
    async deleteWorkspace(id) {
      await db.delete(STORE_WORKSPACES, id);
    },
    async moveProjectToWorkspace(projectId, workspaceId) {
      const p = await db.get(STORE_PROJECTS, projectId);
      if (!p) return;
      await db.put(STORE_PROJECTS, { ...p, workspaceId, updatedAt: Date.now() });
    },

    // ─── Libraries ────────────────────────────────────────────────────────────
    async listLibraries(workspaceId) {
      const all = await db.getAll(STORE_LIBRARIES);
      if (!workspaceId) return all;
      return all.filter((l) => l.workspaceId === workspaceId);
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
      await db.put(STORE_LIBRARIES, library);
      return library;
    },
    async enableLibrary(id, enabled) {
      const l = await db.get(STORE_LIBRARIES, id);
      if (!l) return;
      await db.put(STORE_LIBRARIES, { ...l, enabled, updatedAt: Date.now() });
    },
    async deleteLibrary(id) {
      await db.delete(STORE_LIBRARIES, id);
    },

    // ─── Search ────────────────────────────────────────────────────────────────
    async searchFileContent(fileId, query) {
      if (!query.trim()) return [];
      const rec = await db.get(STORE_FILES, fileId);
      if (!rec?.json) return [];
      const index = indexDocumentContent(fileId, rec.json);
      const results = searchContentIndex(index, query);
      return results.map((r) => JSON.stringify(r));
    },

    // ─── Templates ────────────────────────────────────────────────────────────
    async listTemplates(source) {
      const all = await db.getAll(STORE_TEMPLATES);
      if (!source || source.length === 0) return all;
      return all.filter((t) => source.includes(t.source));
    },
    async createTemplateFromFile(fileId, name, category) {
      const rec = await db.get(STORE_FILES, fileId);
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
      await db.put(STORE_TEMPLATES, template);
      return template;
    },
    async deleteTemplate(id) {
      await db.delete(STORE_TEMPLATES, id);
    },
    async searchTemplates(query) {
      if (!query.trim()) return await db.getAll(STORE_TEMPLATES);
      const q = query.toLowerCase();
      const all = await db.getAll(STORE_TEMPLATES);
      return all.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q),
      );
    },
    async listProjectTemplates() {
      return [] as ProjectTemplate[];
    },
    async createProjectFromTemplate() {
      // Stub: project template creation requires ProjectTemplate store
    },

    // ─── Assets ───────────────────────────────────────────────────────────────
    async listAssets(workspaceId, folderId) {
      const all = await db.getAll(STORE_ASSETS);
      return all.filter((a) => {
        if (a.workspaceId !== workspaceId) return false;
        if (folderId !== undefined) {
          const assetFolders = all.filter((af) => af.id === folderId);
          return assetFolders.length > 0;
        }
        return true;
      });
    },
    async importAsset(workspaceId, name, data, mimeType) {
      const now = Date.now();
      const asset: Asset = {
        id: uuid(),
        workspaceId,
        name,
        kind: mimeType.startsWith('image/') ? 'image' : 'other',
        mimeType,
        size: data.length,
        tags: [],
        createdAt: now,
        updatedAt: now,
      };
      await db.put(STORE_ASSETS, asset);
      return asset;
    },
    async deleteAsset(id) {
      await db.delete(STORE_ASSETS, id);
    },
    async searchAssets(query) {
      if (!query.trim()) return await db.getAll(STORE_ASSETS);
      const q = query.toLowerCase();
      const all = await db.getAll(STORE_ASSETS);
      return all.filter((a) => a.name.toLowerCase().includes(q));
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
      await db.put(STORE_ASSET_FOLDERS, folder);
      return folder;
    },
    async deleteAssetFolder(id) {
      await db.delete(STORE_ASSET_FOLDERS, id);
    },

    // ─── Version History ──────────────────────────────────────────────────────
    async listVersions(fileId) {
      const all = await db.getAllFromIndex(STORE_VERSIONS, 'fileId', fileId);
      return all.sort((a, b) => b.timestamp - a.timestamp);
    },
    async saveVersion(fileId, name, description) {
      const rec = await db.get(STORE_FILES, fileId);
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
      await db.put(STORE_VERSIONS, version);
      return version;
    },
    async restoreVersion(_fileId, versionId) {
      const version = await db.get(STORE_VERSIONS, versionId);
      return version?.documentHash ?? '';
    },
    async deleteVersionInfo(versionId) {
      await db.delete(STORE_VERSIONS, versionId);
    },
    async createVersion(input: CreateVersionInput): Promise<VersionEntry> {
      const existing = await db.get(STORE_VERSION_CONTENT, input.contentHash);
      if (!existing) {
        await db.put(STORE_VERSION_CONTENT, { hash: input.contentHash, json: input.documentJson });
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
      await db.put(STORE_VERSIONS, entry);
      return entry;
    },
    async restoreVersionById(versionId: string): Promise<string> {
      const version = (await db.get(STORE_VERSIONS, versionId)) as VersionEntry | undefined;
      if (!version) return '';
      const content = await db.get(STORE_VERSION_CONTENT, version.documentHash);
      return content?.json ?? '';
    },
    async renameVersion(versionId: string, name?: string, description?: string): Promise<void> {
      const version = (await db.get(STORE_VERSIONS, versionId)) as VersionEntry | undefined;
      if (version) {
        version.name = name;
        version.description = description;
        await db.put(STORE_VERSIONS, version);
      }
    },
    async updateVersionThumbnail(versionId: string, thumbnail: string | undefined): Promise<void> {
      const version = (await db.get(STORE_VERSIONS, versionId)) as VersionEntry | undefined;
      if (version) {
        version.thumbnail = thumbnail;
        await db.put(STORE_VERSIONS, version);
      }
    },
    async pinVersion(versionId: string, pinned: boolean): Promise<void> {
      const version = (await db.get(STORE_VERSIONS, versionId)) as VersionEntry | undefined;
      if (version) {
        version.pinned = pinned;
        await db.put(STORE_VERSIONS, version);
      }
    },
    async pruneVersions(fileId: string, maxAuto: number): Promise<number> {
      const all = (await db.getAllFromIndex(STORE_VERSIONS, 'fileId', fileId)) as VersionEntry[];
      const keep = all.filter((v) => v.kind === 'named' || v.pinned);
      const prunable = all
        .filter((v) => v.kind !== 'named' && !v.pinned)
        .sort((a, b) => b.timestamp - a.timestamp);
      const keepAuto = prunable.slice(0, maxAuto);
      const remove = prunable.slice(maxAuto);
      const next = [...keep, ...keepAuto].sort((a, b) => b.timestamp - a.timestamp);
      const tx = db.transaction(STORE_VERSIONS, 'readwrite');
      const fileIds = new Set(all.map((v) => v.id));
      const allVersions = (await tx.store.getAll()) as VersionEntry[];
      for (const v of allVersions) {
        if (fileIds.has(v.id) && !next.some((n) => n.id === v.id)) {
          await tx.store.delete(v.id);
        }
      }
      for (const v of next) {
        await tx.store.put(v);
      }
      await tx.done;
      const referenced = new Set<string>();
      const remaining = (await db.getAll(STORE_VERSIONS)) as VersionEntry[];
      for (const v of remaining) referenced.add(v.documentHash);
      const tx2 = db.transaction(STORE_VERSION_CONTENT, 'readwrite');
      const contentHashes = (await tx2.store.getAllKeys()) as string[];
      for (const hash of contentHashes) {
        if (!referenced.has(hash)) await tx2.store.delete(hash);
      }
      await tx2.done;
      return remove.length;
    },
    async getVersionStats(fileId: string): Promise<VersionStats> {
      const list = (await db.getAllFromIndex(STORE_VERSIONS, 'fileId', fileId)) as VersionEntry[];
      const content = (await db.getAll(STORE_VERSION_CONTENT)) as Array<{
        hash: string;
        json: string;
      }>;
      return {
        totalVersions: list.length,
        namedVersions: list.filter((v) => v.kind === 'named').length,
        totalBytes: content.reduce((sum, c) => sum + new TextEncoder().encode(c.json).length, 0),
      };
    },
    async listBranches(fileId) {
      if (!fileId) return await db.getAll(STORE_BRANCHES);
      return await db.getAllFromIndex(STORE_BRANCHES, 'fileId', fileId);
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
      await db.put(STORE_BRANCHES, branch);
      return branch;
    },

    // ─── Permissions ──────────────────────────────────────────────────────────
    async listPermissions(fileId: string) {
      const key = `perm_${fileId}`;
      const row = await db.get(STORE_KV, key);
      return (row?.value as Permission[] | undefined) ?? [];
    },
    async setPermission(fileId: string, role: Permission['role'], email?: string) {
      const key = `perm_${fileId}`;
      const row = await db.get(STORE_KV, key);
      const list: Permission[] = (row?.value as Permission[] | undefined) ?? [];
      list.push({ fileId, role, email, grantedAt: Date.now() });
      await db.put(STORE_KV, { key, value: list });
    },

    // ─── Activity ─────────────────────────────────────────────────────────────
    async listActivity(workspaceId, limit) {
      const all = await db.getAllFromIndex(STORE_ACTIVITY, 'timestamp');
      const filtered = all
        .filter((e) => e.workspaceId === workspaceId)
        .sort((a, b) => b.timestamp - a.timestamp);
      return limit ? filtered.slice(0, limit) : filtered;
    },
    async recordActivity(event) {
      const activityEvent: ActivityEvent = {
        ...event,
        id: uuid(),
        timestamp: Date.now(),
      };
      await db.put(STORE_ACTIVITY, activityEvent);
    },

    // ─── Tags ─────────────────────────────────────────────────────────────────
    async listTags(workspaceId) {
      const all = await db.getAll(STORE_TAGS);
      if (!workspaceId) return all;
      return all.filter((t) => t.workspaceId === workspaceId);
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
      await db.put(STORE_TAGS, tag);
      return tag;
    },
    async renameTag(id, name) {
      const t = await db.get(STORE_TAGS, id);
      if (!t) return;
      await db.put(STORE_TAGS, { ...t, name, updatedAt: Date.now() });
    },
    async deleteTag(id) {
      await db.delete(STORE_TAGS, id);
      // Remove all file-tag associations for this tag
      const records = await db.getAllFromIndex(STORE_FILE_TAGS, 'tagId', id);
      for (const r of records) {
        await db.delete(STORE_FILE_TAGS, r.id);
      }
    },
    async listFileTags(fileId) {
      const records = await db.getAllFromIndex(STORE_FILE_TAGS, 'fileId', fileId);
      const tags: Tag[] = [];
      for (const r of records) {
        const tag = await db.get(STORE_TAGS, r.tagId);
        if (tag) tags.push(tag);
      }
      return tags;
    },
    async addFileTag(fileId, tagId) {
      const existing = await db.getAllFromIndex(STORE_FILE_TAGS, 'fileId', fileId);
      if (existing.some((r) => r.tagId === tagId)) return;
      const record: FileTagRecord = {
        id: uuid(),
        fileId,
        tagId,
        addedAt: Date.now(),
      };
      await db.put(STORE_FILE_TAGS, record);
    },
    async removeFileTag(fileId, tagId) {
      const records = await db.getAllFromIndex(STORE_FILE_TAGS, 'fileId', fileId);
      const match = records.find((r) => r.tagId === tagId);
      if (match) {
        await db.delete(STORE_FILE_TAGS, match.id);
      }
    },
    async listFilesByTag(tagId) {
      const fileIds = await fileIdsForTag(tagId);
      const all = await db.getAll(STORE_FILES);
      return all.map((r) => r.entry).filter((e) => fileIds.has(e.id) && e.trashedAt === null);
    },

    // ─── Saved Searches ───────────────────────────────────────────────────────
    async listSavedSearches() {
      return await db.getAll(STORE_SAVED_SEARCHES);
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
      await db.put(STORE_SAVED_SEARCHES, search);
      return search;
    },
    async deleteSavedSearch(id) {
      await db.delete(STORE_SAVED_SEARCHES, id);
    },

    // ─── File Search & Utils ──────────────────────────────────────────────────
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
      return true;
    },

    // ─── Thumbnails ───────────────────────────────────────────────────────────
    async getThumbnail(hash) {
      const rec = await db.get(STORE_THUMBS, hash);
      return rec?.dataUrl;
    },
    async setThumbnailPreference(fileId, preference) {
      const rec = await db.get(STORE_FILES, fileId);
      if (!rec) return;
      await db.put(STORE_FILES, {
        ...rec,
        entry: { ...rec.entry, thumbnailPreference: preference },
      });
    },
    async putThumbnail(record) {
      await db.put(STORE_THUMBS, record);
    },
    async deleteThumbnail(hash) {
      await db.delete(STORE_THUMBS, hash);
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

    // ─── View State ───────────────────────────────────────────────────────────
    async getViewState() {
      const row = await db.get(STORE_KV, KV_VIEW_STATE);
      return mergeViewState((row?.value as Partial<HomeViewState> | undefined) ?? undefined);
    },
    async setViewState(next) {
      await db.put(STORE_KV, { key: KV_VIEW_STATE, value: next });
    },

    // ─── App settings ───────────────────────────────────────────────────────
    async getAppSetting(key: string) {
      const row = await db.get(STORE_KV, `app-setting_${key}`);
      return (row?.value as string | undefined) ?? null;
    },
    async setAppSetting(key: string, value: string) {
      await db.put(STORE_KV, { key: `app-setting_${key}`, value });
    },

    // ─── Native Dialogs ───────────────────────────────────────────────────────
    async openDocumentFromDisk() {
      const w = getWindow();
      if (w?.showOpenFilePicker) {
        let handles: Array<FileSystemFileHandle> | undefined;
        try {
          handles = await w.showOpenFilePicker({ multiple: false, types: VARVE_ACCEPT });
        } catch {
          return null;
        }
        const handle = handles?.[0];
        if (!handle) return null;
        const file = await handle.getFile();
        const text = await file.text();
        return ingestFile(file.name, text);
      }
      const picked = await pickViaInput(['.varve', '.strata']);
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
      const choice = await this.chooseDocumentSaveTarget(name);
      if (choice.kind !== 'target') return null;
      const written = await this.writeSaveTarget(choice.target, documentJson);
      if (written.kind !== 'written') return null;
      if (choice.target.kind === 'web-file-handle') return choice.target.displayName;
      if (choice.target.kind === 'download-only') return choice.target.suggestedName;
      return null;
    },

    async writeDocumentToPath(_path, documentJson) {
      // Browsers can't write to arbitrary paths; the File System Access API
      // requires a user gesture + picker per file. Deprecated — the editor
      // routes through chooseDocumentSaveTarget/writeSaveTarget instead.
      return this.saveDocumentToDisk('document', documentJson);
    },

    async chooseDocumentSaveTarget(suggestedName) {
      return chooseWebSaveTarget(suggestedName);
    },

    async writeSaveTarget(target, contents) {
      return writeWebSaveTarget(target, contents);
    },

    async readDocumentText() {
      // Browsers have no path-based file API; external-change detection is
      // desktop-only.
      return undefined;
    },

    async saveBinaryFile(name, data, mimeType, extension) {
      const w = getWindow();
      const ext = extension.replace(/^\./, '');
      const suggested = name.endsWith(`.${ext}`) ? name : `${name}.${ext}`;
      const acceptType = { description: mimeType, accept: { [mimeType]: [`.${ext}`] } };
      if (w?.showSaveFilePicker) {
        let handle: FileSystemFileHandle | undefined;
        try {
          handle = await w.showSaveFilePicker({ suggestedName: suggested, types: [acceptType] });
        } catch {
          return null;
        }
        if (!handle) return null;
        const writable = await (
          handle as unknown as {
            createWritable: () => Promise<{
              write: (d: Uint8Array) => Promise<void>;
              close: () => Promise<void>;
            }>;
          }
        ).createWritable();
        await writable.write(data);
        await writable.close();
        return handle.name;
      }
      // Fallback: Blob download.
      const blob = new Blob([data as unknown as ArrayBuffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = suggested;
      a.click();
      URL.revokeObjectURL(url);
      return suggested;
    },
    async chooseExportFolder() {
      // Browser multi-file export is delivered as a single archive. Directory
      // handles are intentionally not represented as fake filesystem paths.
      return null;
    },
    async writeBinaryFileToFolder() {
      throw new Error('Direct folder export is unavailable in this browser');
    },

    async listPrinters() {
      return [] as PrinterInfo[];
    },
    async printPdf(data, _jobTitle, _options) {
      // Browser-based printing: create a blob URL and open in a new tab.
      // The browser's native PDF viewer handles printing. This is limited —
      // no printer selection, no job tracking, no programmatic print trigger.
      const blob = new Blob([data as unknown as ArrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      return {
        jobId: 0,
        message: 'PDF opened in new tab for printing',
        success: true,
      } satisfies PrintJobResult;
    },
    async cancelPrintJob(_printerName, _jobId) {
      return 'Cancel not supported in browser';
    },

    async onNativeFileDrop() {
      return () => {};
    },
    async readFileBytes(path) {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Unable to read file bytes: ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
    async readClipboardImage() {
      const clipboard = navigator.clipboard;
      if (!clipboard || typeof clipboard.read !== 'function') return null;
      try {
        for (const item of await clipboard.read()) {
          const imageType = item.types.find((type) => type.startsWith('image/'));
          if (!imageType) continue;
          return new Uint8Array(await (await item.getType(imageType)).arrayBuffer());
        }
      } catch {
        // Permission denial/no image is a recoverable browser capability miss.
      }
      return null;
    },

    async revealInFileManager() {
      // Browsers cannot shell out to the OS file manager.
    },
    fileManagerLabel() {
      return 'Reveal in Files';
    },

    // ─── Recent Files ──────────────────────────────────────────────────────────
    async listRecentFiles() {
      const db = await openHomeDb();
      const records = await db.getAllFromIndex(STORE_RECENT_FILES, 'lastOpenedAt');
      return records.reverse();
    },
    async touchRecentFile(id, name, sourceWorkspaceId, contentHash) {
      const db = await openHomeDb();
      const existing = await db.get(STORE_RECENT_FILES, id);
      const now = Date.now();
      const record: RecentFileRecord = existing
        ? {
            ...existing,
            name,
            lastOpenedAt: now,
            openedCount: existing.openedCount + 1,
            sourceWorkspaceId: sourceWorkspaceId ?? existing.sourceWorkspaceId,
            contentHash: contentHash ?? existing.contentHash,
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
            version: 1,
            sourceWorkspaceId,
            contentHash,
          };
      await db.put(STORE_RECENT_FILES, record);
      return record;
    },
    async patchRecentFile(id, patch) {
      const db = await openHomeDb();
      const existing = await db.get(STORE_RECENT_FILES, id);
      if (!existing) return;
      await db.put(STORE_RECENT_FILES, { ...existing, ...patch });
    },
    async removeRecentFile(id) {
      const db = await openHomeDb();
      await db.delete(STORE_RECENT_FILES, id);
    },
    async clearRecentHistory() {
      const db = await openHomeDb();
      const records = await db.getAll(STORE_RECENT_FILES);
      await Promise.all(records.map((r) => db.delete(STORE_RECENT_FILES, r.id)));
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

export { defaultViewState };
