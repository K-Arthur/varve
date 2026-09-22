import type {
  BackupEvent,
  BackupIndexEntry,
  BackupManifest,
  BackupResult,
  BackupStorageInfo,
  BackupType,
  RetentionConfig,
} from '@varve/engine';
import {
  BackupEngine,
  type BackupStore,
  createBackupStore,
  DEFAULT_RETENTION,
} from '@varve/engine';
import { isTauriRuntime, recordStorageWrite } from '@varve/platform';

export type IncludeAssetsPolicy = 'none' | 'used' | 'all';

export interface BackupServiceConfig {
  enabled: boolean;
  intervalMs: number;
  retention: RetentionConfig;
  includeAssets: IncludeAssetsPolicy;
  maxStorageBytes: number;
  snapshotOnClose: boolean;
  snapshotBeforeMigration: boolean;
}

export interface BackupServiceOptions {
  /** Schedule automatic work on the editor's background frame lane. */
  scheduleBackground?: (job: () => void) => void;
}

export const DEFAULT_BACKUP_CONFIG: BackupServiceConfig = {
  enabled: true,
  intervalMs: 5 * 60 * 1000,
  retention: DEFAULT_RETENTION,
  includeAssets: 'used',
  maxStorageBytes: DEFAULT_RETENTION.maxTotalBytes,
  snapshotOnClose: true,
  snapshotBeforeMigration: true,
};

export interface BackupServiceState {
  lastBackupAt: number | null;
  nextBackupAt: number | null;
  lastVerificationAt: number | null;
  totalBackups: number;
  storageUsed: number;
  consecutiveFailures: number;
  lastError: string | null;
  running: boolean;
}

const STORAGE_KEY = 'strata-backup-service';

interface DirtyProject {
  serializeDocument: () => string;
  /** Memoized only after the revision is actually due for persistence. */
  materializedJson?: string;
  fileName: string;
  revision: number;
  fileId?: string;
  filePath?: string;
  /** Revision of this dirty data — refreshed on each markDirty call. */
  dirtyAt: number;
}

export class BackupService {
  private engine: BackupEngine | null = null;
  private store: BackupStore | null = null;
  private config: BackupServiceConfig;
  private state: BackupServiceState;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private dirtyProjects = new Map<string, DirtyProject>();
  private lastBackupTimes = new Map<string, number>();
  /** Last successfully auto-backed-up JSON per project (content dedup). */
  private lastAutomaticJson = new Map<string, string>();
  private onEvent: ((event: BackupEvent) => void) | null = null;
  private onProgress: ((event: BackupEvent) => void) | null = null;
  private running = false;
  private scheduleBackground: ((job: () => void) => void) | null;
  private automaticWorkQueued = false;

  constructor(config?: Partial<BackupServiceConfig>, options?: BackupServiceOptions) {
    this.config = { ...DEFAULT_BACKUP_CONFIG, ...config };
    this.scheduleBackground = options?.scheduleBackground ?? null;
    this.state = this.loadState();
  }

  setEventHandler(handler: (event: BackupEvent) => void): void {
    this.onEvent = handler;
  }

  setProgressHandler(handler: (event: BackupEvent) => void): void {
    this.onProgress = handler;
  }

  isRunning(): boolean {
    return this.running;
  }

  updateConfig(patch: Partial<BackupServiceConfig>): void {
    this.config = { ...this.config, ...patch };
    this.saveConfig();
    if (this.intervalId) {
      this.restartScheduler();
    }
  }

  getConfig(): BackupServiceConfig {
    return { ...this.config };
  }

  getState(): BackupServiceState {
    return { ...this.state };
  }

  getEngine(): BackupEngine | null {
    return this.engine;
  }

  async initialize(): Promise<void> {
    this.store = createBackupStore({
      hasIndexedDb: typeof indexedDB !== 'undefined',
      platform: isTauriRuntime() ? 'tauri' : 'web',
    });
    this.engine = new BackupEngine(this.store);
    this.restoreState();
    if (this.config.enabled) {
      this.startScheduler();
    }
    const info = await this.store.getStorageInfo();
    this.state.storageUsed = info.totalBytes;
    this.state.totalBackups = info.entryCount;
    this.state.nextBackupAt = this.config.enabled ? Date.now() + this.config.intervalMs : null;
  }

  async shutdown(): Promise<void> {
    this.stopScheduler();
    await this.store?.close();
    this.engine = null;
    this.store = null;
  }

  markDirty(
    projectId: string,
    serializeDocument: () => string,
    fileName: string,
    revision: number,
    fileId?: string,
    filePath?: string,
  ): void {
    this.dirtyProjects.set(projectId, {
      serializeDocument,
      fileName,
      revision,
      fileId,
      filePath,
      dirtyAt: Date.now(),
    });
  }

