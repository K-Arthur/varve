import { InferenceError } from './InferenceError';
import type { ModelStorage } from './ModelStorage';
import { createModelStorage, migrateFromLocalStorage } from './ModelStorage';
import type {
  DownloadProgress,
  DownloadState,
  ManifestEntry,
  ModelInstallInfo,
  ModelManifestEntry,
  ModelState,
} from './types';

interface ActiveDownload {
  controller: AbortController;
  componentId?: string;
}

type StateListener = (modelId: string, state: ModelState) => void;
type DownloadListener = (progress: DownloadProgress) => void;

const STATE_PREFIX = 'varve-model-state-';
const LEGACY_STATE_PREFIX = 'strata-model-state-';

export class DownloadManager {
  private activeDownloads = new Map<string, ActiveDownload>();
  private modelMeta = new Map<string, ModelManifestEntry>();
  private manifestEntries = new Map<string, ManifestEntry>();
  private stateCache = new Map<string, ModelState>();
  private stateListeners = new Map<string, Set<StateListener>>();
  private downloadListeners = new Map<string, Set<DownloadListener>>();
  private storage: ModelStorage;

  constructor(storage?: ModelStorage) {
    this.storage = storage ?? createModelStorage();
    this.migrateLegacyStorage();
  }

  private async migrateLegacyStorage(): Promise<void> {
    try {
      await migrateFromLocalStorage(this.storage);
    } catch {}
  }

  registerModel(entry: ModelManifestEntry): void {
    this.modelMeta.set(entry.id, entry);
  }

  registerManifestEntry(entry: ManifestEntry): void {
    this.manifestEntries.set(entry.id, entry);
  }

  getStorage(): ModelStorage {
    return this.storage;
  }

  /**
   * The component list to download for an entry, or null for a single file.
   *
   * A non-empty `components` array is authoritative on its own; the older
   * `multiComponent` boolean is only a hint. Requiring both meant an entry that
   * listed components but omitted the flag silently took the single-file path
   * and fetched just its first URL — for an ONNX model whose weights live in a
   * sibling `.onnx.data`, that downloads the graph and leaves the model
   * unloadable, reported as "downloaded".
   */
  private componentsOf(
    entry: ModelManifestEntry,
  ): NonNullable<ModelManifestEntry['components']> | null {
    return entry.components && entry.components.length > 0 ? entry.components : null;
  }

  async getDownloadState(modelId: string): Promise<DownloadState> {
    const cached = this.stateCache.get(modelId);
    if (cached) {
      if (cached === 'ready') return 'ready';
      if (cached === 'downloading') return 'downloading';
      if (cached === 'error') return 'error';
    }

    const entry = this.modelMeta.get(modelId);
    if (!entry) {
      const manifestEntry = this.manifestEntries.get(modelId);
      if (manifestEntry?.bundled) return 'ready';
      return 'not-downloaded';
    }
    if (entry.bundled) return 'ready';

    const stateComponents = this.componentsOf(entry);
    if (stateComponents) {
      const allReady = await this.areAllComponentsReady(stateComponents);
      if (allReady) return 'ready';

      const anyPartial = await this.anyComponentPartial(stateComponents);
      if (anyPartial) return 'paused';

      return 'not-downloaded';
    }

    const partial = await this.storage.loadPartial(modelId);
    if (partial) return 'paused';

    const stored = await this.storage.hasInstalled(modelId);
    if (stored) return 'ready';

    return 'not-downloaded';
  }

  private async areAllComponentsReady(
    components: NonNullable<ModelManifestEntry['components']>,
  ): Promise<boolean> {
    const results = await Promise.all(components.map((c) => this.storage.hasInstalled(c.id)));
    return results.every(Boolean);
  }

  private async anyComponentPartial(
    components: NonNullable<ModelManifestEntry['components']>,
  ): Promise<boolean> {
    const results = await Promise.all(components.map((c) => this.storage.loadPartial(c.id)));
    return results.some(Boolean);
  }

  async getComponentStates(modelId: string): Promise<Map<string, DownloadState>> {
    const states = new Map<string, DownloadState>();
    const entry = this.modelMeta.get(modelId);
    const components = entry?.components;
    if (!components) return states;

    for (const comp of components) {
      const partial = await this.storage.loadPartial(comp.id);
      if (partial) {
        states.set(comp.id, 'paused');
        continue;
      }
      const installed = await this.storage.hasInstalled(comp.id);
      states.set(comp.id, installed ? 'ready' : 'not-downloaded');
    }
    return states;
  }

