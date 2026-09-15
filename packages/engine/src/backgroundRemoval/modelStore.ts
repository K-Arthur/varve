/**
 * IndexedDB-backed model storage for AI models.
 *
 * localStorage has a ~5MB limit which is insufficient for ONNX models
 * (4.7MB u2netp up to 928MB birefnet-general). IndexedDB provides the
 * capacity needed for large binary blobs.
 *
 * Two writers share this store and must stay interoperable:
 *   - the model loader stores raw Blob values (v2 schema)
 *   - the inference DownloadManager stores { bytes, modelId, installedAt }
 *     records (v1 schema, still produced by older builds)
 * `loadModelBlob` normalizes both shapes so availability checks work
 * regardless of which manager installed the model.
 */
import { migrateLegacyIndexedDb } from '@varve/platform';

const DB_NAME = 'varve-model-store';
const LEGACY_DB_NAME = 'strata-model-store';
// Must match inference/core/ModelStorage's dbVersion: both writers open the
// same database, and indexedDB rejects an open at a lower version than the
// existing one (VersionError) depending on which manager ran first.
const DB_VERSION = 3;
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
    request.onsuccess = () => {
      const db = request.result;
      void migrateLegacyIndexedDb(LEGACY_DB_NAME, DB_NAME, [STORE_NAME, PARTIALS_STORE]).then(() =>
        resolve(db),
      );
    };
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
      resolve(normalizeModelRecord(request.result));
    };
    request.onerror = () => {
      db.close();
      reject(new Error(`Failed to load model: ${id}`));
    };
  });
}

/**
 * Normalize a stored model record to a Blob. Accepts either the blob
 * schema written by the model loader or the `{ bytes, modelId,
 * installedAt }` record written by the inference DownloadManager, so
 * models installed through either path are visible to availability
 * checks.
 */
function normalizeModelRecord(value: unknown): Blob | null {
  if (value == null) return null;
  if (value instanceof Blob) return value;
  if (typeof value === 'object' && 'bytes' in value) {
    const bytes = (value as { bytes: ArrayBuffer | Uint8Array }).bytes;
    if (bytes instanceof Uint8Array) {
      // Copy to a fresh Uint8Array<ArrayBuffer> so BlobPart typing is happy.
      return new Blob([new Uint8Array(bytes)]);
    }
    if (bytes instanceof ArrayBuffer) {
      return new Blob([bytes]);
    }
  }
  return null;
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