  async markSaved(
    projectId: string,
    documentJson: string,
    _fileName: string,
    _revision: number,
    _fileId?: string,
    _filePath?: string,
  ): Promise<void> {
    this.lastBackupTimes.set(projectId, Date.now());
    // Remember the saved content so a later dirty tick does not rewrite an
    // identical full-document backup.
    this.lastAutomaticJson.set(projectId, documentJson);
    this.dirtyProjects.delete(projectId);
  }

  async createBackup(
    projectId: string,
    type: BackupType,
    documentJson: string,
    fileName: string,
    revision?: number,
    notes?: string,
    fileId?: string,
    filePath?: string,
    expectedDirty?: object,
  ): Promise<BackupResult> {
    if (!this.engine) {
      return { success: false, error: 'Backup engine not initialized' };
    }
    const result = await this.engine.createBackup(
      projectId,
      type,
      documentJson,
      fileName,
      revision,
      notes,
      fileId,
      filePath,
    );
    this.emitEvent({
      type: result.success ? 'completed' : 'failed',
      backupId: result.backupId,
      projectId,
      error: result.error,
      timestamp: Date.now(),
    });
    if (result.success) {
      this.state.lastBackupAt = Date.now();
      this.state.consecutiveFailures = 0;
      this.state.totalBackups++;
      if (!expectedDirty || this.dirtyProjects.get(projectId) === expectedDirty) {
        this.dirtyProjects.delete(projectId);
      }
      if (type === 'automatic') {
        this.lastAutomaticJson.set(projectId, documentJson);
      }
      recordStorageWrite('backup', documentJson.length);
      await this.applyRetention(projectId);
    } else {
      this.state.consecutiveFailures++;
      this.state.lastError = result.error ?? null;
    }
    this.saveState();
    return result;
  }

  async applyRetention(projectId: string): Promise<number> {
    if (!this.engine) return 0;
    const removed = await this.engine.applyRetention(projectId, this.config.retention);
    if (removed > 0) {
      this.emitEvent({ type: 'pruned', projectId, timestamp: Date.now() });
    }
    return removed;
  }

  async getBackups(projectId: string): Promise<BackupIndexEntry[]> {
    if (!this.engine) return [];
    return this.engine.listBackups(projectId);
  }

  async getStorageInfo(): Promise<BackupStorageInfo> {
    if (!this.engine) {
      return {
        totalBytes: 0,
        entryCount: 0,
        projectCount: 0,
        lastBackupAt: 0,
        lastVerificationAt: 0,
      };
    }
    const info = await this.engine.getStorageInfo();
    this.state.storageUsed = info.totalBytes;
    this.state.totalBackups = info.entryCount;
    return info;
  }

  async verifyBackup(backupId: string): Promise<{ valid: boolean }> {
    if (!this.engine) return { valid: false };
    const result = await this.engine.verifyBackupById(backupId);
    return { valid: result.valid };
  }

  async verifyAllBackups(
    projectId: string,
  ): Promise<{ total: number; valid: number; corrupted: number }> {
    if (!this.engine) return { total: 0, valid: 0, corrupted: 0 };
    const result = await this.engine.verifyAllBackups(projectId);
    this.state.lastVerificationAt = Date.now();
    return result;
  }

  /** Public entry point for manual "Backup Now" — creates an immediate backup
   *  for every dirty project, bypassing the interval gate. */
  async backupAllDirty(): Promise<{ backedUp: number; failed: number }> {
    if (!this.config.enabled || !this.engine) return { backedUp: 0, failed: 0 };
    let backedUp = 0;
    let failed = 0;
    for (const [projectId, data] of this.dirtyProjects) {
      this.emitProgress({
        type: 'started',
        projectId,
        timestamp: Date.now(),
      });
      let documentJson: string;
      try {
        documentJson = this.materialize(data);
      } catch (error) {
        this.recordMaterializationFailure(error);
        failed++;
        continue;
      }
      const result = await this.createAutomaticBackup(projectId, data, documentJson);
      if (result.success) {
        backedUp++;
      } else {
        failed++;
      }
    }
    return { backedUp, failed };
  }

  async checkAndBackup(
    projectId: string,
    documentJson: string,
    fileName: string,
    revision: number,
    fileId?: string,
    filePath?: string,
  ): Promise<void> {
    if (!this.config.enabled) return;
    const now = Date.now();
    const lastBackup = this.lastBackupTimes.get(projectId) ?? 0;
    if (now - lastBackup < this.config.intervalMs) return;
    if (!this.dirtyProjects.has(projectId)) return;
    if (this.lastAutomaticJson.get(projectId) === documentJson) {
      // Unchanged content: count the interval as satisfied without writing a
      // duplicate full-document backup (the dirty map can outlive a manual
      // save when no caller invokes markSaved).
      this.lastBackupTimes.set(projectId, now);
      return;
    }
    await this.createBackup(
      projectId,
      'automatic',
      documentJson,
      fileName,
      revision,
      undefined,
      fileId,
      filePath,
      this.dirtyProjects.get(projectId),
    );
    this.lastBackupTimes.set(projectId, now);
  }

