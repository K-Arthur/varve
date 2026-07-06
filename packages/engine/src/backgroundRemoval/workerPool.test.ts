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
    // Nothing ever answers the mock worker in this test — resolve the
    // dangling promise deterministically via the pool's own 60s timeout
    // instead of leaving a real timer alive past the test.
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

    await vi.runAllTimersAsync();
    await expect(pending).rejects.toThrow('timed out');
    vi.useRealTimers();
  });
});
