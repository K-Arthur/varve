export type { ArchiveError, ArchiveExtractor, ArchiveImportResult } from './archive';
export { detectArchiveType, validateArchiveImport } from './archive';
export { BackupEngine } from './engine';
export type { JournalStorage } from './journal';
export { CrashJournal } from './journal';
export type { RetentionResult } from './retention';
export { evaluateRetention } from './retention';
export type {
  BackupEvent,
  BackupEventHandler,
  BackupJob,
  BackupProgress,
  BackupResult,
  SchedulerConfig,
  SchedulerStatus,
} from './scheduler';
export type { BackupStore, BackupStoreFactory } from './storage';
export type { BackupEnvironment } from './stores/factory';
export { createBackupStore } from './stores/factory';
export { createIndexedDbBackupStore } from './stores/indexeddb';
export { createMemoryBackupStore } from './stores/memory';
export type {
  ArchiveEntry,
  ArchivePackage,
  BackupFilter,
  BackupIndexEntry,
  BackupManifest,
  BackupStorageInfo,
  BackupType,
  BackupVerificationStatus,
  BulkBackupOptions,
  JournalEntry,
  JournalHeader,
  ProjectBackupIndex,
  RestorePreview,
  RetentionConfig,
} from './types';
export { DEFAULT_RETENTION, MAXIMUM_RETENTION, MINIMAL_RETENTION } from './types';
export type { VerificationResult } from './verify';
export { computeChecksum, verifyBackup, verifyBackupsBatch } from './verify';

export const BACKUP_DIR_NAME = '.strata-backups';
export const JOURNAL_DIR_NAME = '.strata-journals';
export const BACKUP_MANIFEST_FILE = 'manifest.json';
export const BACKUP_DOCUMENT_FILE = 'document.strata';
export const BACKUP_INDEX_FILE = 'index.json';
