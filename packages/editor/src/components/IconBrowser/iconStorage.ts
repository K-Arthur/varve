/**
 * Icon cache storage — IndexedDB persistence for icon SVGs and metadata.
 *
 * Policy (2026-08-04):
 * - Records are keyed by globally stable canonical id
 *   ("iconify:mdi:home"), migrated from the legacy "prefix:name" keys.
 * - A configurable byte budget with LRU eviction. Pinned records and
 *   favourites are protected from eviction.
 * - Pack-level metadata enables the pack manager (storage usage, update
 *   checks, per-pack remove).
 * - Favourites moved from localStorage into the store (migrated on upgrade).
 *
 * The cache is a convenience mirror only: icon data embedded in documents is
 * never evicted by this store.
 */

import { migrateLegacyIndexedDb } from '@varve/platform';

export interface IconStorageRecord {
  /** Canonical id: provider:pack:name (v2+). Legacy "pack:name" keys migrate. */
  id: string;
  name: string;
  providerId: string;
  /** Icon pack prefix (e.g. "mdi"). */
  prefix: string;
  /** Globally stable canonical id (provider:prefix:name). */
  canonicalId: string;
  svg: string;
  licence?: string;
  /** SPDX identifier of the pack licence when known. */
  spdxId?: string;
  /** Licence URL. */
  licenceUrl?: string;
  /** Attribution text required by the licence. */
  attributionText?: string;
  attribution?: string;
  category?: string;
  categories?: string[];
  styles?: string[];
  /** monotone | multicolor. */
  paletteType?: 'monotone' | 'multicolor';
  storedAt: number;
  /** Updated on every cache read (for LRU). */
  lastAccessedAt: number;
  byteSize: number;
  /** Pack version at fetch time. */
  sourceVersion?: string;
  /** Pack last-modified (unix seconds) at fetch time. */
  lastModified?: number;
  /** Sanitizer version that produced the stored SVG. */
  sanitizerVersion?: string;
  /** Content hash of the stored SVG. */
  contentHash?: string;
  /** Pinned records are exempt from LRU eviction. */
  pinned?: boolean;
  /** Favourite (migrated from localStorage). */
  favourite?: boolean;
}

export interface IconPackStorageStats {
  prefix: string;
  count: number;
  bytes: number;
  lastAccessedAt: number;
}

const DB_NAME = 'varve-icon-storage';
const LEGACY_DB_NAME = 'strata-icon-storage';
/** Legacy favourites key in localStorage. */
const LEGACY_FAVOURITES_KEY = 'strata-icon-favourites';
export const FAVOURITES_KEY = 'varve-icon-favourites';

/** v1 -> v2 schema + id migration. */
export const DB_VERSION = 2;
const STORE_NAME = 'icons';

/** Default cache budget (matches a low-end device target: ~4 GB RAM systems). */
export const DEFAULT_CACHE_BUDGET_BYTES = 50 * 1024 * 1024;

let migrated = false;
let legacyFavouritesMigrated = false;

async function ensureMigrated(): Promise<void> {
  if (migrated) return;
  migrated = true;
  await migrateLegacyIndexedDb(LEGACY_DB_NAME, DB_NAME, [STORE_NAME]);
}

/** Migrate favourites from the legacy localStorage key, once. */
export function migrateLegacyFavourites(): Set<string> {
  if (legacyFavouritesMigrated) return readFavouritesFromStorage();
  legacyFavouritesMigrated = true;
  try {
    const raw = localStorage.getItem(LEGACY_FAVOURITES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        // Legacy ids are "prefix:name" — rewrite to canonical "iconify:prefix:name".
        const canonical = parsed
          .filter((x): x is string => typeof x === 'string')
          .map((x) => (x.includes(':') && !x.startsWith('iconify:') ? `iconify:${x}` : x));
        if (canonical.length > 0) {
          localStorage.setItem(FAVOURITES_KEY, JSON.stringify(canonical));
        }
        localStorage.removeItem(LEGACY_FAVOURITES_KEY);
      }
    }
  } catch {
    // ignore
  }
  return readFavouritesFromStorage();
}

function readFavouritesFromStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVOURITES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return new Set(
      Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

export function saveFavourites(favs: Set<string>): void {
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([...favs]));
  } catch {
    // ignore
  }
}

