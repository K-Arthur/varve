import { migrateLegacyIndexedDb } from '@varve/platform';
import { InferenceError } from './InferenceError';

export interface StoredModel {
  bytes: ArrayBuffer;
  modelId: string;
  installedAt: number;
}

export interface PartialDownloadRecord {
  bytes: Uint8Array;
  url: string;
  etag: string | null;
  loaded: number;
}

export interface StorageQuota {
  used: number;
  available: number | null;
}

export interface ModelStorage {
  readonly name: string;
  isAvailable(): boolean;
  saveInstalled(modelId: string, bytes: ArrayBuffer): Promise<void>;
  loadInstalled(modelId: string): Promise<ArrayBuffer | null>;
  deleteInstalled(modelId: string): Promise<void>;
  hasInstalled(modelId: string): Promise<boolean>;
  listInstalled(): Promise<string[]>;
  savePartial(modelId: string, record: PartialDownloadRecord): Promise<void>;
  loadPartial(modelId: string): Promise<PartialDownloadRecord | null>;
  deletePartial(modelId: string): Promise<void>;
  getQuota(): Promise<StorageQuota>;
  clear(): Promise<void>;
}

class IndexedDBStorage implements ModelStorage {
  readonly name = 'indexeddb';
  private dbName = 'varve-model-store';
  private legacyDbName = 'strata-model-store';
  private dbVersion = 3;
  private storeName = 'models';
  private partialStore = 'partials';

  isAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
        if (!db.objectStoreNames.contains(this.partialStore)) {
          db.createObjectStore(this.partialStore);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        void migrateLegacyIndexedDb(this.legacyDbName, this.dbName, [
          this.storeName,
          this.partialStore,
        ]).then(() => resolve(db));
      };
      request.onerror = () => reject(new Error('Failed to open IndexedDB model store'));
    });
  }

  async saveInstalled(modelId: string, bytes: ArrayBuffer): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const record: StoredModel = { bytes, modelId, installedAt: Date.now() };
      tx.objectStore(this.storeName).put(record, modelId);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        const err = tx.error ?? new Error(`Save failed: ${modelId}`);
        if (err instanceof DOMException && err.name === 'QuotaExceededError') {
          reject(new InferenceError('insufficient_disk_space'));
        } else {
          reject(err);
        }
      };
    });
  }

  async loadInstalled(modelId: string): Promise<ArrayBuffer | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const request = tx.objectStore(this.storeName).get(modelId);
      request.onsuccess = () => {
        db.close();
        const record = request.result as StoredModel | Blob | undefined;
        // The model loader writes raw Blob values in the same store; expose
        // them as bytes so DownloadManager state/size accounting works for
        // models installed through either manager.
        if (record instanceof Blob) {
          void record.arrayBuffer().then(resolve, reject);
          return;
        }
        resolve(record?.bytes ?? null);
      };
      request.onerror = () => {
        db.close();
        reject(new Error(`Load failed: ${modelId}`));
      };
    });
  }

  async deleteInstalled(modelId: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).delete(modelId);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(new Error(`Delete failed: ${modelId}`));
      };
    });
  }

  async hasInstalled(modelId: string): Promise<boolean> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const request = tx.objectStore(this.storeName).count(modelId);
      request.onsuccess = () => {
        db.close();
        resolve(request.result > 0);
      };
      request.onerror = () => {
        db.close();
        reject(new Error(`Count failed: ${modelId}`));
      };
    });
  }

  async listInstalled(): Promise<string[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const request = tx.objectStore(this.storeName).getAllKeys();
      request.onsuccess = () => {
        db.close();
        resolve((request.result as IDBValidKey[]).map(String));
      };
      request.onerror = () => {
        db.close();
        reject(new Error('Failed to list installed models'));
      };
    });
  }

  async savePartial(modelId: string, record: PartialDownloadRecord): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.partialStore, 'readwrite');
      tx.objectStore(this.partialStore).put(record, modelId);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(new Error(`Save partial failed: ${modelId}`));
      };
    });
  }

  async loadPartial(modelId: string): Promise<PartialDownloadRecord | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.partialStore, 'readonly');
      const request = tx.objectStore(this.partialStore).get(modelId);
      request.onsuccess = () => {
        db.close();
        resolve((request.result as PartialDownloadRecord | undefined) ?? null);
      };
      request.onerror = () => {
        db.close();
        reject(new Error(`Load partial failed: ${modelId}`));
      };
    });
  }

  async deletePartial(modelId: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.partialStore, 'readwrite');
      tx.objectStore(this.partialStore).delete(modelId);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(new Error(`Delete partial failed: ${modelId}`));
      };
    });
  }

  async getQuota(): Promise<StorageQuota> {
    let used = 0;
    const ids = await this.listInstalled();
    for (const id of ids) {
      const bytes = await this.loadInstalled(id);
      if (bytes) used += bytes.byteLength;
    }
    let available: number | null = null;
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota != null && estimate.usage != null) {
        available = estimate.quota - estimate.usage + used;
      }
    }
    return { used, available };
  }

  async clear(): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([this.storeName, this.partialStore], 'readwrite');
      tx.objectStore(this.storeName).clear();
      tx.objectStore(this.partialStore).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(new Error('Failed to clear model store'));
      };
    });
  }
}

