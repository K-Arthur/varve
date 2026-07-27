import { InferenceError } from './InferenceError';
import type {
  DownloadProgress,
  DownloadState,
  ModelInstallInfo,
  ModelManifestEntry,
  ModelState,
} from './types';

interface PartialDownload {
  bytes: Uint8Array;
  meta: {
    url: string;
    etag: string | null;
    loaded: number;
  };
}

type StateListener = (modelId: string, state: ModelState) => void;
type DownloadListener = (progress: DownloadProgress) => void;

const PARTIAL_PREFIX = 'strata-model-partial-';
const STATE_PREFIX = 'strata-model-state-';

export class DownloadManager {
  private activeDownloads = new Map<string, AbortController>();
  private modelMeta = new Map<string, ModelManifestEntry>();
  private stateCache = new Map<string, ModelState>();
  private stateListeners = new Map<string, Set<StateListener>>();
  private downloadListeners = new Map<string, Set<DownloadListener>>();

  registerModel(entry: ModelManifestEntry): void {
    this.modelMeta.set(entry.id, entry);
  }

  async getDownloadState(modelId: string): Promise<DownloadState> {
    const cached = this.stateCache.get(modelId);
    if (cached) return this.mapState(cached);
    const entry = this.modelMeta.get(modelId);
    if (!entry) return 'not-downloaded';
    if (entry.bundled) return 'ready';

    const partial = await this.loadPartial(modelId);
    if (partial) return 'paused';

    const stored = await this.loadInstalled(modelId);
    if (stored) return 'ready';

    return 'not-downloaded';
  }

  async startDownload(modelId: string, signal?: AbortSignal): Promise<void> {
    const entry = this.modelMeta.get(modelId);
    if (!entry) throw new InferenceError('model_not_installed');
    if (this.activeDownloads.has(modelId)) {
      throw new Error(`Already downloading model: ${modelId}`);
    }

    const controller = new AbortController();
    this.activeDownloads.set(modelId, controller);

    const combinedSignal = signal
      ? this.combineSignals(controller.signal, signal)
      : controller.signal;
    this.setState(modelId, 'downloading');

    try {
      const remoteUrl = entry.remoteUrl;
      if (!remoteUrl) {
        throw new InferenceError('model_not_installed', undefined, {
          message: `Model ${modelId} has no download URL.`,
          userMessage: `"${entry.name}" is not available for download yet.`,
        });
      }

      const existingPartial = await this.loadPartial(modelId);
      let partialLoaded = 0;
      let partialChunks: Uint8Array[] = [];
      let storedEtag: string | null = null;

      if (existingPartial && existingPartial.meta.url === remoteUrl) {
        partialChunks = [existingPartial.bytes];
        partialLoaded = existingPartial.bytes.length;
        storedEtag = existingPartial.meta.etag;
      }

      const headers: Record<string, string> = {};
      if (partialLoaded > 0) {
        headers.Range = `bytes=${partialLoaded}-`;
      }

      const response = await fetch(remoteUrl, {
        signal: combinedSignal,
        headers,
      });

      if (!response.ok && response.status !== 206) {
        if (response.status === 416) {
          await this.deletePartial(modelId);
          partialLoaded = 0;
          partialChunks = [];
          const retryResponse = await fetch(remoteUrl, { signal: combinedSignal });
          if (!retryResponse.ok) {
            throw new InferenceError('model_download_failed', undefined, {
              technical: `HTTP ${retryResponse.status}: ${retryResponse.statusText}`,
            });
          }
          return this.streamDownload(
            modelId,
            retryResponse,
            partialChunks,
            0,
            controller,
            combinedSignal,
          );
        }
        if (response.status === 404) {
          throw new InferenceError('model_download_failed', undefined, {
            message: `Model file not found at remote URL.`,
            userMessage: `The model "${entry.name}" could not be found on the server. It may have been removed or relocated.`,
            technical: `HTTP 404 for ${remoteUrl}`,
          });
        }
        throw new InferenceError('model_download_failed', undefined, {
          technical: `HTTP ${response.status}: ${response.statusText}`,
        });
      }

      const responseEtag = response.headers.get('etag');
      const isRangeResponse = response.status === 206;

      if (isRangeResponse && partialLoaded > 0) {
        if (storedEtag && responseEtag && storedEtag !== responseEtag) {
          await this.deletePartial(modelId);
          partialChunks = [];
          partialLoaded = 0;
          const freshResponse = await fetch(remoteUrl, { signal: combinedSignal });
          if (!freshResponse.ok) {
            throw new InferenceError('model_download_failed', undefined, {
              technical: `HTTP ${freshResponse.status} after ETag mismatch`,
            });
          }
          return this.streamDownload(modelId, freshResponse, [], 0, controller, combinedSignal);
        }
      } else if (partialLoaded > 0) {
        await this.deletePartial(modelId);
        partialChunks = [];
        partialLoaded = 0;
      }

      return this.streamDownload(
        modelId,
        response,
        partialChunks,
        partialLoaded,
        controller,
        combinedSignal,
      );
    } catch (error) {
      this.activeDownloads.delete(modelId);
      if (combinedSignal.aborted) {
        const partial = await this.getPartialBytes(modelId);
        if (partial) {
          await this.savePartial(modelId, partial.bytes, {
            url: entry.remoteUrl,
            etag: null,
            loaded: partial.loaded,
          });
          this.setState(modelId, 'unavailable');
        } else {
          this.setState(modelId, 'unavailable');
        }
        throw new InferenceError('download_interrupted');
      }
      this.setState(modelId, 'error');
      throw error;
    }
  }

