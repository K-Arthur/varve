/**
 * Content-addressed raster tile store tests (Phase 3A).
 *
 * Covers: put/get by hash, deduplication, batch operations, delete, stats,
 * and memory fallback.  IndexedDB backend tested via fake-indexeddb with
 * per-test database isolation.
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRasterTileStore,
  hashTilePixels,
  IndexedDbRasterTileStore,
  MemoryRasterTileStore,
  type RasterTileEntry,
} from '../rasterTileStore';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePixels(count: number, seed = 0): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = (seed + i) & 0xff;
  }
  return pixels;
}

function tileEntry(key: string, seed = 0, pixelCount = 4): RasterTileEntry {
  const pixels = makePixels(pixelCount, seed);
  return { tileKey: key, contentHash: '', pixels };
}

async function computeHash(entry: RasterTileEntry): Promise<RasterTileEntry> {
  return { ...entry, contentHash: await hashTilePixels(entry.pixels) };
}

// ── Per-test IDB isolation ───────────────────────────────────────────────────

const openConnections: Array<{ close(): void }> = [];
let dbCounter = 0;

afterEach(() => {
  for (const db of openConnections.splice(0)) db.close();
});

async function freshIdbStore(): Promise<IndexedDbRasterTileStore> {
  const { openDB } = await import('idb');
  const name = `raster-tile-test-${++dbCounter}`;
  const db = await openDB(name, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('tile-blobs')) {
        db.createObjectStore('tile-blobs');
      }
      if (!db.objectStoreNames.contains('key-index')) {
        db.createObjectStore('key-index');
      }
    },
  });
  openConnections.push(db);
  return new IndexedDbRasterTileStore(db);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('hashTilePixels', () => {
  it('produces a consistent 64-char hex SHA-256', async () => {
    const pixels = makePixels(8, 42);
    const h1 = await hashTilePixels(pixels);
    const h2 = await hashTilePixels(pixels);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it('changes when pixel data differs', async () => {
    const h1 = await hashTilePixels(makePixels(4, 0));
    const h2 = await hashTilePixels(makePixels(4, 1));
    expect(h1).not.toBe(h2);
  });
});

describe('MemoryRasterTileStore', () => {
  it('put and get by content hash', async () => {
    const store = new MemoryRasterTileStore();
    const entry = await computeHash(tileEntry('n1:0:0'));
    const hash = await store.put(entry);
    expect(hash).toBe(entry.contentHash);
    const retrieved = await store.get(hash);
    expect(retrieved).toEqual(entry.pixels);
  });

  it('returns null for unknown hash', async () => {
    const store = new MemoryRasterTileStore();
    expect(await store.get('nonexistent')).toBeNull();
    expect(await store.has('nonexistent')).toBe(false);
  });

  it('deduplicates identical pixels under the same hash', async () => {
    const store = new MemoryRasterTileStore();
    const e1 = await computeHash(tileEntry('n1:0:0', 7));
    const e2 = await computeHash(tileEntry('n1:1:0', 7));
    const h1 = await store.put(e1);
    const h2 = await store.put(e2);
    expect(h1).toBe(h2);
    const st = await store.stats();
    expect(st.totalTiles).toBe(1);
  });

  it('putBatch stores all entries', async () => {
    const store = new MemoryRasterTileStore();
    const entries = await Promise.all([
      computeHash(tileEntry('n1:0:0', 0)),
      computeHash(tileEntry('n1:1:0', 10)),
      computeHash(tileEntry('n1:2:0', 20)),
    ]);
    const result = await store.putBatch(entries);
    expect(result.size).toBe(3);
    for (const e of entries) {
      expect(result.get(e.tileKey)).toBe(e.contentHash);
      expect(await store.has(e.contentHash)).toBe(true);
    }
  });

  it('getBatch returns a subset for missing hashes', async () => {
    const store = new MemoryRasterTileStore();
    const e1 = await computeHash(tileEntry('a', 0));
    const e2 = await computeHash(tileEntry('b', 5));
    await store.putBatch([e1, e2]);
    const batch = await store.getBatch([e1.contentHash, 'missing', e2.contentHash]);
    expect(batch.size).toBe(2);
    expect(batch.get(e1.contentHash)).toEqual(e1.pixels);
    expect(batch.get(e2.contentHash)).toEqual(e2.pixels);
  });

  it('deleteBatch removes blobs', async () => {
    const store = new MemoryRasterTileStore();
    const e1 = await computeHash(tileEntry('a', 0));
    const e2 = await computeHash(tileEntry('b', 5));
    await store.putBatch([e1, e2]);
    await store.deleteBatch([e1.contentHash]);
    expect(await store.has(e1.contentHash)).toBe(false);
    expect(await store.has(e2.contentHash)).toBe(true);
  });

  it('stats returns correct totals', async () => {
    const store = new MemoryRasterTileStore();
    // 4 pixels × 4 bytes/pixel = 16 bytes; 8 pixels × 4 bytes/pixel = 32 bytes
    const e1 = await computeHash(tileEntry('a', 0, 4));
    const e2 = await computeHash(tileEntry('b', 5, 8));
    await store.putBatch([e1, e2]);
    const st = await store.stats();
    expect(st.totalTiles).toBe(2);
    expect(st.totalBytes).toBe(16 + 32);
  });
});

describe('IndexedDbRasterTileStore', () => {
  it('put and get by content hash', async () => {
    const store = await freshIdbStore();
    const entry = await computeHash(tileEntry('n1:0:0'));
    await store.put(entry);
    const retrieved = await store.get(entry.contentHash);
    expect(retrieved).toEqual(entry.pixels);
  });

  it('has returns true for stored hash', async () => {
    const store = await freshIdbStore();
    const entry = await computeHash(tileEntry('n1:0:0'));
    await store.put(entry);
    expect(await store.has(entry.contentHash)).toBe(true);
    expect(await store.has('nonexistent')).toBe(false);
  });

  it('putBatch stores all entries atomically', async () => {
    const store = await freshIdbStore();
    const entries = await Promise.all([
      computeHash(tileEntry('n1:0:0', 0)),
      computeHash(tileEntry('n1:1:0', 10)),
    ]);
    const result = await store.putBatch(entries);
    expect(result.size).toBe(2);
    for (const e of entries) {
      expect(await store.has(e.contentHash)).toBe(true);
    }
  });

  it('getBatch retrieves multiple tiles', async () => {
    const store = await freshIdbStore();
    const e1 = await computeHash(tileEntry('a', 0));
    const e2 = await computeHash(tileEntry('b', 5));
    await store.putBatch([e1, e2]);
    const batch = await store.getBatch([e1.contentHash, e2.contentHash]);
    expect(batch.size).toBe(2);
    expect(batch.get(e1.contentHash)).toEqual(e1.pixels);
  });

  it('deleteBatch removes tiles', async () => {
    const store = await freshIdbStore();
    const e1 = await computeHash(tileEntry('a', 0));
    const e2 = await computeHash(tileEntry('b', 5));
    await store.putBatch([e1, e2]);
    await store.deleteBatch([e1.contentHash]);
    expect(await store.has(e1.contentHash)).toBe(false);
    expect(await store.has(e2.contentHash)).toBe(true);
  });

  it('stats returns correct totals', async () => {
    const store = await freshIdbStore();
    // 4 pixels × 4 bytes/pixel = 16 bytes; 8 pixels × 4 bytes/pixel = 32 bytes
    const e1 = await computeHash(tileEntry('a', 0, 4));
    const e2 = await computeHash(tileEntry('b', 5, 8));
    await store.putBatch([e1, e2]);
    const st = await store.stats();
    expect(st.totalTiles).toBe(2);
    expect(st.totalBytes).toBe(16 + 32);
  });

  it('deduplicates identical pixels', async () => {
    const store = await freshIdbStore();
    const e1 = await computeHash(tileEntry('n1:0:0', 3));
    const e2 = await computeHash(tileEntry('n1:1:0', 3));
    await store.putBatch([e1, e2]);
    const st = await store.stats();
    expect(st.totalTiles).toBe(1);
  });
});

describe('createRasterTileStore (factory)', () => {
  it('returns a working store that implements RasterTileStore', async () => {
    const store = createRasterTileStore();
    const entry = await computeHash(tileEntry('factory:0:0'));
    const hash = await store.put(entry);
    expect(hash).toBe(entry.contentHash);
    const retrieved = await store.get(hash);
    expect(retrieved).toEqual(entry.pixels);
  });
});
