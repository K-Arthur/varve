import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPatchMatchInWorker } from './patchMatchWorkerHost';

function source(): ImageData {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 80;
    data[index + 1] = 120;
    data[index + 2] = 160;
    data[index + 3] = 255;
  }
  return new ImageData(data, 16, 16);
}

describe('PatchMatch worker host', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects an already-cancelled request before creating work', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runPatchMatchInWorker(source(), new Uint8Array(16 * 16), 16, 16, 0, 0, controller.signal),
    ).rejects.toThrow('cancelled');
  });

  it('retains a synchronous fallback for runtimes without Worker', async () => {
    vi.stubGlobal('Worker', undefined);
    const mask = new Uint8Array(16 * 16);
    mask[8 * 16 + 8] = 255;
    const result = await runPatchMatchInWorker(source(), mask, 16, 16, 0, 0, undefined, 17);
    expect(result.imageData.width).toBe(16);
    expect(result.imageData.height).toBe(16);
    expect(result.filledBounds).toEqual({ x: 8, y: 8, w: 1, h: 1 });
  });

  it('terminates active worker computation when cancelled', async () => {
    let workerTerminated = false;
    class NonRespondingWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onmessageerror: (() => void) | null = null;
      terminated = false;

      constructor() {
        workerTerminated = false;
      }

      postMessage(): void {}

      terminate(): void {
        this.terminated = true;
        workerTerminated = true;
      }
    }
    vi.stubGlobal('Worker', NonRespondingWorker);

    const controller = new AbortController();
    const promise = runPatchMatchInWorker(
      source(),
      new Uint8Array(16 * 16),
      16,
      16,
      0,
      0,
      controller.signal,
    );
    controller.abort();

    await expect(promise).rejects.toThrow('cancelled');
    expect(workerTerminated).toBe(true);
  });
});
