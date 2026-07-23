/**
 * Archive system — portable backup/restore for Strata documents and settings.
 *
 * @module archive
 */

export { ARCHIVE_FORMAT_VERSION } from './archiveTypes';
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
} from './archiveTypes';

export {
  buildArchive,
  buildFullArchive,
  buildSettingsArchive,
  collectArchiveAssets,
  createArchiveManifest,
  packageArchive,
} from './archiveBuilder';

export {
  restoreArchive,
  validateArchive,
  decryptArchive,
  extractArchiveDocument,
  extractArchiveSettings,
  detectConflicts,
  applyRestore,
} from './archiveRestorer';

export {
  deriveKey,
  encryptBytes,
  decryptBytes,
  computeChecksum,
  verifyChecksum,
  getKdfParams,
  bytesToHex,
  hexToBytes,
} from './encryption';

export {
  collectSettingsBackup,
  applySettingsBackup,
  validateSettingsEntry,
  migrateSettingsEntry,
  createRollbackSnapshot,
  restoreRollbackSnapshot,
} from './settingsBackup';

export {
  safeWriteFile,
  safeWriteWithRetry,
  registerSafeWriteIo,
  inMemoryFileExists,
  inMemoryReadFile,
  inMemoryClear,
} from './safeWrite';

export {
  createBackupSnapshot,
  verifySnapshot,
  detectStaleInput,
  coalesceEditsDuringBackup,
} from './concurrentSafety';
