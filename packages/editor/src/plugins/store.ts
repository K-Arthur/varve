import type { PluginPackageManifest, PluginPermission } from './package';

const DB_NAME = 'varve-application-plugins-v1';
const STORE_NAME = 'packages';
const REVISION_STORE = 'revisions';
const DB_VERSION = 2;
const CHANGE_CHANNEL = 'varve-application-plugins-v1';

export interface StoredPluginVersion {
  archive: Uint8Array;
  manifest: PluginPackageManifest;
  wasm: Uint8Array;
  sha256: string;
  grants: PluginPermission[];
  installedAt: number;
}

export interface StoredPlugin extends StoredPluginVersion {
  enabled: boolean;
  source: 'local-file';
  previous?: StoredPluginVersion;
  lastError?: string;
  /**
   * Contribution IDs of Inspector panels the user hid. User-local display
   * preference, never document state: it must not touch artwork or history.
   * Retained with updates/rollback (filtered to still-declared panels) and
   * dropped with the installation itself.
   */
  hiddenPanels?: string[];
}

export interface StoredPluginState {
  plugin?: StoredPlugin;
  revision: number;
}

export interface StoredPluginInventory {
  plugins: StoredPlugin[];
  /** Includes durable tombstones for IDs that have been removed. */
  revisions: Map<string, number>;
}

interface RevisionRecord {
  id: string;
  revision: number;
}

export interface PluginStoreChange {
  id: string;
  revision: number;
  removed: boolean;
}

export class PluginStoreConflictError extends Error {
  constructor() {
    super('Plugin state changed in another window; refresh the plugin inventory and retry');
    this.name = 'PluginStoreConflictError';
  }
}

const sourceId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
const changeSubscribers = new Set<(change: PluginStoreChange) => void>();
let changeChannel: BroadcastChannel | null | undefined;

function getChangeChannel(): BroadcastChannel | null {
  if (changeChannel !== undefined) return changeChannel;
  changeChannel =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANGE_CHANNEL);
  if (changeChannel) {
    changeChannel.onmessage = (event: MessageEvent<unknown>) => {
      const value = event.data as Partial<PluginStoreChange> & { sourceId?: unknown };
      if (
        !value ||
        typeof value !== 'object' ||
        value.sourceId === sourceId ||
        typeof value.id !== 'string' ||
        !Number.isSafeInteger(value.revision) ||
        typeof value.removed !== 'boolean'
      ) {
        return;
      }
      const change = { id: value.id, revision: value.revision!, removed: value.removed };
      for (const subscriber of changeSubscribers) subscriber(change);
    };
  }
  return changeChannel;
}

/**
 * A channel notice is only an invalidation hint. Receivers must reread the
 * authoritative IndexedDB row and revision before permitting any operation.
 */
function announceChange(change: PluginStoreChange): void {
  getChangeChannel()?.postMessage({ ...change, sourceId });
}

export function subscribeStoredPluginChanges(
  subscriber: (change: PluginStoreChange) => void,
): () => void {
  getChangeChannel();
  changeSubscribers.add(subscriber);
  return () => changeSubscribers.delete(subscriber);
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Local plugin storage is unavailable in this runtime'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'manifest.id' });
      }
      if (!db.objectStoreNames.contains(REVISION_STORE)) {
        const revisions = db.createObjectStore(REVISION_STORE, { keyPath: 'id' });
        // Additive migration. Existing packages and their grants/preferences
        // are retained; revision 1 makes their first guarded operation CAS-safe.
        const packages = transaction?.objectStore(STORE_NAME);
        if (packages) {
          packages.openCursor().onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (!cursor) return;
            const id = (cursor.value as StoredPlugin).manifest?.id;
            if (typeof id === 'string') revisions.put({ id, revision: 1 } satisfies RevisionRecord);
            cursor.continue();
          };
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open plugin storage'));
    // Do not reject here: the versionchange request may unblock when another
    // window finishes its current IndexedDB operation or closes normally.
  });
}

