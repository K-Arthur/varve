import { migrateLegacyIndexedDb } from '@varve/platform';

/**
 * Font storage — persists downloaded font files across sessions.
 *
 * Uses raw IndexedDB (available in all modern browsers, WebView2,
 * WKWebView, and Tauri's webview) so no external dependency is needed.
 *
 * Lifecycle:
 *   download → store in IndexedDB → register with FontLoader → ready
 *   app start → load from storage → register with FontLoader → ready
 *
 * Tauri desktop can optionally mirror stored fonts to the app data
 * directory via a separate filesystem adapter when filesystem-level
 * access is needed (e.g., for system-wide font installation).
 */

export interface StoredFontRecord {
  family: string;
  data: Uint8Array;
  storedAt: string;
  providerId?: string;
  licenseName?: string;
}

const DB_NAME = 'varve-fonts';
const LEGACY_DB_NAME = 'strata-fonts';
const DB_VERSION = 1;
const STORE_NAME = 'fonts';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'family' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      void migrateLegacyIndexedDb(LEGACY_DB_NAME, DB_NAME, [STORE_NAME]).then(() => resolve(db));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function storeFont(
  family: string,
  data: ArrayBuffer,
  meta?: { providerId?: string; licenseName?: string },
): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({
      family: family.toLowerCase(),
      data: new Uint8Array(data),
      storedAt: new Date().toISOString(),
      providerId: meta?.providerId,
      licenseName: meta?.licenseName,
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadStoredFont(family: string): Promise<StoredFontRecord | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return await new Promise<StoredFontRecord | undefined>((resolve, reject) => {
      const req = store.get(family.toLowerCase());
      req.onsuccess = () => resolve(req.result ?? undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function listStoredFonts(): Promise<StoredFontRecord[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return await new Promise<StoredFontRecord[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function removeStoredFont(family: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(family.toLowerCase());
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function getStoredFontCount(): Promise<number> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return await new Promise<number>((resolve, reject) => {
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
