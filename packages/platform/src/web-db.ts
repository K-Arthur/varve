/**
 * @strata/platform — IndexedDB schema, store constants, and the DB initializer.
 *
 * Every object store used by the web platform is defined and versioned here.
 * The public export is `openHomeDb()`; every consumer imports the store-name
 * constants they need rather than hardcoding strings.
 */
import { type IDBPDatabase, openDB } from 'idb';
import type {
  ActivityEvent,
  Asset,
  AssetFolder,
  Branch,
  Collection,
  CollectionEntry,
  FileEntry,
  Folder,
  Library,
  Project,
  RecentFileRecord,
  SavedSearch,
  Tag,
  TemplateLibrary,
  ThumbnailRecord,
  VersionEntry,
  Workspace,
} from './types';

// COMPLEXITY: 15

export const DB_NAME = 'strata-home';
export const DB_VERSION = 3;
export const STORE_FILES = 'files';
export const STORE_PROJECTS = 'projects';
export const STORE_THUMBS = 'thumbnails';
export const STORE_KV = 'kv';
export const STORE_FOLDERS = 'folders';
export const STORE_COLLECTIONS = 'collections';
export const STORE_COLLECTION_ENTRIES = 'collectionEntries';
export const STORE_WORKSPACES = 'workspaces';
export const STORE_LIBRARIES = 'libraries';
export const STORE_TEMPLATES = 'templates';
export const STORE_ASSETS = 'assets';
export const STORE_ASSET_FOLDERS = 'assetFolders';
export const STORE_VERSIONS = 'versions';
export const STORE_VERSION_CONTENT = 'versionContent';
export const STORE_BRANCHES = 'branches';
export const STORE_TAGS = 'tags';
export const STORE_FILE_TAGS = 'fileTags';
export const STORE_ACTIVITY = 'activity';
export const STORE_SAVED_SEARCHES = 'savedSearches';
export const STORE_RECENT_FILES = 'recentFiles';
export const KV_VIEW_STATE = 'view-state';

export interface FileRecord {
  entry: FileEntry;
  json: string;
}

export interface FileTagRecord {
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

export async function openHomeDb(): Promise<IDBPDatabase<DbSchema>> {
  return openDB<DbSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
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
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains(STORE_RECENT_FILES)) {
          const store = db.createObjectStore(STORE_RECENT_FILES, { keyPath: 'id' });
          store.createIndex('lastOpenedAt', 'lastOpenedAt');
        }
      }
    },
  });
}