function stores(db: IDBDatabase, mode: IDBTransactionMode): IDBTransaction {
  return db.transaction([STORE_NAME, REVISION_STORE], mode);
}

function revisionFor(plugin: StoredPlugin | undefined, record: RevisionRecord | undefined): number {
  return record?.revision ?? (plugin ? 1 : 0);
}

function validRevision(revision: number): boolean {
  return Number.isSafeInteger(revision) && revision >= 0;
}

function transactionError(transaction: IDBTransaction, fallback: string): Error {
  return transaction.error ?? new Error(fallback);
}

export function listStoredPluginInventory(): Promise<StoredPluginInventory> {
  return openDatabase().then(
    (db) =>
      new Promise<StoredPluginInventory>((resolve, reject) => {
        const transaction = stores(db, 'readonly');
        const pluginRequest = transaction.objectStore(STORE_NAME).getAll() as IDBRequest<
          StoredPlugin[]
        >;
        const revisionRequest = transaction.objectStore(REVISION_STORE).getAll() as IDBRequest<
          RevisionRecord[]
        >;
        let plugins: StoredPlugin[] = [];
        let revisionRecords: RevisionRecord[] = [];
        pluginRequest.onsuccess = () => {
          plugins = pluginRequest.result;
        };
        revisionRequest.onsuccess = () => {
          revisionRecords = revisionRequest.result;
        };
        transaction.oncomplete = () => {
          db.close();
          const revisions = new Map(revisionRecords.map(({ id, revision }) => [id, revision]));
          for (const plugin of plugins) {
            if (!revisions.has(plugin.manifest.id)) revisions.set(plugin.manifest.id, 1);
          }
          resolve({ plugins, revisions });
        };
        transaction.onerror = () => {
          db.close();
          reject(transactionError(transaction, 'Could not read plugin inventory'));
        };
        transaction.onabort = () => {
          db.close();
          reject(transactionError(transaction, 'Plugin inventory read was aborted'));
        };
      }),
  );
}

export function listStoredPlugins(): Promise<StoredPlugin[]> {
  return listStoredPluginInventory().then(({ plugins }) => plugins);
}

export function getStoredPluginState(id: string): Promise<StoredPluginState> {
  return openDatabase().then(
    (db) =>
      new Promise<StoredPluginState>((resolve, reject) => {
        const transaction = stores(db, 'readonly');
        const pluginRequest = transaction.objectStore(STORE_NAME).get(id) as IDBRequest<
          StoredPlugin | undefined
        >;
        const revisionRequest = transaction.objectStore(REVISION_STORE).get(id) as IDBRequest<
          RevisionRecord | undefined
        >;
        let plugin: StoredPlugin | undefined;
        let revisionRecord: RevisionRecord | undefined;
        pluginRequest.onsuccess = () => {
          plugin = pluginRequest.result;
        };
        revisionRequest.onsuccess = () => {
          revisionRecord = revisionRequest.result;
        };
        transaction.oncomplete = () => {
          db.close();
          resolve({ plugin, revision: revisionFor(plugin, revisionRecord) });
        };
        transaction.onerror = () => {
          db.close();
          reject(transactionError(transaction, 'Could not read plugin state'));
        };
        transaction.onabort = () => {
          db.close();
          reject(transactionError(transaction, 'Plugin state read was aborted'));
        };
      }),
  );
}

export function getStoredPlugin(id: string): Promise<StoredPlugin | undefined> {
  return getStoredPluginState(id).then(({ plugin }) => plugin);
}

/**
 * Run a synchronous host operation while holding an exclusive transaction on
 * both authoritative stores. The callback must not yield or call guest code.
 * This also works when `navigator.locks` is absent.
 */
