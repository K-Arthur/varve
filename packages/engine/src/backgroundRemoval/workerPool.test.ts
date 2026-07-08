import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelAllWorkerJobs, runPooledInference, terminateWorkerPool } from './workerPool';

class MockWorker {
  postMessage = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  terminate = vi.fn();
}

describe('workerPool', () => {
  afterEach(() => {
    terminateWorkerPool();
    vi.unstubAllGlobals();
  });

  it('cancelAllWorkerJobs clears pending without throwing', () => {
    expect(() => cancelAllWorkerJobs()).not.toThrow();
  });

  it('terminateWorkerPool resets pool state', () => {
    terminateWorkerPool();
    expect(() => terminateWorkerPool()).not.toThrow();
  });

  it('forwards feather and decontaminate options to the worker message', async () => {
    vi.useFakeTimers();
    const mockWorker = new MockWorker();
    vi.stubGlobal(
      'Worker',
      vi.fn(() => mockWorker),
    );

    const imageData = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) } as ImageData;
    const pending = runPooledInference(
      imageData,
      { method: 'ai-balanced', feather: 6, decontaminate: true },
      '/models/u2netp.onnx',
      'u2netp',
    );
    pending.catch(() => {});

    expect(mockWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'infer',
        feather: 6,
        decontaminate: true,
        modelPath: '/models/u2netp.onnx',
        modelId: 'u2netp',
      }),
    );

    // First inference before the Worker has ever reported 'ready' uses a
    // short 10 s init timeout so a hung Worker import fails fast.
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).rejects.toThrow('timed out');
    vi.useRealTimers();
  });

  it('rejects and dequeues when external AbortSignal fires', async () => {
    vi.useFakeTimers();
    const mockWorker = new MockWorker();
    vi.stubGlobal(
      'Worker',
      vi.fn(() => mockWorker),
    );

    const imageData = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) } as ImageData;
    const controller = new AbortController();
    const pending = runPooledInference(
      imageData,
      { method: 'ai-balanced' },
      '/models/u2netp.onnx',
      'u2netp',
      controller.signal,
    );
    pending.catch(() => {});
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    vi.useRealTimers();
  });
});
