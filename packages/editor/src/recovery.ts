/**
 * RecoveryManager — crash-recovery session persistence.
 *
 * Maintains auto-save recovery points separate from the main document,
 * with cleanup of stale sessions and graceful handling of corrupt data.
 */

import type { Document } from '@varve/scene';
import { migrateDocumentJson, serializeDocument } from '@varve/scene';

export interface RecoverySession {
  id: string;
  tabName: string;
  timestamp: number;
  fileId?: string;
  filePath?: string;
}

export interface RecoveryStorage {
  save(key: string, data: string): Promise<void>;
  load(key: string): Promise<string | null>;
  list(): Promise<string[]>;
  delete(key: string): Promise<void>;
}

const KEY_PREFIX = 'recovery_';

export class MemoryRecoveryStorage implements RecoveryStorage {
  private store = new Map<string, string>();

  async save(key: string, data: string): Promise<void> {
    this.store.set(key, data);
  }

  async load(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async list(): Promise<string[]> {
    return [...this.store.keys()];
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export class IndexedDbRecoveryStorage implements RecoveryStorage {
  /** Live DB name. Recovery sessions are recovered-from or deleted within
   *  seconds of an app crash, so a one-time copy of the legacy database
   *  (strata-recovery) keeps pre-rename crash sessions discoverable. */
  private dbName = 'varve-recovery';
  private legacyDbName = 'strata-recovery';
  private storeName = 'sessions';

  private async db(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(this.storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /** Copy any legacy pre-rename sessions into the live database once, so
   *  crash recovery survives the rename. Idempotent: the legacy DB is only
   *  read; it is never deleted (rollback to an old build keeps working). */
  private async migrateLegacy(): Promise<void> {
    try {
      const legacy = indexedDB.open(this.legacyDbName, 1);
      const legacyDb = await new Promise<IDBDatabase | null>((resolve) => {
        legacy.onupgradeneeded = () => {
          // Never mutate the legacy schema.
          legacy.transaction?.abort();
        };
        legacy.onsuccess = () => resolve(legacy.result);
        legacy.onerror = () => resolve(null);
      });
      if (!legacyDb) return;
      try {
        const tx = legacyDb.transaction('sessions', 'readonly');
        const store = tx.objectStore('sessions');
        const keysReq = store.getAllKeys();
        const valuesReq = store.getAll();
        await Promise.all([
          new Promise<void>((resolve, reject) => {
            keysReq.onsuccess = () => resolve();
            keysReq.onerror = () => reject(keysReq.error);
          }),
          new Promise<void>((resolve, reject) => {
            valuesReq.onsuccess = () => resolve();
            valuesReq.onerror = () => reject(valuesReq.error);
          }),
        ]);
        const live = await this.db();
        const liveTx = live.transaction(this.storeName, 'readwrite');
        const liveStore = liveTx.objectStore(this.storeName);
        const keys = keysReq.result as IDBValidKey[];
        const values = valuesReq.result as string[];
        keys.forEach((key, i) => {
          // Only fill missing keys — never overwrite a newer session.
          const existing = liveTx.objectStore(this.storeName).get(key);
          existing.onsuccess = () => {
            if (existing.result == null && values[i] != null) {
              liveStore.put(values[i] as string, key);
            }
          };
        });
        await new Promise<void>((resolve, reject) => {
          liveTx.oncomplete = () => resolve();
          liveTx.onerror = () => reject(liveTx.error);
        });
      } finally {
        legacyDb.close();
      }
    } catch {
      // Best-effort migration only.
    }
  }

  private async ensureMigrated(): Promise<void> {
    if (!this.migrationDone) {
      this.migrationDone = true;
      await this.migrateLegacy();
    }
  }

  private migrationDone = false;

  async save(key: string, data: string): Promise<void> {
    await this.ensureMigrated();
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).put(data, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async load(key: string): Promise<string | null> {
    await this.ensureMigrated();
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const request = tx.objectStore(this.storeName).get(key);
      request.onsuccess = () => resolve((request.result as string) ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async list(): Promise<string[]> {
    await this.ensureMigrated();
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const request = tx.objectStore(this.storeName).getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(key: string): Promise<void> {
    await this.ensureMigrated();
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export interface RecoverySessionMeta extends RecoverySession {
  nodeCount: number;
  sizeBytes: number;
}

const MAX_SESSIONS_DEFAULT = 20;

/**
 * Total recovery bytes kept per origin. Recovery points hold a full document
 * string each, so on a small eMMC device a handful of image-heavy documents
 * can occupy gigabytes if only the session count is capped. Older redundant
 * points for the same tab are evicted first; the newest point per tab is
 * never deleted to satisfy this cap (a single oversized point may therefore
 * keep the total above it).
 */
const MAX_TOTAL_BYTES_DEFAULT = 64 * 1024 * 1024;

export class RecoveryManager {
  constructor(
    private storage: RecoveryStorage,
    private maxTotalBytes = MAX_TOTAL_BYTES_DEFAULT,
  ) {}

  async createRecoveryPoint(
    doc: Document,
    tabName: string,
    fileId?: string,
    filePath?: string,
  ): Promise<void> {
    const id = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session: RecoverySession = {
      id,
      tabName,
      timestamp: Date.now(),
    };
    if (fileId) session.fileId = fileId;
    if (filePath) session.filePath = filePath;

    // Serialize through the canonical document serializer: raw
    // JSON.stringify converts RasterLayerNode.tiles (a Map) into {}, which
    // decodes back as an empty raster layer and silently discards paint
    // pixels on recovery. Splicing the serialized document keeps the existing
    // envelope shape without paying a parse+stringify round trip.
    const data = `{"session":${JSON.stringify(session)},"document":${serializeDocument(doc)}}`;

    await this.storage.save(`${KEY_PREFIX}${id}`, data);

    // Enforce max sessions limit — remove oldest beyond cap
    await this.enforceMaxSessions(MAX_SESSIONS_DEFAULT);
    await this.enforceTotalBytes();
  }

  /**
   * Evict the oldest redundant points until the byte cap is met. The newest
   * point for each tab is the only copy of that tab's latest work, so it is
   * protected even when it alone exceeds the cap.
   */
  private async enforceTotalBytes(): Promise<void> {
    const metas = await this.listSessionsMeta();
    let total = metas.reduce((sum, meta) => sum + meta.sizeBytes, 0);
    if (total <= this.maxTotalBytes) return;

    const protectedIds = new Set<string>();
    const seenTabs = new Set<string>();
    for (const meta of metas) {
      const tabKey = meta.fileId ?? `name:${meta.tabName}`;
      if (seenTabs.has(tabKey)) continue;
      seenTabs.add(tabKey);
      protectedIds.add(meta.id);
    }

    for (const meta of [...metas].reverse()) {
      if (total <= this.maxTotalBytes) break;
      if (protectedIds.has(meta.id)) continue;
      await this.deleteSession(meta.id);
      total -= meta.sizeBytes;
    }
  }

  private async enforceMaxSessions(max: number): Promise<void> {
    const sessions = await this.listSessions();
    if (sessions.length <= max) return;
    const toRemove = sessions.slice(max);
    for (const s of toRemove) {
      await this.deleteSession(s.id);
    }
  }

  async listSessions(): Promise<RecoverySession[]> {
    const keys = await this.storage.list();
    const sessions: RecoverySession[] = [];

    for (const key of keys) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      try {
        const raw = await this.storage.load(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed?.session && parsed.document) {
          sessions.push(parsed.session as RecoverySession);
        }
      } catch {
        // skip corrupt entries
      }
    }

    sessions.sort((a, b) => b.timestamp - a.timestamp);
    return sessions;
  }

  async restoreSession(
    id: string,
  ): Promise<{ document: Document; tabName: string; fileId?: string; filePath?: string } | null> {
    const raw = await this.storage.load(`${KEY_PREFIX}${id}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed?.document || !parsed.session) return null;
      const migrated = migrateDocumentJson(JSON.stringify(parsed.document));
      if (!migrated) return null;
      return {
        document: migrated as unknown as Document,
        tabName: parsed.session.tabName as string,
        fileId: parsed.session.fileId as string | undefined,
        filePath: parsed.session.filePath as string | undefined,
      };
    } catch {
      return null;
    }
  }

  async deleteSession(id: string): Promise<void> {
    await this.storage.delete(`${KEY_PREFIX}${id}`);
  }

  /**
   * Delete recovery points belonging to a tab the user intentionally
   * discarded at termination commit — discarded edits must not reappear as
   * "crash recovery" next launch (ADR-0216 D6).
   *
   * Matching is deliberately conservative: a file-bound tab matches exactly
   * by fileId; an untitled tab matches by name only when the match is unique.
   * Duplicate untitled names are skipped rather than risking the removal of
   * another open tab's recovery material.
   */
  async deleteRecoveryForTab(tabName: string, fileId?: string): Promise<number> {
    const sessions = await this.listSessions();
    const candidates = fileId
      ? sessions.filter((s) => s.fileId === fileId)
      : sessions.filter((s) => s.tabName === tabName);
    if (!fileId && candidates.length > 1) return 0;
    for (const session of candidates) {
      await this.deleteSession(session.id);
    }
    return candidates.length;
  }

  async cleanup(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const sessions = await this.listSessions();
    const now = Date.now();
    let removed = 0;

    for (const session of sessions) {
      if (now - session.timestamp > maxAgeMs) {
        await this.deleteSession(session.id);
        removed++;
      }
    }

    return removed;
  }

  async hasSessions(): Promise<boolean> {
    const sessions = await this.listSessions();
    return sessions.length > 0;
  }

  async listSessionsMeta(): Promise<RecoverySessionMeta[]> {
    const keys = await this.storage.list();
    const metas: RecoverySessionMeta[] = [];

    for (const key of keys) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      try {
        const raw = await this.storage.load(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (!parsed?.session || !parsed.document) continue;
        const session = parsed.session as RecoverySession;
        const nodeCount = parsed.document.nodes
          ? Object.keys(parsed.document.nodes as Record<string, unknown>).length
          : 0;
        metas.push({ ...session, nodeCount, sizeBytes: raw.length });
      } catch {
        // skip corrupt entries
      }
    }

    metas.sort((a, b) => b.timestamp - a.timestamp);
    return metas;
  }

  async verifySession(id: string): Promise<boolean> {
    const raw = await this.storage.load(`${KEY_PREFIX}${id}`);
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed?.document || !parsed.session) return false;
      const migrated = migrateDocumentJson(JSON.stringify(parsed.document));
      return migrated !== null;
    } catch {
      return false;
    }
  }
}

let sharedRecoveryManager: RecoveryManager | null = null;

export function getSharedRecoveryManager(): RecoveryManager {
  if (!sharedRecoveryManager) {
    const storage =
      typeof indexedDB !== 'undefined'
        ? new IndexedDbRecoveryStorage()
        : new MemoryRecoveryStorage();
    sharedRecoveryManager = new RecoveryManager(storage);
  }
  return sharedRecoveryManager;
}
