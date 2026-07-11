// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function makeMockWorker() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {
    message: [],
    error: [],
  };
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    addEventListener: vi.fn((type: string, cb: (...args: unknown[]) => void) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type]!.push(cb);
    }),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onmessage: null as unknown,
    onerror: null as unknown,
    _listeners: listeners,
    _sendMessage(data: Record<string, unknown>) {
      for (const cb of listeners.message ?? []) {
        cb({ data });
      }
    },
    _sendError(message: string) {
      for (const cb of listeners.error ?? []) {
        cb({ message });
      }
    },
  };
  return worker;
}

describe('workerPool', () => {
  let mockWorkers: ReturnType<typeof makeMockWorker>[];

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockWorkers = [];
    vi.stubGlobal(
      'Worker',
      vi.fn(() => {
        const w = makeMockWorker();
        mockWorkers.push(w);
        return w;
      }),
    );
  });

  afterEach(async () => {
    // Flush any pending promise microtasks so .catch() handlers registered
    // in the test run before afterEach triggers new rejections.
    await new Promise<void>((r) => setTimeout(r, 0));
    // Reset fake timers before tearing down the module-level pool
    vi.useRealTimers();
    const { terminateWorkerPool } = await import('../workerPool');
    terminateWorkerPool();
    vi.unstubAllGlobals();
  });

  describe('processQueue propagation', () => {
    it('dispatches a queued job after a running job times out', async () => {
      const { runPooledInference } = await import('../workerPool');
      const img = new ImageData(4, 4);
      const opts = { method: 'ai-balanced' as const };

      const p1 = runPooledInference(img, opts, '/models/u2netp.onnx', 'u2netp');
      expect(mockWorkers.length).toBeGreaterThanOrEqual(1);

      const p2 = runPooledInference(img, opts, '/models/u2netp.onnx', 'u2netp');
      for (const p of [p1, p2]) p.catch(() => {});

      await vi.advanceTimersByTimeAsync(11_000);

      await expect(p1).rejects.toThrow('Worker inference timed out');

      const inferCalls = mockWorkers
        .flatMap((w) => w.postMessage.mock.calls)
        .filter((call: unknown[]) => (call[0] as Record<string, unknown>)?.type === 'infer');
      expect(inferCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('dispatches a queued job after aborting a running job', async () => {
      const { runPooledInference } = await import('../workerPool');
      const img = new ImageData(4, 4);
      const opts = { method: 'ai-balanced' as const };
      const ctrl = new AbortController();

      const p1 = runPooledInference(img, opts, '/models/u2netp.onnx', 'u2netp', ctrl.signal);
      const p2 = runPooledInference(img, opts, '/models/u2netp.onnx', 'u2netp');
      for (const p of [p1, p2]) p.catch(() => {});

      ctrl.abort();
      await expect(p1).rejects.toThrow('cancelled');

      await vi.advanceTimersByTimeAsync(100);

      const inferCalls = mockWorkers
        .flatMap((w) => w.postMessage.mock.calls)
        .filter((call: unknown[]) => (call[0] as Record<string, unknown>)?.type === 'infer');
      expect(inferCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('dispatches queued jobs after a running job completes', async () => {
      const { runPooledInference } = await import('../workerPool');
      const img = new ImageData(4, 4);
      const opts = { method: 'ai-balanced' as const };

      const p1 = runPooledInference(img, opts, '/models/u2netp.onnx', 'u2netp');
      const p2 = runPooledInference(img, opts, '/models/u2netp.onnx', 'u2netp');
      const p3 = runPooledInference(img, opts, '/models/u2netp.onnx', 'u2netp');
      for (const p of [p1, p2, p3]) p.catch(() => {});

      // p1 is dispatched to the first idle worker. p2, p3 are queued.
      // Complete p1 by having its worker respond
      const activeWorker = mockWorkers.find((w) => w.postMessage.mock.calls.length > 0);
      if (activeWorker) {
        activeWorker._sendMessage({
          type: 'result',
          result: {
            maskDataUrl: 'data:image/png;base64,done',
            confidence: 0.9,
            method: 'ai-balanced',
            processingTimeMs: 10,
            width: 4,
            height: 4,
          },
        });
      }

      // After p1 completes, processQueue should dispatch p2
      await vi.advanceTimersByTimeAsync(100);

      const inferCalls = mockWorkers
        .flatMap((w) => w.postMessage.mock.calls)
        .filter((call: unknown[]) => (call[0] as Record<string, unknown>)?.type === 'infer');
      // p1 was dispatched, now p2 should be dispatched too
      expect(inferCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