export function withStoredPluginGuard<T>(
  id: string,
  expectedRevision: number,
  operation: (state: StoredPluginState) => T,
): Promise<T> {
  if (!validRevision(expectedRevision)) return Promise.reject(new Error('Invalid plugin revision'));
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = stores(db, 'readwrite');
        const pluginRequest = transaction.objectStore(STORE_NAME).get(id) as IDBRequest<
          StoredPlugin | undefined
        >;
        const revisionRequest = transaction.objectStore(REVISION_STORE).get(id) as IDBRequest<
          RevisionRecord | undefined
        >;
        let plugin: StoredPlugin | undefined;
        let revisionRecord: RevisionRecord | undefined;
        let pluginReady = false;
        let revisionReady = false;
        let operationRan = false;
        let result!: T;
        let failure: Error | undefined;
        const abort = (error: Error) => {
          failure = error;
          try {
            transaction.abort();
          } catch {
            // The transaction may already have aborted after a request error.
          }
        };
        const invokeWhenReady = () => {
          if (!pluginReady || !revisionReady || operationRan) return;
          operationRan = true;
          const state = { plugin, revision: revisionFor(plugin, revisionRecord) };
          if (state.revision !== expectedRevision) {
            abort(new PluginStoreConflictError());
            return;
          }
          try {
            result = operation(state);
            if (
              result !== null &&
              (typeof result === 'object' || typeof result === 'function') &&
              typeof (result as { then?: unknown }).then === 'function'
            ) {
              throw new Error('Guarded plugin operations must be synchronous');
            }
          } catch (error) {
            abort(error instanceof Error ? error : new Error(String(error)));
          }
        };
        pluginRequest.onsuccess = () => {
          plugin = pluginRequest.result;
          pluginReady = true;
          invokeWhenReady();
        };
        revisionRequest.onsuccess = () => {
          revisionRecord = revisionRequest.result;
          revisionReady = true;
          invokeWhenReady();
        };
        transaction.oncomplete = () => {
          db.close();
          resolve(result);
        };
        transaction.onerror = () => {
          db.close();
          reject(failure ?? transactionError(transaction, 'Plugin operation failed'));
        };
        transaction.onabort = () => {
          db.close();
          reject(failure ?? transactionError(transaction, 'Plugin operation was aborted'));
        };
      }),
  );
}

/**
 * Compare-and-replace an installation and its revision atomically. Every
 * lifecycle mutation uses this path, including first installation. The
 * installation cap is checked inside the same transaction as the write.
 */
export function putStoredPlugin(plugin: StoredPlugin, expectedRevision: number): Promise<number> {
  if (!validRevision(expectedRevision)) return Promise.reject(new Error('Invalid plugin revision'));
  return openDatabase().then(
    (db) =>
      new Promise<number>((resolve, reject) => {
        const transaction = stores(db, 'readwrite');
        const packages = transaction.objectStore(STORE_NAME);
        const revisions = transaction.objectStore(REVISION_STORE);
        const currentRequest = packages.get(plugin.manifest.id) as IDBRequest<
          StoredPlugin | undefined
        >;
        const revisionRequest = revisions.get(plugin.manifest.id) as IDBRequest<
          RevisionRecord | undefined
        >;
        const keysRequest = packages.getAllKeys();
        let current: StoredPlugin | undefined;
        let revisionRecord: RevisionRecord | undefined;
        let keys: IDBValidKey[] = [];
        let currentReady = false;
        let revisionReady = false;
        let keysReady = false;
        let writeStarted = false;
        let nextRevision = 0;
        let failure: Error | undefined;
        const abort = (error: Error) => {
          failure = error;
          try {
            transaction.abort();
          } catch {
            // The transaction may already have aborted after a request error.
          }
        };
        const writeWhenReady = () => {
          if (!currentReady || !revisionReady || !keysReady || writeStarted) return;
          writeStarted = true;
          const actualRevision = revisionFor(current, revisionRecord);
          if (actualRevision !== expectedRevision) {
            abort(new PluginStoreConflictError());
            return;
          }
          if (!current && keys.length >= 32) {
            abort(new Error('The 32-plugin local limit is reached'));
            return;
          }
          if (actualRevision === Number.MAX_SAFE_INTEGER) {
            abort(new Error('Plugin revision limit reached'));
            return;
          }
          nextRevision = actualRevision + 1;
          packages.put(plugin);
          revisions.put({
            id: plugin.manifest.id,
            revision: nextRevision,
          } satisfies RevisionRecord);
        };
        currentRequest.onsuccess = () => {
          current = currentRequest.result;
          currentReady = true;
          writeWhenReady();
        };
        revisionRequest.onsuccess = () => {
          revisionRecord = revisionRequest.result;
          revisionReady = true;
          writeWhenReady();
        };
        keysRequest.onsuccess = () => {
          keys = keysRequest.result;
          keysReady = true;
          writeWhenReady();
        };
        transaction.oncomplete = () => {
          db.close();
          resolve(nextRevision);
          announceChange({ id: plugin.manifest.id, revision: nextRevision, removed: false });
        };
        transaction.onerror = () => {
          db.close();
          reject(failure ?? transactionError(transaction, 'Could not save plugin package'));
        };
        transaction.onabort = () => {
          db.close();
          reject(failure ?? transactionError(transaction, 'Plugin package save was aborted'));
        };
      }),
  );
}

