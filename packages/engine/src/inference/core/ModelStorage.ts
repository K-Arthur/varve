import { sha256 } from '@noble/hashes/sha2.js';
import { migrateLegacyIndexedDb } from '@varve/platform';
import { InferenceError } from './InferenceError';

export interface ModelArtifactMetadata {
  modelId: string;
  sizeBytes: number;
  sha256: string | null;
  installedAt: number;
}

export interface ModelArtifactHandle {
  readonly metadata: ModelArtifactMetadata;
  openStream(): ReadableStream<Uint8Array>;
  toBlob(): Promise<Blob>;
  arrayBuffer(): Promise<ArrayBuffer>;
  readPrefix(maxBytes: number): Promise<Uint8Array>;
}

export interface ModelInstallOptions {
  expectedSizeBytes?: number;
  expectedSha256?: string;
}

export interface PartialDownloadMetadata {
  modelId: string;
  url: string;
  etag: string | null;
  loaded: number;
}

export interface PartialArtifactHandle {
  readonly metadata: PartialDownloadMetadata;
  readonly artifact: ModelArtifactHandle;
}

export interface StagedModelWrite {
  readonly modelId: string;
  readonly bytesWritten: number;
  write(bytes: Uint8Array): Promise<void>;
  /** Publishes the artifact only after its expected size and digest match. */
  commit(): Promise<ModelArtifactMetadata>;
  /** Makes verified bytes resumable without exposing them as an installed model. */
  pause(metadata: Omit<PartialDownloadMetadata, 'modelId' | 'loaded'>): Promise<void>;
  abort(): Promise<void>;
}

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
  statInstalled(modelId: string): Promise<ModelArtifactMetadata | null>;
  openInstalledArtifact(modelId: string): Promise<ModelArtifactHandle | null>;
  beginInstalledWrite(modelId: string, options?: ModelInstallOptions): Promise<StagedModelWrite>;
  /** Atomically swaps verified temporary artifacts into their public model ids. */
  publishInstalledBatch(entries: Array<{ stagedId: string; modelId: string }>): Promise<void>;
  deleteInstalled(modelId: string): Promise<void>;
  hasInstalled(modelId: string): Promise<boolean>;
  listInstalled(): Promise<string[]>;
  savePartial(modelId: string, record: PartialDownloadRecord): Promise<void>;
  loadPartial(modelId: string): Promise<PartialDownloadRecord | null>;
  getPartialMetadata(modelId: string): Promise<PartialDownloadMetadata | null>;
  openPartialArtifact(modelId: string): Promise<PartialArtifactHandle | null>;
  deletePartial(modelId: string): Promise<void>;
  getQuota(): Promise<StorageQuota>;
  clear(): Promise<void>;
}

interface ArtifactSink {
  write(bytes: Uint8Array): Promise<void>;
  publish(metadata: ModelArtifactMetadata): Promise<void>;
  pause(metadata: PartialDownloadMetadata): Promise<void>;
  abort(): Promise<void>;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

class VerifiedModelWrite implements StagedModelWrite {
  private size = 0;
  private closed = false;
  private readonly hasher = sha256.create();

  constructor(
    readonly modelId: string,
    private readonly options: ModelInstallOptions,
    private readonly sink: ArtifactSink,
  ) {}

  get bytesWritten(): number {
    return this.size;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('Model artifact writer is already closed');
    if (bytes.byteLength === 0) return;
    await this.sink.write(bytes);
    this.hasher.update(bytes);
    this.size += bytes.byteLength;
  }

  async commit(): Promise<ModelArtifactMetadata> {
    if (this.closed) throw new Error('Model artifact writer is already closed');
    const digest = toHex(this.hasher.digest());
    if (
      this.options.expectedSizeBytes !== undefined &&
      this.size !== this.options.expectedSizeBytes
    ) {
      await this.abort();
      throw new InferenceError('model_download_failed', undefined, {
        technical: `Expected ${this.options.expectedSizeBytes} bytes, received ${this.size}.`,
      });
    }
    if (this.options.expectedSha256 && digest !== this.options.expectedSha256.toLowerCase()) {
      await this.abort();
      throw new InferenceError('checksum_mismatch', undefined, {
        technical: `Expected ${this.options.expectedSha256.toLowerCase()}, got ${digest}.`,
      });
    }
    const metadata: ModelArtifactMetadata = {
      modelId: this.modelId,
      sizeBytes: this.size,
      sha256: digest,
      installedAt: Date.now(),
    };
    await this.sink.publish(metadata);
    this.closed = true;
    return metadata;
  }

