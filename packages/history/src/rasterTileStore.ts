/**
 * Content-addressed raster tile store (Phase 3A).
 *
 * Raster brush strokes produce dirty tiles that need exact before/after pixel
 * state for lossless undo.  Instead of serialising the entire `tiles` Map into
 * every semantic-diff payload, each tile's RGBA pixel data is stored once by
 * its SHA-256 content hash.  Only the `{nodeId}:{col}:{row}` → hash mapping
 * travels with the undo payload.
 *
 * Two backends:
 * - `MemoryRasterTileStore` — plain Maps, used in tests / SSR.
 * - `IndexedDbRasterTileStore` — separate IndexedDB database
 *   (`varve-raster-tiles`) with a `tile-blobs` store keyed by hash.
 *
 * Tile identity belongs to an immutable operation payload rather than a
 * mutable global index: the same `{nodeId}:{col}:{row}` legitimately points
 * to different content at different revisions.
 *
 * `createRasterTileStore` returns the IndexedDB backend when the browser API
 * is available and falls back to memory otherwise.
 */
import { sha256Hex } from '@varve/scene';
import { type IDBPDatabase, openDB } from 'idb';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RasterTileEntry {
  /** Unique tile key, e.g. `"{nodeId}:{col}:{row}"`. */
  tileKey: string;
  /** SHA-256 hex digest of `pixels`. */
  contentHash: string;
  /** Raw RGBA pixel data. */
  pixels: Uint8ClampedArray;
}

export interface RasterTileStore {
  /** Store a tile's pixels. Returns the content hash. */
  put(entry: RasterTileEntry): Promise<string>;
  /** Retrieve tile pixels by content hash. */
  get(contentHash: string): Promise<Uint8ClampedArray | null>;
  /** Check if a tile hash exists. */
  has(contentHash: string): Promise<boolean>;
  /** Store multiple tiles at once. Returns a map of tileKey → contentHash. */
  putBatch(entries: RasterTileEntry[]): Promise<Map<string, string>>;
  /** Retrieve multiple tiles at once. Returns a map of hash → pixels. */
  getBatch(hashes: string[]): Promise<Map<string, Uint8ClampedArray>>;
  /** Delete tiles by hash. */
  deleteBatch(hashes: string[]): Promise<void>;
  /** Enumerate content hashes for reachability-based garbage collection. */
  listHashes(): Promise<string[]>;
  /** Get storage statistics. */
  stats(): Promise<{ totalTiles: number; totalBytes: number }>;
}

// ── Hash utility ─────────────────────────────────────────────────────────────

/** Compute the SHA-256 hex digest of raw RGBA pixel data.
 *
 * Use the scene package's pure TypeScript implementation so Node, browser,
 * Tauri, and test environments produce identical history addresses.
 */
export async function hashTilePixels(pixels: Uint8ClampedArray): Promise<string> {
  return sha256Hex(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength));
}

function copyPixels(pixels: Uint8ClampedArray): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels);
}

async function validateEntry(entry: RasterTileEntry): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(entry.contentHash)) {
    throw new Error('raster tile contentHash must be a lowercase SHA-256 digest');
  }
  const actual = await hashTilePixels(entry.pixels);
  if (actual !== entry.contentHash) {
    throw new Error(
      `raster tile content hash mismatch: expected ${entry.contentHash}, got ${actual}`,
    );
  }
}

// ── Memory implementation ────────────────────────────────────────────────────

export class MemoryRasterTileStore implements RasterTileStore {
  /** contentHash → RGBA pixels */
  private store = new Map<string, Uint8ClampedArray>();
  /** contentHash → total byte length (cached for stats) */
  private byteIndex = new Map<string, number>();

  async put(entry: RasterTileEntry): Promise<string> {
    await validateEntry(entry);
    if (!this.store.has(entry.contentHash)) {
      const pixels = copyPixels(entry.pixels);
      this.store.set(entry.contentHash, pixels);
      this.byteIndex.set(entry.contentHash, pixels.byteLength);
    }
    return entry.contentHash;
  }

  async get(contentHash: string): Promise<Uint8ClampedArray | null> {
    const pixels = this.store.get(contentHash);
    return pixels ? copyPixels(pixels) : null;
  }

  async has(contentHash: string): Promise<boolean> {
    return this.store.has(contentHash);
  }