/** Delete an installation while retaining an incremented tombstone revision. */
export function deleteStoredPlugin(id: string, expectedRevision: number): Promise<number> {
  if (!validRevision(expectedRevision)) return Promise.reject(new Error('Invalid plugin revision'));
  return openDatabase().then(
    (db) =>
      new Promise<number>((resolve, reject) => {
        const transaction = stores(db, 'readwrite');
        const packages = transaction.objectStore(STORE_NAME);
        const revisions = transaction.objectStore(REVISION_STORE);
        const currentRequest = packages.get(id) as IDBRequest<StoredPlugin | undefined>;
        const revisionRequest = revisions.get(id) as IDBRequest<RevisionRecord | undefined>;
        let current: StoredPlugin | undefined;
        let revisionRecord: RevisionRecord | undefined;
        let currentReady = false;
        let revisionReady = false;
        let deleteStarted = false;
        let nextRevision = 0;
        let failure: Error | undefined;
        const abort = (error: Error) => {
          failure = error;
          try {
            transaction.abort();
          } catch {
            // The transaction may already have aborted after a request error.
          }
        };
        const deleteWhenReady = () => {
          if (!currentReady || !revisionReady || deleteStarted) return;
          deleteStarted = true;
          const actualRevision = revisionFor(current, revisionRecord);
          if (!current || actualRevision !== expectedRevision) {
            abort(!current ? new Error('Plugin is not installed') : new PluginStoreConflictError());
            return;
          }
          if (actualRevision === Number.MAX_SAFE_INTEGER) {
            abort(new Error('Plugin revision limit reached'));
            return;
          }
          nextRevision = actualRevision + 1;
          packages.delete(id);
          revisions.put({ id, revision: nextRevision } satisfies RevisionRecord);
        };
        currentRequest.onsuccess = () => {
          current = currentRequest.result;
          currentReady = true;
          deleteWhenReady();
        };
        revisionRequest.onsuccess = () => {
          revisionRecord = revisionRequest.result;
          revisionReady = true;
          deleteWhenReady();
        };
        transaction.oncomplete = () => {
          db.close();
          resolve(nextRevision);
          announceChange({ id, revision: nextRevision, removed: true });
        };
        transaction.onerror = () => {
          db.close();
          reject(failure ?? transactionError(transaction, 'Could not remove plugin package'));
        };
        transaction.onabort = () => {
          db.close();
          reject(failure ?? transactionError(transaction, 'Plugin package removal was aborted'));
        };
      }),
  );
}
