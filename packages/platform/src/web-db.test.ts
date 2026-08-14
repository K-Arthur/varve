import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression test for the legacy IndexedDB migration race: puts issued
 * from inside async get callbacks could land after the write transaction
 * auto-committed, throwing TransactionInactiveError and crashing the app
 * through the window-error handler.
 */
describe('migrateLegacyIndexedDb', () => {
  let IDB: typeof import('fake-indexeddb').IDBFactory;

  beforeEach(async () => {
    const fdb = await import('fake-indexeddb');
    IDB = fdb.IDBFactory;
    vi.stubGlobal('indexedDB', new IDB());
    vi.stubGlobal('IDBKeyRange', (await import('fake-indexeddb')).IDBKeyRange);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('copies legacy records without throwing on the write transaction', async () => {
    const { migrateLegacyIndexedDb } = await import('./web-db');
    const legacyName = 'varve-legacy-test';
    const currentName = 'varve-current-test';

    // Seed the legacy database with records.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(legacyName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('models');
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('models', 'readwrite');
        const store = tx.objectStore('models');
        for (let i = 0; i < 12; i++) {
          store.put({ v: i }, `key-${i}`);
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    // Current database exists but is empty for the store.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(currentName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('models');
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });

    await expect(
      migrateLegacyIndexedDb(legacyName, currentName, ['models']),
    ).resolves.toBeUndefined();

    // All records arrived in the current database.
    const count = await new Promise<number>((resolve, reject) => {
      const req = indexedDB.open(currentName, 1);
      req.onsuccess = () => {
        const db = req.result;
        const countReq = db.transaction('models', 'readonly').objectStore('models').count();
        countReq.onsuccess = () => {
          db.close();
          resolve(countReq.result);
        };
        countReq.onerror = () => reject(countReq.error);
      };
      req.onerror = () => reject(req.error);
    });
    expect(count).toBe(12);
  });
});