class LocalStorageModelStorage implements ModelStorage {
  readonly name = 'localstorage';

  isAvailable(): boolean {
    return typeof localStorage !== 'undefined';
  }

  private key(modelId: string): string {
    return `varve-model-${modelId}`;
  }

  private legacyKey(modelId: string): string {
    return `strata-model-${modelId}`;
  }

  private partialKey(modelId: string): string {
    return `varve-model-partial-${modelId}`;
  }

  private legacyPartialKey(modelId: string): string {
    return `strata-model-partial-${modelId}`;
  }

  async saveInstalled(modelId: string, bytes: ArrayBuffer): Promise<void> {
    const data: number[] = [];
    const view = new Uint8Array(bytes);
    for (let i = 0; i < view.length; i += 65536) {
      const slice = view.subarray(i, Math.min(i + 65536, view.length));
      data.push(...Array.from(slice));
    }
    try {
      localStorage.setItem(this.key(modelId), JSON.stringify({ data }));
    } catch {
      throw new InferenceError('insufficient_disk_space');
    }
  }

  async loadInstalled(modelId: string): Promise<ArrayBuffer | null> {
    try {
      const raw =
        localStorage.getItem(this.key(modelId)) ?? localStorage.getItem(this.legacyKey(modelId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { data: number[] };
      return new Uint8Array(parsed.data).buffer;
    } catch {
      return null;
    }
  }

  async deleteInstalled(modelId: string): Promise<void> {
    try {
      localStorage.removeItem(this.key(modelId));
      localStorage.removeItem(this.legacyKey(modelId));
    } catch {}
    try {
      localStorage.removeItem(`varve-model-state-${modelId}`);
      localStorage.removeItem(`strata-model-state-${modelId}`);
    } catch {}
  }

  async hasInstalled(modelId: string): Promise<boolean> {
    return (
      localStorage.getItem(this.key(modelId)) !== null ||
      localStorage.getItem(this.legacyKey(modelId)) !== null
    );
  }

  async listInstalled(): Promise<string[]> {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const prefix of ['varve-model-', 'strata-model-']) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          const id = key.slice(prefix.length);
          if (!seen.has(id)) {
            seen.add(id);
            ids.push(id);
          }
        }
      }
    }
    return ids;
  }

  async savePartial(modelId: string, record: PartialDownloadRecord): Promise<void> {
    try {
      localStorage.setItem(
        this.partialKey(modelId),
        JSON.stringify({
          bytes: Array.from(record.bytes),
          meta: { url: record.url, etag: record.etag, loaded: record.loaded },
        }),
      );
    } catch {}
  }

  async loadPartial(modelId: string): Promise<PartialDownloadRecord | null> {
    try {
      const raw =
        localStorage.getItem(this.partialKey(modelId)) ??
        localStorage.getItem(this.legacyPartialKey(modelId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        bytes: number[];
        meta: { url: string; etag: string | null; loaded: number };
      };
      return {
        bytes: new Uint8Array(parsed.bytes),
        url: parsed.meta.url,
        etag: parsed.meta.etag,
        loaded: parsed.meta.loaded,
      };
    } catch {
      return null;
    }
  }

  async deletePartial(modelId: string): Promise<void> {
    try {
      localStorage.removeItem(this.partialKey(modelId));
      localStorage.removeItem(this.legacyPartialKey(modelId));
    } catch {}
  }

  async getQuota(): Promise<StorageQuota> {
    let used = 0;
    for (const id of await this.listInstalled()) {
      const raw = localStorage.getItem(this.key(id)) ?? localStorage.getItem(this.legacyKey(id));
      if (raw) used += raw.length;
    }
    return { used, available: null };
  }

  async clear(): Promise<void> {
    const ids = [...new Set([...(await this.listInstalled()), ...(await this.listPartials())])];
    for (const id of ids) {
      await this.deleteInstalled(id);
      await this.deletePartial(id);
    }
  }

  private async listPartials(): Promise<string[]> {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const prefix of ['varve-model-partial-', 'strata-model-partial-']) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          const id = key.slice(prefix.length);
          if (!seen.has(id)) {
            seen.add(id);
            ids.push(id);
          }
        }
      }
    }
    return ids;
  }
}

