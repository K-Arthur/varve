/**
 * @varve/platform — IndexedDB schema, store constants, and the DB initializer.
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

export const DB_NAME = 'varve-home';
export const DB_VERSION = 4;
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
export const STORE_SEMANTIC_EMBEDDINGS = 'semanticEmbeddings';
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
      if (oldVersion < 4) {
        // Content-addressed semantic embeddings (derived, reconstructible —
        // see semanticEmbeddingStore.ts). Keyed by the embedding identity
        // string so renames reuse work while edits/model changes invalidate.
        if (!db.objectStoreNames.contains(STORE_SEMANTIC_EMBEDDINGS)) {
          db.createObjectStore(STORE_SEMANTIC_EMBEDDINGS, { keyPath: 'key' });
        }
      }
    },
  });
}

/**
 * Copy records from a legacy IndexedDB database into the current one,
 * idempotently: stores that already contain data are left untouched.
 *
 * Used by storage backends whose database names carried the old product
 * name (e.g. `strata-backups`) and were renamed with the product. The
 * legacy database is opened read-only and closed afterwards; it is never
 * deleted, so a rollback to the old build keeps working.
 *
 * Records are copied by key via `getAllKeys` + `get`, which works for
 * both keyPath stores and keyless stores.
 */
export function migrateLegacyIndexedDb(
  legacyName: string,
  currentName: string,
  stores: string[],
): Promise<void> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve();
      return;
    }
    let legacy: IDBDatabase | null = null;
    let current: IDBDatabase | null = null;
    const finish = () => {
      legacy?.close();
      current?.close();
      resolve();
    };
    const legacyReq = indexedDB.open(legacyName);
    legacyReq.onupgradeneeded = () => {
      legacyReq.transaction?.abort();
    };
    legacyReq.onerror = () => {
      resolve();
    };
    legacyReq.onsuccess = () => {
      const legacyDb = legacyReq.result;
      legacy = legacyDb;
      if (!legacyDb) {
        resolve();
        return;
      }
      const storeNames = stores.filter((s) => legacyDb.objectStoreNames.contains(s));
      if (storeNames.length === 0) {
        finish();
        return;
      }
      const currentReq = indexedDB.open(currentName);
      currentReq.onerror = () => {
        finish();
      };
      currentReq.onsuccess = () => {
        current = currentReq.result;
        if (!current) {
          finish();
          return;
        }
        const tasks = storeNames.map(
          (storeName) =>
            new Promise<void>((storeDone) => {
              if (!current?.objectStoreNames.contains(storeName)) {
                storeDone();
                return;
              }
              const countReq = current
                .transaction(storeName, 'readonly')
                .objectStore(storeName)
                .count();
              countReq.onerror = () => {
                storeDone();
              };
              countReq.onsuccess = () => {
                if (!current || !legacy || countReq.result > 0) {
                  storeDone();
                  return;
                }
                const keysReq = legacy
                  .transaction(storeName, 'readonly')
                  .objectStore(storeName)
                  .getAllKeys();
                keysReq.onerror = () => {
                  storeDone();
                };
                keysReq.onsuccess = () => {
                  const keys = keysReq.result;
                  if (!current || keys.length === 0) {
                    storeDone();
                    return;
                  }
                  const writeTx = current.transaction(storeName, 'readwrite');
                  const target = writeTx.objectStore(storeName);
                  let remaining = keys.length;
                  const stepDone = () => {
                    remaining -= 1;
                    if (remaining === 0) {
                      writeTx.oncomplete = () => {
                        storeDone();
                      };
                      writeTx.onerror = () => {
                        storeDone();
                      };
                    }
                  };
                  keys.forEach((key) => {
                    const getReq = legacy!
                      .transaction(storeName, 'readonly')
                      .objectStore(storeName)
                      .get(key);
                    getReq.onsuccess = () => {
                      target.put(getReq.result, key as IDBValidKey);
                      stepDone();
                    };
                    getReq.onerror = () => {
                      stepDone();
                    };
                  });
                };
              };
            }),
        );
        void Promise.all(tasks).then(finish);
      };
    };
  });
}
