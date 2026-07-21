import { evaluateRetention } from './retention';
import type { BackupResult } from './scheduler';
import type { BackupStore } from './storage';
import type {
  BackupFilter,
  BackupIndexEntry,
  BackupManifest,
  BackupStorageInfo,
  BackupType,
  ProjectBackupIndex,
  RetentionConfig,
} from './types';
import { computeChecksum, verifyBackup } from './verify';

const CURRENT_DOCUMENT_VERSION = '2.6';

import { CrashJournal, type JournalStorage } from './journal';

export type { BackupStore, BackupStoreFactory } from './storage';

export class BackupEngine {
  private revisionCounter = 0;

  constructor(
    private readonly store: BackupStore,
    private readonly journalStorage?: JournalStorage,
    private readonly journalDir?: string,
    private readonly appVersion: string = CURRENT_DOCUMENT_VERSION,
  ) {}

  get storeKind(): string {
    return this.store.kind;
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
    assetsMap?: Map<string, string>,
  ): Promise<BackupResult> {
    const startTime = performance.now();
    try {
      const backupId = this.generateBackupId(type);

      const checksum = computeChecksum(documentJson);
      const documentSize = new TextEncoder().encode(documentJson).length;
      if (revision === undefined) {
        this.revisionCounter++;
        revision = this.revisionCounter;
      }

      let schemaVersion: string;
      try {
        const parsed = JSON.parse(documentJson);
        schemaVersion = parsed.formatVersion || CURRENT_DOCUMENT_VERSION;
      } catch {
        schemaVersion = CURRENT_DOCUMENT_VERSION;
      }

      const assetCount = assetsMap?.size ?? 0;
      let assetTotalSize = 0;
      if (assetsMap) {
        for (const [, data] of assetsMap) {
          assetTotalSize += new TextEncoder().encode(data).length;
        }
      }

      const manifest: BackupManifest = {
        formatVersion: 1,
        id: backupId,
        projectId,
        type,
        createdAt: Date.now(),
        appVersion: this.appVersion,
        schemaVersion,
        documentRevision: revision,
        documentSize,
        documentChecksum: checksum,
        assetsIncluded: assetCount > 0,
        assetCount,
        assetTotalSize,
        notes,
        verificationStatus: 'unverified',
        sourceFileId: fileId,
        sourceFilePath: filePath,
        sourceName: fileName,
      };

      await this.store.saveBackup(projectId, backupId, manifest, documentJson, assetsMap);

      const index =
        (await this.store.getProjectIndex(projectId)) ?? this.createEmptyIndex(projectId);
      index.backups.push({
        id: backupId,
        type,
        createdAt: manifest.createdAt,
        size: manifest.documentSize + assetTotalSize + 4096,
        documentSize: manifest.documentSize,
        verificationStatus: 'unverified',
      });
      index.totalSize += manifest.documentSize + assetTotalSize;
      index.entryCount = index.backups.length;
      index.lastBackupAt = manifest.createdAt;
      await this.store.saveProjectIndex(projectId, index);

      if (this.journalStorage && this.journalDir) {
        const journal = new CrashJournal(this.journalStorage, projectId, this.journalDir);
        try {
          await journal.open();
          await journal.append(
            type === 'pre-close'
              ? 'pre-close'
              : type === 'snapshot'
                ? 'snapshot'
                : type === 'pre-migration'
                  ? 'migration'
                  : type === 'automatic'
                    ? 'auto-save'
                    : 'save',
            checksum,
            revision,
            documentSize,
          );
        } finally {
          await journal.close();
        }
      }

      const verificationResult = await verifyBackup(this.store, backupId, manifest);
      if (verificationResult.valid) {
        manifest.verificationStatus = 'verified';
        manifest.verifiedAt = Date.now();
        manifest.verifiedChecksum = verificationResult.computedChecksum;
      } else {
        manifest.verificationStatus = 'corrupted';
      }
      // Persist the updated manifest (verification status + timestamps).
      await this.store.saveBackup(projectId, backupId, manifest, documentJson, assetsMap);

      return {
        success: true,
        backupId,
        size: manifest.documentSize + assetTotalSize,
        duration: Math.round(performance.now() - startTime),
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        duration: Math.round(performance.now() - startTime),
      };
    }
  }

  async listBackups(projectId: string, filter?: BackupFilter): Promise<BackupIndexEntry[]> {
    const index = await this.store.getProjectIndex(projectId);
    if (!index) return [];
    let entries = index.backups;
    if (filter?.types) {
      entries = entries.filter((e) => filter.types!.includes(e.type));
    }
    if (filter?.since) {
      entries = entries.filter((e) => e.createdAt >= filter.since!);
    }
    if (filter?.until) {
      entries = entries.filter((e) => e.createdAt <= filter.until!);
    }
    if (filter?.verified !== undefined) {
      entries = entries.filter((e) =>
        filter.verified ? e.verificationStatus === 'verified' : true,
      );
    }
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  }