  private async streamDownload(
    modelId: string,
    response: Response,
    partialChunks: Uint8Array[],
    partialLoaded: number,
    _controller: AbortController,
    combinedSignal: AbortSignal,
  ): Promise<void> {
    const entry = this.modelMeta.get(modelId);
    if (!entry) throw new InferenceError('model_not_installed');

    const reader = response.body?.getReader();
    if (!reader)
      throw new InferenceError('model_download_failed', undefined, {
        message: 'Response body not readable.',
      });

    const contentLength = response.headers.get('content-length');
    const contentRangeTotal = response.headers.get('content-range')?.split('/')[1];
    const total = contentRangeTotal
      ? parseInt(contentRangeTotal, 10)
      : contentLength
        ? partialLoaded + parseInt(contentLength, 10)
        : entry.sizeBytes;

    let loaded = partialLoaded;
    const chunks: Uint8Array[] = [...partialChunks];
    const startTime = performance.now();

    try {
      while (true) {
        if (combinedSignal.aborted) {
          await reader.cancel();
          await this.savePartialFromChunks(modelId, chunks, entry.remoteUrl, loaded);
          this.setState(modelId, 'unavailable');
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        loaded += value.length;

        const elapsed = (performance.now() - startTime) / 1000;
        const speed = elapsed > 0 ? Math.round(loaded / elapsed) : 0;
        const estimatedRemaining =
          speed > 0 && total > loaded ? Math.round(((total - loaded) / speed) * 1000) : 0;

        this.notifyDownloadProgress(modelId, {
          modelId,
          loaded,
          total,
          speedBytesPerSec: speed,
          estimatedRemainingMs: estimatedRemaining,
        });
      }

      const totalBytes = chunks.reduce((sum, c) => sum + c.length, 0);
      const bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }

      this.setState(modelId, 'verifying');

      if (entry.checksum) {
        const hash = await this.sha256Hex(bytes.buffer);
        if (hash !== entry.checksum.toLowerCase()) {
          throw new InferenceError('checksum_mismatch', undefined, {
            technical: `Expected ${entry.checksum}, got ${hash}`,
          });
        }
      }

      this.setState(modelId, 'installing');
      await this.saveInstalled(modelId, bytes);
      await this.deletePartial(modelId);

      this.activeDownloads.delete(modelId);
      this.setState(modelId, 'ready');
    } catch (error) {
      this.activeDownloads.delete(modelId);
      if (combinedSignal.aborted) {
        await this.savePartialFromChunks(modelId, chunks, entry.remoteUrl, loaded);
        this.setState(modelId, 'unavailable');
        throw new InferenceError('download_interrupted');
      }
      if (error instanceof InferenceError) throw error;
      this.setState(modelId, 'error');
      throw new InferenceError('model_download_failed', error instanceof Error ? error : undefined);
    }
  }

  cancelDownload(modelId: string): void {
    const controller = this.activeDownloads.get(modelId);
    if (controller) {
      controller.abort();
      this.activeDownloads.delete(modelId);
    }
  }

  async pauseDownload(modelId: string): Promise<void> {
    const controller = this.activeDownloads.get(modelId);
    if (!controller) return;
    controller.abort();
    this.activeDownloads.delete(modelId);
  }

  async resumeDownload(modelId: string, signal?: AbortSignal): Promise<void> {
    return this.startDownload(modelId, signal);
  }

  async deleteModel(modelId: string): Promise<void> {
    this.cancelDownload(modelId);
    await this.deleteInstalled(modelId);
    await this.deletePartial(modelId);
    this.stateCache.delete(modelId);
  }

  async getInstalledBytes(modelId: string): Promise<Uint8Array | null> {
    try {
      const key = `strata-model-${modelId}`;
      const stored = localStorage.getItem(key);
      if (!stored) return null;
      const parsed = JSON.parse(stored) as { data: number[] };
      return new Uint8Array(parsed.data);
    } catch {
      return null;
    }
  }

  async getInstalledSize(modelId: string): Promise<number | null> {
    const bytes = await this.getInstalledBytes(modelId);
    return bytes?.length ?? null;
  }

  async getTotalStorageUsed(): Promise<number> {
    let total = 0;
    for (const id of this.modelMeta.keys()) {
      const bytes = await this.getInstalledBytes(id);
      if (bytes) total += bytes.length;
    }
    return total;
  }

