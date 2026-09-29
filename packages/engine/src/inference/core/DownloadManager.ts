import { InferenceError } from './InferenceError';
import type { ModelArtifactHandle, ModelStorage } from './ModelStorage';
import { getModelStorage, migrateFromLocalStorage } from './ModelStorage';
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
  completion?: Promise<void>;
}

type StateListener = (modelId: string, state: ModelState) => void;
type DownloadListener = (progress: DownloadProgress) => void;

const STATE_PREFIX = 'varve-model-state-';
const LEGACY_STATE_PREFIX = 'strata-model-state-';
const INSTALL_WRITE_CHUNK_BYTES = 256 * 1024;

interface StreamDownloadOptions {
  entry?: ModelManifestEntry;
  expectedSizeBytes?: number;
  responseEtag?: string | null;
}

interface PartialSource {
  bytes?: Uint8Array;
  artifact?: ModelArtifactHandle;
  url: string;
  etag: string | null;
  loaded: number;
}

interface ContentRange {
  start: number;
  end: number;
  total: number | null;
}

function parseContentRange(value: string | null): ContentRange | null {
  if (!value) return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === '*' ? null : Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    (total !== null && (!Number.isSafeInteger(total) || total <= end))
  ) {
    return null;
  }
  return { start, end, total };
}

