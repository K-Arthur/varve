import { getUpscaleModel } from '../upscaleModels';
import { fetchWithTimeout } from './fetchWithTimeout';
import { getManifestEntry, verifyModelChecksum } from './modelManifest';
import {
  deleteModelBlob,
  deletePartialDownload,
  hasModelBlob,
  loadModelBlob,
  loadPartialDownload,
  ModelStorageQuotaError,
  type PartialDownloadRecord,
  saveModelBlob,
  savePartialDownload,
} from './modelStore';
import type { ModelState } from './types';
import { AVAILABLE_MODELS } from './types';

// Static fallback metadata for models not covered by AVAILABLE_MODELS or
// upscaleModels.ts. These mirror entries from modelCatalog.ts FALLBACK_ENTRIES
// so the download infrastructure can resolve remoteUrl and size without waiting
// for an async manifest fetch.
const EXTENDED_MODEL_META: Record<string, { remoteUrl: string; name: string; size: number }> = {
  scunet: {
    // Verified 2026-07-21: Heliosoph/scunet-onnx on Hugging Face, Apache-2.0.
    // Fully convolutional blind denoising. Total ~77MB (graph + external weights).
    remoteUrl:
      'https://huggingface.co/Heliosoph/scunet-onnx/resolve/main/scunet_color_real_psnr.onnx',
    name: 'SCUNet Denoise',
    size: 76_936_854,
  },
  'paddleocr-det-v4': {
    // Verified 2026-07-21: deepghs/paddleocr PP-OCRv4 detector (Apache-2.0).
    remoteUrl:
      'https://huggingface.co/deepghs/paddleocr/resolve/main/det/ch_PP-OCRv4_det/model.onnx',
    name: 'PaddleOCR v4 Detection',
    size: 4_745_517,
  },
  'paddleocr-rec-v4': {
    // Verified 2026-07-21: deepghs/paddleocr PP-OCRv4 recognition (Apache-2.0).
    remoteUrl:
      'https://huggingface.co/deepghs/paddleocr/resolve/main/rec/ch_PP-OCRv4_rec/model.onnx',
    name: 'PaddleOCR v4 Recognition',
    size: 10_826_336,
  },
  'depth-anything-v2-small': {
    // Verified: onnx-community/depth-anything-v2-small on Hugging Face
    // (Apache-2.0), INT8 variant (~27MB) for a smaller one-time download.
    remoteUrl:
      'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_int8.onnx',
    name: 'Depth-Anything-V2 Small (INT8)',
    size: 27_300_000,
  },
  'sam2-hiera-tiny': {
    remoteUrl: '',
    name: 'SAM2 Tiny',
    size: 39_000_000,
  },
  'sam2-hiera-small': {
    remoteUrl: '',
    name: 'SAM2 Small',
    size: 92_000_000,
  },
  'tr-ocr-base-printed': {
    remoteUrl: '',
    name: 'TrOCR (Printed Text)',
    size: 340_000_000,
  },
};

function modelMeta(
  modelId: string,
): { remoteUrl: string; name?: string; size: number } | undefined {
  const bg = AVAILABLE_MODELS.find((m) => m.id === modelId);
  if (bg) return bg;
  const up = getUpscaleModel(modelId);
  if (up) return { remoteUrl: up.remoteUrl, name: up.name, size: up.size };
  const ext = EXTENDED_MODEL_META[modelId];
  if (ext) return ext;
  return undefined;
}

/** How long a probe HEAD request for a model path is allowed to take. */
const MODEL_PATH_PROBE_TIMEOUT = 5_000;
/** How long a full model-file download is allowed to take. */
const MODEL_DOWNLOAD_TIMEOUT = 900_000;

const STATE_KEY = 'strata-bg-model-state';

type StateListener = (state: ModelState, modelId: string) => void;

