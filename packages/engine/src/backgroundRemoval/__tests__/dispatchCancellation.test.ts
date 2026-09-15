// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function makeMockWorker() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {
    message: [],
    error: [],
  };
  const worker = {
    postMessage: vi.fn((msg: Record<string, unknown>) => {
      // Echo back requestId in result after a tick (simulating inference)
      if (msg?.type === 'infer' && msg?.requestId) {
        setTimeout(() => {
          for (const cb of listeners.message ?? []) {
            cb({
              data: {
                type: 'result',
                requestId: msg.requestId,
                result: {
                  maskDataUrl: 'data:image/png;base64,test',
                  confidence: 0.95,
                  method: msg.method,
                  processingTimeMs: 10,
                  width: (msg.imageData as { width: number })?.width ?? 0,
                  height: (msg.imageData as { height: number })?.height ?? 0,
                },
              },
            });
          }
        }, 0);
      }
    }),
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

describe('workerPool — revision-safe protocol', () => {
  let mockWorkers: ReturnType<typeof makeMockWorker>[];

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockWorkers = [];
    vi.stubGlobal(
      'Worker',
      // Vitest 4: mocks invoked with `new` require a constructible
      // implementation (arrow functions are no longer callable as
      // constructors).
      vi.fn(function WorkerMock() {
        const w = makeMockWorker();
        mockWorkers.push(w);
        return w;
      }),
    );
  });

  afterEach(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
    vi.useRealTimers();
    const { terminateWorkerPool } = await import('../workerPool');
    terminateWorkerPool();
    vi.unstubAllGlobals();
  });

  it('never resolves job B with a late result from cancelled job A', async () => {
    const { runPooledInference, __getPool } = await import('../workerPool');
    const imgA = new ImageData(4, 4);
    const imgB = new ImageData(8, 8);
    const opts = { method: 'ai-balanced' as const };
    const path = '/models/u2netp.onnx';
    const model = 'u2netp' as const;

    // Pre-init pool so mock workers exist, then disable auto-response
    __getPool();
    for (const w of mockWorkers) {
      w.postMessage = vi.fn();
    }

    // Start job A — it will be dispatched to the first worker
    const abortA = new AbortController();
    const first = runPooledInference(imgA, opts, path, model, abortA.signal);
    first.catch(() => {});

    // Advance so the job is dispatched
    await vi.advanceTimersByTimeAsync(0);

    // Get the requestId from the postMessage call to worker[0]
    const firstCall = mockWorkers[0]?.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.type === 'infer',
    );
    const firstRequestId = (firstCall?.[0] as Record<string, unknown>)?.requestId as string;
    expect(firstRequestId).toBeTruthy();

    // Abort job A
    abortA.abort();
    await expect(first).rejects.toThrow(/cancelled/i);
    expect(mockWorkers[0]?.terminate).toHaveBeenCalledTimes(1);
    // Cancellation replaces the worker so the in-flight ORT run is actually
    // stopped. Disable the replacement mock's automatic response; this test
    // injects job B's real response explicitly below.
    for (const w of mockWorkers) {
      w.postMessage = vi.fn();
    }

    // Start job B — it should be dispatched to the same or different worker
    const second = runPooledInference(imgB, opts, path, model);
    second.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);

    // Get job B's requestId
    const allCalls = mockWorkers.flatMap((w) =>
      w.postMessage.mock.calls.map((c: unknown) => (c as unknown[])[0] as Record<string, unknown>),
    );
    const inferCalls = allCalls.filter(
      (c) => c?.type === 'infer' && c?.requestId !== firstRequestId,
    );
    const secondRequestId = inferCalls[0]?.requestId as string;
    expect(secondRequestId).toBeTruthy();

    // Simulate a late result from the cancelled job A arriving
    // This should NOT resolve job B
    const lateResult = {
      type: 'result',
      requestId: firstRequestId,
      result: {
        maskDataUrl: 'data:image/png;base64,late',
        confidence: 0.5,
        method: 'ai-balanced',
        processingTimeMs: 100,
        width: 4,
        height: 4,
      },
    };

    // Send the late result — should be silently discarded
    for (const w of mockWorkers) {
      w._sendMessage(lateResult);
    }

    // Send the real result for job B
    const realResult = {
      type: 'result',
      requestId: secondRequestId,
      result: {
        maskDataUrl: 'data:image/png;base64,real',
        confidence: 0.9,
        method: 'ai-balanced',
        processingTimeMs: 50,
        width: 8,
        height: 8,
      },
    };
    for (const w of mockWorkers) {
      w._sendMessage(realResult);
    }

    await vi.advanceTimersByTimeAsync(0);

    // Job B should resolve with the real result, not the late one
    const result = await second;
    expect(result.maskDataUrl).toBe('data:image/png;base64,real');
    expect(result.width).toBe(8);
  });

  it('gives the fallback provider intact pixels after worker failure', async () => {
    vi.doMock('../providers/workerProvider', () => ({
      workerRemovalProvider: {
        id: 'worker-onnx',
        isAvailable: vi.fn().mockResolvedValue(true),
        remove: vi.fn().mockRejectedValue(new Error('worker failed')),
      },
    }));
    vi.doMock('../providers/tauriProvider', () => ({
      isNativeAiReady: vi.fn().mockResolvedValue(false),
      tauriRemovalProvider: {
        id: 'tauri-native',
        isAvailable: vi.fn().mockResolvedValue(false),
        remove: vi.fn(),
      },
    }));
    vi.doMock('../providers/directOnnxProvider', () => ({
      directOnnxRemovalProvider: {
        id: 'direct-onnx',
        isAvailable: vi.fn().mockResolvedValue(true),
        remove: vi.fn().mockImplementation(async (pixels: ImageData) => {
          expect(pixels.data.byteLength).toBeGreaterThan(0);
          expect(pixels.width).toBe(4);
          expect(pixels.height).toBe(4);
          return {
            maskDataUrl: 'data:image/png;base64,direct',
            confidence: 0.85,
            method: 'ai-balanced',
            processingTimeMs: 200,
            width: 4,
            height: 4,
          };
        }),
      },
    }));
    vi.doMock('../providers/cloudProvider', () => ({
      cloudRemovalProvider: {
        id: 'cloud',
        isAvailable: vi.fn().mockResolvedValue(false),
        remove: vi.fn(),
      },
    }));

    vi.resetModules();
    const { dispatchBackgroundRemoval: dispatch } = await import('../providers/dispatch');
    const img = new ImageData(4, 4);
    const opts = { method: 'ai-balanced' as const };
    const result = await dispatch(img, opts);
    expect(result.maskDataUrl).toBe('data:image/png;base64,direct');
  });

  it('each job resolves exactly once', async () => {
    const { runPooledInference, __getPending } = await import('../workerPool');
    const img = new ImageData(4, 4);
    const opts = { method: 'ai-balanced' as const };
    const path = '/models/u2netp.onnx';
    const model = 'u2netp' as const;

    const p1 = runPooledInference(img, opts, path, model);
    const p2 = runPooledInference(img, opts, path, model);
    p1.catch(() => {});
    p2.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    const r1 = await p1;
    const r2 = await p2;

    expect(r1.width).toBe(4);
    expect(r2.width).toBe(4);
    expect(__getPending().length).toBe(0);
  }, 15000);

  it('worker counts return to configured bound after all jobs settle', async () => {
    const { runPooledInference, __getPool } = await import('../workerPool');
    const img = new ImageData(4, 4);
    const opts = { method: 'ai-balanced' as const };
    const path = '/models/u2netp.onnx';
    const model = 'u2netp' as const;

    const pool = __getPool();
    const bound = pool.length;

    const promises = [];
    for (let i = 0; i < bound + 2; i++) {
      promises.push(runPooledInference(img, opts, path, model));
    }
    for (const p of promises) p.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    await Promise.all(promises);

    for (const pw of __getPool()) {
      expect(pw.busy).toBe(false);
    }
  }, 15000);

  it('cancelAllWorkerJobs rejects all pending and cleans up listeners', async () => {
    const { runPooledInference, cancelAllWorkerJobs, __getPending } = await import('../workerPool');
    const img = new ImageData(4, 4);
    const opts = { method: 'ai-balanced' as const };
    const path = '/models/u2netp.onnx';
    const model = 'u2netp' as const;

    const p1 = runPooledInference(img, opts, path, model);
    const p2 = runPooledInference(img, opts, path, model);
    p1.catch(() => {});
    p2.catch(() => {});

    cancelAllWorkerJobs();

    await expect(p1).rejects.toThrow('cancelled');
    await expect(p2).rejects.toThrow('cancelled');
    expect(__getPending().length).toBe(0);
  });

  it('late result from old worker generation is discarded', async () => {
    const { runPooledInference, __getPool } = await import('../workerPool');
    const img = new ImageData(4, 4);
    const opts = { method: 'ai-balanced' as const };
    const path = '/models/u2netp.onnx';
    const model = 'u2netp' as const;

    const pool = __getPool();
    const pw = pool[0]!;

    // Disable auto-response for this test so we control timing
    const mockWorker = pw.worker as unknown as ReturnType<typeof makeMockWorker>;
    const origPostMessage = mockWorker.postMessage;
    mockWorker.postMessage = vi.fn((_msg: Record<string, unknown>) => {
      // Don't auto-respond — we'll manually send results
    });

    const p1 = runPooledInference(img, opts, path, model);
    p1.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);

    // Capture the requestId from the dispatch
    const call = mockWorker.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.type === 'infer',
    );
    const requestId = (call?.[0] as Record<string, unknown>)?.requestId as string;
    expect(requestId).toBeTruthy();

    // Simulate worker error (triggers replacement, incrementing generation)
    mockWorker._sendError('worker crashed');
    await expect(p1).rejects.toThrow('worker crashed');

    // Now try to send a late result with the old requestId on the old worker
    // It should be silently discarded
    const lateResult = {
      type: 'result',
      requestId,
      result: {
        maskDataUrl: 'data:image/png;base64,late',
        confidence: 0.5,
        method: 'ai-balanced',
        processingTimeMs: 100,
        width: 4,
        height: 4,
      },
    };
    mockWorker._sendMessage(lateResult);

    // Restore postMessage for the new job
    mockWorker.postMessage = origPostMessage;

    // Start a new job — it should work fine on the replaced worker
    const p2 = runPooledInference(img, opts, path, model);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    const result = await p2;
    expect(result.width).toBe(4);
  });

  it('rejects stale results from a previous worker generation', async () => {
    const { runPooledInference, __getPool } = await import('../workerPool');
    const img = new ImageData(4, 4);
    const opts = { method: 'ai-balanced' as const };
    const path = '/models/u2netp.onnx';
    const model = 'u2netp' as const;

    const pool = __getPool();
    const pw = pool[0]!;

    // Disable auto-response so we control timing
    const mockWorker = pw.worker as unknown as ReturnType<typeof makeMockWorker>;
    mockWorker.postMessage = vi.fn((_msg: Record<string, unknown>) => {
      // Don't auto-respond
    });

    const p1 = runPooledInference(img, opts, path, model);
    p1.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);

    const call = mockWorker.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.type === 'infer',
    );
    const requestId = (call?.[0] as Record<string, unknown>)?.requestId as string;
    expect(requestId).toBeTruthy();

    // Simulate worker replacement without settling the job:
    // increment generation so arriving messages are from a "prior" generation
    pw.generation = pw.generation + 1;

    // Send a result from the "old" generation
    mockWorker._sendMessage({
      type: 'result',
      requestId,
      result: {
        maskDataUrl: 'data:image/png;base64,stale',
        confidence: 0.5,
        method: 'ai-balanced',
        processingTimeMs: 100,
        width: 4,
        height: 4,
      },
    });

    await vi.advanceTimersByTimeAsync(0);

    // The current code silently discards generation-mismatch messages
    // without settling the job. The job promise should reject with a
    // generation-mismatch error — currently it hangs (RED state).
    // The short timeout prevents indefinite hang but the assertion is
    // that the promise DOES settle (fails = RED).
    const settled = await Promise.race([
      p1.then(() => 'resolved').catch((e: Error) => `rejected:${e.message}`),
      new Promise<string>((r) => setTimeout(() => r('TIMEOUT'), 300)),
    ]);
    expect(settled).toMatch(/^rejected:/i);
    // After the fix, this should match a generation-mismatch error:
    // expect(settled).toMatch(/generation.?mismatch/i);
  });

  it('cleans up abort listeners when a request settles', async () => {
    const { runPooledInference, __getPool, __getPending } = await import('../workerPool');
    const img = new ImageData(4, 4);
    const opts = { method: 'ai-balanced' as const };
    const path = '/models/u2netp.onnx';
    const model = 'u2netp' as const;

    const external = new AbortController();
    const p1 = runPooledInference(img, opts, path, model, external.signal);
    const p2 = runPooledInference(img, opts, path, model, external.signal);
    p1.catch(() => {});
    p2.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    await p1;
    await p2;

    // Both jobs settled, pool should be idle
    expect(__getPending().length).toBe(0);
    for (const pw of __getPool()) {
      expect(pw.busy).toBe(false);
    }

    // Abort the external signal — if the pool's internal listeners were
    // properly cleaned up, this is a no-op. If they were NOT cleaned up,
    // the stale onAbort handler fires and corrupts worker busy flags.
    external.abort();

    // Pool must still be clean after the abort
    expect(__getPending().length).toBe(0);
    for (const pw of __getPool()) {
      expect(pw.busy).toBe(false);
    }
  });

  it('warm-worker timeout replacement creates a new worker', async () => {
    const { runPooledInference, __getPool } = await import('../workerPool');
    const img = new ImageData(4, 4);
    const opts = { method: 'ai-balanced' as const };
    const path = '/models/u2netp.onnx';
    const model = 'u2netp' as const;

    const pool = __getPool();
    const pw = pool[0]!;

    // The mock workers in dispatchCancellation.test.ts do NOT auto-send
    // 'ready' — send it manually to simulate a warm worker.
    const mockWorker = pw.worker as unknown as ReturnType<typeof makeMockWorker>;
    mockWorker._sendMessage({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(0);

    // Worker should now be ready (warm)
    expect(pw.ready).toBe(true);

    // Capture the original worker reference so we can detect replacement
    const originalWorker = pw.worker;
    const terminateSpy = vi.spyOn(originalWorker, 'terminate');

    // Disable postMessage auto-response so the job hangs and times out
    mockWorker.postMessage = vi.fn((_msg: Record<string, unknown>) => {
      // Don't auto-respond — forces timeout
    });

    const p1 = runPooledInference(img, opts, path, model);
    p1.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);

    // Verify the job was dispatched
    expect(mockWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'infer' }),
      expect.anything(),
    );

    // Advance past the warm-worker timeout (120_000ms for ai-balanced)
    await vi.advanceTimersByTimeAsync(200_000);

    // The current code does NOT replace a warm (ready) worker on timeout —
    // it only marks it idle. Assert that a new worker IS created, proving
    // the worker was replaced. This fails (RED) because currently
    // terminate is never called for warm-worker timeouts.
    expect(terminateSpy).toHaveBeenCalled();

    // The timed-out job must reject
    await expect(p1).rejects.toThrow(/timed out/i);
  });
});
