import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PluginPackageManifest } from './package';
import {
  deleteStoredPlugin,
  getStoredPluginState,
  listStoredPluginInventory,
  PluginStoreConflictError,
  putStoredPlugin,
  type StoredPlugin,
  withStoredPluginGuard,
} from './store';

const DB_NAME = 'varve-application-plugins-v1';
const encoder = new TextEncoder();

const manifest = (id: string): PluginPackageManifest => ({
  schemaVersion: 1,
  id,
  name: id,
  publisher: 'Store tests',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'module.wasm',
  permissions: { required: [], optional: [] },
  commands: [],
});

function record(id: string, patch: Partial<StoredPlugin> = {}): StoredPlugin {
  const pluginManifest = manifest(id);
  return {
    archive: encoder.encode(id),
    manifest: pluginManifest,
    wasm: new Uint8Array(),
    sha256: `hash-${id}`,
    grants: [],
    installedAt: 1,
    enabled: false,
    source: 'local-file',
    ...patch,
  };
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('test database deletion was blocked'));
  });
}

async function openVersionOne(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('packages', { keyPath: 'manifest.id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe('transactional plugin store', () => {
  beforeEach(async () => deleteDatabase());

  it('preserves v1 installations and additively seeds durable revisions', async () => {
    const legacy = record('com.example.legacy', {
      enabled: true,
      grants: ['selection.read'],
      hiddenPanels: ['details'],
      previous: {
        archive: encoder.encode('previous'),
        manifest: manifest('com.example.legacy'),
        wasm: new Uint8Array([1, 2, 3]),
        sha256: 'previous-hash',
        grants: ['selection.read'],
        installedAt: 0,
      },
    });
    const db = await openVersionOne();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('packages', 'readwrite');
      transaction.objectStore('packages').put(legacy);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();

    const inventory = await listStoredPluginInventory();
    expect(inventory.plugins).toHaveLength(1);
    expect(inventory.revisions.get(legacy.manifest.id)).toBe(1);
    expect(inventory.plugins[0]?.grants).toEqual(['selection.read']);
    expect(inventory.plugins[0]?.hiddenPanels).toEqual(['details']);
    expect(inventory.plugins[0]?.previous?.sha256).toBe('previous-hash');
  });

  it('allows only one competing write at an expected revision', async () => {
    const [first, second] = await Promise.allSettled([
      putStoredPlugin(record('com.example.race', { sha256: 'first' }), 0),
      putStoredPlugin(record('com.example.race', { sha256: 'second' }), 0),
    ]);
    expect([first.status, second.status].filter((status) => status === 'fulfilled')).toHaveLength(
      1,
    );
    const rejected = [first, second].find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
      PluginStoreConflictError,
    );
    expect((await getStoredPluginState('com.example.race')).revision).toBe(1);
  });

  it('keeps the previous package and revision when an IndexedDB write transaction aborts', async () => {
    await putStoredPlugin(record('com.example.interrupted', { sha256: 'working' }), 0);

    const prototype = IDBObjectStore.prototype;
    const originalPut = prototype.put;
    let abortQueued = false;
    prototype.put = function (
      this: IDBObjectStore,
      value: Parameters<typeof originalPut>[0],
      key?: Parameters<typeof originalPut>[1],
    ) {
      const request =
        key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
      if (this.name === 'packages' && !abortQueued) {
        abortQueued = true;
        queueMicrotask(() => request.transaction?.abort());
      }
      return request;
    };

    try {
      await expect(
        putStoredPlugin(record('com.example.interrupted', { sha256: 'partial-update' }), 1),
      ).rejects.toThrow();
    } finally {
      prototype.put = originalPut;
    }

    expect(abortQueued).toBe(true);
    const afterAbort = await getStoredPluginState('com.example.interrupted');
    expect(afterAbort.revision).toBe(1);
    expect(afterAbort.plugin?.sha256).toBe('working');
  });

  it('enforces the 32-installation cap inside competing write transactions', async () => {
    for (let index = 0; index < 31; index++) {
      await putStoredPlugin(record(`com.example.${index}`), 0);
    }
    const attempts = await Promise.allSettled([
      putStoredPlugin(record('com.example.final-a'), 0),
      putStoredPlugin(record('com.example.final-b'), 0),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await listStoredPluginInventory()).plugins).toHaveLength(32);
  });

  it('retains tombstones across remove and reinstall to prevent stale-state ABA', async () => {
    await putStoredPlugin(record('com.example.removed'), 0);
    expect(await deleteStoredPlugin('com.example.removed', 1)).toBe(2);
    const missing = await getStoredPluginState('com.example.removed');
    expect(missing).toEqual({ plugin: undefined, revision: 2 });
    await expect(putStoredPlugin(record('com.example.removed'), 1)).rejects.toBeInstanceOf(
      PluginStoreConflictError,
    );
    expect(await putStoredPlugin(record('com.example.removed'), 2)).toBe(3);
  });

  it('executes guarded host work synchronously under the same write lock', async () => {
    await putStoredPlugin(record('com.example.guard'), 0);
    const observed: number[] = [];
    const result = await withStoredPluginGuard('com.example.guard', 1, (state) => {
      observed.push(state.revision);
      return state.plugin?.sha256;
    });
    expect(observed).toEqual([1]);
    expect(result).toBe('hash-com.example.guard');
    await expect(
      withStoredPluginGuard('com.example.guard', 0, () => 'must not execute'),
    ).rejects.toBeInstanceOf(PluginStoreConflictError);
    await expect(
      withStoredPluginGuard('com.example.guard', 1, () => {
        throw new Error('host mutation failed');
      }),
    ).rejects.toThrow('host mutation failed');
    expect((await getStoredPluginState('com.example.guard')).revision).toBe(1);
  });
});
