import type { RawDevelopResult, RawMosaic, RawRecipe } from '@varve/engine/raw';
import { decodeDng, defaultRawRecipe, developRaw } from '@varve/engine/raw';

export interface RawWorkerDecodeResult {
  mosaic: RawMosaic;
  recipe: RawRecipe;
  result: RawDevelopResult;
  workerSessionId?: string;
}

interface DecodeRequest {
  type: 'decode';
  id: number;
  bytes: ArrayBuffer;
  recipe?: RawRecipe;
}

interface DevelopRequest {
  type: 'develop';
  id: number;
  sessionId: string;
  recipe: RawRecipe;
}

interface DisposeRequest {
  type: 'dispose';
  sessionId: string;
}

type RawWorkerRequest = DecodeRequest | DevelopRequest | DisposeRequest;

interface DecodeSuccess {
  type: 'decode-success';
  id: number;
  sessionId: string;
  mosaic: RawMosaic;
  recipe: RawRecipe;
  result: RawDevelopResult;
}

interface DevelopSuccess {
  type: 'develop-success';
  id: number;
  result: RawDevelopResult;
}

interface WorkerFailure {
  type: 'error';
  id: number;
  message: string;
}

type RawWorkerResponse = DecodeSuccess | DevelopSuccess | WorkerFailure;

interface PendingJob {
  resolve: (response: RawWorkerResponse) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

let worker: Worker | null = null;
let nextJobId = 1;
let activeWorkerSessionId: string | undefined;
const pending = new Map<number, PendingJob>();

function abortError(): Error {
  const error = new Error('RAW processing was cancelled');
  error.name = 'AbortError';
  return error;
}

function rejectPending(error: Error): void {
  for (const job of pending.values()) {
    job.cleanup();
    job.reject(error);
  }
  pending.clear();
}

function handleMessage(event: MessageEvent<RawWorkerResponse>): void {
  const response = event.data;
  if (response.type === 'error' && response.id === 0) return;
  const job = pending.get(response.id);
  if (!job) return;
  pending.delete(response.id);
  job.cleanup();
  job.resolve(response);
}

function ensureWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./rawDevelopmentWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = handleMessage;
    worker.onerror = () => {
      rejectPending(new Error('RAW processing worker failed; using the local fallback'));
      worker?.terminate();
      worker = null;
      activeWorkerSessionId = undefined;
    };
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

function request<T extends RawWorkerResponse>(
  message: RawWorkerRequest,
  transfer: Transferable[],
  signal: AbortSignal,
): Promise<T> {
  const activeWorker = ensureWorker();
  if (!activeWorker) return Promise.reject(new Error('RAW worker is unavailable'));
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      pending.delete(message.type === 'dispose' ? 0 : message.id);
      reject(abortError());
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const id = message.type === 'dispose' ? 0 : message.id;
    if (id !== 0)
      pending.set(id, {
        resolve: resolve as (response: RawWorkerResponse) => void,
        reject,
        cleanup,
      });
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      activeWorker.postMessage(message, transfer);
    } catch (error) {
      if (id !== 0) pending.delete(id);
      cleanup();
      reject(error instanceof Error ? error : new Error('Could not start RAW processing'));
    }
  });
}

function fallbackDecode(bytes: Uint8Array, recipe: RawRecipe | undefined): RawWorkerDecodeResult {
  const mosaic = decodeDng(bytes);
  const resolvedRecipe = recipe ?? defaultRawRecipe(mosaic);
  return { mosaic, recipe: resolvedRecipe, result: developRaw(mosaic, resolvedRecipe) };
}

/** Decode and develop off the editor thread when module workers are available. */
export async function decodeAndDevelopRaw(
  bytes: Uint8Array,
  recipe?: RawRecipe,
  signal: AbortSignal = new AbortController().signal,
): Promise<RawWorkerDecodeResult> {
  const activeWorker = ensureWorker();
  if (!activeWorker) {
    await yieldToBrowser();
    if (signal.aborted) throw abortError();
    return fallbackDecode(bytes, recipe);
  }
  if (activeWorkerSessionId) {
    activeWorker.postMessage({
      type: 'dispose',
      sessionId: activeWorkerSessionId,
    } satisfies DisposeRequest);
    activeWorkerSessionId = undefined;
  }
  const id = nextJobId++;
  const payload = bytes.slice();
  try {
    const response = await request<DecodeSuccess>(
      { type: 'decode', id, bytes: payload.buffer, ...(recipe ? { recipe } : {}) },
      [payload.buffer],
      signal,
    );
    if (response.type !== 'decode-success')
      throw new Error('RAW decode returned an unexpected response');
    activeWorkerSessionId = response.sessionId;
    return {
      mosaic: response.mosaic,
      recipe: response.recipe,
      result: response.result,
      workerSessionId: response.sessionId,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    await yieldToBrowser();
    if (signal.aborted) throw abortError();
    return fallbackDecode(bytes, recipe);
  }
}

/** Re-develop an existing decoded mosaic without reading the source again. */
export async function developRawSession(
  session: { mosaic: RawMosaic; workerSessionId?: string },
  recipe: RawRecipe,
  signal: AbortSignal = new AbortController().signal,
): Promise<RawDevelopResult> {
  const activeWorker = ensureWorker();
  if (!activeWorker || !session.workerSessionId) {
    await yieldToBrowser();
    if (signal.aborted) throw abortError();
    return developRaw(session.mosaic, recipe);
  }
  const id = nextJobId++;
  try {
    const response = await request<DevelopSuccess>(
      { type: 'develop', id, sessionId: session.workerSessionId, recipe },
      [],
      signal,
    );
    if (response.type !== 'develop-success')
      throw new Error('RAW development returned an unexpected response');
    return response.result;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    await yieldToBrowser();
    if (signal.aborted) throw abortError();
    return developRaw(session.mosaic, recipe);
  }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