  async pause(metadata: Omit<PartialDownloadMetadata, 'modelId' | 'loaded'>): Promise<void> {
    if (this.closed) return;
    await this.sink.pause({ ...metadata, modelId: this.modelId, loaded: this.size });
    this.closed = true;
  }

  async abort(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.sink.abort();
  }
}

function artifactHandle(
  metadata: ModelArtifactMetadata,
  getBlob: () => Promise<Blob>,
  stream?: () => ReadableStream<Uint8Array>,
): ModelArtifactHandle {
  return {
    metadata,
    openStream: () => {
      if (stream) return stream();
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let pending: Promise<ReadableStreamDefaultReader<Uint8Array>> | null = null;
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            pending ??= getBlob().then((blob) => blob.stream().getReader());
            reader ??= await pending;
            const { done, value } = await reader.read();
            if (done) controller.close();
            else controller.enqueue(value);
          } catch (error) {
            controller.error(error);
          }
        },
        async cancel(reason) {
          await reader?.cancel(reason);
        },
      });
    },
    toBlob: getBlob,
    async arrayBuffer() {
      return (await getBlob()).arrayBuffer();
    },
    async readPrefix(maxBytes) {
      const limit = Math.max(0, Math.trunc(maxBytes));
      if (limit === 0) return new Uint8Array();
      const reader = this.openStream().getReader();
      const parts: Uint8Array[] = [];
      let length = 0;
      try {
        while (length < limit) {
          const { done, value } = await reader.read();
          if (done) break;
          const take = Math.min(value.length, limit - length);
          parts.push(value.subarray(0, take));
          length += take;
          if (take < value.length) break;
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const prefix = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) {
        prefix.set(part, offset);
        offset += part.length;
      }
      return prefix;
    },
  };
}

interface ArtifactRecord {
  storageFormat: 'varve-model-artifact';
  modelId: string;
  backend: 'opfs' | 'indexeddb-chunks';
  artifactId: string;
  chunkCount: number;
  sizeBytes: number;
  sha256: string | null;
  installedAt: number;
}

interface PartialArtifactRecord {
  storageFormat: 'varve-partial-artifact';
  modelId: string;
  url: string;
  etag: string | null;
  loaded: number;
  backend: 'opfs' | 'indexeddb-chunks';
  artifactId: string;
  chunkCount: number;
}

const ARTIFACT_DIRECTORY = 'varve-model-artifacts';
const STORAGE_CHUNK_BYTES = 256 * 1024;
const ARTIFACT_CHUNK_STORE = 'artifact-chunks';

function isArtifactRecord(value: unknown): value is ArtifactRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'storageFormat' in value &&
    (value as { storageFormat?: unknown }).storageFormat === 'varve-model-artifact'
  );
}

function isPartialArtifactRecord(value: unknown): value is PartialArtifactRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'storageFormat' in value &&
    (value as { storageFormat?: unknown }).storageFormat === 'varve-partial-artifact'
  );
}

function storageError(error: unknown): never {
  if (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  ) {
    throw new InferenceError('insufficient_disk_space', error);
  }
  throw error;
}

class IndexedDBStorage implements ModelStorage {
  readonly name = 'indexeddb';
  private dbName = 'varve-model-store';
  private legacyDbName = 'strata-model-store';
  private dbVersion = 4;
  private storeName = 'models';
  private partialStore = 'partials';

