/**
 * Icon storage — IndexedDB persistence for downloaded/cached icon SVGs.
 */

export interface IconStorageRecord {
  id: string;
  name: string;
  providerId: string;
  prefix: string;
  svg: string;
  licence?: string;
  attribution?: string;
  category?: string;
  styles?: string[];
  storedAt: number;
  byteSize: number;
}

const DB_NAME = 'strata-icon-storage';
const DB_VERSION = 1;
const STORE_NAME = 'icons';

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('providerId', 'providerId', { unique: false });
          store.createIndex('prefix', 'prefix', { unique: false });
          store.createIndex('storedAt', 'storedAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch {
      resolve(null);
    }
  });
}

export async function storeIcon(record: IconStorageRecord): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // best-effort
  } finally {
    db.close();
  }
}

export async function getStoredIcon(id: string): Promise<IconStorageRecord | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    return await new Promise<IconStorageRecord | null>((resolve) => {
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function removeStoredIcon(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // best-effort
  } finally {
    db.close();
  }
}

export async function listStoredIcons(): Promise<IconStorageRecord[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    return await new Promise<IconStorageRecord[]>((resolve) => {
      req.onsuccess = () => {
        const results = (req.result ?? []) as IconStorageRecord[];
        results.sort((a, b) => b.storedAt - a.storedAt);
        resolve(results);
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  } finally {
    db.close();
  }
}