function isBrowserEnv(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

/**
 * Whether a probe response is an HTML document rather than a model file.
 *
 * Only `text/html` is treated as a miss: a correctly served `.onnx` may carry
 * an empty or generic content type, so requiring a specific one would reject
 * genuinely present models.
 */
function isHtmlResponse(response: Response): boolean {
  // Headers are absent on some non-standard/stubbed responses; a response we
  // cannot inspect is not positively HTML, so it must not be rejected here.
  return (response.headers?.get('content-type') ?? '').toLowerCase().includes('text/html');
}

/** First line of a Git LFS pointer file, per the LFS v1 spec. */
const LFS_POINTER_MAGIC = 'version https://git-lfs.github.com/spec/v1';
/** Pointer files are a few hundred bytes; real models are megabytes. */
const LFS_POINTER_MAX_BYTES = 1024;

/**
 * Whether a served `.onnx` is really a Git LFS pointer stub.
 *
 * `*.onnx` is LFS-tracked in this repo, so a checkout without the objects
 * fetched leaves a ~130-byte text stub where the model should be. The stub is a
 * real file that serves 200 with a non-HTML type, so every existence check
 * passes and the failure only surfaces later as an opaque ONNX parse error.
 * Treating a stub as "not installed" lets the normal download path recover.
 *
 * Only bodies small enough to *be* a pointer are read, so this never pulls a
 * real multi-megabyte model over the wire.
 */
async function isGitLfsPointer(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      url,
      { headers: { Range: `bytes=0-${LFS_POINTER_MAX_BYTES - 1}` }, signal },
      MODEL_PATH_PROBE_TIMEOUT,
    );
    if (!response.ok || typeof response.text !== 'function') return false;
    const text = await response.text();
    return (
      typeof text === 'string' && text.slice(0, LFS_POINTER_MAGIC.length) === LFS_POINTER_MAGIC
    );
  } catch {
    return false;
  }
}

/**
 * Whether a probe response is too small to be a model, and so worth reading to
 * check for an LFS stub. Absent `content-length` (chunked responses) it is
 * cheaper to check than to risk trusting a stub.
 */
/**
 * Whether a response body plausibly *is* a model, judged from headers alone so
 * the stream stays unread for the caller.
 *
 * Rejects HTML: a dev server with SPA history fallback answers a missing local
 * model with 200 + the index document, which would otherwise be downloaded and
 * then reported as a checksum failure. Size is deliberately not used as a
 * signal — the body cannot be inspected without consuming the stream the caller
 * needs, and an LFS stub reaching this point is still caught by the checksum.
 */
function looksLikeModelPayload(response: Response): boolean {
  return !isHtmlResponse(response);
}

function couldBeLfsPointer(response: Response): boolean {
  const length = response.headers?.get('content-length') ?? null;
  if (length === null) return true;
  const bytes = Number.parseInt(length, 10);
  return !Number.isFinite(bytes) || bytes <= LFS_POINTER_MAX_BYTES;
}

class ModelLoader {
  private state: ModelState = 'unavailable';
  private currentModelId = '';
  private listeners: StateListener[] = [];
  /** Object URL created from an IndexedDB-backed blob, revoked on next resolve/clear. */
  private activeBlobUrl: string | null = null;

  private loadState() {
    try {
      const stored = localStorage.getItem(STATE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.state = parsed.state as ModelState;
        this.currentModelId = parsed.modelId ?? '';
      }
    } catch {
      // ignore
    }
  }

