/**
 * Persistent, content-addressed storage for semantic embeddings.
 *
 * The editor's Find Similar workflow computes normalized embedding vectors
 * for image content. Repeated searches for unchanged content must not
 * re-run inference: this store persists `AssetEmbeddingRecord`s keyed by
 * content hash + model + preprocessing + schema version, so a rename or
 * re-import reuses derived work while an edit or model change invalidates
 * it.
 *
 * The web implementation backs onto IndexedDB (`semanticEmbeddings` store,
 * schema-owned by web-db.ts, version 4), which also covers the Tauri
 * webview. The memory implementation serves tests. The index itself
 * (`SemanticAssetIndex`) is a separate reconstructible layer rebuilt from
 * these records.
 */

import type { AssetEmbeddingRecord } from './assetEmbeddingIndex';
import { DB_NAME, STORE_SEMANTIC_EMBEDDINGS } from './web-db';

export interface SemanticEmbeddingStore {
  get(key: string): Promise<AssetEmbeddingRecord | null>;
  put(record: AssetEmbeddingRecord): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  listAll(): Promise<AssetEmbeddingRecord[]>;
}

/** In-memory store (tests, non-persistent runtimes). */
export class MemorySemanticEmbeddingStore implements SemanticEmbeddingStore {
  private readonly records = new Map<string, AssetEmbeddingRecord>();

  async get(key: string): Promise<AssetEmbeddingRecord | null> {
    const record = this.records.get(key);
    return record ? cloneRecord(record) : null;
  }

  async put(record: AssetEmbeddingRecord): Promise<void> {
    this.records.set(record.key, cloneRecord(record));
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  async clear(): Promise<void> {
    this.records.clear();
  }

  async listAll(): Promise<AssetEmbeddingRecord[]> {
    return [...this.records.values()].map(cloneRecord);
  }
}

/** IndexedDB-backed store shared by web and Tauri-webview runtimes. */
export class IndexedDbSemanticEmbeddingStore implements SemanticEmbeddingStore {
  constructor(private readonly dbName: string = DB_NAME) {}

  private async db(): Promise<import('idb').IDBPDatabase> {
    const { openDB } = await import('idb');
    // No upgrade callback here: the store schema is owned by web-db.ts,
    // which creates `semanticEmbeddings` on version-4 upgrades. Opening at
    // the same version never triggers a schema change from this module.
    return openDB(this.dbName, 4);
  }

  async get(key: string): Promise<AssetEmbeddingRecord | null> {
    const db = await this.db();
    try {
      const record = (await db.get(STORE_SEMANTIC_EMBEDDINGS, key)) as
        | AssetEmbeddingRecord
        | undefined;
      return record ? cloneRecord(record) : null;
    } finally {
      db.close();
    }
  }

  async put(record: AssetEmbeddingRecord): Promise<void> {
    const db = await this.db();
    try {
      await db.put(STORE_SEMANTIC_EMBEDDINGS, cloneRecord(record));
    } finally {
      db.close();
    }
  }

  async delete(key: string): Promise<void> {
    const db = await this.db();
    try {
      await db.delete(STORE_SEMANTIC_EMBEDDINGS, key);
    } finally {
      db.close();
    }
  }

  async clear(): Promise<void> {
    const db = await this.db();
    try {
      await db.clear(STORE_SEMANTIC_EMBEDDINGS);
    } finally {
      db.close();
    }
  }

  async listAll(): Promise<AssetEmbeddingRecord[]> {
    const db = await this.db();
    try {
      const records = (await db.getAll(STORE_SEMANTIC_EMBEDDINGS)) as AssetEmbeddingRecord[];
      return records.map(cloneRecord);
    } finally {
      db.close();
    }
  }
}

function cloneRecord(record: AssetEmbeddingRecord): AssetEmbeddingRecord {
  return { ...record, bytes: record.bytes.slice(0) };
}
