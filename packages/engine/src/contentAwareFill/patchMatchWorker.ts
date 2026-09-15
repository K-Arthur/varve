import { patchMatchFill } from './patchMatch';

interface PatchMatchWorkerRequest {
  type: 'run';
  imageBuffer: ArrayBuffer;
  width: number;
  height: number;
  maskBuffer: ArrayBuffer;
  maskWidth: number;
  maskHeight: number;
  seed?: number;
}

interface PatchMatchWorkerResponse {
  type: 'result' | 'error';
  imageBuffer?: ArrayBuffer;
  width?: number;
  height?: number;
  filledBounds?: { x: number; y: number; w: number; h: number };
  message?: string;
}

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<PatchMatchWorkerRequest>) => {
  const request = event.data;
  if (request?.type !== 'run') return;
  try {
    const imageData = new ImageData(
      new Uint8ClampedArray(request.imageBuffer),
      request.width,
      request.height,
    );
    const result = patchMatchFill(
      imageData,
      new Uint8Array(request.maskBuffer),
      request.maskWidth,
      request.maskHeight,
      0,
      0,
      undefined,
      request.seed,
    );
    const imageBuffer = result.imageData.data.buffer;
    const response: PatchMatchWorkerResponse = {
      type: 'result',
      imageBuffer,
      width: result.imageData.width,
      height: result.imageData.height,
      filledBounds: result.filledBounds,
    };
    workerScope.postMessage(response, [imageBuffer]);
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'PatchMatch worker failed',
    } satisfies PatchMatchWorkerResponse);
  }
};
