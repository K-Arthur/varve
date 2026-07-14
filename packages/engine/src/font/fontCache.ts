/**
 * LRU cache for font metadata and binary data.
 *
 * Provides a generic TTL-aware, byte-budgeted LRU cache plus two
 * specialised subclasses:
 *   - FontMetadataCache: indexes parsed font metadata by family name and
 *     content hash for O(1) lookup.
 *   - FontBinaryCache: stores raw ArrayBuffer font file data with a 50 MB
 *     default budget.
 *
 * Research basis: Chrome font cache (200-entry LRU), Firefox font cache
 * (150 entries / 32 MB), FontBase cache strategy.
 */

import type { ParsedFontMetadata } from './fontIdentity';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface FontCacheConfig {
  /** Maximum number of entries (default 200). */
  maxEntries?: number;
  /** Maximum total byte size (default 50 MB). */
  maxBytes?: number;
  /** Time-to-live in milliseconds (default 24 h). */
  ttlMs?: number;
}

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

// ---------------------------------------------------------------------------
// Cache entry
// ---------------------------------------------------------------------------

export interface FontCacheEntry<T> {
  data: T;
  createdAt: number;
  lastAccessedAt: number;
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Generic LRU cache
// ---------------------------------------------------------------------------

/**
 * Generic LRU cache with optional TTL and byte-budget eviction.
 *
 * Internal order is oldest-first in `entries`. `get` touches the entry to
 * move it to the most-recently-used end. Eviction is O(n) on the entries
 * array but runs infrequently enough for the expected working set (≤200
 * entries) to be negligible.
 */
export class FontCache<T> {
  private store = new Map<string, FontCacheEntry<T>>();
  private maxEntries: number;
  private maxBytes: number;
  private ttlMs: number;

  constructor(config?: FontCacheConfig) {
    this.maxEntries = config?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = config?.maxBytes ?? DEFAULT_MAX_BYTES;
    this.ttlMs = config?.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** Retrieve an entry and update its last-accessed timestamp. */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    // TTL check
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }

    entry.lastAccessedAt = Date.now();
    return entry.data;
  }

  /** Store a value. If sizeBytes is omitted, 0 is assumed. Auto-evicts LRU entries. */
  set(key: string, data: T, sizeBytes = 0): void {
    this.store.set(key, {
      data,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      sizeBytes,
    });
    // Auto-evict if over limits
    if (this.store.size > this.maxEntries || this.totalBytesCurrent() > this.maxBytes) {
      this.evict();
    }
  }

  /** Check if a non-expired entry exists. */
  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  /** Delete a single entry. Returns true if the entry existed. */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /** Remove all entries. */
  clear(): void {
    this.store.clear();
  }

  /** Number of live (non-expired) entries. */
  size(): number {
    this.evictExpired();
    return this.store.size;
  }

  /** Sum of sizeBytes across all live entries. */
  totalBytes(): number {
    this.evictExpired();
    let total = 0;
    for (const entry of this.store.values()) {
      total += entry.sizeBytes;
    }
    return total;
  }

  /**
   * Evict LRU entries until both maxEntries and maxBytes constraints are
   * satisfied. Returns the number of entries evicted.
   */
  evict(): number {
    let evicted = 0;

    // 1. Expire stale entries.
    evicted += this.evictExpired();

    // 2. LRU evict until within limits.
    const sorted = this.entriesSortedByAccess();

    while (sorted.length > this.maxEntries || this.totalBytesCurrent() > this.maxBytes) {
      const oldest = sorted.shift();
      if (!oldest) break;
      this.store.delete(oldest.key);
      evicted++;
    }

    return evicted;
  }

  /** Return all live entries as an array. */
  entries(): Array<{ key: string; data: T; sizeBytes: number }> {
    this.evictExpired();
    return Array.from(this.store.entries()).map(([key, entry]) => ({
      key,
      data: entry.data,
      sizeBytes: entry.sizeBytes,
    }));
  }

  // ----- internals -----

  private isExpired(entry: FontCacheEntry<T>): boolean {
    return Date.now() - entry.createdAt > this.ttlMs;
  }

  private evictExpired(): number {
    let count = 0;
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.createdAt > this.ttlMs) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  /** Total bytes without triggering a full evictExpired pass. */
  private totalBytesCurrent(): number {
    let total = 0;
    for (const entry of this.store.values()) {
      total += entry.sizeBytes;
    }
    return total;
  }

  /** Entries sorted oldest-first by lastAccessedAt. */
  private entriesSortedByAccess(): Array<{ key: string; lastAccessedAt: number }> {
    return Array.from(this.store.entries())
      .map(([key, entry]) => ({ key, lastAccessedAt: entry.lastAccessedAt }))
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
  }
}

// ---------------------------------------------------------------------------
// FontMetadataCache
// ---------------------------------------------------------------------------

/**
 * Font metadata cache with secondary indexes on family name and content hash.
 * The primary store is the inherited FontCache keyed by font ID (content hash).
 */
export class FontMetadataCache extends FontCache<ParsedFontMetadata> {
  private byFamily = new Map<string, string>();
  private byHash = new Map<string, string>();

  constructor(config?: FontCacheConfig) {
    super({ maxEntries: 200, maxBytes: 50 * 1024 * 1024, ...config });
  }

  override set(key: string, data: ParsedFontMetadata, sizeBytes?: number): void {
    super.set(key, data, sizeBytes);
    // Maintain indexes
    const family = data.identity.familyName;
    if (family) this.byFamily.set(family, key);
    const hash = data.identity.contentHash;
    if (hash) this.byHash.set(hash, key);
  }

  override delete(key: string): boolean {
    const entry = this.entries().find((e) => e.key === key);
    if (entry) {
      const family = entry.data.identity.familyName;
      if (family && this.byFamily.get(family) === key) {
        this.byFamily.delete(family);
      }
      const hash = entry.data.identity.contentHash;
      if (hash && this.byHash.get(hash) === key) {
        this.byHash.delete(hash);
      }
    }
    return super.delete(key);
  }

  override clear(): void {
    super.clear();
    this.byFamily.clear();
    this.byHash.clear();
  }

  /** Look up metadata by family name. */
  getByFamily(family: string): ParsedFontMetadata | undefined {
    const key = this.byFamily.get(family);
    if (!key) return undefined;
    return this.get(key);
  }

  /** Look up metadata by content hash. */
  getByHash(hash: string): ParsedFontMetadata | undefined {
    const key = this.byHash.get(hash);
    if (!key) return undefined;
    return this.get(key);
  }
}

// ---------------------------------------------------------------------------
// FontBinaryCache
// ---------------------------------------------------------------------------

/**
 * Font binary data cache (ArrayBuffer) with a 50 MB default budget.
 * Font file data is expensive to re-fetch so this cache prioritises keeping
 * recently used font bytes resident.
 */
export class FontBinaryCache extends FontCache<ArrayBuffer> {
  constructor(config?: FontCacheConfig) {
    super({ maxEntries: 200, maxBytes: 50 * 1024 * 1024, ...config });
  }

  /** Store raw font file data. */
  storeFontData(fontId: string, data: ArrayBuffer): void {
    this.set(fontId, data, data.byteLength);
  }

  /** Retrieve raw font file data. */
  getFontData(fontId: string): ArrayBuffer | undefined {
    return this.get(fontId);
  }
}
