import { describe, expect, it } from 'vitest';
import {
  clearDisposableAppCaches,
  collectStorageInventory,
  isDisposableAppCache,
  requestPersistentStorage,
} from './storageInventory';

describe('storage inventory', () => {
  it('collects estimates, persistence, owned caches, and recovery data', async () => {
    const inventory = await collectStorageInventory({
      storageManager: {
        estimate: async () => ({ usage: 1024, quota: 8192 }),
        persisted: async () => true,
      },
      cacheStorage: {
        keys: async () => ['varve-demo-shell-v2', 'another-app-v1'],
        open: async () => ({ keys: async () => [1, 2, 3] }),
      },
      listRecoveryMeta: async () => [{ sizeBytes: 100 }, { sizeBytes: 50 }],
    });

    expect(inventory.estimate).toEqual({ usageBytes: 1024, quotaBytes: 8192 });
    expect(inventory.persisted).toBe(true);
    // Only this app's prefix is counted, and entries are summed.
    expect(inventory.appCaches.names).toEqual(['varve-demo-shell-v2']);
    expect(inventory.appCaches.entries).toBe(3);
    expect(inventory.recovery).toEqual({ count: 2, bytes: 150 });
  });

  it('degrades to null/zero when APIs are missing or throw', async () => {
    const inventory = await collectStorageInventory({
      storageManager: {
        estimate: async () => {
          throw new Error('denied');
        },
      },
      cacheStorage: {
        keys: async () => {
          throw new Error('private mode');
        },
      },
      listRecoveryMeta: async () => {
        throw new Error('idb blocked');
      },
    });

    expect(inventory.estimate).toEqual({ usageBytes: null, quotaBytes: null });
    expect(inventory.persisted).toBeNull();
    expect(inventory.appCaches).toEqual({ names: [], entries: 0 });
    expect(inventory.recovery).toEqual({ count: 0, bytes: 0 });
  });

  it('treats non-finite estimates as unknown', async () => {
    const inventory = await collectStorageInventory({
      storageManager: {
        estimate: async () => ({ usage: Number.NaN, quota: -5 }),
      },
    });
    expect(inventory.estimate).toEqual({ usageBytes: null, quotaBytes: null });
  });
});

describe('disposable app caches', () => {
  it('matches only the owned prefix', () => {
    expect(isDisposableAppCache('varve-demo-shell-v2')).toBe(true);
    expect(isDisposableAppCache('varve-demo-shell-v1')).toBe(true);
    expect(isDisposableAppCache('workbox-precache-v2')).toBe(false);
    expect(isDisposableAppCache('varve-recovery')).toBe(false);
  });

  it('deletes owned caches only and reports them', async () => {
    const deleted: string[] = [];
    const result = await clearDisposableAppCaches({
      keys: async () => ['varve-demo-shell-v2', 'someone-elses-cache', 'varve-demo-shell-v1'],
      delete: async (name) => {
        deleted.push(name);
        return true;
      },
    });

    expect(result).toEqual(['varve-demo-shell-v2', 'varve-demo-shell-v1']);
    expect(deleted).toEqual(['varve-demo-shell-v2', 'varve-demo-shell-v1']);
  });
});

describe('persistence request', () => {
  it('reports the browser answer or unavailability', async () => {
    expect(await requestPersistentStorage({ persist: async () => true })).toBe(true);
    expect(await requestPersistentStorage({ persist: async () => false })).toBe(false);
    expect(await requestPersistentStorage(undefined)).toBeNull();
    expect(
      await requestPersistentStorage({
        persist: async () => {
          throw new Error('nope');
        },
      }),
    ).toBeNull();
  });
});