class InMemoryStorage implements ModelStorage {
  readonly name = 'memory';
  private models = new Map<string, ArrayBuffer>();
  private partials = new Map<string, PartialDownloadRecord>();

  isAvailable(): boolean {
    return true;
  }

  async saveInstalled(modelId: string, bytes: ArrayBuffer): Promise<void> {
    this.models.set(modelId, bytes);
  }

  async loadInstalled(modelId: string): Promise<ArrayBuffer | null> {
    return this.models.get(modelId) ?? null;
  }

  async deleteInstalled(modelId: string): Promise<void> {
    this.models.delete(modelId);
  }

  async hasInstalled(modelId: string): Promise<boolean> {
    return this.models.has(modelId);
  }

  async listInstalled(): Promise<string[]> {
    return [...this.models.keys()];
  }

  async savePartial(modelId: string, record: PartialDownloadRecord): Promise<void> {
    this.partials.set(modelId, record);
  }

  async loadPartial(modelId: string): Promise<PartialDownloadRecord | null> {
    return this.partials.get(modelId) ?? null;
  }

  async deletePartial(modelId: string): Promise<void> {
    this.partials.delete(modelId);
  }

  async getQuota(): Promise<StorageQuota> {
    let used = 0;
    for (const buf of this.models.values()) {
      used += buf.byteLength;
    }
    return { used, available: null };
  }

  async clear(): Promise<void> {
    this.models.clear();
    this.partials.clear();
  }
}

export function createModelStorage(kind?: 'indexeddb' | 'localstorage' | 'memory'): ModelStorage {
  if (kind === 'memory') return new InMemoryStorage();
  if (kind === 'localstorage') return new LocalStorageModelStorage();
  if (kind === 'indexeddb') return new IndexedDBStorage();
  if (typeof indexedDB !== 'undefined') return new IndexedDBStorage();
  if (typeof localStorage !== 'undefined') return new LocalStorageModelStorage();
  return new InMemoryStorage();
}

export async function migrateFromLocalStorage(
  storage: ModelStorage,
): Promise<{ migrated: number; failed: number }> {
  let migrated = 0;
  let failed = 0;
  if (storage.name === 'localstorage') return { migrated, failed };
  const ls = new LocalStorageModelStorage();
  if (!ls.isAvailable()) return { migrated, failed };

  const migratedKey = 'strata-migration-v2-complete';
  if (localStorage.getItem(migratedKey)) return { migrated, failed };

  const ids = await ls.listInstalled();
  for (const id of ids) {
    try {
      const bytes = await ls.loadInstalled(id);
      if (bytes) {
        await storage.saveInstalled(id, bytes);
        migrated++;
      }
    } catch {
      failed++;
    }
  }
  localStorage.setItem(migratedKey, JSON.stringify({ migrated, failed, at: Date.now() }));
  return { migrated, failed };
}
