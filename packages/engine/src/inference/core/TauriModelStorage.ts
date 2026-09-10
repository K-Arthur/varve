import type { ModelStorage, PartialDownloadRecord, StorageQuota } from './ModelStorage';

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const w = typeof window !== 'undefined' ? window : undefined;
  const core = (
    w as unknown as {
      __TAURI__?: {
        core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
      };
    }
  )?.__TAURI__?.core;
  if (!core) {
    return Promise.reject(new Error('Tauri IPC not available'));
  }
  return core.invoke(cmd, args) as Promise<T>;
}

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

  private async withFallback<T>(
    action: () => Promise<T>,
    fallbackAction: () => Promise<T>,
  ): Promise<T> {
    if (this.isAvailable()) {
      try {
        return await action();
      } catch (err) {
        if (this.fallback && String(err).includes('not available')) {
          return fallbackAction();
        }
        throw err;
      }
    }
    if (this.fallback) return fallbackAction();
    throw new Error('TauriModelStorage: not available and no fallback');
  }

  async saveInstalled(modelId: string, bytes: ArrayBuffer): Promise<void> {
    return this.withFallback(
      () => invoke('write_model_file', { modelId, data: Array.from(new Uint8Array(bytes)) }),
      () => this.fallback!.saveInstalled(modelId, bytes),
    );
  }

  async loadInstalled(modelId: string): Promise<ArrayBuffer | null> {
    return this.withFallback(
      async () => {
        const data = await invoke<number[]>('read_model_file', { modelId });
        return new Uint8Array(data).buffer;
      },
      () => this.fallback!.loadInstalled(modelId),
    );
  }

  async deleteInstalled(modelId: string): Promise<void> {
    return this.withFallback(
      () => invoke('delete_model_file', { modelId }),
      () => this.fallback!.deleteInstalled(modelId),
    );
  }

  async hasInstalled(modelId: string): Promise<boolean> {
    try {
      const bytes = await this.loadInstalled(modelId);
      return bytes !== null;
    } catch {
      return false;
    }
  }

  async listInstalled(): Promise<string[]> {
    return this.withFallback(
      () => invoke<string[]>('list_model_files'),
      () => this.fallback!.listInstalled(),
    );
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
