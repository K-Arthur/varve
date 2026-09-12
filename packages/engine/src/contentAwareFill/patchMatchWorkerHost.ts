import { type PatchMatchResult, patchMatchFill } from './patchMatch';

interface PatchMatchWorkerResponse {
  type: 'result' | 'error';
  imageBuffer?: ArrayBuffer;
  width?: number;
  height?: number;
  filledBounds?: { x: number; y: number; w: number; h: number };
  message?: string;
}

function cancelledError(): Error {
  return new Error('cancelled');
}

function isValidFilledBounds(value: unknown): value is PatchMatchResult['filledBounds'] {
  if (!value || typeof value !== 'object') return false;
  const bounds = value as Record<string, unknown>;
  return ['x', 'y', 'w', 'h'].every(
    (key) => typeof bounds[key] === 'number' && Number.isFinite(bounds[key]),
  );
}

function runInWorker(
  imageData: ImageData,
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  signal: AbortSignal | undefined,
  seed: number | undefined,
): Promise<PatchMatchResult> {
  const worker = new Worker(new URL('./patchMatchWorker.ts', import.meta.url), {
    type: 'module',
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener('abort', cancel);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      worker.terminate();
      callback();
    };
    const cancel = () => {
      finish(() => reject(cancelledError()));
    };

    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }

    worker.onmessage = (event: MessageEvent<PatchMatchWorkerResponse>) => {
      const response = event.data;
      if (response?.type === 'error') {
        finish(() => reject(new Error(response.message || 'PatchMatch worker failed')));
        return;
      }
      const width = response?.width;
      const height = response?.height;
      if (
        response?.type !== 'result' ||
        !(response.imageBuffer instanceof ArrayBuffer) ||
        typeof width !== 'number' ||
        typeof height !== 'number' ||
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        response.imageBuffer.byteLength !== width * height * 4 ||
        !isValidFilledBounds(response.filledBounds)
      ) {
        finish(() => reject(new Error('PatchMatch worker returned invalid output')));
        return;
      }
      const outputBuffer = response.imageBuffer as ArrayBuffer;
      const outputWidth = width as number;
      const outputHeight = height as number;
      const filledBounds = response.filledBounds as PatchMatchResult['filledBounds'];
      finish(() =>
        resolve({
          imageData: new ImageData(new Uint8ClampedArray(outputBuffer), outputWidth, outputHeight),
          filledBounds,
        }),
      );
    };
    worker.onerror = () => {
      finish(() => reject(new Error('PatchMatch worker failed')));
    };
    worker.onmessageerror = () => {
      finish(() => reject(new Error('PatchMatch worker message could not be decoded')));
    };

    const imageBuffer = imageData.data.slice().buffer;
    const maskBuffer = mask.slice().buffer;
    try {
      worker.postMessage(
        {
          type: 'run',
          imageBuffer,
          width: imageData.width,
          height: imageData.height,
          maskBuffer,
          maskWidth,
          maskHeight,
          seed,
        },
        [imageBuffer, maskBuffer],
      );
    } catch (error) {
      finish(() =>
        reject(error instanceof Error ? error : new Error('PatchMatch worker could not start')),
      );
    }
  });
}

/**
 * Run the synchronous PatchMatch implementation away from the editor thread
 * whenever module workers are available. The synchronous fallback is kept for
 * SSR/tests and old embedded webviews that do not expose Worker.
 */
export function runPatchMatchInWorker(
  imageData: ImageData,
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  maskOffsetX: number,
  maskOffsetY: number,
  signal?: AbortSignal,
  seed?: number,
): Promise<PatchMatchResult> {
  if (signal?.aborted) return Promise.reject(cancelledError());
  if (typeof Worker === 'undefined') {
    return Promise.resolve(
      patchMatchFill(
        imageData,
        mask,
        maskWidth,
        maskHeight,
        maskOffsetX,
        maskOffsetY,
        signal,
        seed,
      ),
    );
  }
  if (maskOffsetX !== 0 || maskOffsetY !== 0) {
    // The worker protocol intentionally carries only bounded contexts. Keep
    // non-zero offsets correct for direct callers rather than silently
    // shifting their mask.
    return Promise.resolve(
      patchMatchFill(
        imageData,
        mask,
        maskWidth,
        maskHeight,
        maskOffsetX,
        maskOffsetY,
        signal,
        seed,
      ),
    );
  }
  return runInWorker(imageData, mask, maskWidth, maskHeight, signal, seed);
}
