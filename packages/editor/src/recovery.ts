/**
 * RecoveryManager — crash-recovery session persistence.
 *
 * Maintains auto-save recovery points separate from the main document,
 * with cleanup of stale sessions and graceful handling of corrupt data.
 */

import type { Document } from '@varve/scene';
import { migrateDocumentJson } from '@varve/scene';

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
  private dbName = 'strata-recovery';
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

  async save(key: string, data: string): Promise<void> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).put(data, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async load(key: string): Promise<string | null> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const request = tx.objectStore(this.storeName).get(key);
      request.onsuccess = () => resolve((request.result as string) ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async list(): Promise<string[]> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const request = tx.objectStore(this.storeName).getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(key: string): Promise<void> {
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

export class RecoveryManager {
  constructor(private storage: RecoveryStorage) {}

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

    const data = JSON.stringify({
      session,
      document: doc,
    });

    await this.storage.save(`${KEY_PREFIX}${id}`, data);

    // Enforce max sessions limit — remove oldest beyond cap
    await this.enforceMaxSessions(MAX_SESSIONS_DEFAULT);
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
