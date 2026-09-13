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
  /** SHA-256 of the original artifact, independent of a collection member. */
  artifactHash?: string;
  /** Collection member selected from the original artifact. */
  collectionIndex?: number;
  /** Exact face identity (`sha256:<digest>:<member>`). */
  faceKey?: string;
  /** Optional document reference retaining a project-font lifetime. */
  documentId?: string;
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
  /** SHA-256 digest of the original bytes. */
  artifactHash: string;
  /** Exact face identity key. */
  faceKey: string;
  /** Integrity state written after validation. */
  integrity: 'verified';
}

interface StoredFaceRecord {
  faceKey: string;
  artifactHash: string;
  familyName: string;
  metadata: FontStorageMetadata;
  storedAt: number;
}

interface StoredArtifactRecord {
  artifactHash: string;
  data: ArrayBuffer;
  byteLength: number;
  refCount: number;
  storedAt: number;
}

interface MigrationJournalRecord {
  key: string;
  state: 'started' | 'complete';
  importedKeys: string[];
  updatedAt: number;
}

interface TombstoneRecord {
  key: string;
  faceKey: string;
  removedAt: number;
}

interface QuarantineRecord {
  key: string;
  faceKey: string;
  reason: string;
  /** Preserve the raw value so malformed legacy records remain recoverable. */
  record: unknown;
  quarantinedAt: number;
}

const DB_NAME = 'varve-font-storage-v2';
const STORE_NAME = 'artifacts';
const ARTIFACT_BLOBS_STORE = 'artifactBlobs';
const FACES_STORE = 'faces';
const MIGRATION_STORE = 'migrationJournal';
const TOMBSTONE_STORE = 'tombstones';
const QUARANTINE_STORE = 'quarantine';
const LEGACY_MIGRATION_KEY = 'legacy-font-storage-v1';
export const LEGACY_FONT_STORAGE_DATABASES = [
  'varve-font-storage',
  'varve-fonts',
  'strata-fonts',
] as const;

let migrationPromise: Promise<void> | undefined;

/** Reset the process-local migration guard for isolated storage tests. */
export function resetFontStorageMigrationForTests(): void {
  migrationPromise = undefined;
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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
      if (!request.result.objectStoreNames.contains(FACES_STORE)) {
        request.result.createObjectStore(FACES_STORE, { keyPath: 'faceKey' });
      }
      if (!request.result.objectStoreNames.contains(ARTIFACT_BLOBS_STORE)) {
        request.result.createObjectStore(ARTIFACT_BLOBS_STORE, { keyPath: 'artifactHash' });
      }
      if (!request.result.objectStoreNames.contains(MIGRATION_STORE)) {
        request.result.createObjectStore(MIGRATION_STORE, { keyPath: 'key' });
      }
      if (!request.result.objectStoreNames.contains(TOMBSTONE_STORE)) {
        request.result.createObjectStore(TOMBSTONE_STORE, { keyPath: 'key' });
      }
      if (!request.result.objectStoreNames.contains(QUARANTINE_STORE)) {
        request.result.createObjectStore(QUARANTINE_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Keep concurrent opens on one migration attempt. A failed attempt
      // clears the in-memory guard so a later open can retry from the durable
      // journal's `started` state; successful migrations remain cached because
      // legacy databases are otherwise needlessly reopened on every read.
      if (!migrationPromise) {
        migrationPromise = migrateLegacyStorage(db).then((completed) => {
          if (!completed) migrationPromise = undefined;
        });
      }
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

function artifactKey(contentHash: string): string {
  return `sha256:${contentHash.toLowerCase()}`;
}

function storageKey(metadata: FontStorageMetadata, contentHash: string): string {
  return canonicalFaceKey(metadata, contentHash);
}

function normalizeBytes(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof Uint8Array) {
    return Uint8Array.from(data).buffer;
  }
  return data.slice(0);
}

function normalizeDigest(value: string): string {
  return value.replace(/^sha256:/i, '').toLowerCase();
}

function isSha256Digest(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

function collectionMember(value: number | undefined): string {
  return Number.isInteger(value) && value !== undefined && value >= 0 ? String(value) : 'single';
}

function canonicalFaceKey(metadata: FontStorageMetadata, contentHash: string): string {
  const digest = normalizeDigest(contentHash);
  const fallback = `${artifactKey(digest)}:${collectionMember(metadata.collectionIndex)}`;
  const supplied = metadata.faceKey?.match(/^sha256:([0-9a-f]{64}):(single|0|[1-9][0-9]*)$/i);
  if (!supplied) return fallback;
  if (supplied[1]!.toLowerCase() !== digest) {
    throw new Error('Font face identity does not match the supplied bytes.');
  }
  if (
    metadata.collectionIndex !== undefined &&
    collectionMember(metadata.collectionIndex) !== supplied[2]!.toLowerCase()
  ) {
    throw new Error('Font face identity does not match the collection member.');
  }
  return `${artifactKey(digest)}:${supplied[2]!.toLowerCase()}`;
}

function recordArtifactDigest(record: Partial<StoredFontRecord>): string | null {
  const candidate =
    record.artifactHash ?? record.metadata?.artifactHash ?? record.metadata?.contentHash;
  if (typeof candidate !== 'string') return null;
  const digest = normalizeDigest(candidate);
  return isSha256Digest(digest) ? digest : null;
}

function recordFaceKey(value: unknown): string {
  const record = value && typeof value === 'object' ? (value as Partial<StoredFontRecord>) : {};
  return typeof record.faceKey === 'string' && record.faceKey.length > 0
    ? record.faceKey
    : typeof record.key === 'string'
      ? record.key
      : 'unknown';
}

function storedBytes(value: unknown): ArrayBuffer | null {
  if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
    return new Uint8Array(value as ArrayBuffer).slice().buffer;
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as Uint8Array;
    return Uint8Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)).buffer;
  }
  return null;
}

