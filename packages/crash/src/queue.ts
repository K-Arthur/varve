/**
 * Bounded local crash-report queue.
 *
 * Reports are stored ONLY after local redaction, under random opaque report
 * IDs, with count and byte caps, expiry, corruption isolation, and atomic
 * writes. The queue works offline and with reporting disabled: it is the
 * local record a user can inspect, export, or delete from settings.
 *
 * Storage implementations:
 *  - MemoryCrashReportStorage (tests, pre-render startup)
 *  - IndexedDbCrashReportStorage (browser + desktop webview)
 *  - NativeFsCrashReportStorage (desktop filesystem via Tauri commands —
 *    restrictive permissions, atomic writes, see crash.rs)
 */

import { type CrashReport, isValidCrashReport, LIMITS } from './schema';

export interface CrashReportStorage {
  listIds(): Promise<string[]>;
  load(id: string): Promise<string | null>;
  save(id: string, content: string): Promise<void>;
  delete(id: string): Promise<void>;
  /** Best-effort total byte usage; undefined when unavailable. */
  totalBytes?(): Promise<number | undefined>;
}

export class MemoryCrashReportStorage implements CrashReportStorage {
  private readonly store = new Map<string, string>();
  async listIds(): Promise<string[]> {
    return [...this.store.keys()];
  }
  async load(id: string): Promise<string | null> {
    return this.store.get(id) ?? null;
  }
  async save(id: string, content: string): Promise<void> {
    this.store.set(id, content);
  }
  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
  async totalBytes(): Promise<number | undefined> {
    let total = 0;
    for (const value of this.store.values()) total += value.length;
    return total;
  }
}

export interface IndexedDbOptions {
  dbName?: string;
  storeName?: string;
}

/**
 * IndexedDB-backed storage. Report IDs are random opaque strings; no
 * sensitive content appears in keys. Single-transaction writes are atomic.
 */
export class IndexedDbCrashReportStorage implements CrashReportStorage {
  private readonly dbName: string;
  private readonly storeName: string;

  constructor(options: IndexedDbOptions = {}) {
    this.dbName = options.dbName ?? 'varve-crash-reports';
    this.storeName = options.storeName ?? 'reports';
  }

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

  private tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    return (async () => {
      const db = await this.db();
      return new Promise<T>((resolve, reject) => {
        const tx = db.transaction(this.storeName, mode);
        const request = run(tx.objectStore(this.storeName));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      });
    })();
  }

  async listIds(): Promise<string[]> {
    return this.tx<string[]>('readonly', (store) => store.getAllKeys());
  }

  async load(id: string): Promise<string | null> {
    return this.tx<string>('readonly', (store) => store.get(id));
  }

  async save(id: string, content: string): Promise<void> {
    return this.tx<void>('readwrite', (store) => store.put(content, id));
  }

  async delete(id: string): Promise<void> {
    return this.tx<void>('readwrite', (store) => store.delete(id));
  }

  async totalBytes(): Promise<number | undefined> {
    const ids = await this.listIds();
    let total = 0;
    for (const id of ids) {
      const content = await this.load(id);
      if (content) total += content.length;
    }
    return total;
  }
}

