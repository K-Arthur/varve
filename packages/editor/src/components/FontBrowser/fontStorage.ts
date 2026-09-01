/**
 * Durable downloaded-font storage.
 *
 * Records are keyed by the exact artifact identity and content hash. Family
 * name is display metadata only, so static faces, subsets, versions, and
 * variable files cannot overwrite one another.
 */

export interface FontStorageMetadata {
  providerId: string;
  familyId?: string;
  packageVersion?: string;
  upstreamVersion?: string;
  weight?: number;
  style?: 'normal' | 'italic';
  subset?: string;
  variable?: boolean;
  axes?: Array<{ tag: string; min: number; max: number; default: number; step?: number }>;
  postScriptName?: string;
  contentHash?: string;
  license?: string;
  licenseUrl?: string;
  attribution?: string;
}

export interface StoredFontRecord {
  key: string;
  familyName: string;
  data: ArrayBuffer;
  metadata: FontStorageMetadata;
  storedAt: number;
}

const DB_NAME = 'varve-font-storage-v2';
const STORE_NAME = 'artifacts';
const LEGACY_DB_NAME = 'varve-font-storage';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function sha256(data: ArrayBuffer): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Secure font hashing is unavailable in this environment.');
  }
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function storageKey(metadata: FontStorageMetadata, contentHash: string): string {
  return [
    metadata.providerId,
    metadata.familyId ?? metadata.postScriptName ?? 'unknown-family',
    metadata.packageVersion ?? 'unknown-version',
    metadata.weight ?? 'variable',
    metadata.style ?? 'normal',
    metadata.subset ?? 'default',
    metadata.variable ? 'variable' : 'static',
    contentHash,
  ].join(':');
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Font storage transaction aborted'));
  });
}

/** Store one validated artifact by its complete identity. */
export async function storeFont(
  familyName: string,
  data: ArrayBuffer,
  metadata: FontStorageMetadata,
): Promise<StoredFontRecord> {
  if (typeof indexedDB === 'undefined') throw new Error('Local font storage is unavailable.');
  const contentHash = metadata.contentHash ?? (await sha256(data));
  const record: StoredFontRecord = {
    key: storageKey(metadata, contentHash),
    familyName,
    data,
    metadata: { ...metadata, contentHash },
    storedAt: Date.now(),
  };
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record);
    await transactionDone(transaction);
    return record;
  } finally {
    db.close();
  }
}

export async function getStoredFont(familyName: string): Promise<StoredFontRecord | null> {
  const records = await listStoredFonts();
  return (
    records.find(
      (record) => record.familyName.toLocaleLowerCase() === familyName.toLocaleLowerCase(),
    ) ?? null
  );
}

export async function listStoredFonts(): Promise<StoredFontRecord[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openDb();
  try {
    const records = await requestResult(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll(),
    );
    return records as StoredFontRecord[];
  } finally {
    db.close();
  }
}

export async function removeStoredFont(keyOrFamilyName: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const records = (await requestResult(store.getAll())) as StoredFontRecord[];
    for (const record of records) {
      if (
        record.key === keyOrFamilyName ||
        record.familyName.toLocaleLowerCase() === keyOrFamilyName.toLocaleLowerCase()
      ) {
        store.delete(record.key);
      }
    }
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function getStoredFontCount(): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  const db = await openDb();
  try {
    return await requestResult(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count(),
    );
  } finally {
    db.close();
  }
}

/** Name retained for migration diagnostics and compatibility tooling. */
export const LEGACY_FONT_STORAGE_DATABASE = LEGACY_DB_NAME;
