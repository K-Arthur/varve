export const BACKUP_FORMAT_VERSION = 1;

export type BackupType =
  | 'automatic'
  | 'snapshot'
  | 'pre-migration'
  | 'pre-close'
  | 'bulk'
  | 'pre-save';

export type BackupVerificationStatus = 'unverified' | 'verified' | 'corrupted' | 'partial';

export interface BackupManifest {
  formatVersion: number;
  id: string;
  projectId: string;
  type: BackupType;
  createdAt: number;
  appVersion: string;
  schemaVersion: string;
  documentRevision: number;
  documentSize: number;
  documentChecksum: string;
  assetsIncluded: boolean;
  assetCount: number;
  assetTotalSize: number;
  notes?: string;
  verificationStatus: BackupVerificationStatus;
  verifiedAt?: number;
  verifiedChecksum?: string;
  sourceFileId?: string;
  sourceFilePath?: string;
  sourceName: string;
  migrationVersion?: string;
}

export interface BackupIndexEntry {
  id: string;
  type: BackupType;
  createdAt: number;
  size: number;
  documentSize: number;
  verificationStatus: BackupVerificationStatus;
}

export interface ProjectBackupIndex {
  formatVersion: number;
  projectId: string;
  backups: BackupIndexEntry[];
  totalSize: number;
  entryCount: number;
  lastBackupAt: number;
  lastVerificationAt: number;
}

export interface RetentionConfig {
  hourlyCount: number;
  dailyCount: number;
  weeklyCount: number;
  monthlyCount: number;
  maxTotalBytes: number;
  maxEntryCount: number;
}

export const DEFAULT_RETENTION: RetentionConfig = {
  hourlyCount: 12,
  dailyCount: 7,
  weeklyCount: 4,
  monthlyCount: 3,
  maxTotalBytes: 1_073_741_824,
  maxEntryCount: 200,
};

export const MINIMAL_RETENTION: RetentionConfig = {
  hourlyCount: 2,
  dailyCount: 3,
  weeklyCount: 2,
  monthlyCount: 1,
  maxTotalBytes: 524_288_000,
  maxEntryCount: 50,
};

export const MAXIMUM_RETENTION: RetentionConfig = {
  hourlyCount: 48,
  dailyCount: 30,
  weeklyCount: 12,
  monthlyCount: 12,
  maxTotalBytes: 10_737_418_240,
  maxEntryCount: 1000,
};

export interface JournalEntry {
  timestamp: number;
  operation: 'save' | 'auto-save' | 'snapshot' | 'migration' | 'pre-close';
  documentChecksum: string;
  documentRevision: number;
  documentSize: number;
}

export interface JournalHeader {
  formatVersion: number;
  projectId: string;
  created: number;
  lastEntryTimestamp: number;
  entryCount: number;
  totalByteLength: number;
}

export interface BackupStorageInfo {
  totalBytes: number;
  entryCount: number;
  projectCount: number;
  lastBackupAt: number;
  lastVerificationAt: number;
}

export interface BackupFilter {
  types?: BackupType[];
  since?: number;
  until?: number;
  projectIds?: string[];
  verified?: boolean;
}

export interface BulkBackupOptions {
  projectIds?: string[];
  includeAllProjects?: boolean;
  includeSettings?: boolean;
  includeResources?: boolean;
  includeAssets: 'none' | 'used' | 'all';
  includeFonts?: boolean;
  includePlugins?: boolean;
  includeModelMetadata?: boolean;
  destination?: string;
  compressionLevel?: number;
}

export interface ArchivePackage {
  formatVersion: number;
  archiveType: 'project-backup' | 'full-library' | 'settings-only' | 'resources-only';
  createdAt: number;
  appVersion: string;
  schemaVersion: string;
  entries: ArchiveEntry[];
  totalUncompressedSize: number;
  totalCompressedSize?: number;
  checksum: string;
}

export interface ArchiveEntry {
  path: string;
  size: number;
  checksum: string;
  contentType: 'manifest' | 'document' | 'asset' | 'settings' | 'resource' | 'preview' | 'meta';
  /** Base64-encoded asset data for asset entries (embedded assets only). */
  data?: string;
  /** MIME type for asset entries. */
  mimeType?: string;
}

export interface BackupRestoreOptions {
  asCopy: boolean;
  replaceExisting: boolean;
  includeAssets: boolean;
  targetProjectId?: string;
  targetName?: string;
}

export interface RestorePreview {
  manifest: BackupManifest;
  documentPreview?: { nodeCount: number; pageCount: number; name: string };
  assetsPresent: boolean;
  assetsMissing: string[];
  schemaForwardCompatible: boolean;
  warnings: string[];
}
