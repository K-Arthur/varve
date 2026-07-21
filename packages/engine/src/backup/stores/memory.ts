import type { BackupStore } from '../storage';
import type { BackupManifest, BackupStorageInfo, ProjectBackupIndex } from '../types';
import { computeChecksum } from '../verify';

interface BackupEntry {
  manifest: BackupManifest;
  documentJson: string;
  assets: Map<string, string>;
}

export function createMemoryBackupStore(): BackupStore {
  const projects = new Map<string, Map<string, BackupEntry>>();
  const projectIndices = new Map<string, ProjectBackupIndex>();

  const store: BackupStore = {
    kind: 'memory',

    async listProjects(): Promise<string[]> {
      return Array.from(projects.keys());
    },

    async getProjectIndex(projectId: string): Promise<ProjectBackupIndex | null> {
      return projectIndices.get(projectId) ?? null;
    },

    async saveProjectIndex(projectId: string, index: ProjectBackupIndex): Promise<void> {
      projectIndices.set(projectId, { ...index, backups: [...index.backups] });
    },

    async saveBackup(
      projectId: string,
      backupId: string,
      manifest: BackupManifest,
      documentJson: string,
      assets?: Map<string, string>,
    ): Promise<void> {
      if (!projects.has(projectId)) {
        projects.set(projectId, new Map());
      }
      const project = projects.get(projectId)!;
      project.set(backupId, {
        manifest: { ...manifest },
        documentJson,
        assets: assets ? new Map(assets) : new Map(),
      });
    },

    async readBackupManifest(backupId: string): Promise<BackupManifest | null> {
      for (const [, project] of projects) {
        const entry = project.get(backupId);
        if (entry) return { ...entry.manifest };
      }
      return null;
    },

    async readBackupDocument(backupId: string): Promise<string | null> {
      for (const [, project] of projects) {
        const entry = project.get(backupId);
        if (entry) return entry.documentJson;
      }
      return null;
    },

    async readBackupAsset(backupId: string, assetHash: string): Promise<string | null> {
      for (const [, project] of projects) {
        const entry = project.get(backupId);
        if (entry?.assets.has(assetHash)) {
          return entry.assets.get(assetHash)!;
        }
      }
      return null;
    },

    async deleteBackup(projectId: string, backupId: string): Promise<void> {
      const project = projects.get(projectId);
      project?.delete(backupId);
    },

    async backupSize(backupId: string): Promise<number> {
      for (const [, project] of projects) {
        const entry = project.get(backupId);
        if (entry) {
          return new TextEncoder().encode(entry.documentJson).length + entry.assets.size * 64;
        }
      }
      return 0;
    },

    async getStorageInfo(): Promise<BackupStorageInfo> {
      let totalBytes = 0;
      let entryCount = 0;
      let lastBackupAt = 0;
      for (const [, project] of projects) {
        for (const [, entry] of project) {
          totalBytes += new TextEncoder().encode(entry.documentJson).length;
          entryCount++;
          if (entry.manifest.createdAt > lastBackupAt) {
            lastBackupAt = entry.manifest.createdAt;
          }
        }
      }
      return {
        totalBytes,
        entryCount,
        projectCount: projects.size,
        lastBackupAt,
        lastVerificationAt: 0,
      };
    },

    async exportArchive(backupIds: string[]): Promise<Uint8Array> {
      const entries: Array<{ manifest: BackupManifest; document: string }> = [];
      for (const [, project] of projects) {
        for (const id of backupIds) {
          const entry = project.get(id);
          if (entry) {
            entries.push({ manifest: entry.manifest, document: entry.documentJson });
          }
        }
      }
      const archive = {
        formatVersion: 1,
        archiveType: 'project-backup',
        createdAt: Date.now(),
        entries,
      };
      return new TextEncoder().encode(JSON.stringify(archive));
    },

    async importArchive(data: Uint8Array): Promise<string> {
      const text = new TextDecoder().decode(data);
      const archive = JSON.parse(text);
      if (!archive.entries) return 'no-entries';
      let count = 0;
      const projectData = new Map<string, Array<{ id: string; manifest: BackupManifest }>>();
      for (const entry of archive.entries) {
        const pId = entry.manifest?.projectId ?? 'imported';
        const bId = entry.manifest?.id ?? `import-${count}`;
        await store.saveBackup(pId, bId, entry.manifest, entry.document);
        if (!projectData.has(pId)) {
          projectData.set(pId, []);
        }
        projectData.get(pId)!.push({ id: bId, manifest: entry.manifest });
        count++;
      }
      for (const [pId, entries] of projectData) {
        let index = projectIndices.get(pId);
        if (!index) {
          index = {
            formatVersion: 1,
            projectId: pId,
            backups: [],
            totalSize: 0,
            entryCount: 0,
            lastBackupAt: 0,
            lastVerificationAt: 0,
          };
        }
        for (const { id, manifest } of entries) {
          index.backups.push({
            id,
            type: manifest.type,
            createdAt: manifest.createdAt,
            size: manifest.documentSize + (manifest.assetsIncluded ? manifest.assetTotalSize : 0),
            documentSize: manifest.documentSize,
            verificationStatus: manifest.verificationStatus,
          });
          index.totalSize += manifest.documentSize;
          index.entryCount = index.backups.length;
          if (manifest.createdAt > index.lastBackupAt) index.lastBackupAt = manifest.createdAt;
        }
        projectIndices.set(pId, index);
      }
      return `imported-${count}`;
    },

    async verifyBackup(backupId: string): Promise<{ valid: boolean; computedChecksum: string }> {
      for (const [, project] of projects) {
        const entry = project.get(backupId);
        if (entry) {
          const checksum = computeChecksum(entry.documentJson);
          return {
            valid: checksum === entry.manifest.documentChecksum,
            computedChecksum: checksum,
          };
        }
      }
      return { valid: false, computedChecksum: '' };
    },

    async close(): Promise<void> {
      projects.clear();
      projectIndices.clear();
    },
  };

  return store;
}
