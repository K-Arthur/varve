/**
 * Durable font artifact storage shared by the engine and editor.
 *
 * The key contains provider identity, exact package version, face selection,
 * and content hash. Family name is display metadata only.
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
export const LEGACY_FONT_STORAGE_DATABASES = [
  'varve-font-storage',
  'varve-fonts',
  'strata-fonts',
] as const;

let migrationPromise: Promise<void> | undefined;

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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      migrationPromise ??= migrateLegacyStorage(db);
      void migrationPromise.then(() => resolve(db), reject);
    };
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

/** Compatibility lookup for export and filesystem adapters. */
export async function loadStoredFont(familyName: string): Promise<StoredFontRecord | undefined> {
  return (await getStoredFont(familyName)) ?? undefined;
}

export async function listStoredFonts(): Promise<StoredFontRecord[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openDb();
  try {
    return (await requestResult(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll(),
    )) as StoredFontRecord[];
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

interface LegacyFontRecord {
  family?: string;
  familyName?: string;
  data?: ArrayBuffer | Uint8Array;
  metadata?: Record<string, unknown>;
  providerId?: string;
  licenseName?: string;
  storedAt?: string | number;
}

async function readLegacyRecords(databaseName: string): Promise<LegacyFontRecord[]> {
  return new Promise((resolve) => {
    let created = false;
    const request = indexedDB.open(databaseName);
    request.onupgradeneeded = () => {
      created = true;
    };
    request.onerror = () => resolve([]);
    request.onsuccess = () => {
      const db = request.result;
      const storeName = [...db.objectStoreNames].find(
        (name) => name === 'fonts' || name === 'artifacts',
      );
      if (created || !storeName) {
        db.close();
        resolve([]);
        return;
      }
      const getAll = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      getAll.onsuccess = () => {
        const records = (getAll.result ?? []) as LegacyFontRecord[];
        db.close();
        resolve(records);
      };
      getAll.onerror = () => {
        db.close();
        resolve([]);
      };
    };
  });
}

async function migrateLegacyStorage(target: IDBDatabase): Promise<void> {
  try {
    const legacy = (
      await Promise.all(LEGACY_FONT_STORAGE_DATABASES.map((name) => readLegacyRecords(name)))
    ).flat();
    const records: StoredFontRecord[] = [];
    for (const old of legacy) {
      const familyName = old.familyName ?? old.family;
      if (!familyName || !old.data) continue;
      const data: ArrayBuffer =
        old.data instanceof Uint8Array ? Uint8Array.from(old.data).buffer : old.data;
      const oldMetadata = old.metadata ?? {};
      const metadata: FontStorageMetadata = {
        providerId: String(oldMetadata.providerId ?? old.providerId ?? 'legacy'),
        familyId:
          typeof oldMetadata.familyId === 'string'
            ? oldMetadata.familyId
            : familyName.toLowerCase(),
        packageVersion:
          typeof oldMetadata.packageVersion === 'string' ? oldMetadata.packageVersion : 'legacy',
        style: oldMetadata.style === 'italic' ? 'italic' : 'normal',
        license: typeof oldMetadata.license === 'string' ? oldMetadata.license : old.licenseName,
      };
      const contentHash = await sha256(data);
      records.push({
        key: storageKey(metadata, contentHash),
        familyName,
        data,
        metadata: { ...metadata, contentHash },
        storedAt: typeof old.storedAt === 'number' ? old.storedAt : Date.now(),
      });
    }
    if (records.length === 0) return;
    const transaction = target.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    for (const record of records) store.put(record);
    await transactionDone(transaction);
  } catch {
    // A corrupt or inaccessible legacy database must not prevent app startup.
  }
}