export interface NativeFsCrashReportStorageOptions {
  list: () => Promise<string[]>;
  read: (id: string) => Promise<string | null>;
  write: (id: string, content: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/**
 * Desktop filesystem storage bridged to Tauri commands. The Rust side owns
 * the crash-report directory: restrictive permissions, atomic writes, path
 * sandboxing, and size caps (see apps/desktop/src-tauri/src/crash.rs).
 */
export class NativeFsCrashReportStorage implements CrashReportStorage {
  constructor(private readonly bridge: NativeFsCrashReportStorageOptions) {}

  async listIds(): Promise<string[]> {
    return this.bridge.list();
  }
  async load(id: string): Promise<string | null> {
    return this.bridge.read(id);
  }
  async save(id: string, content: string): Promise<void> {
    return this.bridge.write(id, content);
  }
  async delete(id: string): Promise<void> {
    return this.bridge.remove(id);
  }
}

export type EnqueueResult =
  | { status: 'queued'; report: CrashReport }
  | { status: 'dropped-invalid'; reason: string }
  | { status: 'dropped-full' };

/**
 * The local queue. All mutations are async; corruption never blocks startup
 * (malformed entries are isolated and skipped, not thrown).
 */
export class CrashReportQueue {
  constructor(
    private readonly storage: CrashReportStorage,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Enqueues a report that has ALREADY been sanitized (callers must use
   * `sanitizeCrashReport` first — the queue refuses anything invalid and
   * treats unredacted input as a programming error, not a new source of data).
   */
  async enqueue(report: CrashReport): Promise<EnqueueResult> {
    if (!isValidCrashReport(report)) {
      return { status: 'dropped-invalid', reason: 'schema validation failed' };
    }
    await this.sweepExpired();
    const ids = await this.storage.listIds();
    if (ids.length >= LIMITS.maxQueuedReports) {
      // Evict the oldest report to make room, bounded by byte budget too.
      const pruned = await this.pruneToBudget(report);
      if (!pruned) return { status: 'dropped-full' };
    }
    const serialized = JSON.stringify(report);
    if (serialized.length > LIMITS.maxReportBytes) {
      return { status: 'dropped-invalid', reason: 'report exceeds size limit' };
    }
    const bytes = await this.storage.totalBytes?.();
    if (bytes !== undefined && bytes + serialized.length > LIMITS.maxQueueBytes) {
      const pruned = await this.pruneToBudget(report);
      if (!pruned) return { status: 'dropped-full' };
    }
    await this.storage.save(report.reportId, serialized);
    return { status: 'queued', report };
  }

  private async pruneToBudget(incoming: CrashReport): Promise<boolean> {
    const ids = await this.storage.listIds();
    // Oldest first by createdAt; never prune the report being enqueued.
    const reports = await Promise.all(
      ids.map(async (id) => {
        const raw = await this.storage.load(id);
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw) as CrashReport;
          return { id, createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0 };
        } catch {
          return { id, createdAt: 0 };
        }
      }),
    );
    const sorted = reports
      .filter((r): r is { id: string; createdAt: number } => r !== null)
      .sort((a, b) => a.createdAt - b.createdAt);
    while (sorted.length > 0) {
      const victim = sorted.shift();
      if (!victim) break;
      if (victim.id === incoming.reportId) continue;
      await this.storage.delete(victim.id);
      const bytes = await this.storage.totalBytes?.();
      if (bytes !== undefined && bytes + JSON.stringify(incoming).length <= LIMITS.maxQueueBytes) {
        return true;
      }
    }
    return true;
  }

  /** Lists valid, non-expired reports newest first. Corrupt entries are skipped. */
  async list(): Promise<CrashReport[]> {
    await this.sweepExpired();
    const ids = await this.storage.listIds();
    const reports: CrashReport[] = [];
    for (const id of ids) {
      const raw = await this.storage.load(id);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as CrashReport;
        if (isValidCrashReport(parsed)) reports.push(parsed);
      } catch {
        // Isolate malformed reports; they never block startup or listing.
        void this.storage.delete(id).catch(() => undefined);
      }
    }
    reports.sort((a, b) => b.createdAt - a.createdAt);
    return reports;
  }

  async get(id: string): Promise<CrashReport | null> {
    const raw = await this.storage.load(id);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as CrashReport;
      return isValidCrashReport(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    await this.storage.delete(id);
  }

  async clear(): Promise<void> {
    for (const id of await this.storage.listIds()) {
      await this.storage.delete(id);
    }
  }

  /** Marks a report uploaded (idempotent) and drops it from the queue. */
  async markUploaded(id: string, uploadedAt: number): Promise<void> {
    const report = await this.get(id);
    if (!report) return;
    report.uploadedAt = uploadedAt;
    await this.storage.save(id, JSON.stringify(report));
    // Do not retain the full report after a successful upload.
    await this.storage.delete(id);
  }

  async recordAttempt(id: string): Promise<number> {
    const report = await this.get(id);
    if (!report) return 0;
    report.uploadAttempts = (report.uploadAttempts ?? 0) + 1;
    await this.storage.save(id, JSON.stringify(report));
    return report.uploadAttempts;
  }

  /** Removes expired reports; returns the number removed. */
  async sweepExpired(): Promise<number> {
    const reports = await this.listUnchecked();
    const now = this.now();
    let removed = 0;
    for (const report of reports) {
      if (now - report.createdAt > LIMITS.reportExpiryMs) {
        await this.storage.delete(report.reportId);
        removed++;
      }
    }
    return removed;
  }

  private async listUnchecked(): Promise<CrashReport[]> {
    const ids = await this.storage.listIds();
    const reports: CrashReport[] = [];
    for (const id of ids) {
      const raw = await this.storage.load(id);
      if (!raw) continue;
      try {
        reports.push(JSON.parse(raw) as CrashReport);
      } catch {
        // isolated
      }
    }
    return reports;
  }
}