  async putBatch(entries: RasterTileEntry[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    await Promise.all(entries.map(validateEntry));
    for (const entry of entries) {
      if (!this.store.has(entry.contentHash)) {
        const pixels = copyPixels(entry.pixels);
        this.store.set(entry.contentHash, pixels);
        this.byteIndex.set(entry.contentHash, pixels.byteLength);
      }
      result.set(entry.tileKey, entry.contentHash);
    }
    return result;
  }

  async getBatch(hashes: string[]): Promise<Map<string, Uint8ClampedArray>> {
    const result = new Map<string, Uint8ClampedArray>();
    for (const h of hashes) {
      const pixels = this.store.get(h);
      if (pixels) result.set(h, copyPixels(pixels));
    }
    return result;
  }

  async deleteBatch(hashes: string[]): Promise<void> {
    for (const h of hashes) {
      this.store.delete(h);
      this.byteIndex.delete(h);
    }
  }

  async listHashes(): Promise<string[]> {
    return [...this.store.keys()].sort();
  }

  async stats(): Promise<{ totalTiles: number; totalBytes: number }> {
    let totalBytes = 0;
    for (const bytes of this.byteIndex.values()) {
      totalBytes += bytes;
    }
    return { totalTiles: this.store.size, totalBytes };
  }
}

// ── IndexedDB implementation ─────────────────────────────────────────────────

const TILE_DB_NAME = 'varve-raster-tiles';
const TILE_DB_VERSION = 1;
const BLOB_STORE = 'tile-blobs';

async function openTileDb(): Promise<IDBPDatabase> {
  return openDB(TILE_DB_NAME, TILE_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE);
      }
    },
  });
}

export class IndexedDbRasterTileStore implements RasterTileStore {
  private connect: Promise<IDBPDatabase>;

  constructor(db: IDBPDatabase | Promise<IDBPDatabase> = openTileDb()) {
    this.connect = typeof db === 'object' && db !== null && 'name' in db ? Promise.resolve(db) : db;
  }

  async put(entry: RasterTileEntry): Promise<string> {
    await validateEntry(entry);
    const db = await this.connect;
    const tx = db.transaction(BLOB_STORE, 'readwrite');
    const store = tx.objectStore(BLOB_STORE);
    if ((await store.get(entry.contentHash)) === undefined) {
      store.put(copyPixels(entry.pixels).buffer, entry.contentHash);
    }
    await tx.done;
    return entry.contentHash;
  }

  async get(contentHash: string): Promise<Uint8ClampedArray | null> {
    const db = await this.connect;
    const buf = (await db.get(BLOB_STORE, contentHash)) as ArrayBuffer | undefined;
    return buf ? new Uint8ClampedArray(buf.slice(0)) : null;
  }

  async has(contentHash: string): Promise<boolean> {
    const db = await this.connect;
    const buf = await db.get(BLOB_STORE, contentHash);
    return buf !== undefined;
  }

  async putBatch(entries: RasterTileEntry[]): Promise<Map<string, string>> {
    if (entries.length === 0) return new Map();
    await Promise.all(entries.map(validateEntry));
    const db = await this.connect;
    const tx = db.transaction(BLOB_STORE, 'readwrite');
    const store = tx.objectStore(BLOB_STORE);
    const result = new Map<string, string>();
    for (const entry of entries) {
      if ((await store.get(entry.contentHash)) === undefined) {
        store.put(copyPixels(entry.pixels).buffer, entry.contentHash);
      }
      result.set(entry.tileKey, entry.contentHash);
    }
    await tx.done;
    return result;
  }

  async getBatch(hashes: string[]): Promise<Map<string, Uint8ClampedArray>> {
    if (hashes.length === 0) return new Map();
    const db = await this.connect;
    const result = new Map<string, Uint8ClampedArray>();
    const tx = db.transaction(BLOB_STORE, 'readonly');
    const store = tx.objectStore(BLOB_STORE);
    const promises = hashes.map(async (h) => {
      const buf = (await store.get(h)) as ArrayBuffer | undefined;
      if (buf) result.set(h, new Uint8ClampedArray((buf as ArrayBuffer).slice(0)));
    });
    await Promise.all(promises);
    await tx.done;
    return result;
  }

  async deleteBatch(hashes: string[]): Promise<void> {
    if (hashes.length === 0) return;
    const db = await this.connect;
    const tx = db.transaction(BLOB_STORE, 'readwrite');
    for (const h of hashes) {
      tx.objectStore(BLOB_STORE).delete(h);
    }
    await tx.done;
  }

  async listHashes(): Promise<string[]> {
    const db = await this.connect;
    return ((await db.getAllKeys(BLOB_STORE)) as string[]).sort();
  }

  async stats(): Promise<{ totalTiles: number; totalBytes: number }> {
    const db = await this.connect;
    const tx = db.transaction(BLOB_STORE, 'readonly');
    const store = tx.objectStore(BLOB_STORE);
    const allBuffers = await store.getAll();
    await tx.done;
    let totalBytes = 0;
    for (const buf of allBuffers) {
      totalBytes += (buf as ArrayBuffer).byteLength;
    }
    return { totalTiles: allBuffers.length, totalBytes };
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

/** Create a content-addressed raster tile store. Prefers IndexedDB when available. */
export function createRasterTileStore(): RasterTileStore {
  // jsdom can expose a partial `indexedDB` shim without the IDB request
  // constructors required by `idb`. Treat it as unavailable rather than
  // creating a rejected promise for every editor history session.
  if (
    typeof indexedDB !== 'undefined' &&
    typeof IDBKeyRange !== 'undefined' &&
    typeof IDBRequest !== 'undefined'
  ) {
    return new IndexedDbRasterTileStore();
  }
  return new MemoryRasterTileStore();
}
