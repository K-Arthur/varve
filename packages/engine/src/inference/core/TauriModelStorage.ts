import type {
  ModelArtifactHandle,
  ModelArtifactMetadata,
  ModelInstallOptions,
  ModelStorage,
  PartialArtifactHandle,
  PartialDownloadMetadata,
  PartialDownloadRecord,
  StagedModelWrite,
  StorageQuota,
} from './ModelStorage';

export class TauriModelStorage implements ModelStorage {
  readonly name = 'tauri';
  private fallback: ModelStorage | null = null;

  constructor(fallback?: ModelStorage) {
    this.fallback = fallback ?? null;
  }

  isAvailable(): boolean {
    if (typeof window === 'undefined') return false;
    return '__TAURI__' in window;
  }

  async saveInstalled(modelId: string, bytes: ArrayBuffer): Promise<void> {
    if (!this.fallback) {
      throw new Error(
        'Native model writes must use the verified streaming model downloader; JSON byte-array IPC is disabled.',
      );
    }
    return this.fallback.saveInstalled(modelId, bytes);
  }

  async loadInstalled(modelId: string): Promise<ArrayBuffer | null> {
    return this.fallback?.loadInstalled(modelId) ?? Promise.resolve(null);
  }

  async statInstalled(modelId: string): Promise<ModelArtifactMetadata | null> {
    return this.fallback?.statInstalled(modelId) ?? Promise.resolve(null);
  }

  async openInstalledArtifact(modelId: string): Promise<ModelArtifactHandle | null> {
    return this.fallback?.openInstalledArtifact(modelId) ?? Promise.resolve(null);
  }

  async beginInstalledWrite(
    modelId: string,
    options?: ModelInstallOptions,
  ): Promise<StagedModelWrite> {
    if (!this.fallback) {
      throw new Error(
        'Native model writes must use the verified streaming model downloader; JSON byte-array IPC is disabled.',
      );
    }
    return this.fallback.beginInstalledWrite(modelId, options);
  }

  async publishInstalledBatch(
    entries: Array<{ stagedId: string; modelId: string }>,
  ): Promise<void> {
    if (!this.fallback) {
      throw new Error(
        'Native model publication must use the verified streaming model downloader; JSON byte-array IPC is disabled.',
      );
    }
    return this.fallback.publishInstalledBatch(entries);
  }

  async deleteInstalled(modelId: string): Promise<void> {
    if (this.fallback) await this.fallback.deleteInstalled(modelId);
  }

  async hasInstalled(modelId: string): Promise<boolean> {
    return this.fallback?.hasInstalled(modelId) ?? false;
  }

  async listInstalled(): Promise<string[]> {
    return this.fallback?.listInstalled() ?? [];
  }

  async savePartial(modelId: string, record: PartialDownloadRecord): Promise<void> {
    if (this.fallback) {
      return this.fallback.savePartial(modelId, record);
    }
    throw new Error('TauriModelStorage: partial downloads not supported without fallback');
  }

  async loadPartial(modelId: string): Promise<PartialDownloadRecord | null> {
    if (this.fallback) {
      return this.fallback.loadPartial(modelId);
    }
    return null;
  }

  async getPartialMetadata(modelId: string): Promise<PartialDownloadMetadata | null> {
    return this.fallback?.getPartialMetadata(modelId) ?? null;
  }

  async openPartialArtifact(modelId: string): Promise<PartialArtifactHandle | null> {
    return this.fallback?.openPartialArtifact(modelId) ?? null;
  }

  async deletePartial(modelId: string): Promise<void> {
    if (this.fallback) {
      return this.fallback.deletePartial(modelId);
    }
  }

  async getQuota(): Promise<StorageQuota> {
    if (this.fallback) {
      return this.fallback.getQuota();
    }
    return { used: 0, available: null };
  }

  async clear(): Promise<void> {
    const ids = await this.listInstalled();
    for (const id of ids) {
      await this.deleteInstalled(id);
    }
  }
}