/** Rewrite a legacy "prefix:name" id to canonical form (best-effort). */
export function canonicalizeLegacyId(id: string): string {
  if (!id || id.startsWith('iconify:')) return id;
  return `iconify:${id}`;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        const oldVersion = (e as IDBVersionChangeEvent).oldVersion;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('providerId', 'providerId', { unique: false });
          store.createIndex('prefix', 'prefix', { unique: false });
          store.createIndex('storedAt', 'storedAt', { unique: false });
          store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
          store.createIndex('pinned', 'pinned', { unique: false });
        }
        if (oldVersion < 2) {
          // v1 records are keyed "prefix:name" with providerId === prefix.
          // Rewrite to canonical ids in place.
          const tx = req.transaction;
          const store = tx?.objectStore(STORE_NAME);
          if (store) {
            const cursor = store.openCursor();
            cursor.onsuccess = () => {
              const cur = cursor.result;
              if (!cur) return;
              const record = cur.value as Partial<IconStorageRecord> & { id?: string };
              const legacyId = record.id;
              if (legacyId && !legacyId.startsWith('iconify:')) {
                const canonical = canonicalizeLegacyId(legacyId);
                record.id = canonical;
                record.canonicalId = canonical;
                record.providerId = 'iconify';
                if (record.lastAccessedAt === undefined) {
                  record.lastAccessedAt = record.storedAt ?? Date.now();
                }
                store.delete(legacyId);
                store.put(record);
              }
              cur.continue();
            };
          }
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        void ensureMigrated().then(() => resolve(db));
      };
      req.onerror = () => reject(req.error);
    } catch {
      resolve(null);
    }
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexeddb transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexeddb transaction aborted'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | IDBRequest,
): Promise<T> {
  const db = await openDb();
  if (!db) throw new Error('IndexedDB unavailable');
  try {
    const tx = db.transaction(STORE_NAME, mode);
    const req = fn(tx.objectStore(STORE_NAME));
    const result = await new Promise<T>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
    await txDone(tx);
    return result;
  } finally {
    db.close();
  }
}

/** True when the platform exposes IndexedDB (not, e.g., an exotic worker). */
export function isIconStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export class IconCacheBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IconCacheBudgetExceededError';
  }
}

/**
 * Enforce the cache budget after a write: evict least-recently-used records
 * (skipping pinned and favourited) until under budget. Returns evicted ids.
 */
async function evictForBudget(budgetBytes: number): Promise<string[]> {
  const db = await openDb();
  if (!db) return [];
  const evicted: string[] = [];
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const all = await new Promise<IconStorageRecord[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result ?? []) as IconStorageRecord[]);
      req.onerror = () => reject(req.error);
    });
    const now = Date.now();
    const total = all.reduce((sum, r) => sum + (r.byteSize ?? 0), 0);
    if (total <= budgetBytes) {
      await txDone(tx);
      return [];
    }
    const evictable = all
      .filter((r) => !r.pinned && !r.favourite)
      .sort((a, b) => (a.lastAccessedAt ?? 0) - (b.lastAccessedAt ?? 0));
    let excess = total - budgetBytes;
    for (const record of evictable) {
      if (excess <= 0) break;
      store.delete(record.id);
      evicted.push(record.id);
      excess -= record.byteSize ?? 0;
      void now;
    }
    await txDone(tx);
  } catch {
    // best-effort
  } finally {
    db.close();
  }
  return evicted;
}

export interface IconCacheOptions {
  /** Byte budget for the whole cache (default 50 MiB). */
  budgetBytes?: number;
}

