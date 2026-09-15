/**
 * Archive system — portable backup/restore for Strata documents and settings.
 *
 * @module archive
 */

export {
  buildArchive,
  buildFullArchive,
  buildSettingsArchive,
  collectArchiveAssets,
  createArchiveManifest,
  packageArchive,
} from './archiveBuilder';
export {
  applyRestore,
  decryptArchive,
  detectConflicts,
  extractArchiveDocument,
  extractArchiveSettings,
  restoreArchive,
  validateArchive,
} from './archiveRestorer';
export type {
  ArchiveBuildOptions,
  ArchiveBuildResult,
  ArchiveConflict,
  ArchiveKind,
  ArchiveManifest,
  ArchiveRestoreOptions,
  ArchiveRestoreResult,
  BackupSnapshot,
  EncryptionConfig,
  SafeWriteOptions,
  SettingsBackupEntry,
  SettingsCategory,
  SettingsRollbackSnapshot,
} from './archiveTypes';
export { ARCHIVE_FORMAT_VERSION } from './archiveTypes';
export {
  coalesceEditsDuringBackup,
  createBackupSnapshot,
  detectStaleInput,
  verifySnapshot,
} from './concurrentSafety';
export {
  bytesToHex,
  computeChecksum,
  decryptBytes,
  deriveKey,
  encryptBytes,
  getKdfParams,
  hexToBytes,
  verifyChecksum,
} from './encryption';

export {
  inMemoryClear,
  inMemoryFileExists,
  inMemoryReadFile,
  registerSafeWriteIo,
  resetSafeWriteIo,
  safeWriteFile,
  safeWriteWithRetry,
} from './safeWrite';
export {
  applySettingsBackup,
  collectSettingsBackup,
  createRollbackSnapshot,
  migrateSettingsEntry,
  restoreRollbackSnapshot,
  validateSettingsEntry,
} from './settingsBackup';
