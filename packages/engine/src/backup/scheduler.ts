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