  private saveState() {
    try {
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({ state: this.state, modelId: this.currentModelId }),
      );
    } catch {
      // ignore
    }
  }

  constructor() {
    this.loadState();
  }

  getState(): ModelState {
    return this.state;
  }

  getCurrentModelId(): string {
    return this.currentModelId;
  }

  subscribe(fn: StateListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private notify() {
    for (const fn of this.listeners) {
      fn(this.state, this.currentModelId);
    }
  }

  async getModelPath(modelId: string, signal?: AbortSignal): Promise<string | null> {
    const entry = await getManifestEntry(modelId, signal);
    const bundled = entry?.localPath ?? `/models/${modelId}.onnx`;

    // Bundled models ship with the app, so the manifest is trusted rather than
    // HEAD-probed (that can fail or hang in Vite dev / custom server setups).
    // The one thing still worth checking is an LFS stub: a checkout without the
    // objects fetched leaves a text file that would otherwise be handed to the
    // ONNX runtime as if it were a model.
    if (entry?.bundled) {
      if (typeof fetch !== 'undefined' && (await isGitLfsPointer(bundled, signal))) {
        return null;
      }
      return bundled;
    }

    try {
      if (typeof fetch !== 'undefined') {
        const head = await fetchWithTimeout(
          bundled,
          { method: 'HEAD', signal },
          MODEL_PATH_PROBE_TIMEOUT,
        );
        // A dev server with SPA history fallback answers *every* unknown path
        // with 200 + the index HTML document, so `head.ok` alone reports a
        // missing model as installed. That false positive sends callers down
        // the native inference path, which then fails deep in the backend with
        // a "model not found at <path>" error instead of the actionable
        // "not downloaded" message. Real model responses are never HTML.
        if (head.ok && !isHtmlResponse(head)) {
          if (couldBeLfsPointer(head) && (await isGitLfsPointer(bundled, signal))) {
            // An un-fetched LFS stub — fall through to the download path.
          } else {
            return bundled;
          }
        }
      }
    } catch {
      // offline or blocked — fall through
    }

    // Not bundled: look for a model the user explicitly downloaded (stored
    // as a blob in IndexedDB, since ONNX models can be hundreds of MB —
    // far past localStorage's ~5MB quota). Resolve it to an object URL so
    // `InferenceSession.create()` (which expects a URL or byte buffer) can
    // fetch it like any other model source.
    if (isBrowserEnv()) {
      try {
        const blob = await loadModelBlob(modelId);
        if (blob) {
          if (this.activeBlobUrl) {
            URL.revokeObjectURL(this.activeBlobUrl);
          }
          this.activeBlobUrl = URL.createObjectURL(blob);
          return this.activeBlobUrl;
        }
      } catch {
        // IndexedDB unavailable/blocked — fall through
      }
    }

    return null;
  }

  /** Whether a downloaded model blob exists in IndexedDB, independent of in-memory state. */
  async hasDownloadedBlob(modelId: string): Promise<boolean> {
    if (!isBrowserEnv()) return false;
    try {
      return await hasModelBlob(modelId);
    } catch {
      return false;
    }
  }

  /**
   * Whether a model is reachable (bundled asset or IndexedDB blob or native Tauri).
   * Checks the bg-removal native path first, then falls through to the generic
   * model-path resolution that covers all model types (scunet, depth, sam2, …).
   */
  async isModelAvailable(modelId: string, signal?: AbortSignal): Promise<boolean> {
    if (AVAILABLE_MODELS.some((model) => model.id === modelId)) {
      const { getNativeBackgroundRemovalModelStatus } = await import('./providers/tauriProvider');
      const native = await getNativeBackgroundRemovalModelStatus(modelId);
      if (native?.runtimeReady && native.installed) return true;
      // BiRefNet is deliberately native-only on Tauri when no accelerated
      // web EP is available: its bare-WASM path can exceed wasm32 memory and
      // abort the webview. An old IndexedDB copy must not make the UI claim
      // Quality is runnable when the native model has not been installed.
      if (native && (modelId.startsWith('birefnet-') || modelId === 'isnet-general-use')) {
        return false;
      }
    }
    const path = await this.getModelPath(modelId, signal);
    if (path === null) return false;

    // A split model is only usable with its external weights. Reporting ready
    // on the graph alone would skip the download prompt and fail later at
    // session creation instead.
    const entry = await getManifestEntry(modelId, signal);
    if (entry?.remoteDataUrl && isBrowserEnv()) {
      return this.hasDownloadedBlob(this.externalDataId(modelId));
    }
    return true;
  }

  /**
   * Reconcile in-memory state with persisted storage on startup.
   * IndexedDB holds the actual model bytes; localStorage only tracks metadata.
   */
  async syncFromStorage(signal?: AbortSignal): Promise<void> {
    if (this.state === 'downloading') return;

    if (this.currentModelId && this.state === 'ready') {
      const stillThere = await this.isModelAvailable(this.currentModelId, signal);
      if (!stillThere) {
        this.state = 'unavailable';
        this.currentModelId = '';
        this.saveState();
        this.notify();
      }
      return;
    }

    for (const model of AVAILABLE_MODELS) {
      if (await this.isModelAvailable(model.id, signal)) {
        this.state = 'ready';
        this.currentModelId = model.id;
        this.saveState();
        this.notify();
        return;
      }
    }
  }

  /** List models with install status and approximate storage use (IndexedDB blobs only). */
  async listInstalledModels(signal?: AbortSignal): Promise<
    Array<{
      id: string;
      name: string;
      size: number;
      installed: boolean;
      source: 'bundled' | 'downloaded' | 'none';
    }>
  > {
    await this.syncFromStorage(signal);
    const result: Array<{
      id: string;
      name: string;
      size: number;
      installed: boolean;
      source: 'bundled' | 'downloaded' | 'none';
    }> = [];

    for (const model of AVAILABLE_MODELS) {
      let source: 'bundled' | 'downloaded' | 'none' = 'none';
      let installed = false;

      if (model.id.startsWith('birefnet-') || model.id === 'isnet-general-use') {
        const { getNativeBackgroundRemovalModelStatus } = await import('./providers/tauriProvider');
        const native = await getNativeBackgroundRemovalModelStatus(model.id);
        if (native) {
          result.push({
            id: model.id,
            name: model.name,
            size: model.size,
            installed: native.runtimeReady && native.installed,
            source: native.runtimeReady && native.installed ? 'downloaded' : 'none',
          });
          continue;
        }
      }

      try {
        if (typeof fetch !== 'undefined') {
          const entry = await getManifestEntry(model.id, signal);
          const bundled = entry?.localPath ?? `/models/${model.id}.onnx`;
          const head = await fetchWithTimeout(
            bundled,
            { method: 'HEAD', signal },
            MODEL_PATH_PROBE_TIMEOUT,
          );
          if (head.ok) {
            installed = true;
            source = 'bundled';
          }
        }
      } catch {
        // offline — fall through to IndexedDB check
      }

      if (!installed && (await this.hasDownloadedBlob(model.id))) {
        installed = true;
        source = 'downloaded';
      }

      if (!installed && AVAILABLE_MODELS.some((candidate) => candidate.id === model.id)) {
        const { getNativeBackgroundRemovalModelStatus } = await import('./providers/tauriProvider');
        const native = await getNativeBackgroundRemovalModelStatus(model.id);
        if (native?.installed) {
          installed = true;
          source = 'downloaded';
        }
      }

      result.push({
        id: model.id,
        name: model.name,
        size: model.size,
        installed,
        source,
      });
    }
    return result;
  }

  async deleteModel(modelId: string): Promise<void> {
    if (AVAILABLE_MODELS.some((model) => model.id === modelId)) {
      const { deleteNativeBackgroundRemovalModel } = await import('./providers/tauriProvider');
      await deleteNativeBackgroundRemovalModel(modelId);
    }
    if (isBrowserEnv()) {
      await deleteModelBlob(modelId);
      await deletePartialDownload(modelId).catch(() => {});
    }
    if (this.currentModelId === modelId) {
      if (this.activeBlobUrl) {
        URL.revokeObjectURL(this.activeBlobUrl);
        this.activeBlobUrl = null;
      }
      this.state = 'unavailable';
      this.currentModelId = '';
      this.saveState();
      this.notify();
    }
  }

  /** Resolve download URL: manifest bundled path first; remote only via explicit download. */
  async resolveDownloadSources(
    modelId: string,
    signal?: AbortSignal,
  ): Promise<{ local: string; remote: string; bundled: boolean } | null> {
    const entry = await getManifestEntry(modelId, signal);
    const model = modelMeta(modelId);
    if (!model && !entry) return null;
    return {
      local: entry?.localPath ?? `/models/${modelId}.onnx`,
      remote: entry?.remoteUrl ?? model?.remoteUrl ?? '',
      bundled: entry?.bundled ?? false,
    };
  }

  /** Storage id for a model's external-weights sidecar. */
  private externalDataId(modelId: string): string {
    return `${modelId}__externaldata`;
  }

  /** One authoritative acquisition per model id; concurrent callers coalesce. */
  private activeDownloads = new Map<string, Promise<void>>();

  /**
   * Fetch and store a model's external-weights sidecar, if it declares one.
   *
   * ONNX keeps tensor data outside the graph once the model exceeds protobuf's
   * 2GB ceiling (and some publishers split smaller models the same way). The
   * runtime resolves it by the filename recorded inside the graph, so the file
   * is stored under a derived id and re-presented under that exact name at
   * session creation.
   */
  private async downloadExternalData(
    modelId: string,
    manifestEntry: { remoteDataUrl?: string; filename?: string } | null | undefined,
    onProgress?: (loaded: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const dataUrl = manifestEntry?.remoteDataUrl;
    if (!dataUrl || !isBrowserEnv()) return;
    const response = await fetchWithTimeout(dataUrl, { signal }, MODEL_DOWNLOAD_TIMEOUT);
    if (!response.ok) {
      throw new Error(
        `Model ${modelId} weights (${dataUrl.split('/').pop()}) failed to download: ${response.statusText}`,
      );
    }
    const total = Number.parseInt(response.headers.get('content-length') ?? '', 10);
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    if (reader) {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel();
          throw new Error('Download cancelled');
        }
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (Number.isFinite(total)) onProgress?.(loaded, total);
      }
    } else {
      chunks.push(new Uint8Array(await response.arrayBuffer()));
    }
    const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    await saveModelBlob(
      this.externalDataId(modelId),
      new Blob([bytes], { type: 'application/octet-stream' }),
    );
  }

  /**
   * Resolve a model's external-weights sidecar for session creation.
   *
   * `path` is the name the graph refers to internally; `url` is a blob URL the
   * ONNX runtime can read. Returns null when the model has no sidecar.
   */
  async getModelExternalData(
    modelId: string,
    signal?: AbortSignal,
  ): Promise<{ path: string; url: string } | null> {
    const entry = await getManifestEntry(modelId, signal);
    const dataUrl = entry?.remoteDataUrl;
    if (!dataUrl) return null;
    const path = dataUrl.split('/').pop();
    if (!path) return null;
    if (!isBrowserEnv()) return null;
    const blob = await loadModelBlob(this.externalDataId(modelId)).catch(() => null);
    if (!blob) return null;
    return { path, url: URL.createObjectURL(blob) };
  }

  async downloadModel(
    modelId: string,
    onProgress?: (loaded: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const active = this.activeDownloads.get(modelId);
    if (active) return active;

    const operation = this.downloadModelInternal(modelId, onProgress, signal);
    this.activeDownloads.set(modelId, operation);
    try {
      await operation;
    } finally {
      if (this.activeDownloads.get(modelId) === operation) {
        this.activeDownloads.delete(modelId);
      }
    }
  }

  private async downloadModelInternal(
    modelId: string,
    onProgress?: (loaded: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    let model = modelMeta(modelId);
    if (!model) {
      // Not a background-removal or upscale model — fall back to the
      // unified catalog (manifest.json) so generic inference models
      // (depth, denoise, segmentation, etc.) share this same download,
      // checksum, resume, and IndexedDB-caching pipeline instead of each
      // feature hand-rolling its own fetch loop.
      const entry = await getManifestEntry(modelId, signal);
      if (entry) {
        model = { remoteUrl: entry.remoteUrl, name: entry.filename, size: 0 };
      }
    }
    if (!model) {
      throw new Error(`Unknown model: ${modelId}`);
    }

    this.state = 'downloading';
    this.currentModelId = modelId;
    this.notify();
    this.saveState();

    let remoteUrl = '';
    let partialChunks: Uint8Array[] = [];
    let partialLoaded = 0;
    let downloadChunks: Uint8Array[] = [];
    let storedEtag: string | null = null;

    try {
      if (AVAILABLE_MODELS.some((candidate) => candidate.id === modelId)) {
        const { downloadNativeBackgroundRemovalModel, isTauriRuntime } = await import(
          './providers/tauriProvider'
        );
        if (isTauriRuntime()) {
          await downloadNativeBackgroundRemovalModel(modelId, onProgress, signal);
          // Native Quality supersedes legacy IndexedDB storage in desktop
          // builds. Remove any old browser-side copy after the native file
          // has passed Rust's size and SHA-256 validation.
          if (isBrowserEnv()) {
            await deleteModelBlob(modelId).catch(() => {});
            await deletePartialDownload(modelId).catch(() => {});
          }
          this.state = 'ready';
          this.notify();
          this.saveState();
          return;
        }
      }

      // Refuse downloads for models whose manifest explicitly declares no
      // checksum — integrity verification is impossible and a corrupt or
      // malicious file would go undetected. If the manifest is unreachable
      // (offline, test environment) we allow the download through; the
      // post-download checksum verification will skip when no hash is known.
      const manifestEntry = await getManifestEntry(modelId, signal);
      if (manifestEntry && !manifestEntry.sha256) {
        throw new Error(
          `Model ${modelId} has no SHA-256 checksum and cannot be verified. ` +
            'This model is not available for download until its integrity metadata is published. ' +
            'Use a supported model (u2netp, isnet-general-use, birefnet-general-lite) instead.',
        );
      }

      const sources = await this.resolveDownloadSources(modelId, signal);
      const localPath = sources?.local ?? `/models/${modelId}.onnx`;
      remoteUrl = sources?.remote ?? model.remoteUrl;

      const existingPartial =
        isBrowserEnv() && remoteUrl ? await loadPartialDownload(modelId) : null;
      if (
        existingPartial &&
        existingPartial.meta.url === remoteUrl &&
        existingPartial.bytes.length > 0
      ) {
        partialChunks = [existingPartial.bytes];
        partialLoaded = existingPartial.bytes.length;
      } else if (existingPartial) {
        await deletePartialDownload(modelId);
      }

      let response: Response | null = null;
      try {
        response = await fetchWithTimeout(localPath, { signal }, MODEL_DOWNLOAD_TIMEOUT);
      } catch (_err) {
        if (signal?.aborted) throw new Error('Download cancelled');
        response = null;
      }
      // A local hit is only real if it looks like a model. A dev server with SPA
      // history fallback returns 200 + the index HTML for a missing path, and an
      // un-fetched Git LFS stub is a ~130-byte text file — both would be
      // "downloaded" here and then fail checksum verification, reporting a
      // corrupt-download error for a file that was simply never there. Falling
      // through to the remote URL is the correct recovery.
      if (response?.ok && !looksLikeModelPayload(response)) {
        if (typeof response.body?.cancel === 'function') {
          void response.body.cancel().catch(() => {});
        }
        response = null;
      }
      if (!response?.ok) {
        if (!remoteUrl) {
          throw new Error(`Model ${modelId} is not bundled; download explicitly from settings.`);
        }
        const headers: Record<string, string> = {};
        if (partialLoaded > 0) {
          headers.Range = `bytes=${partialLoaded}-`;
        }
        response = await fetchWithTimeout(remoteUrl, { signal, headers }, MODEL_DOWNLOAD_TIMEOUT);
      }

      if (!response.ok) {
        throw new Error(`Failed to download model: ${response.statusText}`);
      }

      const responseEtag = response.headers.get('etag');
      storedEtag = responseEtag ?? existingPartial?.meta.etag ?? null;
      const isRangeResponse = response.status === 206;

      if (isRangeResponse && partialLoaded > 0) {
        if (
          existingPartial?.meta.etag &&
          responseEtag &&
          existingPartial.meta.etag !== responseEtag
        ) {
          await deletePartialDownload(modelId);
          partialChunks = [];
          partialLoaded = 0;
          response = await fetchWithTimeout(remoteUrl, { signal }, MODEL_DOWNLOAD_TIMEOUT);
          if (!response.ok) {
            throw new Error(`Failed to download model: ${response.statusText}`);
          }
        }
      } else if (partialLoaded > 0) {
        await deletePartialDownload(modelId);
        partialChunks = [];
        partialLoaded = 0;
      }

      const contentLength = response.headers.get('content-length');
      const contentRangeTotal = response.headers.get('content-range')?.split('/')[1];
      const total = contentRangeTotal
        ? parseInt(contentRangeTotal, 10)
        : contentLength
          ? partialLoaded + parseInt(contentLength, 10)
          : model.size;
      let loaded = partialLoaded;

      const reader = response.body?.getReader();
      downloadChunks = [...partialChunks];

      while (true) {
        if (signal?.aborted) {
          await reader?.cancel();
          throw new Error('Download cancelled');
        }
        if (!reader) throw new Error('Download stream unavailable');
        const { done, value } = await reader.read();
        if (done) break;
        downloadChunks.push(value);
        loaded += value.length;
        onProgress?.(loaded, total);
      }

      const totalBytes = downloadChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of downloadChunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const buffer = bytes.buffer;
      const checksum = manifestEntry?.sha256 ?? null;
      if (!(await verifyModelChecksum(buffer, checksum))) {
        await deletePartialDownload(modelId);
        throw new Error(`Model ${modelId} failed SHA-256 verification`);
      }

      const blob = new Blob([bytes], { type: 'application/octet-stream' });

      if (isBrowserEnv()) {
        await saveModelBlob(modelId, blob);
        await deletePartialDownload(modelId);
        // Models above the 2GB protobuf limit keep their weights in a sibling
        // `.onnx.data` file. The graph alone parses but cannot initialize, so a
        // graph-only download would report success and then fail at session
        // creation. Fetch the sidecar as part of the same download.
        await this.downloadExternalData(modelId, manifestEntry, onProgress, signal);
      } else {
        throw new Error(
          'This environment cannot store AI models (IndexedDB unavailable). Use Quick mode, or run in a browser/desktop build with storage enabled.',
        );
      }

      this.state = 'ready';
      this.notify();
      this.saveState();
    } catch (error) {
      const cancelled = signal?.aborted || (error as Error).message === 'Download cancelled';
      if (!cancelled && isBrowserEnv() && remoteUrl && downloadChunks.length > 0) {
        try {
          const combined = new Uint8Array(
            downloadChunks.reduce((sum, chunk) => sum + chunk.length, 0),
          );
          let off = 0;
          for (const chunk of downloadChunks) {
            combined.set(chunk, off);
            off += chunk.length;
          }
          const record: PartialDownloadRecord = {
            bytes: combined,
            meta: {
              url: remoteUrl,
              etag: storedEtag,
              loaded: combined.length,
            },
          };
          await savePartialDownload(modelId, record);
        } catch {
          // Best-effort partial persistence; quota errors bubble below.
        }
      }
      if (cancelled && isBrowserEnv()) {
        await deletePartialDownload(modelId).catch(() => {});
      }
      if (error instanceof ModelStorageQuotaError) {
        throw new ModelStorageQuotaError(
          'Storage quota exceeded. Free disk space or delete old models in Settings, Offline Models.',
        );
      }
      this.state = cancelled ? 'unavailable' : 'error';
      this.currentModelId = '';
      this.notify();
      this.saveState();
      throw error;
    }
  }

  /** Verify a bundled model's bytes against the manifest SHA-256. */
  async verifyBundledModel(
    modelId: string,
    signal?: AbortSignal,
  ): Promise<'verified' | 'corrupt' | 'skipped'> {
    const entry = await getManifestEntry(modelId, signal);
    if (!entry?.bundled || !entry.sha256) return 'skipped';

    const bundled = entry.localPath ?? `/models/${modelId}.onnx`;
    try {
      const response = await fetchWithTimeout(bundled, { signal }, MODEL_PATH_PROBE_TIMEOUT);
      if (!response.ok) return 'corrupt';
      const buffer = await response.arrayBuffer();
      const ok = await verifyModelChecksum(buffer, entry.sha256);
      return ok ? 'verified' : 'corrupt';
    } catch {
      return 'corrupt';
    }
  }

  isModelDownloaded(modelId: string): boolean {
    return this.state === 'ready' && this.currentModelId === modelId;
  }

  async clearModel() {
    if (this.currentModelId) {
      try {
        if (isBrowserEnv()) {
          await deleteModelBlob(this.currentModelId);
        }
      } catch {
        // ignore
      }
    }
    if (this.activeBlobUrl) {
      URL.revokeObjectURL(this.activeBlobUrl);
      this.activeBlobUrl = null;
    }
    this.state = 'unavailable';
    this.currentModelId = '';
    this.saveState();
    this.notify();
  }
}

let instance: ModelLoader | null = null;
let syncPromise: Promise<void> | null = null;

export function getModelLoader(signal?: AbortSignal): ModelLoader {
  if (!instance) {
    instance = new ModelLoader();
    syncPromise = instance.syncFromStorage(signal).catch(() => {
      // Non-fatal: UI will treat models as unavailable until next sync.
    });
  }
  return instance;
}

/** Returns the singleton loader after the first storage sync completes. */
export async function getModelLoaderReady(signal?: AbortSignal): Promise<ModelLoader> {
  const loader = getModelLoader(signal);
  if (syncPromise) await syncPromise;
  return loader;
}

export function resetModelLoader(): void {
  instance = null;
  syncPromise = null;
}
