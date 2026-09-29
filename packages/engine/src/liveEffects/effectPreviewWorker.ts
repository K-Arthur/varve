import { cpuEffectProvider } from './cpuProvider';
import type {
  EffectPreviewWorkerRequest,
  EffectPreviewWorkerResponse,
} from './effectPreviewRunner';

interface EffectWorkerScope {
  onmessage: ((event: MessageEvent<EffectPreviewWorkerRequest>) => void) | null;
  postMessage(message: EffectPreviewWorkerResponse, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as EffectWorkerScope;

scope.onmessage = (event) => {
  const { id, request, rgba } = event.data;
  try {
    const source = new Uint8ClampedArray(rgba);
    if (
      !Number.isSafeInteger(request.width) ||
      !Number.isSafeInteger(request.height) ||
      request.width < 1 ||
      request.height < 1 ||
      source.byteLength !== request.width * request.height * 4
    ) {
      throw new Error('Effect worker received invalid dimensions or RGBA bytes.');
    }
    void cpuEffectProvider.apply(request, source).then(
      (result) => {
        try {
          const output = result.buffer;
          if (
            !(output instanceof ArrayBuffer) ||
            result.byteOffset !== 0 ||
            result.byteLength !== output.byteLength
          ) {
            throw new Error('Canonical effect provider returned a non-transferable buffer.');
          }
          scope.postMessage({ type: 'result', id, rgba: output }, [output]);
        } catch (error) {
          scope.postMessage(
            { type: 'error', id, message: error instanceof Error ? error.message : String(error) },
            [],
          );
        }
      },
      (error: unknown) => {
        scope.postMessage(
          { type: 'error', id, message: error instanceof Error ? error.message : String(error) },
          [],
        );
      },
    );
  } catch (error) {
    scope.postMessage(
      { type: 'error', id, message: error instanceof Error ? error.message : String(error) },
      [],
    );
  }
};
