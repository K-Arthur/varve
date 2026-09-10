import {
  analyzePalette,
  PALETTE_ANALYSIS_VERSION,
  PALETTE_DEFAULT_COLOR_COUNT,
  type PaletteAnalysis,
  type PalettePixelSource,
  type PaletteSourceInfo,
} from '@varve/engine';

const MAX_CACHED_RESULTS = 48;

export interface PaletteAnalysisRequest {
  width: number;
  height: number;
  data: ArrayLike<number>;
  source?: PaletteSourceInfo;
}

export interface PaletteAnalysisOptions {
  colorCount?: number;
  force?: boolean;
}

interface WorkerRequest {
  type: 'analyze';
  id: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  source?: PaletteSourceInfo;
  colorCount?: number;
}

interface WorkerSuccess {
  type: 'success';
  id: number;
  result: PaletteAnalysis;
}

interface WorkerFailure {
  type: 'error';
  id: number;
  message: string;
}

type WorkerResponse = WorkerSuccess | WorkerFailure;

interface PendingJob {
  resolve: (result: PaletteAnalysis) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

const resultCache = new Map<string, PaletteAnalysis>();
let worker: Worker | null = null;
let nextJobId = 1;
const pending = new Map<number, PendingJob>();

function abortError(): Error {
  const error = new Error('Palette analysis was cancelled');
  error.name = 'AbortError';
  return error;
}

function hashData(data: ArrayLike<number>): string {
  let first = 2166136261 >>> 0;
  let second = 0x9e3779b9 >>> 0;
  const stride = Math.max(1, Math.floor(data.length / 2048));
  for (let i = 0; i < data.length; i += stride) {
    const value = Number(data[i] ?? 0) & 0xff;
    first = Math.imul(first ^ value, 16777619) >>> 0;
    second = Math.imul(second ^ value, 2246822519) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

/** Stable identity for source bytes + crop + algorithm configuration. */
export function paletteAnalysisCacheKey(
  source: PaletteAnalysisRequest,
  options: PaletteAnalysisOptions = {},
): string {
  const sourceInfo = source.source;
  const content = sourceInfo?.contentHash ?? hashData(source.data);
  const asset = sourceInfo?.assetId ?? 'inline';
  const crop = sourceInfo?.crop ? JSON.stringify(sourceInfo.crop) : 'full';
  return [
    `v${PALETTE_ANALYSIS_VERSION}`,
    asset,
    content,
    source.width,
    source.height,
    crop,
    options.colorCount ?? PALETTE_DEFAULT_COLOR_COUNT,
  ].join(':');
}

function remember(key: string, result: PaletteAnalysis): void {
  resultCache.delete(key);
  resultCache.set(key, result);
  while (resultCache.size > MAX_CACHED_RESULTS) {
    const oldest = resultCache.keys().next().value as string | undefined;
    if (!oldest) break;
    resultCache.delete(oldest);
  }
}

function rejectWorkerJobs(error: Error): void {
  for (const job of pending.values()) {
    job.cleanup();
    job.reject(error);
  }
  pending.clear();
}

function handleWorkerMessage(event: MessageEvent<WorkerResponse>): void {
  const response = event.data;
  const job = pending.get(response.id);
  if (!job) return;
  pending.delete(response.id);
  job.cleanup();
  if (response.type === 'error') {
    job.reject(new Error(response.message));
    return;
  }
  job.resolve(response.result);
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./paletteWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = () => {
      const failed = new Error('Palette analysis worker failed');
      rejectWorkerJobs(failed);
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

function runFallback(
  source: PaletteAnalysisRequest,
  colorCount: number | undefined,
  signal: AbortSignal,
): Promise<PaletteAnalysis> {
  return new Promise((resolve, reject) => {
    const schedule =
      typeof queueMicrotask === 'function'
        ? queueMicrotask
        : (callback: () => void) => setTimeout(callback, 0);
    schedule(() => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      try {
        const pixelSource: PalettePixelSource = {
          width: source.width,
          height: source.height,
          data: source.data,
          ...(source.source ? { source: source.source } : {}),
        };
        resolve(analyzePalette(pixelSource, { ...(colorCount ? { colorCount } : {}) }));
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Palette analysis failed'));
      }
    });
  });
}

/**
 * Run analysis off the editor's render/input path when Workers are available.
 * The synchronous engine remains the documented fallback for restricted WebViews.
 */
export function analyzePaletteInWorker(
  source: PaletteAnalysisRequest,
  options: PaletteAnalysisOptions = {},
  signal: AbortSignal = new AbortController().signal,
): Promise<PaletteAnalysis> {
  if (signal.aborted) return Promise.reject(abortError());
  const key = paletteAnalysisCacheKey(source, options);
  if (!options.force) {
    const cached = resultCache.get(key);
    if (cached) return Promise.resolve(cached);
  }

  const activeWorker = getWorker();
  if (!activeWorker) {
    return runFallback(source, options.colorCount, signal).then((result) => {
      if (!options.force) remember(key, result);
      return result;
    });
  }

  const id = nextJobId++;
  const data = new Uint8ClampedArray(source.data);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      pending.delete(id);
      reject(abortError());
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    pending.set(id, {
      resolve: (result) => {
        if (!options.force) remember(key, result);
        resolve(result);
      },
      reject,
      cleanup,
    });
    signal.addEventListener('abort', onAbort, { once: true });
    const message: WorkerRequest = {
      type: 'analyze',
      id,
      width: source.width,
      height: source.height,
      data,
      ...(source.source ? { source: source.source } : {}),
      ...(options.colorCount ? { colorCount: options.colorCount } : {}),
    };
    try {
      activeWorker.postMessage(message, [data.buffer]);
    } catch (error) {
      pending.delete(id);
      cleanup();
      reject(error instanceof Error ? error : new Error('Could not start palette analysis'));
    }
  });
}

export function clearPaletteAnalysisCache(): void {
  resultCache.clear();
}

export function disposePaletteAnalysisWorker(): void {
  rejectWorkerJobs(abortError());
  worker?.terminate();
  worker = null;
}