async function readStoredRecords(db: IDBDatabase): Promise<StoredFontRecord[]> {
  return (await requestResult(
    db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll(),
  )) as StoredFontRecord[];
}

/** Store one validated artifact by its complete identity. */
export async function storeFont(
  familyName: string,
  data: ArrayBuffer,
  metadata: FontStorageMetadata,
): Promise<StoredFontRecord> {
  if (typeof indexedDB === 'undefined') throw new Error('Local font storage is unavailable.');
  const bytes = normalizeBytes(data);
  const contentHash = await sha256(bytes);
  if (metadata.contentHash && normalizeDigest(metadata.contentHash) !== contentHash) {
    throw new Error('Font artifact hash does not match the supplied bytes.');
  }
  if (metadata.artifactHash && normalizeDigest(metadata.artifactHash) !== contentHash) {
    throw new Error('Font artifact identity does not match the supplied bytes.');
  }
  const resolvedFaceKey = canonicalFaceKey(metadata, contentHash);
  const resolvedMetadata: FontStorageMetadata = {
    ...metadata,
    contentHash,
    artifactHash: contentHash,
    faceKey: resolvedFaceKey,
  };
  const record: StoredFontRecord = {
    key: storageKey(resolvedMetadata, contentHash),
    familyName,
    data: bytes,
    metadata: resolvedMetadata,
    storedAt: Date.now(),
    artifactHash: contentHash,
    faceKey: resolvedFaceKey,
    integrity: 'verified',
  };
  const db = await openDb();
  try {
    const transaction = db.transaction(
      [STORE_NAME, FACES_STORE, ARTIFACT_BLOBS_STORE],
      'readwrite',
    );
    transaction.objectStore(STORE_NAME).put(record);
    const face: StoredFaceRecord = {
      faceKey: resolvedFaceKey,
      artifactHash: contentHash,
      familyName,
      metadata: resolvedMetadata,
      storedAt: record.storedAt,
    };
    const faceStore = transaction.objectStore(FACES_STORE);
    const existingFaceRequest = faceStore.get(resolvedFaceKey);
    faceStore.put(face);
    const artifactStore = transaction.objectStore(ARTIFACT_BLOBS_STORE);
    const artifactRequest = artifactStore.get(artifactKey(contentHash));
    let existingFace: StoredFaceRecord | undefined;
    let existingArtifact: StoredArtifactRecord | undefined;
    let faceRead = false;
    let artifactRead = false;
    const writeArtifact = () => {
      if (!faceRead || !artifactRead) return;
      artifactStore.put({
        artifactHash: artifactKey(contentHash),
        data: existingArtifact?.data ?? bytes,
        byteLength: existingArtifact?.byteLength ?? bytes.byteLength,
        refCount: (existingArtifact?.refCount ?? 0) + (existingFace ? 0 : 1),
        storedAt: existingArtifact?.storedAt ?? record.storedAt,
      } satisfies StoredArtifactRecord);
    };
    existingFaceRequest.onsuccess = () => {
      existingFace = existingFaceRequest.result as StoredFaceRecord | undefined;
      faceRead = true;
      writeArtifact();
    };
    artifactRequest.onsuccess = () => {
      existingArtifact = artifactRequest.result as StoredArtifactRecord | undefined;
      artifactRead = true;
      writeArtifact();
    };
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

/** Resolve one exact stored face without falling back to a family match. */
export async function getStoredFontByIdentity(
  identity: string | { artifactHash: string; collectionIndex?: number },
): Promise<StoredFontRecord | null> {
  if (typeof indexedDB === 'undefined') return null;
  const requestedKey =
    typeof identity === 'string'
      ? identity
      : isSha256Digest(normalizeDigest(identity.artifactHash))
        ? `${artifactKey(normalizeDigest(identity.artifactHash))}:${collectionMember(identity.collectionIndex)}`
        : null;
  if (!requestedKey) return null;
  const records = await listStoredFonts();
  return (
    records.find((record) => record.faceKey === requestedKey || record.key === requestedKey) ?? null
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
    const records = await readStoredRecords(db);
    const valid: StoredFontRecord[] = [];
    const invalid: Array<{ record: unknown; reason: string }> = [];
    for (const candidate of records) {
      const record = candidate as Partial<StoredFontRecord>;
      try {
        const bytes = storedBytes(record.data);
        const digest = bytes ? await sha256(bytes) : '';
        const expected = recordArtifactDigest(record);
        if (
          !bytes ||
          !expected ||
          digest !== expected ||
          record.integrity !== 'verified' ||
          typeof record.key !== 'string' ||
          !record.metadata
        ) {
          invalid.push({
            record: candidate,
            reason: 'Stored bytes failed integrity verification.',
          });
          continue;
        }
        valid.push({
          ...record,
          key: record.key,
          data: bytes,
          metadata: record.metadata,
          storedAt: typeof record.storedAt === 'number' ? record.storedAt : Date.now(),
          artifactHash: recordArtifactDigest(record) ?? digest,
          faceKey: recordFaceKey(record),
          integrity: 'verified',
        } as StoredFontRecord);
      } catch (cause) {
        invalid.push({
          record: candidate,
          reason: cause instanceof Error ? cause.message : 'Font integrity verification failed.',
        });
      }
    }
    if (invalid.length > 0) {
      const transaction = db.transaction([STORE_NAME, FACES_STORE, QUARANTINE_STORE], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const quarantine = transaction.objectStore(QUARANTINE_STORE);
      for (const { record, reason } of invalid) {
        const candidate =
          record && typeof record === 'object' ? (record as Partial<StoredFontRecord>) : {};
        const quarantineRecord: QuarantineRecord = {
          key: `${recordFaceKey(record)}:${Date.now()}`,
          faceKey: recordFaceKey(record),
          reason,
          record,
          quarantinedAt: Date.now(),
        };
        quarantine.put(quarantineRecord);
        if (typeof candidate.key === 'string') store.delete(candidate.key);
        if (candidate.faceKey || candidate.key) {
          transaction.objectStore(FACES_STORE).delete(recordFaceKey(record));
        }
      }
      await transactionDone(transaction);
    }
    return valid;
  } finally {
    db.close();
  }
}

export async function removeStoredFont(keyOrFamilyName: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  try {
    const records = await readStoredRecords(db);
    const transaction = db.transaction(
      [STORE_NAME, FACES_STORE, TOMBSTONE_STORE, ARTIFACT_BLOBS_STORE],
      'readwrite',
    );
    const store = transaction.objectStore(STORE_NAME);
    const tombstones = transaction.objectStore(TOMBSTONE_STORE);
    const removed = records.filter((record) => {
      const familyName = typeof record.familyName === 'string' ? record.familyName : '';
      return (
        record.key === keyOrFamilyName ||
        familyName.toLocaleLowerCase() === keyOrFamilyName.toLocaleLowerCase()
      );
    });
    const remainingByArtifact = new Map<string, number>();
    for (const record of records) {
      if (!removed.includes(record)) {
        const digest = recordArtifactDigest(record);
        if (!digest) continue;
        const key = artifactKey(digest);
        remainingByArtifact.set(key, (remainingByArtifact.get(key) ?? 0) + 1);
      }
    }
    const artifactStore = transaction.objectStore(ARTIFACT_BLOBS_STORE);
    for (const record of removed) {
      if (
        record.key === keyOrFamilyName ||
        (typeof record.familyName === 'string' &&
          record.familyName.toLocaleLowerCase() === keyOrFamilyName.toLocaleLowerCase())
      ) {
        store.delete(record.key);
        transaction.objectStore(FACES_STORE).delete(recordFaceKey(record));
        tombstones.put({
          key: recordFaceKey(record),
          faceKey: recordFaceKey(record),
          removedAt: Date.now(),
        } satisfies TombstoneRecord);
        const digest = recordArtifactDigest(record);
        if (!digest) continue;
        const artifactHash = artifactKey(digest);
        const artifactRequest = artifactStore.get(artifactHash);
        artifactRequest.onsuccess = () => {
          const artifact = artifactRequest.result as StoredArtifactRecord | undefined;
          if (!artifact) return;
          const refCount = remainingByArtifact.get(artifactHash) ?? 0;
          if (refCount === 0) artifactStore.delete(artifactHash);
          else artifactStore.put({ ...artifact, refCount });
        };
      }
    }
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

/** Remove exactly one face and leave a durable tombstone for migrations. */
export async function removeStoredFontByIdentity(
  identity: string | { artifactHash: string; collectionIndex?: number },
): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  const requestedKey =
    typeof identity === 'string'
      ? identity
      : isSha256Digest(normalizeDigest(identity.artifactHash))
        ? `${artifactKey(normalizeDigest(identity.artifactHash))}:${collectionMember(identity.collectionIndex)}`
        : null;
  if (!requestedKey) return false;
  const db = await openDb();
  try {
    const records = await readStoredRecords(db);
    const record = records.find((candidate) => candidate.key === requestedKey);
    if (!record) return false;
    const transaction = db.transaction(
      [STORE_NAME, FACES_STORE, TOMBSTONE_STORE, ARTIFACT_BLOBS_STORE],
      'readwrite',
    );
    const store = transaction.objectStore(STORE_NAME);
    store.delete(requestedKey);
    transaction.objectStore(FACES_STORE).delete(recordFaceKey(record));
    transaction.objectStore(TOMBSTONE_STORE).put({
      key: recordFaceKey(record),
      faceKey: recordFaceKey(record),
      removedAt: Date.now(),
    } satisfies TombstoneRecord);
    const artifactStore = transaction.objectStore(ARTIFACT_BLOBS_STORE);
    const digest = recordArtifactDigest(record);
    if (!digest) {
      await transactionDone(transaction);
      return true;
    }
    const artifactHash = artifactKey(digest);
    const remaining = records
      .filter((candidate) => candidate.key !== requestedKey)
      .filter(
        (candidate) =>
          recordArtifactDigest(candidate) !== null &&
          artifactKey(recordArtifactDigest(candidate)!) === artifactHash,
      ).length;
    const artifactRequest = artifactStore.get(artifactHash);
    artifactRequest.onsuccess = () => {
      const artifact = artifactRequest.result as StoredArtifactRecord | undefined;
      if (!artifact) return;
      if (remaining === 0) artifactStore.delete(artifactHash);
      else artifactStore.put({ ...artifact, refCount: remaining });
    };
    await transactionDone(transaction);
    return true;
  } finally {
    db.close();
  }
}

export async function getStoredFontCount(): Promise<number> {
  return (await listStoredFonts()).length;
}

interface LegacyFontRecord {
  key?: string;
  family?: string;
  familyName?: string;
  data?: ArrayBuffer | Uint8Array;
  metadata?: Record<string, unknown>;
  providerId?: string;
  licenseName?: string;
  storedAt?: string | number;
}

interface MigrationRecord {
  key?: string;
  family?: string;
  familyName?: string;
  data?: ArrayBuffer | Uint8Array;
  metadata?: Record<string, unknown> | FontStorageMetadata;
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

async function migrateLegacyStorage(target: IDBDatabase): Promise<boolean> {
  try {
    const journal = (await requestResult(
      target
        .transaction(MIGRATION_STORE, 'readonly')
        .objectStore(MIGRATION_STORE)
        .get(LEGACY_MIGRATION_KEY),
    )) as MigrationJournalRecord | undefined;
    if (journal?.state === 'complete') return true;

    const startTransaction = target.transaction(MIGRATION_STORE, 'readwrite');
    startTransaction.objectStore(MIGRATION_STORE).put({
      key: LEGACY_MIGRATION_KEY,
      state: 'started',
      importedKeys: journal?.importedKeys ?? [],
      updatedAt: Date.now(),
    } satisfies MigrationJournalRecord);
    await transactionDone(startTransaction);

    const existing = (await requestResult(
      target.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll(),
    )) as MigrationRecord[];
    const legacy = (
      await Promise.all(LEGACY_FONT_STORAGE_DATABASES.map((name) => readLegacyRecords(name)))
    ).flat();
    const records: StoredFontRecord[] = [];
    const sourceRecords: MigrationRecord[] = [...existing, ...legacy];
    const tombstones = (await requestResult(
      target.transaction(TOMBSTONE_STORE, 'readonly').objectStore(TOMBSTONE_STORE).getAll(),
    )) as TombstoneRecord[];
    const removed = new Set(tombstones.flatMap((tombstone) => [tombstone.key, tombstone.faceKey]));
    for (const old of sourceRecords) {
      try {
        const familyName = old.familyName ?? old.family;
        if (!familyName || !old.data) continue;
        // A legacy key was sometimes the family name. Honour either form so
        // a completed removal cannot be resurrected by a later retry.
        if (old.key && removed.has(old.key)) continue;
        if (removed.has(familyName)) continue;
        const data: ArrayBuffer =
          old.data instanceof Uint8Array
            ? Uint8Array.from(old.data).buffer
            : normalizeBytes(old.data);
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
          collectionIndex:
            typeof oldMetadata.collectionIndex === 'number'
              ? oldMetadata.collectionIndex
              : undefined,
        };
        const contentHash = await sha256(data);
        const resolvedFaceKey = canonicalFaceKey(metadata, contentHash);
        if (removed.has(resolvedFaceKey)) continue;
        if (records.some((record) => record.faceKey === resolvedFaceKey)) continue;
        records.push({
          key: resolvedFaceKey,
          familyName,
          data,
          metadata: {
            ...metadata,
            contentHash,
            artifactHash: contentHash,
            faceKey: resolvedFaceKey,
          },
          storedAt: typeof old.storedAt === 'number' ? old.storedAt : Date.now(),
          artifactHash: contentHash,
          faceKey: resolvedFaceKey,
          integrity: 'verified',
        });
      } catch {
        // One malformed legacy entry must not block recoverable entries.
      }
    }
    const transaction = target.transaction(
      [STORE_NAME, FACES_STORE, ARTIFACT_BLOBS_STORE, MIGRATION_STORE],
      'readwrite',
    );
    const store = transaction.objectStore(STORE_NAME);
    const faceStore = transaction.objectStore(FACES_STORE);
    const artifactStore = transaction.objectStore(ARTIFACT_BLOBS_STORE);
    const artifactCounts = new Map<string, number>();
    for (const record of records) {
      store.put(record);
      faceStore.put({
        faceKey: record.faceKey,
        artifactHash: record.artifactHash,
        familyName: record.familyName,
        metadata: record.metadata,
        storedAt: record.storedAt,
      } satisfies StoredFaceRecord);
      const key = artifactKey(record.artifactHash);
      artifactCounts.set(key, (artifactCounts.get(key) ?? 0) + 1);
      artifactStore.put({
        artifactHash: key,
        data: record.data,
        byteLength: record.data.byteLength,
        refCount: artifactCounts.get(key)!,
        storedAt: record.storedAt,
      } satisfies StoredArtifactRecord);
    }
    transaction.objectStore(MIGRATION_STORE).put({
      key: LEGACY_MIGRATION_KEY,
      state: 'complete',
      importedKeys: records.map((record) => record.faceKey),
      updatedAt: Date.now(),
    } satisfies MigrationJournalRecord);
    await transactionDone(transaction);
    return true;
  } catch {
    // A corrupt or inaccessible legacy database must not prevent app startup.
    // Returning false lets the next database open retry the durable journal.
    return false;
  }
}