  constructor(private readonly preferOpfs = true) {}

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
        if (!db.objectStoreNames.contains(ARTIFACT_CHUNK_STORE)) {
          db.createObjectStore(ARTIFACT_CHUNK_STORE);
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

  private async artifactDirectory(): Promise<FileSystemDirectoryHandle | null> {
    if (!this.preferOpfs || typeof navigator === 'undefined' || !navigator.storage) return null;
    const getDirectory = (
      navigator.storage as unknown as {
        getDirectory?: () => Promise<FileSystemDirectoryHandle>;
      }
    ).getDirectory;
    if (!getDirectory) return null;
    try {
      const root = await getDirectory.call(navigator.storage);
      return await root.getDirectoryHandle(ARTIFACT_DIRECTORY, { create: true });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') storageError(error);
      return null;
    }
  }

  private async readRecord(storeName: string, key: string): Promise<unknown> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error(`Read failed: ${key}`));
      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error(`Read failed: ${key}`));
      };
    });
  }

  private async writeRecord(storeName: string, key: string, value: unknown): Promise<unknown> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      let previous: unknown;
      const request = store.get(key);
      request.onsuccess = () => {
        previous = request.result;
        store.put(value, key);
      };
      request.onerror = () => tx.abort();
      tx.oncomplete = () => {
        db.close();
        resolve(previous);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error(`Write failed: ${key}`));
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error ?? request.error ?? new Error(`Write failed: ${key}`));
      };
    });
  }

  private async deleteRecord(storeName: string, key: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error(`Delete failed: ${key}`));
      };
    });
  }

  private async readChunk(artifactId: string, index: number): Promise<Blob | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ARTIFACT_CHUNK_STORE, 'readonly');
      const request = tx.objectStore(ARTIFACT_CHUNK_STORE).get(this.chunkKey(artifactId, index));
      request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Failed to read model chunk'));
      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error('Failed to read model chunk'));
      };
    });
  }

  private chunkKey(artifactId: string, index: number): string {
    return `${artifactId}:${index.toString().padStart(8, '0')}`;
  }

  private async deleteChunks(artifactId: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ARTIFACT_CHUNK_STORE, 'readwrite');
      const store = tx.objectStore(ARTIFACT_CHUNK_STORE);
      const prefix = `${artifactId}:`;
      const rangeType = globalThis.IDBKeyRange;
      const range = rangeType?.bound(prefix, `${prefix}\uffff`);
      const request = store.openCursor(range);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (String(cursor.key).startsWith(prefix)) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error('Failed to remove staged model chunks'));
      };
    });
  }

  private async deleteArtifact(record: unknown): Promise<void> {
    if (!isArtifactRecord(record) && !isPartialArtifactRecord(record)) return;
    if (record.backend === 'indexeddb-chunks') {
      await this.deleteChunks(record.artifactId);
      return;
    }
    const directory = await this.artifactDirectory();
    await directory?.removeEntry(record.artifactId).catch(() => undefined);
  }

  private async makeChunkSink(artifactId: string): Promise<ArtifactSink> {
    let index = 0;
    const persist = async (bytes: Uint8Array): Promise<void> => {
      const db = await this.openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(ARTIFACT_CHUNK_STORE, 'readwrite');
        const store = tx.objectStore(ARTIFACT_CHUNK_STORE);
        for (let offset = 0; offset < bytes.length; offset += STORAGE_CHUNK_BYTES) {
          const chunk = bytes.slice(offset, Math.min(offset + STORAGE_CHUNK_BYTES, bytes.length));
          store.put(new Blob([chunk]), this.chunkKey(artifactId, index++));
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Failed to stage model chunk'));
        tx.onabort = () => reject(tx.error ?? new Error('Failed to stage model chunk'));
      })
        .catch(storageError)
        .finally(() => db.close());
    };
    const publish = async (metadata: ModelArtifactMetadata): Promise<void> => {
      const record: ArtifactRecord = {
        storageFormat: 'varve-model-artifact',
        modelId: metadata.modelId,
        backend: 'indexeddb-chunks',
        artifactId,
        chunkCount: index,
        sizeBytes: metadata.sizeBytes,
        sha256: metadata.sha256,
        installedAt: metadata.installedAt,
      };
      const previous = await this.writeRecord(this.storeName, metadata.modelId, record).catch(
        storageError,
      );
      await this.deleteArtifact(previous).catch(() => undefined);
    };
    const pause = async (metadata: PartialDownloadMetadata): Promise<void> => {
      const record: PartialArtifactRecord = {
        storageFormat: 'varve-partial-artifact',
        modelId: metadata.modelId,
        url: metadata.url,
        etag: metadata.etag,
        loaded: metadata.loaded,
        backend: 'indexeddb-chunks',
        artifactId,
        chunkCount: index,
      };
      const previous = await this.writeRecord(this.partialStore, metadata.modelId, record).catch(
        storageError,
      );
      await this.deleteArtifact(previous).catch(() => undefined);
    };
    return {
      async write(bytes) {
        await persist(bytes);
      },
      publish,
      pause,
      abort: () => this.deleteChunks(artifactId),
    };
  }

  private async makeOpfsSink(
    artifactId: string,
    directory: FileSystemDirectoryHandle,
  ): Promise<ArtifactSink> {
    const file = await directory.getFileHandle(artifactId, { create: true });
    const writer = await file.createWritable();
    let chunkCount = 0;
    const close = async () => {
      await writer.close();
    };
    const publish = async (metadata: ModelArtifactMetadata): Promise<void> => {
      await close();
      const record: ArtifactRecord = {
        storageFormat: 'varve-model-artifact',
        modelId: metadata.modelId,
        backend: 'opfs',
        artifactId,
        chunkCount,
        sizeBytes: metadata.sizeBytes,
        sha256: metadata.sha256,
        installedAt: metadata.installedAt,
      };
      const previous = await this.writeRecord(this.storeName, metadata.modelId, record).catch(
        storageError,
      );
      await this.deleteArtifact(previous).catch(() => undefined);
    };
    const pause = async (metadata: PartialDownloadMetadata): Promise<void> => {
      await close();
      const record: PartialArtifactRecord = {
        storageFormat: 'varve-partial-artifact',
        modelId: metadata.modelId,
        url: metadata.url,
        etag: metadata.etag,
        loaded: metadata.loaded,
        backend: 'opfs',
        artifactId,
        chunkCount,
      };
      const previous = await this.writeRecord(this.partialStore, metadata.modelId, record).catch(
        storageError,
      );
      await this.deleteArtifact(previous).catch(() => undefined);
    };
    return {
      async write(bytes) {
        for (let offset = 0; offset < bytes.length; offset += STORAGE_CHUNK_BYTES) {
          const chunk = new Blob([
            bytes.slice(offset, Math.min(offset + STORAGE_CHUNK_BYTES, bytes.length)),
          ]);
          await writer.write(chunk);
          chunkCount++;
        }
      },
      publish,
      pause,
      async abort() {
        await writer.abort().catch(() => undefined);
        await directory.removeEntry(artifactId).catch(() => undefined);
      },
    };
  }

  async publishInstalledBatch(
    entries: Array<{ stagedId: string; modelId: string }>,
  ): Promise<void> {
    if (entries.length === 0) return;
    const stagedIds = new Set(entries.map((entry) => entry.stagedId));
    const modelIds = new Set(entries.map((entry) => entry.modelId));
    if (
      stagedIds.size !== entries.length ||
      modelIds.size !== entries.length ||
      entries.some((entry) => entry.stagedId === entry.modelId || modelIds.has(entry.stagedId))
    ) {
      throw new Error('A model publication batch must contain unique staging and destination ids.');
    }

    const db = await this.openDB();
    const previous = new Map<string, unknown>();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const staged = new Map<string, unknown>();
      let remaining = entries.length * 2;
      let queued = false;
      let abortReason = '';
      const finishReads = () => {
        remaining--;
        if (remaining !== 0 || queued) return;
        queued = true;
        for (const entry of entries) {
          const candidate = staged.get(entry.stagedId);
          if (!isArtifactRecord(candidate)) {
            abortReason = `Verified staged model ${entry.stagedId} is missing; multipart publication is incomplete.`;
            tx.abort();
            return;
          }
          const target = previous.get(entry.modelId);
          const published: ArtifactRecord = { ...candidate, modelId: entry.modelId };
          store.put(published, entry.modelId);
          store.delete(entry.stagedId);
          if (target !== undefined) previous.set(entry.modelId, target);
        }
      };

      for (const entry of entries) {
        const stagedRequest = store.get(entry.stagedId);
        stagedRequest.onsuccess = () => {
          staged.set(entry.stagedId, stagedRequest.result);
          finishReads();
        };
        stagedRequest.onerror = () => tx.abort();
        const targetRequest = store.get(entry.modelId);
        targetRequest.onsuccess = () => {
          if (targetRequest.result !== undefined) previous.set(entry.modelId, targetRequest.result);
          finishReads();
        };
        targetRequest.onerror = () => tx.abort();
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => undefined;
      tx.onabort = () => {
        db.close();
        reject(
          new Error(abortReason || tx.error?.message || 'Failed to publish model artifact batch'),
        );
      };
    });
    await Promise.all(
      [...previous.values()].map((record) => this.deleteArtifact(record).catch(() => undefined)),
    );
  }

  private async chunkedArtifact(record: ArtifactRecord): Promise<ModelArtifactHandle | null> {
    const metadata: ModelArtifactMetadata = {
      modelId: record.modelId,
      sizeBytes: record.sizeBytes,
      sha256: record.sha256,
      installedAt: record.installedAt,
    };
    if (record.backend === 'opfs') {
      const directory = await this.artifactDirectory();
      if (!directory) return null;
      const file = await directory.getFileHandle(record.artifactId).catch(() => null);
      if (!file) return null;
      return artifactHandle(
        metadata,
        async () => file.getFile(),
        () => {
          let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
          let pending: Promise<ReadableStreamDefaultReader<Uint8Array>> | null = null;
          return new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                pending ??= file.getFile().then((modelFile) => modelFile.stream().getReader());
                reader ??= await pending;
                const { done, value } = await reader.read();
                if (done) controller.close();
                else controller.enqueue(value);
              } catch (error) {
                controller.error(error);
              }
            },
            async cancel(reason) {
              await reader?.cancel(reason);
            },
          });
        },
      );
    }
    const storage = this;
    return artifactHandle(
      metadata,
      async () => {
        const parts: Blob[] = [];
        for (let index = 0; index < record.chunkCount; index++) {
          const chunk = await this.readChunk(record.artifactId, index);
          if (!chunk) throw new Error(`Missing model chunk ${index} for ${record.modelId}`);
          parts.push(chunk);
        }
        return new Blob(parts, { type: 'application/octet-stream' });
      },
      () => {
        let index = 0;
        return new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (index >= record.chunkCount) {
              controller.close();
              return;
            }
            try {
              const chunk = await storage.readChunk(record.artifactId, index++);
              if (!chunk) throw new Error(`Missing model chunk for ${record.modelId}`);
              controller.enqueue(new Uint8Array(await chunk.arrayBuffer()));
            } catch (error) {
              controller.error(error);
            }
          },
        });
      },
    );
  }

  async statInstalled(modelId: string): Promise<ModelArtifactMetadata | null> {
    const record = await this.readRecord(this.storeName, modelId);
    if (isArtifactRecord(record)) {
      if (record.backend === 'opfs') {
        const directory = await this.artifactDirectory();
        const file = await directory?.getFileHandle(record.artifactId).catch(() => null);
        if (!file || (await file.getFile()).size !== record.sizeBytes) return null;
      }
      return {
        modelId,
        sizeBytes: record.sizeBytes,
        sha256: record.sha256,
        installedAt: record.installedAt,
      };
    }
    if (record instanceof Blob) {
      return { modelId, sizeBytes: record.size, sha256: null, installedAt: 0 };
    }
    if (record && typeof record === 'object' && 'bytes' in record) {
      const bytes = (record as { bytes?: unknown }).bytes;
      const sizeBytes =
        bytes instanceof ArrayBuffer
          ? bytes.byteLength
          : bytes instanceof Uint8Array
            ? bytes.byteLength
            : null;
      if (sizeBytes !== null) {
        const installedAt =
          'installedAt' in record && typeof record.installedAt === 'number'
            ? record.installedAt
            : 0;
        return { modelId, sizeBytes, sha256: null, installedAt };
      }
    }
    return null;
  }

  async openInstalledArtifact(modelId: string): Promise<ModelArtifactHandle | null> {
    const record = await this.readRecord(this.storeName, modelId);
    if (isArtifactRecord(record)) return this.chunkedArtifact(record);
    const metadata = await this.statInstalled(modelId);
    if (!metadata) return null;
    if (record instanceof Blob) return artifactHandle(metadata, async () => record);
    if (record && typeof record === 'object' && 'bytes' in record) {
      const bytes = (record as { bytes?: unknown }).bytes;
      if (bytes instanceof ArrayBuffer) {
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        return artifactHandle(metadata, async () => blob);
      }
      if (bytes instanceof Uint8Array) {
        const blob = new Blob([bytes.slice()], { type: 'application/octet-stream' });
        return artifactHandle(metadata, async () => blob);
      }
    }
    return null;
  }

  async beginInstalledWrite(
    modelId: string,
    options: ModelInstallOptions = {},
  ): Promise<StagedModelWrite> {
    const artifactId = `artifact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    const directory = await this.artifactDirectory();
    if (directory) {
      try {
        return new VerifiedModelWrite(
          modelId,
          options,
          await this.makeOpfsSink(artifactId, directory),
        );
      } catch (error) {
        await directory.removeEntry(artifactId).catch(() => undefined);
        if (
          error instanceof DOMException &&
          (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
        ) {
          storageError(error);
        }
      }
    }
    return new VerifiedModelWrite(modelId, options, await this.makeChunkSink(artifactId));
  }

  async saveInstalled(modelId: string, bytes: ArrayBuffer): Promise<void> {
    const writer = await this.beginInstalledWrite(modelId, { expectedSizeBytes: bytes.byteLength });
    try {
      const view = new Uint8Array(bytes);
      for (let offset = 0; offset < view.length; offset += STORAGE_CHUNK_BYTES) {
        await writer.write(
          view.subarray(offset, Math.min(offset + STORAGE_CHUNK_BYTES, view.length)),
        );
      }
      await writer.commit();
    } catch (error) {
      await writer.abort();
      throw error;
    }
  }

  async loadInstalled(modelId: string): Promise<ArrayBuffer | null> {
    const artifact = await this.openInstalledArtifact(modelId);
    return artifact ? artifact.arrayBuffer() : null;
  }

  async deleteInstalled(modelId: string): Promise<void> {
    const previous = await this.readRecord(this.storeName, modelId);
    await this.deleteRecord(this.storeName, modelId);
    await this.deleteArtifact(previous);
  }

  async hasInstalled(modelId: string): Promise<boolean> {
    return (await this.statInstalled(modelId)) !== null;
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
    const writer = await this.beginInstalledWrite(modelId);
    try {
      await writer.write(record.bytes);
      await writer.pause({ url: record.url, etag: record.etag });
    } catch (error) {
      await writer.abort();
      throw error;
    }
  }

  async loadPartial(modelId: string): Promise<PartialDownloadRecord | null> {
    const partial = await this.openPartialArtifact(modelId);
    if (!partial) return null;
    return {
      bytes: new Uint8Array(await partial.artifact.arrayBuffer()),
      url: partial.metadata.url,
      etag: partial.metadata.etag,
      loaded: partial.metadata.loaded,
    };
  }

  async getPartialMetadata(modelId: string): Promise<PartialDownloadMetadata | null> {
    const record = await this.readRecord(this.partialStore, modelId);
    if (isPartialArtifactRecord(record)) {
      return {
        modelId,
        url: record.url,
        etag: record.etag,
        loaded: record.loaded,
      };
    }
    if (
      record &&
      typeof record === 'object' &&
      'bytes' in record &&
      'url' in record &&
      'loaded' in record
    ) {
      const partial = record as PartialDownloadRecord;
      return {
        modelId,
        url: partial.url,
        etag: partial.etag,
        loaded: partial.loaded,
      };
    }
    return null;
  }

  async openPartialArtifact(modelId: string): Promise<PartialArtifactHandle | null> {
    const record = await this.readRecord(this.partialStore, modelId);
    if (isPartialArtifactRecord(record)) {
      const artifact = await this.chunkedArtifact({
        storageFormat: 'varve-model-artifact',
        modelId,
        backend: record.backend,
        artifactId: record.artifactId,
        chunkCount: record.chunkCount,
        sizeBytes: record.loaded,
        sha256: null,
        installedAt: 0,
      });
      if (!artifact) return null;
      return {
        metadata: {
          modelId,
          url: record.url,
          etag: record.etag,
          loaded: record.loaded,
        },
        artifact,
      };
    }
    if (
      record &&
      typeof record === 'object' &&
      'bytes' in record &&
      'url' in record &&
      'loaded' in record
    ) {
      const partial = record as PartialDownloadRecord;
      const bytes = partial.bytes;
      const blob = new Blob([bytes.slice()], { type: 'application/octet-stream' });
      const artifact = artifactHandle(
        { modelId, sizeBytes: bytes.byteLength, sha256: null, installedAt: 0 },
        async () => blob,
      );
      return {
        metadata: {
          modelId,
          url: partial.url,
          etag: partial.etag,
          loaded: partial.loaded,
        },
        artifact,
      };
    }
    return null;
  }

  async deletePartial(modelId: string): Promise<void> {
    const previous = await this.readRecord(this.partialStore, modelId);
    await this.deleteRecord(this.partialStore, modelId);
    await this.deleteArtifact(previous);
  }

  async getQuota(): Promise<StorageQuota> {
    let used = 0;
    const ids = await this.listInstalled();
    for (const id of ids) {
      const metadata = await this.statInstalled(id);
      if (metadata) used += metadata.sizeBytes;
    }
    let available: number | null = null;
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota != null && estimate.usage != null) {
        available = estimate.quota - estimate.usage + used;
      }
    }
    return { used, available };
  }

  async clear(): Promise<void> {
    const modelIds = await this.listInstalled();
    for (const modelId of modelIds) await this.deleteInstalled(modelId);
    const db = await this.openDB();
    const partialIds = await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(this.partialStore, 'readonly');
      const request = tx.objectStore(this.partialStore).getAllKeys();
      request.onsuccess = () => resolve((request.result as IDBValidKey[]).map(String));
      request.onerror = () => reject(request.error ?? new Error('Failed to list partial models'));
      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error('Failed to list partial models'));
      };
    });
    for (const modelId of partialIds) await this.deletePartial(modelId);
    const chunkDb = await this.openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = chunkDb.transaction(ARTIFACT_CHUNK_STORE, 'readwrite');
      tx.objectStore(ARTIFACT_CHUNK_STORE).clear();
      tx.oncomplete = () => {
        chunkDb.close();
        resolve();
      };
      tx.onerror = () => {
        chunkDb.close();
        reject(tx.error ?? new Error('Failed to clear staged model chunks'));
      };
    });
    const directory = await this.artifactDirectory();
    if (directory) {
      try {
        for await (const [name] of directory.entries()) {
          await directory.removeEntry(name).catch(() => undefined);
        }
      } catch {}
    }
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
    void modelId;
    void bytes;
    throw new Error(
      'localStorage model records are read-only; use IndexedDB or OPFS for model writes.',
    );
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

  async statInstalled(modelId: string): Promise<ModelArtifactMetadata | null> {
    try {
      const raw =
        localStorage.getItem(this.key(modelId)) ?? localStorage.getItem(this.legacyKey(modelId));
      if (!raw) return null;
      const start = raw.indexOf('"data"');
      const open = start < 0 ? -1 : raw.indexOf('[', start);
      const close = open < 0 ? -1 : raw.indexOf(']', open);
      if (close < 0) return null;
      const body = raw.slice(open + 1, close);
      const sizeBytes = body.trim().length === 0 ? 0 : (body.match(/,/g)?.length ?? 0) + 1;
      return { modelId, sizeBytes, sha256: null, installedAt: 0 };
    } catch {
      return null;
    }
  }

  async openInstalledArtifact(modelId: string): Promise<ModelArtifactHandle | null> {
    const bytes = await this.loadInstalled(modelId);
    if (!bytes) return null;
    const metadata = (await this.statInstalled(modelId)) ?? {
      modelId,
      sizeBytes: bytes.byteLength,
      sha256: null,
      installedAt: 0,
    };
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    return artifactHandle(metadata, async () => blob);
  }

  async beginInstalledWrite(): Promise<StagedModelWrite> {
    throw new Error(
      'localStorage model records are read-only; use IndexedDB or OPFS for model writes.',
    );
  }

  async publishInstalledBatch(): Promise<void> {
    throw new Error(
      'localStorage model records are read-only; use IndexedDB or OPFS for model writes.',
    );
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
    void modelId;
    void record;
    throw new Error('localStorage partial model records are read-only; use IndexedDB or OPFS.');
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

  async getPartialMetadata(modelId: string): Promise<PartialDownloadMetadata | null> {
    const record = await this.loadPartial(modelId);
    return record ? { modelId, url: record.url, etag: record.etag, loaded: record.loaded } : null;
  }

  async openPartialArtifact(modelId: string): Promise<PartialArtifactHandle | null> {
    const record = await this.loadPartial(modelId);
    if (!record) return null;
    const blob = new Blob([record.bytes.slice()], { type: 'application/octet-stream' });
    return {
      metadata: { modelId, url: record.url, etag: record.etag, loaded: record.loaded },
      artifact: artifactHandle(
        { modelId, sizeBytes: record.bytes.byteLength, sha256: null, installedAt: 0 },
        async () => blob,
      ),
    };
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
  private metadata = new Map<string, ModelArtifactMetadata>();
  private partials = new Map<string, PartialDownloadRecord>();

  isAvailable(): boolean {
    return true;
  }

  async saveInstalled(modelId: string, bytes: ArrayBuffer): Promise<void> {
    const writer = await this.beginInstalledWrite(modelId, { expectedSizeBytes: bytes.byteLength });
    await writer.write(new Uint8Array(bytes));
    await writer.commit();
  }

  async statInstalled(modelId: string): Promise<ModelArtifactMetadata | null> {
    const bytes = this.models.get(modelId);
    return bytes
      ? (this.metadata.get(modelId) ?? {
          modelId,
          sizeBytes: bytes.byteLength,
          sha256: null,
          installedAt: 0,
        })
      : null;
  }

  async openInstalledArtifact(modelId: string): Promise<ModelArtifactHandle | null> {
    const bytes = this.models.get(modelId);
    if (!bytes) return null;
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    return artifactHandle((await this.statInstalled(modelId))!, async () => blob);
  }

  async beginInstalledWrite(
    modelId: string,
    options: ModelInstallOptions = {},
  ): Promise<StagedModelWrite> {
    const chunks: Uint8Array[] = [];
    const storage = this;
    const sink: ArtifactSink = {
      async write(bytes) {
        chunks.push(bytes.slice());
      },
      async publish(metadata) {
        const size = chunks.reduce((total, part) => total + part.length, 0);
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        storage.models.set(modelId, bytes.buffer);
        storage.metadata.set(modelId, metadata);
      },
      async pause(metadata) {
        const size = chunks.reduce((total, part) => total + part.length, 0);
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        storage.partials.set(modelId, {
          bytes,
          url: metadata.url,
          etag: metadata.etag,
          loaded: metadata.loaded,
        });
      },
      async abort() {
        chunks.length = 0;
      },
    };
    return new VerifiedModelWrite(modelId, options, sink);
  }

  async publishInstalledBatch(
    entries: Array<{ stagedId: string; modelId: string }>,
  ): Promise<void> {
    const staged = entries.map((entry) => {
      const bytes = this.models.get(entry.stagedId);
      const metadata = this.metadata.get(entry.stagedId);
      if (!bytes || !metadata) {
        throw new Error(`Verified staged model ${entry.stagedId} is missing.`);
      }
      return { ...entry, bytes, metadata };
    });
    for (const entry of staged) {
      this.models.set(entry.modelId, entry.bytes);
      this.metadata.set(entry.modelId, { ...entry.metadata, modelId: entry.modelId });
    }
    for (const entry of staged) {
      this.models.delete(entry.stagedId);
      this.metadata.delete(entry.stagedId);
    }
  }

  async loadInstalled(modelId: string): Promise<ArrayBuffer | null> {
    return this.models.get(modelId) ?? null;
  }

  async deleteInstalled(modelId: string): Promise<void> {
    this.models.delete(modelId);
    this.metadata.delete(modelId);
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

  async getPartialMetadata(modelId: string): Promise<PartialDownloadMetadata | null> {
    const record = this.partials.get(modelId);
    return record ? { modelId, url: record.url, etag: record.etag, loaded: record.loaded } : null;
  }

  async openPartialArtifact(modelId: string): Promise<PartialArtifactHandle | null> {
    const record = this.partials.get(modelId);
    if (!record) return null;
    const blob = new Blob([record.bytes.slice()], { type: 'application/octet-stream' });
    return {
      metadata: { modelId, url: record.url, etag: record.etag, loaded: record.loaded },
      artifact: artifactHandle(
        { modelId, sizeBytes: record.bytes.byteLength, sha256: null, installedAt: 0 },
        async () => blob,
      ),
    };
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
    this.metadata.clear();
    this.partials.clear();
  }
}

export function createModelStorage(kind?: 'indexeddb' | 'localstorage' | 'memory'): ModelStorage {
  if (kind === 'memory') return new InMemoryStorage();
  if (kind === 'localstorage') return new LocalStorageModelStorage();
  if (kind === 'indexeddb') return new IndexedDBStorage(true);
  if (typeof indexedDB !== 'undefined') return new IndexedDBStorage(true);
  if (typeof localStorage !== 'undefined') return new LocalStorageModelStorage();
  return new InMemoryStorage();
}

let defaultModelStorage: ModelStorage | null = null;

/** One shared browser store for inference downloads and background-removal artifacts. */
export function getModelStorage(): ModelStorage {
  defaultModelStorage ??= createModelStorage();
  return defaultModelStorage;
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