  subscribeState(modelId: string, fn: StateListener): () => void {
    let set = this.stateListeners.get(modelId);
    if (!set) {
      set = new Set();
      this.stateListeners.set(modelId, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  subscribeDownloadProgress(modelId: string, fn: DownloadListener): () => void {
    let set = this.downloadListeners.get(modelId);
    if (!set) {
      set = new Set();
      this.downloadListeners.set(modelId, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  listInstalledModels(): ModelInstallInfo[] {
    const result: ModelInstallInfo[] = [];
    for (const [id, entry] of this.modelMeta) {
      const state = this.stateCache.get(id) ?? (entry.bundled ? 'ready' : 'unavailable');
      result.push({
        id,
        name: entry.name,
        sizeBytes: entry.sizeBytes,
        installed: state === 'ready',
        source: entry.bundled ? 'bundled' : state === 'ready' ? 'downloaded' : 'none',
        state,
        precision: entry.precision,
        category: entry.category,
        quality: entry.quality,
      });
    }
    return result;
  }

  private setState(modelId: string, state: ModelState): void {
    const prev = this.stateCache.get(modelId);
    if (prev === state) return;
    this.stateCache.set(modelId, state);
    this.persistState(modelId, state);
    const listeners = this.stateListeners.get(modelId);
    if (listeners) {
      for (const fn of listeners) {
        try {
          fn(modelId, state);
        } catch {}
      }
    }
  }

  private notifyDownloadProgress(modelId: string, progress: DownloadProgress): void {
    const listeners = this.downloadListeners.get(modelId);
    if (listeners) {
      for (const fn of listeners) {
        try {
          fn(progress);
        } catch {}
      }
    }
  }

  private async loadInstalled(modelId: string): Promise<Uint8Array | null> {
    return this.getInstalledBytes(modelId);
  }

  private async saveInstalled(modelId: string, bytes: Uint8Array): Promise<void> {
    const key = `strata-model-${modelId}`;
    const data: number[] = [];
    for (let i = 0; i < bytes.length; i += 65536) {
      const slice = bytes.subarray(i, Math.min(i + 65536, bytes.length));
      data.push(...Array.from(slice));
    }
    try {
      localStorage.setItem(key, JSON.stringify({ data }));
    } catch {
      throw new InferenceError('insufficient_disk_space');
    }
  }

  private async deleteInstalled(modelId: string): Promise<void> {
    try {
      localStorage.removeItem(`strata-model-${modelId}`);
    } catch {}
    try {
      localStorage.removeItem(`${STATE_PREFIX}${modelId}`);
    } catch {}
  }

  private async loadPartial(modelId: string): Promise<PartialDownload | null> {
    try {
      const raw = localStorage.getItem(`${PARTIAL_PREFIX}${modelId}`);
      if (!raw) return null;
      return JSON.parse(raw) as PartialDownload;
    } catch {
      return null;
    }
  }

  private async savePartial(
    modelId: string,
    bytes: Uint8Array,
    meta: { url: string; etag: string | null; loaded: number },
  ): Promise<void> {
    try {
      localStorage.setItem(
        `${PARTIAL_PREFIX}${modelId}`,
        JSON.stringify({ bytes: Array.from(bytes), meta }),
      );
    } catch {}
  }

  private async deletePartial(modelId: string): Promise<void> {
    try {
      localStorage.removeItem(`${PARTIAL_PREFIX}${modelId}`);
    } catch {}
  }

  private async savePartialFromChunks(
    modelId: string,
    chunks: Uint8Array[],
    url: string,
    totalLoaded: number,
  ): Promise<void> {
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    await this.savePartial(modelId, bytes, { url, etag: null, loaded: totalLoaded });
  }

  private async getPartialBytes(
    modelId: string,
  ): Promise<{ bytes: Uint8Array; loaded: number } | null> {
    const partial = await this.loadPartial(modelId);
    if (!partial) return null;
    return { bytes: partial.bytes, loaded: partial.meta.loaded };
  }

  private persistState(modelId: string, state: ModelState): void {
    try {
      localStorage.setItem(`${STATE_PREFIX}${modelId}`, state);
    } catch {}
  }

  private async sha256Hex(buffer: ArrayBuffer): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private mapState(state: ModelState): DownloadState {
    switch (state) {
      case 'unavailable':
        return 'not-downloaded';
      case 'queued':
        return 'queued';
      case 'downloading':
        return 'downloading';
      case 'verifying':
        return 'verifying';
      case 'installing':
        return 'installing';
      case 'ready':
        return 'ready';
      case 'error':
        return 'error';
    }
  }

  private combineSignals(...signals: AbortSignal[]): AbortSignal {
    const valid = signals.filter((s): s is AbortSignal => s !== undefined);
    if (valid.length === 0) return new AbortController().signal;
    const first = valid[0];
    if (first && valid.length === 1) return first;
    const controller = new AbortController();
    for (const signal of valid) {
      if (signal.aborted) {
        controller.abort(signal.reason);
        return controller.signal;
      }
      signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
  }

  reset(): void {
    for (const id of this.activeDownloads.keys()) {
      this.cancelDownload(id);
    }
    this.activeDownloads.clear();
    this.stateCache.clear();
    this.stateListeners.clear();
    this.downloadListeners.clear();
  }
}