  async getBackupManifest(backupId: string): Promise<BackupManifest | null> {
    return this.store.readBackupManifest(backupId);
  }

  async getBackupDocument(backupId: string): Promise<string | null> {
    return this.store.readBackupDocument(backupId);
  }

  async deleteBackup(projectId: string, backupId: string): Promise<void> {
    const index = await this.store.getProjectIndex(projectId);
    if (index) {
      const entry = index.backups.find((e) => e.id === backupId);
      if (entry) {
        index.totalSize -= entry.size;
        index.backups = index.backups.filter((e) => e.id !== backupId);
        index.entryCount = index.backups.length;
        await this.store.saveProjectIndex(projectId, index);
      }
    }
    await this.store.deleteBackup(projectId, backupId);
  }

  async applyRetention(projectId: string, config: RetentionConfig): Promise<number> {
    const index = await this.store.getProjectIndex(projectId);
    if (!index || index.backups.length === 0) return 0;

    const result = evaluateRetention(index.backups, config, index.totalSize);
    let removed = 0;
    for (const id of result.toRemove) {
      await this.store.deleteBackup(projectId, id);
      const entry = index.backups.find((e) => e.id === id);
      if (entry) {
        index.totalSize -= entry.size;
      }
      removed++;
    }
    index.backups = index.backups.filter((e) => !result.toRemove.includes(e.id));
    index.entryCount = index.backups.length;
    await this.store.saveProjectIndex(projectId, index);
    return removed;
  }

  async getStorageInfo(): Promise<BackupStorageInfo> {
    return this.store.getStorageInfo();
  }

  async verifyBackupById(
    backupId: string,
  ): Promise<{ valid: boolean; computedChecksum: string; status: string }> {
    const manifest = await this.store.readBackupManifest(backupId);
    if (!manifest) {
      return { valid: false, computedChecksum: '', status: 'missing' };
    }
    const result = await verifyBackup(this.store, backupId, manifest);
    if (result.valid) {
      manifest.verificationStatus = 'verified';
      manifest.verifiedAt = Date.now();
      manifest.verifiedChecksum = result.computedChecksum;
    } else {
      manifest.verificationStatus = 'corrupted';
    }
    return {
      valid: result.valid,
      computedChecksum: result.computedChecksum,
      status: result.status,
    };
  }

  async verifyAllBackups(
    projectId: string,
  ): Promise<{ total: number; valid: number; corrupted: number }> {
    const index = await this.store.getProjectIndex(projectId);
    if (!index) return { total: 0, valid: 0, corrupted: 0 };
    let valid = 0;
    let corrupted = 0;
    for (const entry of index.backups) {
      const result = await this.verifyBackupById(entry.id);
      if (result.valid) valid++;
      else corrupted++;
    }
    return { total: valid + corrupted, valid, corrupted };
  }

  async exportBackups(backupIds: string[]): Promise<Uint8Array> {
    return this.store.exportArchive(backupIds);
  }

  async importArchive(data: Uint8Array): Promise<{
    success: boolean;
    errors: Array<{ entry: string; message: string }>;
    importedCount: number;
  }> {
    try {
      await this.store.importArchive(data);
      const projects = await this.store.listProjects();
      for (const projectId of projects) {
        const existingIndex = await this.store.getProjectIndex(projectId);
        if (!existingIndex) {
          const newIndex = this.createEmptyIndex(projectId);
          await this.store.saveProjectIndex(projectId, newIndex);
        }
      }
      return { success: true, errors: [], importedCount: projects.length };
    } catch (error) {
      return {
        success: false,
        errors: [{ entry: '<root>', message: (error as Error).message }],
        importedCount: 0,
      };
    }
  }

  async close(): Promise<void> {
    await this.store.close();
  }

  private generateBackupId(type: BackupType): string {
    const prefix =
      type === 'automatic'
        ? 'auto'
        : type === 'snapshot'
          ? 'snap'
          : type === 'pre-migration'
            ? 'mig'
            : type === 'pre-close'
              ? 'cls'
              : type === 'bulk'
                ? 'bulk'
                : 'save';
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 6);
    return `${prefix}_${ts}_${rand}`;
  }

  private createEmptyIndex(projectId: string): ProjectBackupIndex {
    return {
      formatVersion: 1,
      projectId,
      backups: [],
      totalSize: 0,
      entryCount: 0,
      lastBackupAt: 0,
      lastVerificationAt: 0,
    };
  }
}
