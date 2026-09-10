import type { BackupManifest, BackupStorageInfo, ProjectBackupIndex } from './types';

export interface BackupStore {
  readonly kind: 'filesystem' | 'indexeddb' | 'memory';

  listProjects(): Promise<string[]>;
  getProjectIndex(projectId: string): Promise<ProjectBackupIndex | null>;
  saveProjectIndex(projectId: string, index: ProjectBackupIndex): Promise<void>;
  saveBackup(
    projectId: string,
    backupId: string,
    manifest: BackupManifest,
    documentJson: string,
    assets?: Map<string, string>,
  ): Promise<void>;
  readBackupManifest(backupId: string): Promise<BackupManifest | null>;
  readBackupDocument(backupId: string): Promise<string | null>;
  readBackupAsset(backupId: string, assetHash: string): Promise<string | null>;
  deleteBackup(projectId: string, backupId: string): Promise<void>;
  backupSize(backupId: string): Promise<number>;
  getStorageInfo(): Promise<BackupStorageInfo>;
  exportArchive(backupIds: string[]): Promise<Uint8Array>;
  importArchive(data: Uint8Array): Promise<string>;
  verifyBackup(backupId: string): Promise<{ valid: boolean; computedChecksum: string }>;
  close(): Promise<void>;
}

export type BackupStoreFactory = (basePath?: string) => BackupStore;