  async startDownload(modelId: string, signal?: AbortSignal): Promise<void> {
    const entry = this.modelMeta.get(modelId);
    if (!entry) throw new InferenceError('model_not_installed');
    if (this.activeDownloads.has(modelId)) {
      throw new Error(`Already downloading model: ${modelId}`);
    }

    const components = this.componentsOf(entry);
    if (components) {
      return this.downloadMultiComponent(modelId, components, signal);
    }

    return this.downloadSingle(modelId, entry, signal);
  }

  private async downloadMultiComponent(
    modelId: string,
    components: NonNullable<ModelManifestEntry['components']>,
    signal?: AbortSignal,
  ): Promise<void> {
    const manifestEntry = this.manifestEntries.get(modelId);
    const controller = new AbortController();
    const combinedSignal = signal
      ? this.combineSignals(controller.signal, signal)
      : controller.signal;

    this.activeDownloads.set(modelId, { controller });
    this.setState(modelId, 'downloading');

    try {
      for (const component of components) {
        if (combinedSignal.aborted) {
          throw new InferenceError('download_interrupted');
        }

        const componentEntry: ModelManifestEntry = {
          id: component.id,
          name: `${modelId} ${component.role}`,
          description: '',
          sizeBytes: component.sizeBytes ?? 0,
          remoteUrl: component.remoteUrl ?? manifestEntry?.remoteUrl ?? '',
          checksum: component.checksum ?? '',
          bundled: false,
          inputSpec: null,
          quality: 1,
          speed: 1,
          peakMemoryBytes: 0,
          gpuRecommended: false,
          maxSessions: 1,
          precision: 'fp32',
          category: entryCategory(modelId),
        };

        this.notifyDownloadProgress(modelId, {
          modelId,
          loaded: 0,
          total: 0,
          speedBytesPerSec: 0,
          estimatedRemainingMs: 0,
          componentId: component.id,
          componentRole: component.role,
        });

        await this.downloadSingle(component.id, componentEntry, combinedSignal, modelId);

        this.notifyDownloadProgress(modelId, {
          modelId,
          loaded: 0,
          total: 0,
          speedBytesPerSec: 0,
          estimatedRemainingMs: 0,
          componentId: component.id,
          componentRole: component.role,
          componentComplete: true,
        });
      }

      this.activeDownloads.delete(modelId);
      this.setState(modelId, 'ready');
    } catch (error) {
      this.activeDownloads.delete(modelId);
      if (combinedSignal.aborted) {
        this.setState(modelId, 'unavailable');
        throw new InferenceError('download_interrupted');
      }
      this.setState(modelId, 'error');
      throw error;
    }
  }