  async createSnapshot(
    projectId: string,
    documentJson: string,
    fileName: string,
    notes: string,
    revision: number,
    fileId?: string,
    filePath?: string,
  ): Promise<BackupResult> {
    return this.createBackup(
      projectId,
      'snapshot',
      documentJson,
      fileName,
      revision,
      notes,
      fileId,
      filePath,
    );
  }

  /** Retrieve a backup's document JSON and manifest for restore.
   *  Returns null if the backup is missing or corrupt. */
  async getBackupDocument(
    backupId: string,
  ): Promise<{ documentJson: string; manifest: BackupManifest } | null> {
    if (!this.engine) return null;
    const [documentJson, manifest] = await Promise.all([
      this.engine.getBackupDocument(backupId),
      this.engine.getBackupManifest(backupId),
    ]);
    if (!documentJson || !manifest) return null;
    return { documentJson, manifest };
  }

  private startScheduler(): void {
    if (this.intervalId) return;
    this.running = true;
    this.state.running = true;
    this.intervalId = setInterval(() => void this.tick(), 60_000);
  }

  private stopScheduler(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    this.state.running = false;
  }

  private restartScheduler(): void {
    this.stopScheduler();
    if (this.config.enabled) {
      this.startScheduler();
    }
  }

  /** Called every 60s by the scheduler. Creates automatic backups for any
   *  project whose data has been dirty longer than the configured interval. */
  private async tick(): Promise<void> {
    if (!this.running || this.dirtyProjects.size === 0 || this.automaticWorkQueued) return;
    const now = Date.now();
    const due: Array<[string, DirtyProject]> = [];
    for (const [projectId, data] of this.dirtyProjects) {
      if (!this.config.enabled) break;
      const lastBackup = this.lastBackupTimes.get(projectId) ?? 0;
      const sinceLast = lastBackup === 0 ? now - data.dirtyAt : now - lastBackup;
      if (sinceLast < this.config.intervalMs) continue;
      due.push([projectId, data]);
    }
    if (due.length === 0) return;
    this.automaticWorkQueued = true;
    const run = () => {
      this.automaticWorkQueued = false;
      void this.runAutomaticBackups(due);
    };
    if (this.scheduleBackground) this.scheduleBackground(run);
    else run();
  }

  private async runAutomaticBackups(due: Array<[string, DirtyProject]>): Promise<void> {
    for (const [projectId, data] of due) {
      if (!this.config.enabled) break;
      if (this.dirtyProjects.get(projectId) !== data) continue;
      let documentJson: string;
      try {
        documentJson = this.materialize(data);
      } catch (error) {
        this.recordMaterializationFailure(error);
        continue;
      }
      if (this.lastAutomaticJson.get(projectId) === documentJson) {
        this.lastBackupTimes.set(projectId, Date.now());
        continue;
      }
      await this.createAutomaticBackup(projectId, data, documentJson);
    }
  }

  private async createAutomaticBackup(
    projectId: string,
    data: DirtyProject,
    documentJson: string,
  ): Promise<BackupResult> {
    return this.createBackup(
      projectId,
      'automatic',
      documentJson,
      data.fileName,
      data.revision,
      undefined,
      data.fileId,
      data.filePath,
      data,
    );
  }

  private materialize(data: DirtyProject): string {
    if (data.materializedJson === undefined) {
      data.materializedJson = data.serializeDocument();
    }
    return data.materializedJson;
  }

  private recordMaterializationFailure(error: unknown): void {
    this.state.consecutiveFailures++;
    this.state.lastError = error instanceof Error ? error.message : String(error);
    this.saveState();
  }

  private emitEvent(event: BackupEvent): void {
    this.onEvent?.(event);
  }

  private emitProgress(event: BackupEvent): void {
    this.onProgress?.(event);
  }

  private loadState(): BackupServiceState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {
      lastBackupAt: null,
      nextBackupAt: null,
      lastVerificationAt: null,
      totalBackups: 0,
      storageUsed: 0,
      consecutiveFailures: 0,
      lastError: null,
      running: false,
    };
  }

  private saveState(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {}
  }

  private saveConfig(): void {
    try {
      localStorage.setItem('varve-backup-config', JSON.stringify(this.config));
    } catch {}
  }

  private restoreState(): void {
    try {
      const raw =
        localStorage.getItem('varve-backup-config') ?? localStorage.getItem('strata-backup-config');
      if (raw) {
        const saved = JSON.parse(raw);
        this.config = { ...DEFAULT_BACKUP_CONFIG, ...saved };
      }
    } catch {}
  }
}
