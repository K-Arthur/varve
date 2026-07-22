import type { BackupType } from './types';

export interface BackupJob {
  projectId: string;
  type: BackupType;
  documentJson: string;
  fileId?: string;
  filePath?: string;
  fileName: string;
  revision: number;
  schemaVersion: string;
  notes?: string;
}

export interface BackupResult {
  success: boolean;
  backupId?: string;
  error?: string;
  size?: number;
  duration?: number;
}

export interface SchedulerConfig {
  intervalMs: number;
  idleThresholdMs: number;
  maxBackupRetries: number;
  batchWindowMs: number;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  intervalMs: 300_000,
  idleThresholdMs: 10_000,
  maxBackupRetries: 3,
  batchWindowMs: 60_000,
};

export type SchedulerState = 'idle' | 'running' | 'paused' | 'error';

export interface SchedulerStatus {
  state: SchedulerState;
  lastBackupAt: number | null;
  nextBackupAt: number | null;
  consecutiveFailures: number;
  totalBackupsCreated: number;
  totalBackupsFailed: number;
  lastError: string | null;
}

export interface BackupProgress {
  current: number;
  total: number;
  phase: 'preparing' | 'saving' | 'verifying' | 'pruning' | 'complete' | 'error';
  message: string;
}

export type BackupEventHandler = (event: BackupEvent) => void;

export interface BackupEvent {
  type: 'started' | 'completed' | 'failed' | 'pruned' | 'status';
  backupId?: string;
  projectId?: string;
  error?: string;
  timestamp: number;
}

export interface BackupDelegate {
  canBackup(): boolean;
  createBackup(): Promise<BackupResult>;
  getRetentionConfig(): import('./types').RetentionConfig;
  applyRetention(): Promise<number>;
  getPendingProjects(): Promise<string[]>;
}

export class BackupScheduler {
  private delegate: BackupDelegate;
  private config: SchedulerConfig & {
    intervalMs: number;
    idleThresholdMs: number;
    maxBackupRetries: number;
  };
  private _isEnabled = false;
  private _status: SchedulerStatus = {
    state: 'idle',
    lastBackupAt: null,
    nextBackupAt: null,
    consecutiveFailures: 0,
    totalBackupsCreated: 0,
    totalBackupsFailed: 0,
    lastError: null,
  };
  private eventHandlers: BackupEventHandler[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private dirty = false;

  constructor(
    delegate: BackupDelegate,
    config: Partial<SchedulerConfig> & { intervalMs: number; idleThresholdMs: number },
  ) {
    this.delegate = delegate;
    this.config = {
      intervalMs: config.intervalMs,
      idleThresholdMs: config.idleThresholdMs,
      maxBackupRetries: (config as SchedulerConfig).maxBackupRetries ?? 3,
      batchWindowMs: (config as SchedulerConfig).batchWindowMs ?? 60_000,
    };
  }

  get isEnabled(): boolean {
    return this._isEnabled;
  }

  get currentStatus(): SchedulerStatus {
    return this._status;
  }

  notifyEdit(): void {
    this.dirty = true;
  }

  start(): void {
    if (this._isEnabled) return;
    this._isEnabled = true;
    this._status.state = 'running';
    this.intervalId = setInterval(() => {
      if (this.dirty) {
        this.backupNow().catch(() => {});
      }
    }, this.config.intervalMs);
  }

  stop(): void {
    this._isEnabled = false;
    this._status.state = 'idle';
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  onEvent(handler: BackupEventHandler): void {
    this.eventHandlers.push(handler);
  }

  async backupNow(): Promise<BackupResult> {
    const event: BackupEvent = { type: 'started', timestamp: Date.now() };
    this.emit(event);
    this.dirty = false;
    this._status.lastBackupAt = Date.now();

    let lastResult: BackupResult | undefined;
    let anyAttemptSucceeded = false;
    const maxAttempts = this.config.maxBackupRetries + 1;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await this.delegate.createBackup();
      lastResult = result;

      if (result.success) {
        anyAttemptSucceeded = true;
        this._status.totalBackupsCreated++;
        this._status.consecutiveFailures = 0;
        this._status.state = 'running';
        this.emit({ type: 'completed', backupId: result.backupId, timestamp: Date.now() });
        return result;
      }

      this._status.totalBackupsFailed++;
      this._status.lastError = result.error ?? null;
      this.emit({ type: 'failed', error: result.error, timestamp: Date.now() });
    }

    if (!anyAttemptSucceeded) {
      this._status.consecutiveFailures++;
      this._status.state = 'error';
    }
    return lastResult!;
  }

  dispose(): void {
    this.stop();
    this.eventHandlers = [];
  }

  private emit(event: BackupEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Silently handle handler errors
      }
    }
  }
}
