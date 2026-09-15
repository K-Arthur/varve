/**
 * Storage inventory for the browser route — the facts a user needs before
 * clearing anything.
 *
 * Three storage classes are deliberately kept distinct:
 *
 *   1. Documents and recovery copies (IndexedDB / file handles) — the only
 *      irreplaceable data. Never removed by this module.
 *   2. Offline app copies (Cache Storage, `varve-demo-shell-*`) — disposable
 *      build assets. Safe to clear; the next online visit re-caches them.
 *   3. The browser's estimate of total origin usage — an estimate, never a
 *      promise (MDN: usage is padded and quota derives from total disk to
 *      resist fingerprinting).
 *
 * `clearDisposableAppCaches` is prefix-gated so a cache owned by another app
 * on the same origin can never be deleted by this surface.
 */

export const APP_CACHE_PREFIX = 'varve-demo-shell-';

export interface StorageEstimate {
  usageBytes: number | null;
  quotaBytes: number | null;
}

export interface CacheInventory {
  /** Names of this app's offline caches. */
  names: string[];
  /** Total cached responses across those caches. */
  entries: number;
}

export interface RecoveryInventory {
  count: number;
  bytes: number;
}

export interface StorageInventory {
  estimate: StorageEstimate;
  /** null when the API is unavailable or threw. */
  persisted: boolean | null;
  appCaches: CacheInventory;
  recovery: RecoveryInventory;
}

export interface StorageInventoryDeps {
  storageManager?: {
    estimate?: () => Promise<{ usage?: number; quota?: number }>;
    persisted?: () => Promise<boolean>;
  };
  cacheStorage?: {
    keys: () => Promise<string[]>;
    open?: (name: string) => Promise<{ keys: () => Promise<readonly unknown[]> }>;
  };
  listRecoveryMeta?: () => Promise<Array<{ sizeBytes: number }>>;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** True only for caches this app owns and may delete. */
export function isDisposableAppCache(name: string): boolean {
  return name.startsWith(APP_CACHE_PREFIX);
}

export async function collectStorageInventory(
  deps: StorageInventoryDeps,
): Promise<StorageInventory> {
  const estimate: StorageEstimate = { usageBytes: null, quotaBytes: null };
  if (deps.storageManager?.estimate) {
    try {
      const raw = await deps.storageManager.estimate();
      estimate.usageBytes = finite(raw.usage);
      estimate.quotaBytes = finite(raw.quota);
    } catch {
      // Estimate is advisory; leave both null.
    }
  }

  let persisted: boolean | null = null;
  if (deps.storageManager?.persisted) {
    try {
      persisted = await deps.storageManager.persisted();
    } catch {
      persisted = null;
    }
  }

  const appCaches: CacheInventory = { names: [], entries: 0 };
  if (deps.cacheStorage) {
    try {
      const names = (await deps.cacheStorage.keys()).filter(isDisposableAppCache);
      appCaches.names = names;
      if (deps.cacheStorage.open) {
        for (const name of names) {
          try {
            const cache = await deps.cacheStorage.open(name);
            appCaches.entries += (await cache.keys()).length;
          } catch {
            // A cache that cannot be opened contributes no count.
          }
        }
      }
    } catch {
      // Cache Storage can be unavailable in strict privacy modes.
    }
  }

  const recovery: RecoveryInventory = { count: 0, bytes: 0 };
  if (deps.listRecoveryMeta) {
    try {
      const metas = await deps.listRecoveryMeta();
      recovery.count = metas.length;
      recovery.bytes = metas.reduce(
        (sum, meta) => sum + (Number.isFinite(meta.sizeBytes) ? meta.sizeBytes : 0),
        0,
      );
    } catch {
      // Recovery listing failure must never break the storage surface.
    }
  }

  return { estimate, persisted, appCaches, recovery };
}

/** Delete only this app's disposable offline caches. Returns deleted names. */
export async function clearDisposableAppCaches(cacheStorage: {
  keys: () => Promise<string[]>;
  delete: (name: string) => Promise<boolean>;
}): Promise<string[]> {
  const names = (await cacheStorage.keys()).filter(isDisposableAppCache);
  const deleted: string[] = [];
  for (const name of names) {
    if (await cacheStorage.delete(name)) deleted.push(name);
  }
  return deleted;
}

/** Request persistent storage. Returns the browser's answer. */
export async function requestPersistentStorage(storageManager?: {
  persist?: () => Promise<boolean>;
}): Promise<boolean | null> {
  if (!storageManager?.persist) return null;
  try {
    return await storageManager.persist();
  } catch {
    return null;
  }
}
