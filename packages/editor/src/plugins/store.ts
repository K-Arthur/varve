import type { PluginPackageManifest, PluginPermission } from './package';

const DB_NAME = 'varve-application-plugins-v1';
const STORE_NAME = 'packages';

export interface StoredPluginVersion {
  archive: Uint8Array;
  manifest: PluginPackageManifest;
  wasm: Uint8Array;
  sha256: string;
  grants: PluginPermission[];
  installedAt: number;
}

export interface StoredPlugin extends StoredPluginVersion {
  enabled: boolean;
  source: 'local-file';
  previous?: StoredPluginVersion;
  lastError?: string;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Local plugin storage is unavailable in this runtime'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME, { keyPath: 'manifest.id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open plugin storage'));
    request.onblocked = () => reject(new Error('Plugin storage is blocked by another window'));
  });
}

function transact<T>(
  mode: IDBTransactionMode,
  requestFor: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = requestFor(transaction.objectStore(STORE_NAME));
        let value: T;
        request.onsuccess = () => {
          value = request.result;
        };
        transaction.oncomplete = () => {
          db.close();
          resolve(value);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error('Plugin storage transaction failed'));
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error ?? new Error('Plugin storage transaction aborted'));
        };
      }),
  );
}

export function listStoredPlugins(): Promise<StoredPlugin[]> {
  return transact('readonly', (store) => store.getAll() as IDBRequest<StoredPlugin[]>);
}

export function getStoredPlugin(id: string): Promise<StoredPlugin | undefined> {
  return transact('readonly', (store) => store.get(id) as IDBRequest<StoredPlugin | undefined>);
}

export function putStoredPlugin(plugin: StoredPlugin): Promise<IDBValidKey> {
  return transact('readwrite', (store) => store.put(plugin));
}

export function deleteStoredPlugin(id: string): Promise<undefined> {
  return transact('readwrite', (store) => store.delete(id));
}