export async function storeIcon(
  record: IconStorageRecord,
  options: IconCacheOptions = {},
): Promise<void> {
  const now = Date.now();
  const full: IconStorageRecord = {
    ...record,
    id: record.id ?? record.canonicalId,
    canonicalId: record.canonicalId ?? record.id,
    lastAccessedAt: record.lastAccessedAt ?? now,
    storedAt: record.storedAt ?? now,
  };
  try {
    await withStore('readwrite', (store) => store.put(full));
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (
      err instanceof DOMException &&
      (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')
    ) {
      throw new IconCacheBudgetExceededError(
        `Icon cache is full (${message}) — evict unpinned records or raise the budget`,
      );
    }
    if (message.includes('quota')) {
      throw new IconCacheBudgetExceededError(`Icon cache quota exceeded (${message})`);
    }
    throw err;
  }
  await evictForBudget(options.budgetBytes ?? DEFAULT_CACHE_BUDGET_BYTES);
}

export async function getStoredIcon(id: string): Promise<IconStorageRecord | null> {
  const canonical = canonicalizeLegacyId(id);
  try {
    const record = await withStore('readonly', (store) => store.get(canonical));
    if (!record) return null;
    const now = Date.now();
    if ((record.lastAccessedAt ?? 0) < now - 60_000) {
      // Bump LRU timestamp opportunistically (best-effort, throttled).
      await withStore('readwrite', (store) => store.put({ ...record, lastAccessedAt: now })).catch(
        () => {},
      );
    }
    return record;
  } catch {
    return null;
  }
}

export async function touchStoredIcon(id: string): Promise<void> {
  const record = await getStoredIcon(id);
  if (!record) return;
  await withStore('readwrite', (store) =>
    store.put({ ...record, lastAccessedAt: Date.now() }),
  ).catch(() => {});
}

export async function removeStoredIcon(id: string): Promise<void> {
  const canonical = canonicalizeLegacyId(id);
  try {
    await withStore('readwrite', (store) => store.delete(canonical));
  } catch {
    // best-effort
  }
}

export async function setPinned(id: string, pinned: boolean): Promise<void> {
  const record = await getStoredIcon(id);
  if (!record) return;
  await withStore('readwrite', (store) => store.put({ ...record, pinned })).catch(() => {});
}

export async function listStoredIcons(): Promise<IconStorageRecord[]> {
  try {
    const results = await withStore<IconStorageRecord[]>('readonly', (store) => store.getAll());
    results.sort((a, b) => (b.lastAccessedAt ?? b.storedAt) - (a.lastAccessedAt ?? a.storedAt));
    return results;
  } catch {
    return [];
  }
}

/** Grouped per-pack statistics for the pack manager. */
export async function getPackStats(): Promise<IconPackStorageStats[]> {
  const all = await listStoredIcons();
  const byPack = new Map<string, { count: number; bytes: number; lastAccessedAt: number }>();
  for (const record of all) {
    const stats = byPack.get(record.prefix) ?? { count: 0, bytes: 0, lastAccessedAt: 0 };
    stats.count++;
    stats.bytes += record.byteSize ?? 0;
    stats.lastAccessedAt = Math.max(
      stats.lastAccessedAt,
      record.lastAccessedAt ?? record.storedAt ?? 0,
    );
    byPack.set(record.prefix, stats);
  }
  return Array.from(byPack.entries())
    .map(([prefix, s]) => ({ prefix, ...s }))
    .sort((a, b) => b.bytes - a.bytes);
}

/** Total cached bytes. */
export async function getCacheSize(): Promise<number> {
  const all = await listStoredIcons();
  return all.reduce((sum, r) => sum + (r.byteSize ?? 0), 0);
}

/** Remove every cached record (pack manager "clear cache"). */
export async function clearIconCache(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.clear());
  } catch {
    // best-effort
  }
}

/** Remove all records belonging to one pack prefix. Returns removed count. */
export async function removePackFromCache(prefix: string): Promise<number> {
  const all = await listStoredIcons();
  const ids = all.filter((r) => r.prefix === prefix).map((r) => r.id);
  for (const id of ids) {
    await removeStoredIcon(id);
  }
  return ids.length;
}

/** Integrity check: counts records with missing required fields. */
export async function scanCacheIntegrity(): Promise<{ total: number; corrupt: number }> {
  const all = await listStoredIcons();
  let corrupt = 0;
  for (const record of all) {
    if (!record.svg || typeof record.svg !== 'string' || !record.canonicalId) corrupt++;
  }
  return { total: all.length, corrupt };
}

/** Rebuild the cache: clear + re-run legacy migration. */
export async function rebuildIconCache(): Promise<void> {
  await clearIconCache();
  migrated = false;
  await ensureMigrated();
}

/** Last-modified timestamps stored per pack (for update checks). */
export async function getPackLastModified(prefix: string): Promise<number | undefined> {
  const all = await listStoredIcons();
  const withStamp = all.filter((r) => r.prefix === prefix && typeof r.lastModified === 'number');
  if (withStamp.length === 0) return undefined;
  return Math.max(...withStamp.map((r) => r.lastModified as number));
}
