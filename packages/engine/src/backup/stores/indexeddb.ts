import type { BackupStore } from '../storage';
import type { BackupManifest, BackupStorageInfo, ProjectBackupIndex } from '../types';
import { computeChecksum } from '../verify';

const DB_NAME = 'strata-backups';
const DB_VERSION = 1;
const BACKUPS_STORE = 'backups';
const INDICES_STORE = 'indices';
const MANIFESTS_STORE = 'manifests';
const ASSETS_STORE = 'assets';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BACKUPS_STORE)) {
        db.createObjectStore(BACKUPS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(INDICES_STORE)) {
        db.createObjectStore(INDICES_STORE, { keyPath: 'projectId' });
      }
      if (!db.objectStoreNames.contains(MANIFESTS_STORE)) {
        db.createObjectStore(MANIFESTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ASSETS_STORE)) {
        db.createObjectStore(ASSETS_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function createIndexedDbBackupStore(): BackupStore {
  let dbPromise: Promise<IDBDatabase> | null = null;

  async function db(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = openDb();
    }
    return dbPromise;
  }

  function getOne<T>(storeName: string, key: string): Promise<T | undefined> {
    return db().then(
      (database) =>
        new Promise<T | undefined>((resolve, reject) => {
          const tx = database.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const request = store.get(key);
          request.onsuccess = () => resolve(request.result ?? undefined);
          request.onerror = () => reject(request.error);
        }),
    );
  }

  function getAll<T>(storeName: string): Promise<T[]> {
    return db().then(
      (database) =>
        new Promise<T[]>((resolve, reject) => {
          const tx = database.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result as T[]);
          request.onerror = () => reject(request.error);
        }),
    );
  }

  function put(storeName: string, value: unknown): Promise<void> {
    return db().then(
      (database) =>
        new Promise<void>((resolve, reject) => {
          const tx = database.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          const request = store.put(value);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        }),
    );
  }

  const store: BackupStore = {
    kind: 'indexeddb' as const,

    async listProjects(): Promise<string[]> {
      const index = await getAll<ProjectBackupIndex>(INDICES_STORE);
      return (index ?? []).map((i) => i.projectId);
    },

    async getProjectIndex(projectId: string): Promise<ProjectBackupIndex | null> {
      const result = await getOne<ProjectBackupIndex>(INDICES_STORE, projectId);
      return result ?? null;
    },

    async saveProjectIndex(_projectId: string, idx: ProjectBackupIndex): Promise<void> {
      await put(INDICES_STORE, idx);
    },

    async saveBackup(
      projectId: string,
      backupId: string,
      manifest: BackupManifest,
      documentJson: string,
      assets?: Map<string, string>,
    ): Promise<void> {
      const database = await db();
      const tx = database.transaction([BACKUPS_STORE, MANIFESTS_STORE, ASSETS_STORE], 'readwrite');
      tx.objectStore(BACKUPS_STORE).put({ id: backupId, projectId, documentJson });
      tx.objectStore(MANIFESTS_STORE).put({ ...manifest, id: backupId });
      if (assets) {
        const assetStore = tx.objectStore(ASSETS_STORE);
        for (const [hash, data] of assets) {
          assetStore.put({ key: `${backupId}:${hash}`, hash, data });
        }
      }
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },

    async readBackupManifest(backupId: string): Promise<BackupManifest | null> {
      const result = await getOne<BackupManifest>(MANIFESTS_STORE, backupId);
      return result ?? null;
    },

    async readBackupDocument(backupId: string): Promise<string | null> {
      const result = await getOne<{ documentJson: string }>(BACKUPS_STORE, backupId);
      return result?.documentJson ?? null;
    },

    async readBackupAsset(backupId: string, assetHash: string): Promise<string | null> {
      const result = await getOne<{ data: string }>(ASSETS_STORE, `${backupId}:${assetHash}`);
      return result?.data ?? null;
    },

    async deleteBackup(_projectId: string, backupId: string): Promise<void> {
      const database = await db();
      const tx = database.transaction([BACKUPS_STORE, MANIFESTS_STORE, ASSETS_STORE], 'readwrite');
      tx.objectStore(BACKUPS_STORE).delete(backupId);
      tx.objectStore(MANIFESTS_STORE).delete(backupId);
      const assetStore = tx.objectStore(ASSETS_STORE);
      const range = IDBKeyRange.bound(`${backupId}:`, `${backupId}:\uffff`);
      assetStore.delete(range);
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },

    async backupSize(backupId: string): Promise<number> {
      const manifest = await store.readBackupManifest(backupId);
      if (!manifest) return 0;
      return manifest.documentSize;
    },

    async getStorageInfo(): Promise<BackupStorageInfo> {
      const indices = await getAll<ProjectBackupIndex>(INDICES_STORE);
      const entries = indices?.flatMap((i) => i.backups) ?? [];
      const totalBytes = entries.reduce((s, e) => s + e.size, 0);
      const lastBackupAt = entries.reduce((max, e) => Math.max(max, e.createdAt), 0);
      return {
        totalBytes,
        entryCount: entries.length,
        projectCount: indices?.length ?? 0,
        lastBackupAt,
        lastVerificationAt: 0,
      };
    },

    async exportArchive(backupIds: string[]): Promise<Uint8Array> {
      const entries: Array<{ manifest: BackupManifest; document: string }> = [];
      for (const id of backupIds) {
        const manifest = await store.readBackupManifest(id);
        const document = await store.readBackupDocument(id);
        if (manifest && document) {
          entries.push({ manifest, document });
        }
      }
      const archive = JSON.stringify({
        formatVersion: 1,
        archiveType: 'project-backup',
        createdAt: Date.now(),
        entries,
      });
      return new TextEncoder().encode(archive);
    },

    async importArchive(data: Uint8Array): Promise<string> {
      const text = new TextDecoder().decode(data);
      const archive = JSON.parse(text);
      if (!archive.entries) return 'no-entries';
      let count = 0;
      for (const entry of archive.entries) {
        const pId = entry.manifest?.projectId ?? 'imported';
        const bId = entry.manifest?.id ?? `import-${count}`;
        await store.saveBackup(pId, bId, entry.manifest, entry.document);
        const index = await store.getProjectIndex(pId);
        if (!index) {
          await store.saveProjectIndex(pId, {
            formatVersion: 1,
            projectId: pId,
            backups: [],
            totalSize: 0,
            entryCount: 0,
            lastBackupAt: 0,
            lastVerificationAt: 0,
          });
        }
        count++;
      }
      return `imported-${count}`;
    },

    async verifyBackup(backupId: string): Promise<{ valid: boolean; computedChecksum: string }> {
      const manifest = await store.readBackupManifest(backupId);
      const document = await store.readBackupDocument(backupId);
      if (!manifest || !document) {
        return { valid: false, computedChecksum: '' };
      }
      const checksum = await computeChecksum(document);
      return {
        valid: checksum === manifest.documentChecksum,
        computedChecksum: checksum,
      };
    },

    async close(): Promise<void> {
      const database = await db();
      database.close();
      dbPromise = null;
    },
  };

  return store;
}
