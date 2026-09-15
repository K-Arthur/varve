/**
 * Archive format types — portable backup/restore for Strata documents and
 * settings. The archive is a versioned ZIP with optional AES-GCM encryption,
 * structured to preserve document state, user preferences, and embedded
 * assets in a single portable file.
 *
 * Research basis: Figma .fig export bundles, Illustrator .ai packaging,
 * Sketch .sketch archives. All use ZIP or equivalent container with a
 * JSON manifest for version negotiation.
 */

import type { Document } from '@varve/scene';

/** Archive format version */
export const ARCHIVE_FORMAT_VERSION = '1.0';

/** Archive kind */
export type ArchiveKind = 'full' | 'settings-only';

/** Encryption configuration */
export interface EncryptionConfig {
  enabled: boolean;
  password: string;
}

/** Archive manifest (stored as JSON inside the ZIP) */
export interface ArchiveManifest {
  formatVersion: string;
  kind: ArchiveKind;
  appVersion: string;
  createdAt: string;
  document?: {
    id: string;
    name: string;
    formatVersion: string;
    nodeCount: number;
    revisionId?: string;
  };
  settings?: {
    categories: SettingsCategory[];
    itemCount: number;
  };
  assets?: {
    totalBytes: number;
    count: number;
  };
  encryption?: {
    algorithm: 'AES-GCM';
    kdf: 'PBKDF2';
    kdfParams: { iterations: number; saltLength: number; hash: string };
    nonceLength: number;
    contentHash: string;
  };
  checksums: Record<string, string>;
  compatibility: {
    minAppVersion: string;
    flags: string[];
  };
}

/** Settings categories for backup */
export type SettingsCategory =
  | 'appearance'
  | 'shortcuts'
  | 'workspace'
  | 'export'
  | 'performance'
  | 'presets'
  | 'swatches'
  | 'plugins';

/** Settings backup entry */
export interface SettingsBackupEntry {
  category: SettingsCategory;
  key: string;
  value: unknown;
}

/** Archive build options */
export interface ArchiveBuildOptions {
  kind: ArchiveKind;
  document?: Document;
  settings?: SettingsBackupEntry[];
  settingsCategories?: SettingsCategory[];
  encryption?: EncryptionConfig;
  signal?: AbortSignal;
  onProgress?: (phase: string, progress: number) => void;
}

/** Archive build result */
export interface ArchiveBuildResult {
  fileName: string;
  bytes: Uint8Array;
  manifest: ArchiveManifest;
}

/** Archive restore options */
export interface ArchiveRestoreOptions {
  bytes: Uint8Array;
  password?: string;
  onConflict?: 'overwrite' | 'skip' | 'merge';
  onProgress?: (phase: string, progress: number) => void;
  signal?: AbortSignal;
}

/** Archive restore result */
export interface ArchiveRestoreResult {
  document?: Document;
  settings?: SettingsBackupEntry[];
  warnings: string[];
  conflicts: ArchiveConflict[];
  restoredCategories: SettingsCategory[];
}

/** Conflict during restore */
export interface ArchiveConflict {
  category: SettingsCategory;
  key: string;
  existingValue: unknown;
  archiveValue: unknown;
}

/** Safe-write options */
export interface SafeWriteOptions {
  destination: string;
  bytes: Uint8Array;
  validate?: (bytes: Uint8Array) => boolean;
  signal?: AbortSignal;
}

/** Backup snapshot for concurrent safety */
export interface BackupSnapshot {
  id: string;
  documentRevisionId: string;
  documentHash: string;
  settingsHash: string;
  createdAt: string;
}

/**
 * A settings rollback point — unlike `BackupSnapshot` (which only carries
 * hashes for staleness comparison), this captures the actual raw
 * localStorage values so a failed restore can be reverted for real.
 */
export interface SettingsRollbackSnapshot {
  id: string;
  createdAt: string;
  settingsHash: string;
  /** Raw localStorage value per settings key; `null` means the key was absent. */
  values: Record<string, string | null>;
}
