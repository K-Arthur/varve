import type { RawDevelopResult, RawMosaic, RawRecipe } from '@varve/engine/raw';
import { decodeDng, defaultRawRecipe, developRaw } from '@varve/engine/raw';

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

interface WorkerFailure {
  type: 'error';
  id: number;
  message: string;
}

const sessions = new Map<string, RawMosaic>();
let nextSessionId = 1;

const workerScope = globalThis as typeof globalThis & {
  onmessage: ((event: MessageEvent<RawWorkerRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

function postDecodeSuccess(
  id: number,
  sessionId: string,
  mosaic: RawMosaic,
  recipe: RawRecipe,
  result: RawDevelopResult,
): void {
  // Keep the worker's mosaic for recipe scrubbing, while returning an owned
  // copy to the editor. The large buffers are transferred, not cloned.
  const returnedMosaic: RawMosaic = { ...mosaic, pixels: mosaic.pixels.slice() };
  workerScope.postMessage(
    { type: 'decode-success', id, sessionId, mosaic: returnedMosaic, recipe, result },
    [returnedMosaic.pixels.buffer, result.raster.pixels.buffer],
  );
}

function postDevelopSuccess(id: number, result: RawDevelopResult): void {
  workerScope.postMessage({ type: 'develop-success', id, result }, [result.raster.pixels.buffer]);
}

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.type === 'dispose') {
    sessions.delete(request.sessionId);
    return;
  }

  try {
    if (request.type === 'decode') {
      const mosaic = decodeDng(new Uint8Array(request.bytes));
      const recipe = request.recipe ?? defaultRawRecipe(mosaic);
      const result = developRaw(mosaic, recipe);
      const sessionId = `raw-${nextSessionId++}`;
      sessions.set(sessionId, mosaic);
      // Keep this worker bounded if a document changes source repeatedly.
      if (sessions.size > 2) {
        const oldest = sessions.keys().next().value as string | undefined;
        if (oldest) sessions.delete(oldest);
      }
      postDecodeSuccess(request.id, sessionId, mosaic, recipe, result);
      return;
    }

    const mosaic = sessions.get(request.sessionId);
    if (!mosaic) throw new Error('RAW worker session is no longer available');
    postDevelopSuccess(request.id, developRaw(mosaic, request.recipe));
  } catch (error) {
    const response: WorkerFailure = {
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : 'RAW processing failed',
    };
    workerScope.postMessage(response);
  }
};
