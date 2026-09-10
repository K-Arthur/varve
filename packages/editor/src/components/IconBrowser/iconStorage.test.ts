// @vitest-environment jsdom
/**
 * Icon cache storage tests — budgets, LRU eviction, migrations, favourites.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalizeLegacyId,
  clearIconCache,
  DEFAULT_CACHE_BUDGET_BYTES,
  getCacheSize,
  getPackStats,
  getStoredIcon,
  type IconStorageRecord,
  listStoredIcons,
  migrateLegacyFavourites,
  removePackFromCache,
  scanCacheIntegrity,
  setPinned,
  storeIcon,
} from './iconStorage';

function makeRecord(
  id: string,
  bytes = 100,
  extra: Partial<IconStorageRecord> = {},
): IconStorageRecord {
  return {
    id,
    name: id.split(':').pop() ?? id,
    providerId: 'iconify',
    prefix: id.split(':')[1] ?? 'mdi',
    canonicalId: id,
    svg: 'x'.repeat(bytes),
    storedAt: Date.now(),
    lastAccessedAt: Date.now(),
    byteSize: bytes,
    ...extra,
  };
}

afterEach(async () => {
  await clearIconCache();
  localStorage.clear();
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await clearIconCache();
});

describe('canonical ids and migrations', () => {
  it('canonicalizes legacy prefix:name ids', () => {
    expect(canonicalizeLegacyId('mdi:home')).toBe('iconify:mdi:home');
    expect(canonicalizeLegacyId('iconify:mdi:home')).toBe('iconify:mdi:home');
  });

  it('migrates favourites from the legacy localStorage key', () => {
    localStorage.setItem('strata-icon-favourites', JSON.stringify(['mdi:home', 'lucide:star']));
    const favs = migrateLegacyFavourites();
    expect(favs.has('iconify:mdi:home')).toBe(true);
    expect(favs.has('iconify:lucide:star')).toBe(true);
    expect(localStorage.getItem('strata-icon-favourites')).toBeNull();
    expect(localStorage.getItem('varve-icon-favourites')).toContain('iconify:mdi:home');
  });
});

describe('storage operations', () => {
  it('stores and retrieves records by canonical id', async () => {
    await storeIcon(makeRecord('iconify:mdi:home'));
    const record = await getStoredIcon('iconify:mdi:home');
    expect(record?.svg).toBeTruthy();
    expect(record?.byteSize).toBeGreaterThan(0);
  });

  it('retrieves legacy ids through canonicalization', async () => {
    await storeIcon(makeRecord('iconify:mdi:home'));
    const record = await getStoredIcon('mdi:home');
    expect(record?.canonicalId).toBe('iconify:mdi:home');
  });

  it('lists records sorted by last access', async () => {
    await storeIcon(makeRecord('iconify:mdi:a', 10, { lastAccessedAt: 100 }));
    await storeIcon(makeRecord('iconify:mdi:b', 10, { lastAccessedAt: 200 }));
    const list = await listStoredIcons();
    expect(list.map((r) => r.canonicalId)).toEqual(['iconify:mdi:b', 'iconify:mdi:a']);
  });

  it('reports per-pack stats', async () => {
    await storeIcon(makeRecord('iconify:mdi:a', 100));
    await storeIcon(makeRecord('iconify:mdi:b', 200));
    await storeIcon(makeRecord('iconify:lucide:c', 300));
    const stats = await getPackStats();
    expect(stats.find((s) => s.prefix === 'mdi')).toMatchObject({ count: 2, bytes: 300 });
    expect(stats.find((s) => s.prefix === 'lucide')).toMatchObject({ count: 1, bytes: 300 });
  });

  it('removes one pack without touching others', async () => {
    await storeIcon(makeRecord('iconify:mdi:a'));
    await storeIcon(makeRecord('iconify:lucide:c'));
    const removed = await removePackFromCache('mdi');
    expect(removed).toBe(1);
    const remaining = await listStoredIcons();
    expect(remaining.map((r) => r.prefix)).toEqual(['lucide']);
  });

  it('scans integrity and flags corrupt entries', async () => {
    await storeIcon(makeRecord('iconify:mdi:good'));
    const indexedDb = (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB;
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDb.open('varve-icon-storage');
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('icons', 'readwrite');
      tx.objectStore('icons').put({ id: 'iconify:mdi:corrupt', svg: '' });
      tx.oncomplete = () => resolve();
    });
    db.close();
    const integrity = await scanCacheIntegrity();
    expect(integrity.total).toBe(2);
    expect(integrity.corrupt).toBe(1);
  });
});

describe('cache budget and eviction', () => {
  it('evicts LRU records over the budget', async () => {
    await storeIcon(makeRecord('iconify:mdi:old', 300, { lastAccessedAt: 100 }));
    await storeIcon(makeRecord('iconify:mdi:new', 300, { lastAccessedAt: 200 }));
    // Budget of 400: the oldest (300) must be evicted when a third arrives.
    await storeIcon(makeRecord('iconify:mdi:third', 100), { budgetBytes: 400 });
    const ids = (await listStoredIcons()).map((r) => r.canonicalId);
    expect(ids).not.toContain('iconify:mdi:old');
    expect(ids).toContain('iconify:mdi:new');
    expect(ids).toContain('iconify:mdi:third');
  });

  it('never evicts pinned or favourited records', async () => {
    await storeIcon(makeRecord('iconify:mdi:pinned', 300, { pinned: true, lastAccessedAt: 1 }));
    await storeIcon(makeRecord('iconify:mdi:fav', 300, { favourite: true, lastAccessedAt: 2 }));
    await storeIcon(makeRecord('iconify:mdi:plain', 300, { lastAccessedAt: 3 }), {
      budgetBytes: 400,
    });
    const ids = (await listStoredIcons()).map((r) => r.canonicalId);
    expect(ids).toContain('iconify:mdi:pinned');
    expect(ids).toContain('iconify:mdi:fav');
    expect(ids).not.toContain('iconify:mdi:plain');
  });

  it('setPinned toggles eviction protection', async () => {
    await storeIcon(makeRecord('iconify:mdi:p', 300, { lastAccessedAt: 1 }));
    await setPinned('iconify:mdi:p', true);
    await storeIcon(makeRecord('iconify:mdi:q', 300, { lastAccessedAt: 2 }), { budgetBytes: 400 });
    const ids = (await listStoredIcons()).map((r) => r.canonicalId);
    expect(ids).toContain('iconify:mdi:p');
  });

  it('uses the default budget when none is provided', () => {
    expect(DEFAULT_CACHE_BUDGET_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe('cache size reporting', () => {
  it('sums byte sizes', async () => {
    await storeIcon(makeRecord('iconify:mdi:a', 100));
    await storeIcon(makeRecord('iconify:mdi:b', 200));
    expect(await getCacheSize()).toBe(300);
  });
});