  private async downloadSingle(
    modelId: string,
    entry: ModelManifestEntry,
    signal?: AbortSignal,
    parentModelId?: string,
  ): Promise<void> {
    const controller = new AbortController();
    if (!parentModelId) {
      this.activeDownloads.set(modelId, { controller });
    }

    const combinedSignal = signal
      ? this.combineSignals(controller.signal, signal)
      : controller.signal;

    const notifyId = parentModelId ?? modelId;
    if (!parentModelId) {
      this.setState(modelId, 'downloading');
    }

    try {
      const remoteUrl = entry.remoteUrl;
      if (!remoteUrl) {
        throw new InferenceError('model_not_installed', undefined, {
          message: `Model ${modelId} has no download URL.`,
          userMessage: `"${entry.name}" is not available for download yet.`,
        });
      }

      const existingPartial = await this.loadPartialCompat(modelId);
      let partialLoaded = 0;
      let partialChunks: Uint8Array[] = [];
      let storedEtag: string | null = null;

      if (existingPartial && existingPartial.url === remoteUrl) {
        partialChunks = [existingPartial.bytes];
        partialLoaded = existingPartial.bytes.length;
        storedEtag = existingPartial.etag;
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
          await this.storage.deletePartial(modelId);
          partialLoaded = 0;
          partialChunks = [];
          const retryResponse = await fetch(remoteUrl, { signal: combinedSignal });
          if (!retryResponse.ok) {
            throw new InferenceError('model_download_failed', undefined, {
              technical: `HTTP ${retryResponse.status}: ${retryResponse.statusText}`,
            });
          }
          await this.streamDownload(
            modelId,
            notifyId,
            retryResponse,
            partialChunks,
            0,
            controller,
            combinedSignal,
          );
          return;
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
          await this.storage.deletePartial(modelId);
          partialChunks = [];
          partialLoaded = 0;
          const freshResponse = await fetch(remoteUrl, { signal: combinedSignal });
          if (!freshResponse.ok) {
            throw new InferenceError('model_download_failed', undefined, {
              technical: `HTTP ${freshResponse.status} after ETag mismatch`,
            });
          }
          await this.streamDownload(
            modelId,
            notifyId,
            freshResponse,
            [],
            0,
            controller,
            combinedSignal,
          );
          return;
        }
      } else if (partialLoaded > 0) {
        await this.storage.deletePartial(modelId);
        partialChunks = [];
        partialLoaded = 0;
      }

      await this.streamDownload(
        modelId,
        notifyId,
        response,
        partialChunks,
        partialLoaded,
        controller,
        combinedSignal,
      );
    } catch (error) {
      if (!parentModelId) {
        this.activeDownloads.delete(modelId);
      }
      if (combinedSignal.aborted) {
        const partial = await this.getPartialCompat(modelId);
        if (partial) {
          await this.savePartialCompat(modelId, partial.bytes, {
            url: entry.remoteUrl,
            etag: null,
            loaded: partial.loaded,
          });
          if (!parentModelId) this.setState(modelId, 'unavailable');
        } else {
          if (!parentModelId) this.setState(modelId, 'unavailable');
        }
        throw new InferenceError('download_interrupted');
      }
      if (!parentModelId) this.setState(modelId, 'error');
      throw error;
    }
  }

  private async streamDownload(
    modelId: string,
    notifyId: string,
    response: Response,
    partialChunks: Uint8Array[],
    partialLoaded: number,
    _controller: AbortController,
    combinedSignal: AbortSignal,
  ): Promise<void> {
    const entry = this.modelMeta.get(modelId);
    const manifestEntry = this.manifestEntries.get(modelId);
    const remoteUrl = entry?.remoteUrl ?? manifestEntry?.remoteUrl ?? '';

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
        : (entry?.sizeBytes ?? 0);

    let loaded = partialLoaded;
    const chunks: Uint8Array[] = [...partialChunks];
    const startTime = performance.now();

    try {
      while (true) {
        if (combinedSignal.aborted) {
          await reader.cancel();
          await this.savePartialFromChunks(modelId, chunks, remoteUrl, loaded);
          this.setState(notifyId, 'unavailable');
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

        this.notifyDownloadProgress(notifyId, {
          modelId: notifyId,
          loaded,
          total,
          speedBytesPerSec: speed,
          estimatedRemainingMs: estimatedRemaining,
        });
      }

      const totalBytes = chunks.reduce((sum, c) => sum + c.length, 0);
      let bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }

      this.setState(notifyId, 'verifying');

      if (entry?.checksum || entry?.upstreamChecksum) {
        // The downloaded bytes must match what the upstream server serves
        // (upstreamChecksum when the artifact is post-processed locally,
        // otherwise checksum).
        const upstream = await this.sha256Hex(bytes.buffer);
        const expectedUpstream = (entry?.upstreamChecksum ?? entry?.checksum ?? '').toLowerCase();
        if (upstream !== expectedUpstream) {
          throw new InferenceError('checksum_mismatch', undefined, {
            technical: `Expected ${expectedUpstream}, got ${upstream}`,
          });
        }
      }

      if (entry?.repair === 'sam2-empty-value-info') {
        const { repairSam2EncoderGraph } = await import('../models/sam2GraphRepair');
        bytes = new Uint8Array(repairSam2EncoderGraph(bytes));
        if (entry.checksum) {
          const repairedHash = await this.sha256Hex(bytes.buffer);
          if (repairedHash !== entry.checksum.toLowerCase()) {
            throw new InferenceError('checksum_mismatch', undefined, {
              technical: `Repaired artifact checksum mismatch: expected ${entry.checksum}, got ${repairedHash}`,
            });
          }
        }
      }

      this.setState(notifyId, 'installing');
      await this.storage.saveInstalled(modelId, bytes.buffer);
      await this.storage.deletePartial(modelId);

      if (!this.isComponentDownload(notifyId, modelId)) {
        this.activeDownloads.delete(modelId);
      }
      this.setState(notifyId, 'ready');
    } catch (error) {
      if (!this.isComponentDownload(notifyId, modelId)) {
        this.activeDownloads.delete(notifyId);
      }
      if (combinedSignal.aborted) {
        await this.savePartialFromChunks(modelId, chunks, remoteUrl, loaded);
        this.setState(notifyId, 'unavailable');
        throw new InferenceError('download_interrupted');
      }
      if (error instanceof InferenceError) throw error;
      this.setState(notifyId, 'error');
      throw new InferenceError('model_download_failed', error instanceof Error ? error : undefined);
    }
  }

  private isComponentDownload(parentId: string, childId: string): boolean {
    return parentId !== childId;
  }

  cancelDownload(modelId: string): void {
    const active = this.activeDownloads.get(modelId);
    if (active) {
      active.controller.abort();
      this.activeDownloads.delete(modelId);
    }
  }

  async pauseDownload(modelId: string): Promise<void> {
    const active = this.activeDownloads.get(modelId);
    if (!active) return;
    active.controller.abort();
    this.activeDownloads.delete(modelId);
  }

  async resumeDownload(modelId: string, signal?: AbortSignal): Promise<void> {
    return this.startDownload(modelId, signal);
  }

  async deleteModel(modelId: string): Promise<void> {
    this.cancelDownload(modelId);
    await this.storage.deleteInstalled(modelId);
    await this.storage.deletePartial(modelId);
    this.stateCache.delete(modelId);

    const entry = this.modelMeta.get(modelId);
    if (entry?.components) {
      for (const comp of entry.components) {
        await this.storage.deleteInstalled(comp.id);
        await this.storage.deletePartial(comp.id);
      }
    }
  }

  async getInstalledBytes(modelId: string): Promise<Uint8Array | null> {
    const buffer = await this.storage.loadInstalled(modelId);
    return buffer ? new Uint8Array(buffer) : null;
  }

  async getInstalledSize(modelId: string): Promise<number | null> {
    const bytes = await this.getInstalledBytes(modelId);
    return bytes?.length ?? null;
  }

  async getTotalStorageUsed(): Promise<number> {
    const ids = await this.storage.listInstalled();
    let total = 0;
    for (const id of ids) {
      const buf = await this.storage.loadInstalled(id);
      if (buf) total += buf.byteLength;
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

  private notifyDownloadProgress(
    modelId: string,
    progress: DownloadProgress & {
      componentId?: string;
      componentRole?: string;
      componentComplete?: boolean;
    },
  ): void {
    const listeners = this.downloadListeners.get(modelId);
    if (listeners) {
      for (const fn of listeners) {
        try {
          fn(progress);
        } catch {}
      }
    }
  }

  private async loadPartialCompat(
    modelId: string,
  ): Promise<{ bytes: Uint8Array; url: string; etag: string | null; loaded: number } | null> {
    try {
      const legacyRaw = localStorage.getItem(`strata-model-partial-${modelId}`);
      if (legacyRaw) {
        const parsed = JSON.parse(legacyRaw) as {
          bytes: number[];
          meta: { url: string; etag: string | null; loaded: number };
        };
        return {
          bytes: new Uint8Array(parsed.bytes),
          url: parsed.meta.url,
          etag: parsed.meta.etag,
          loaded: parsed.meta.loaded,
        };
      }
    } catch {}

    const record = await this.storage.loadPartial(modelId);
    if (!record) return null;
    return { bytes: record.bytes, url: record.url, etag: record.etag, loaded: record.loaded };
  }

  private async savePartialCompat(
    modelId: string,
    bytes: Uint8Array,
    meta: { url: string; etag: string | null; loaded: number },
  ): Promise<void> {
    await this.storage.savePartial(modelId, {
      bytes,
      url: meta.url,
      etag: meta.etag,
      loaded: meta.loaded,
    });
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
    await this.savePartialCompat(modelId, bytes, { url, etag: null, loaded: totalLoaded });
  }

  private async getPartialCompat(
    modelId: string,
  ): Promise<{ bytes: Uint8Array; loaded: number } | null> {
    const partial = await this.loadPartialCompat(modelId);
    if (!partial) return null;
    return { bytes: partial.bytes, loaded: partial.loaded };
  }

  private persistState(modelId: string, state: ModelState): void {
    try {
      localStorage.setItem(`${STATE_PREFIX}${modelId}`, state);
      localStorage.removeItem(`${LEGACY_STATE_PREFIX}${modelId}`);
    } catch {}
  }

  private async sha256Hex(buffer: ArrayBuffer): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
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

function entryCategory(id: string): import('./types').TaskCategory {
  if (id.startsWith('upscale-')) return 'upscaling';
  if (id.startsWith('birefnet-') || id.startsWith('u2netp') || id.startsWith('isnet-'))
    return 'segmentation';
  if (id.startsWith('sam2-')) return 'segmentation';
  if (id === 'scunet') return 'denoising';
  if (id.startsWith('depth-')) return 'depth';
  if (id.includes('ocr') || id.includes('text-detect') || id.startsWith('tr-ocr')) return 'ocr';
  if (id.includes('classifier') || id.includes('embedder')) return 'classification';
  if (
    id.startsWith('font-') ||
    (id.includes('font') && (id.includes('detect') || id.includes('match') || id.includes('recog')))
  )
    return 'classification';
  return 'other';
}
