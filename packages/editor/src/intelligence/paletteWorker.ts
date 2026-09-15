import { extractPaletteFromRgba, type PaletteSourceInfo } from '@varve/engine';

interface PaletteWorkerRequest {
  type: 'analyze';
  id: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  source?: PaletteSourceInfo;
  colorCount?: number;
}

const workerScope = globalThis as typeof globalThis & {
  onmessage: ((event: MessageEvent<PaletteWorkerRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.type !== 'analyze') return;
  try {
    const result = extractPaletteFromRgba(
      request.width,
      request.height,
      request.data,
      request.colorCount,
      request.source,
    );
    workerScope.postMessage({ type: 'success', id: request.id, result });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : 'Palette analysis failed',
    });
  }
};