function expectedDownloadSize(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export class DownloadManager {
  private activeDownloads = new Map<string, ActiveDownload>();
  private modelMeta = new Map<string, ModelManifestEntry>();
  private manifestEntries = new Map<string, ManifestEntry>();
  private stateCache = new Map<string, ModelState>();
  private stateListeners = new Map<string, Set<StateListener>>();
  private downloadListeners = new Map<string, Set<DownloadListener>>();
  private storage: ModelStorage;

  constructor(storage?: ModelStorage) {
    this.storage = storage ?? getModelStorage();
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

      const anyPartial = await this.anyComponentPartial(modelId, stateComponents);
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
    parentId: string,
    components: NonNullable<ModelManifestEntry['components']>,
  ): Promise<boolean> {
    const results = await Promise.all(
      components.map((component) =>
        this.storage.loadPartial(this.componentStageId(parentId, component.id)),
      ),
    );
    return results.some(Boolean);
  }

  async getComponentStates(modelId: string): Promise<Map<string, DownloadState>> {
    const states = new Map<string, DownloadState>();
    const entry = this.modelMeta.get(modelId);
    const components = entry?.components;
    if (!components) return states;

    for (const comp of components) {
      const stageId = this.componentStageId(modelId, comp.id);
      const partial = await this.storage.loadPartial(stageId);
      if (partial) {
        states.set(comp.id, 'paused');
        continue;
      }
      const installed = await this.storage.hasInstalled(comp.id);
      const staged = await this.storage.hasInstalled(stageId);
      states.set(comp.id, installed || staged ? 'ready' : 'not-downloaded');
    }
    return states;
  }

  private componentStageId(parentId: string, componentId: string): string {
    return `__varve_component_stage__${encodeURIComponent(parentId)}__${encodeURIComponent(componentId)}`;
  }

  async startDownload(modelId: string, signal?: AbortSignal): Promise<void> {
    const entry = this.modelMeta.get(modelId);
    if (!entry) throw new InferenceError('model_not_installed');
    if (this.activeDownloads.has(modelId)) {
      throw new Error(`Already downloading model: ${modelId}`);
    }

    const components = this.componentsOf(entry);
    const operation = components
      ? this.downloadMultiComponent(modelId, components, signal)
      : this.downloadSingle(modelId, entry, signal);
    const active = this.activeDownloads.get(modelId);
    if (active) active.completion = operation;
    return operation;
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
    const publication: Array<{ stagedId: string; modelId: string }> = [];

    try {
      for (const component of components) {
        if (combinedSignal.aborted) {
          throw new InferenceError('download_interrupted');
        }

        const componentEntry: ModelManifestEntry = {
          id: this.componentStageId(modelId, component.id),
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
          ...(component.upstreamChecksum ? { upstreamChecksum: component.upstreamChecksum } : {}),
          ...(component.repair ? { repair: component.repair } : {}),
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

        const stagedId = componentEntry.id;
        const expectedChecksum = component.checksum?.toLowerCase();
        if (!expectedChecksum) {
          throw new InferenceError('model_download_failed', undefined, {
            message: `Model component ${component.id} has no checksum.`,
            technical: 'A multipart installation cannot publish without every component SHA-256.',
          });
        }
        let staged = await this.storage.statInstalled(stagedId);
        const reusable =
          staged !== null &&
          (component.sizeBytes <= 0 || staged.sizeBytes === component.sizeBytes) &&
          staged.sha256 === expectedChecksum;
        if (!reusable) {
          if (staged) await this.storage.deleteInstalled(stagedId);
          await this.downloadSingle(stagedId, componentEntry, combinedSignal, modelId);
          staged = await this.storage.statInstalled(stagedId);
        }
        if (
          !staged ||
          (component.sizeBytes > 0 && staged.sizeBytes !== component.sizeBytes) ||
          staged.sha256 !== expectedChecksum
        ) {
          await this.storage.deleteInstalled(stagedId);
          throw new InferenceError('checksum_mismatch', undefined, {
            technical: `Component ${component.id} did not match its declared size and SHA-256.`,
          });
        }
        publication.push({ stagedId, modelId: component.id });

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

      await this.storage.publishInstalledBatch(publication);
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

    let responseEtag: string | null = null;
    try {
      const remoteUrl = entry.remoteUrl;
      if (!remoteUrl) {
        throw new InferenceError('model_not_installed', undefined, {
          message: `Model ${modelId} has no download URL.`,
          userMessage: `"${entry.name}" is not available for download yet.`,
        });
      }

      const existingPartial = await this.loadPartialCompat(modelId);
      const expectedSizeBytes = expectedDownloadSize(entry.sizeBytes);
      let partialLoaded = 0;
      let partialChunks: Uint8Array[] = [];
      let storedEtag: string | null = null;
      let partialArtifact: ModelArtifactHandle | undefined;
      const partialSize =
        existingPartial?.bytes?.byteLength ?? existingPartial?.artifact?.metadata.sizeBytes ?? 0;

      if (
        existingPartial &&
        existingPartial.url === remoteUrl &&
        existingPartial.loaded === partialSize &&
        partialSize > 0 &&
        (!expectedSizeBytes || partialSize < expectedSizeBytes)
      ) {
        if (existingPartial.bytes) partialChunks = [existingPartial.bytes];
        partialArtifact = existingPartial.artifact;
        partialLoaded = partialSize;
        storedEtag = existingPartial.etag;
      } else if (existingPartial) {
        await this.deletePartialCompat(modelId);
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
          await this.deletePartialCompat(modelId);
          partialLoaded = 0;
          partialChunks = [];
          partialArtifact = undefined;
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
            combinedSignal,
            {
              entry,
              expectedSizeBytes,
              responseEtag: retryResponse.headers.get('etag'),
            },
            undefined,
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

      responseEtag = response.headers.get('etag');
      const isRangeResponse = response.status === 206;

      if (isRangeResponse && partialLoaded > 0) {
        const contentRange = parseContentRange(response.headers.get('content-range'));
        const rangeMatches =
          contentRange !== null &&
          contentRange.start === partialLoaded &&
          contentRange.end >= partialLoaded &&
          (contentRange.total === null ||
            expectedSizeBytes === undefined ||
            contentRange.total === expectedSizeBytes);
        if (!rangeMatches || !storedEtag || !responseEtag || storedEtag !== responseEtag) {
          await response.body?.cancel();
          await this.deletePartialCompat(modelId);
          partialChunks = [];
          partialArtifact = undefined;
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
            combinedSignal,
            {
              entry,
              expectedSizeBytes,
              responseEtag: freshResponse.headers.get('etag'),
            },
            undefined,
          );
          return;
        }
      } else if (isRangeResponse) {
        throw new InferenceError('model_download_failed', undefined, {
          technical: 'Server returned 206 without a matching resumable range.',
        });
      } else if (partialLoaded > 0) {
        await this.deletePartialCompat(modelId);
        partialChunks = [];
        partialArtifact = undefined;
        partialLoaded = 0;
      }

      await this.streamDownload(
        modelId,
        notifyId,
        response,
        partialChunks,
        partialLoaded,
        combinedSignal,
        { entry, expectedSizeBytes, responseEtag },
        partialArtifact,
      );
    } catch (error) {
      if (!parentModelId) {
        this.activeDownloads.delete(modelId);
      }
      if (combinedSignal.aborted) {
        if (!parentModelId) this.setState(modelId, 'unavailable');
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
    combinedSignal: AbortSignal,
    options: StreamDownloadOptions = {},
    partialArtifact?: ModelArtifactHandle,
  ): Promise<void> {
    const entry = options.entry ?? this.modelMeta.get(modelId);
    const manifestEntry = this.manifestEntries.get(modelId);
    const remoteUrl = entry?.remoteUrl ?? manifestEntry?.remoteUrl ?? '';

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('text/html')) {
      throw new InferenceError('model_download_failed', undefined, {
        message: 'Model server returned an HTML document instead of an artifact.',
        technical: `Unexpected content-type ${contentType}`,
      });
    }

    const expectedSizeBytes = expectedDownloadSize(options.expectedSizeBytes);
    const contentRange = parseContentRange(response.headers.get('content-range'));
    if (
      response.status === 206 &&
      (!contentRange || contentRange.start !== partialLoaded || contentRange.end < partialLoaded)
    ) {
      throw new InferenceError('model_download_failed', undefined, {
        technical: 'A partial response did not identify the requested byte range.',
      });
    }
    const contentLengthHeader = response.headers.get('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : undefined;
    if (
      contentLength !== undefined &&
      (!Number.isSafeInteger(contentLength) ||
        contentLength < 0 ||
        (expectedSizeBytes !== undefined &&
          response.status === 200 &&
          contentLength > expectedSizeBytes) ||
        (expectedSizeBytes !== undefined &&
          response.status === 206 &&
          partialLoaded + contentLength > expectedSizeBytes))
    ) {
      throw new InferenceError('model_download_failed', undefined, {
        technical: `Declared response length is invalid for ${modelId}.`,
      });
    }

    const reader = response.body?.getReader();
    if (!reader)
      throw new InferenceError('model_download_failed', undefined, {
        message: 'Response body not readable.',
      });

    const total =
      contentRange?.total ??
      (contentLength !== undefined ? partialLoaded + contentLength : (expectedSizeBytes ?? 0));
    if (expectedSizeBytes !== undefined && total > 0 && total !== expectedSizeBytes) {
      await reader.cancel();
      throw new InferenceError('model_download_failed', undefined, {
        technical: `Expected ${expectedSizeBytes} bytes, server declared ${total}.`,
      });
    }

    let loaded = partialLoaded;
    const needsRepair = options.entry?.repair === 'sam2-empty-value-info';
    const chunks: Uint8Array[] = needsRepair ? [...partialChunks] : [];
    const upstreamChecksum =
      options.entry?.upstreamChecksum ?? options.entry?.checksum ?? undefined;
    let writer: Awaited<ReturnType<ModelStorage['beginInstalledWrite']>> | null = null;
    let writerPaused = false;
    const startTime = performance.now();

    try {
      if (!needsRepair) {
        writer = await this.storage.beginInstalledWrite(modelId, {
          expectedSizeBytes,
          expectedSha256: upstreamChecksum || undefined,
        });
        if (partialArtifact) {
          const partialReader = partialArtifact.openStream().getReader();
          let restored = 0;
          try {
            while (true) {
              const { done, value } = await partialReader.read();
              if (done) break;
              await writer.write(value);
              restored += value.byteLength;
            }
          } finally {
            await partialReader.cancel().catch(() => undefined);
          }
          if (restored !== partialLoaded) {
            throw new InferenceError('model_download_failed', undefined, {
              technical: `Stored partial length mismatch: expected ${partialLoaded}, read ${restored}.`,
            });
          }
        } else {
          for (const chunk of partialChunks) await writer.write(chunk);
        }
      } else if (partialArtifact) {
        chunks.push(new Uint8Array(await partialArtifact.arrayBuffer()));
      }

      while (true) {
        if (combinedSignal.aborted) {
          await reader.cancel();
          if (writer && writer.bytesWritten > 0) {
            await writer.pause({ url: remoteUrl, etag: options.responseEtag ?? null });
            writerPaused = true;
          } else if (writer) {
            await writer.abort();
          }
          throw new InferenceError('download_interrupted');
        }

        const { done, value } = await reader.read();
        if (done) break;

        if (expectedSizeBytes !== undefined && loaded > expectedSizeBytes - value.length) {
          await reader.cancel();
          throw new InferenceError('model_download_failed', undefined, {
            technical: `Downloaded more than the declared ${expectedSizeBytes} bytes.`,
          });
        }
        if (writer) await writer.write(value);
        if (needsRepair) chunks.push(value.slice());
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

      if (
        (expectedSizeBytes !== undefined && loaded !== expectedSizeBytes) ||
        (total > 0 && loaded !== total)
      ) {
        throw new InferenceError('model_download_failed', undefined, {
          technical: `Incomplete artifact: received ${loaded} of ${expectedSizeBytes ?? total} bytes.`,
        });
      }

      this.setState(notifyId, 'verifying');

      if (needsRepair) {
        const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        let bytes = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        if (upstreamChecksum) {
          const upstream = await this.sha256Hex(bytes.buffer);
          const expectedUpstream = upstreamChecksum.toLowerCase();
          if (upstream !== expectedUpstream) {
            throw new InferenceError('checksum_mismatch', undefined, {
              technical: `Expected ${expectedUpstream}, got ${upstream}`,
            });
          }
        }

        const { repairSam2EncoderGraph } = await import('../models/sam2GraphRepair');
        bytes = new Uint8Array(repairSam2EncoderGraph(bytes));
        if (options.entry?.checksum) {
          const repairedHash = await this.sha256Hex(bytes.buffer);
          if (repairedHash !== options.entry.checksum.toLowerCase()) {
            throw new InferenceError('checksum_mismatch', undefined, {
              technical: `Repaired artifact checksum mismatch: expected ${options.entry.checksum}, got ${repairedHash}`,
            });
          }
        }

        this.setState(notifyId, 'installing');
        writer = await this.storage.beginInstalledWrite(modelId, {
          expectedSizeBytes: bytes.byteLength,
          expectedSha256: options.entry?.checksum ?? undefined,
        });
        for (let offset = 0; offset < bytes.length; offset += INSTALL_WRITE_CHUNK_BYTES) {
          await writer.write(
            bytes.subarray(offset, Math.min(offset + INSTALL_WRITE_CHUNK_BYTES, bytes.length)),
          );
        }
      }

      if (!needsRepair) this.setState(notifyId, 'installing');
      await writer?.commit();
      await this.deletePartialCompat(modelId).catch(() => undefined);

      if (!this.isComponentDownload(notifyId, modelId)) {
        this.activeDownloads.delete(modelId);
        this.setState(notifyId, 'ready');
      } else {
        this.setState(notifyId, 'installing');
      }
    } catch (error) {
      if (!this.isComponentDownload(notifyId, modelId)) {
        this.activeDownloads.delete(notifyId);
      }
      if (combinedSignal.aborted) {
        if (writer && !writerPaused && writer.bytesWritten > 0) {
          await writer.pause({ url: remoteUrl, etag: options.responseEtag ?? null });
          writerPaused = true;
        } else if (writer && !writerPaused) {
          await writer.abort();
        }
        if (needsRepair && chunks.length > 0) {
          await this.savePartialFromChunks(
            modelId,
            chunks,
            remoteUrl,
            loaded,
            options.responseEtag ?? null,
          );
        }
        this.setState(notifyId, 'unavailable');
        throw new InferenceError('download_interrupted');
      }
      if (writer && !writerPaused) {
        const details = error instanceof InferenceError ? error : null;
        const isCorrupt = details?.code === 'checksum_mismatch';
        const invalidLength =
          details?.code === 'model_download_failed' &&
          /Expected .* bytes, received/.test(details.technical);
        if (isCorrupt || invalidLength) {
          await writer.abort();
          await this.deletePartialCompat(modelId).catch(() => undefined);
        } else if (writer.bytesWritten > 0) {
          await writer.pause({ url: remoteUrl, etag: options.responseEtag ?? null });
          writerPaused = true;
        } else {
          await writer.abort();
        }
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
    }
  }

  async pauseDownload(modelId: string): Promise<void> {
    const active = this.activeDownloads.get(modelId);
    if (!active) return;
    active.controller.abort();
    await active.completion?.catch(() => undefined);
  }

  async resumeDownload(modelId: string, signal?: AbortSignal): Promise<void> {
    return this.startDownload(modelId, signal);
  }

  async deleteModel(modelId: string): Promise<void> {
    this.cancelDownload(modelId);
    await this.activeDownloads.get(modelId)?.completion?.catch(() => undefined);
    await this.storage.deleteInstalled(modelId);
    await this.deletePartialCompat(modelId);
    this.stateCache.delete(modelId);

    const entry = this.modelMeta.get(modelId);
    if (entry?.components) {
      for (const comp of entry.components) {
        await this.storage.deleteInstalled(comp.id);
        await this.deletePartialCompat(comp.id);
        const stagedId = this.componentStageId(modelId, comp.id);
        await this.storage.deleteInstalled(stagedId);
        await this.deletePartialCompat(stagedId);
      }
    }
  }

  async getInstalledBytes(modelId: string): Promise<Uint8Array | null> {
    const buffer = await this.storage.loadInstalled(modelId);
    return buffer ? new Uint8Array(buffer) : null;
  }

  async getInstalledSize(modelId: string): Promise<number | null> {
    return (await this.storage.statInstalled(modelId))?.sizeBytes ?? null;
  }

  async getTotalStorageUsed(): Promise<number> {
    const ids = await this.storage.listInstalled();
    let total = 0;
    for (const id of ids) {
      const metadata = await this.storage.statInstalled(id);
      if (metadata) total += metadata.sizeBytes;
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

  private async loadPartialCompat(modelId: string): Promise<PartialSource | null> {
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

    const metadata = await this.storage.getPartialMetadata(modelId);
    if (!metadata) return null;
    const partial = await this.storage.openPartialArtifact(modelId);
    if (!partial) return null;
    return {
      artifact: partial.artifact,
      url: metadata.url,
      etag: metadata.etag,
      loaded: metadata.loaded,
    };
  }

  private async deletePartialCompat(modelId: string): Promise<void> {
    await this.storage.deletePartial(modelId);
    try {
      localStorage.removeItem(`strata-model-partial-${modelId}`);
      localStorage.removeItem(`varve-model-partial-${modelId}`);
    } catch {}
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
    etag: string | null,
  ): Promise<void> {
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    await this.savePartialCompat(modelId, bytes, { url, etag, loaded: totalLoaded });
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
