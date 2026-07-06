/**
 * IndexedDB-backed model storage for AI background removal models.
 *
 * localStorage has a ~5MB limit which is insufficient for ONNX models
 * (4.7MB u2netp up to 928MB birefnet-general). IndexedDB provides the
 * capacity needed for large binary blobs.
 */

const DB_NAME = 'strata-model-store';
const DB_VERSION = 2;
const STORE_NAME = 'models';
const PARTIALS_STORE = 'partials';

export interface PartialDownloadMeta {
  url: string;
  etag: string | null;
  loaded: number;
}

export interface PartialDownloadRecord {
  bytes: Uint8Array;
  meta: PartialDownloadMeta;
}

export class ModelStorageQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelStorageQuotaError';
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(PARTIALS_STORE)) {
        db.createObjectStore(PARTIALS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Failed to open IndexedDB'));
  });
}

function isQuotaError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'QuotaExceededError') return true;
  if (err instanceof Error && /quota/i.test(err.message)) return true;
  return false;
}

export async function saveModelBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(blob, id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      const err = tx.error ?? new Error(`Failed to save model: ${id}`);
      reject(isQuotaError(err) ? new ModelStorageQuotaError(err.message) : err);
    };
  });
}

export async function loadModelBlob(id: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => {
      db.close();
      resolve(request.result ?? null);
    };
    request.onerror = () => {
      db.close();
      reject(new Error(`Failed to load model: ${id}`));
    };
  });
}

export async function hasModelBlob(id: string): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.count(id);
    request.onsuccess = () => {
      db.close();
      resolve(request.result > 0);
    };
    request.onerror = () => {
      db.close();
      reject(new Error(`Failed to check model: ${id}`));
    };
  });
}

export async function deleteModelBlob(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(new Error(`Failed to delete model: ${id}`));
    };
  });
}

export async function savePartialDownload(
  id: string,
  record: PartialDownloadRecord,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PARTIALS_STORE, 'readwrite');
    const store = tx.objectStore(PARTIALS_STORE);
    store.put(record, id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      const err = tx.error ?? new Error(`Failed to save partial download: ${id}`);
      reject(isQuotaError(err) ? new ModelStorageQuotaError(err.message) : err);
    };
  });
}

export async function loadPartialDownload(id: string): Promise<PartialDownloadRecord | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PARTIALS_STORE, 'readonly');
    const store = tx.objectStore(PARTIALS_STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      db.close();
      resolve((request.result as PartialDownloadRecord | undefined) ?? null);
    };
    request.onerror = () => {
      db.close();
      reject(new Error(`Failed to load partial download: ${id}`));
    };
  });
}

export async function deletePartialDownload(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PARTIALS_STORE, 'readwrite');
    const store = tx.objectStore(PARTIALS_STORE);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(new Error(`Failed to delete partial download: ${id}`));
    };
  });
}

export async function getModelBlobSize(id: string): Promise<number> {
  const blob = await loadModelBlob(id);
  return blob ? blob.size : 0;
}

export async function clearAllModelBlobs(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, PARTIALS_STORE], 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.objectStore(PARTIALS_STORE).clear();
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
