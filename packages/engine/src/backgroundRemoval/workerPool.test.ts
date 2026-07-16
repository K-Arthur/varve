import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Worker for Node.js test environment
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  private _listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
  private _lastMessage: {
    imageData?: { width: number; height: number };
    requestId?: string;
  } | null = null;

  constructor(_url: string | URL, _opts?: WorkerOptions) {
    // Simulate ready after construction
    setTimeout(() => {
      this._dispatch({ type: 'ready' });
    }, 0);
  }

  postMessage(msg: { imageData?: { width: number; height: number }; requestId?: string }) {
    this._lastMessage = msg;
    // Defer the "inference" completion so tests can queue more jobs
    // before any worker completes.
    setTimeout(() => {
      if (this._lastMessage) {
        this._dispatch({
          type: 'result',
          requestId: this._lastMessage.requestId,
          result: {
            maskDataUrl: 'data:image/png;base64,test',
            confidence: 0.95,
            method: 'ai-balanced',
            processingTimeMs: 100,
            width: this._lastMessage.imageData?.width ?? 0,
            height: this._lastMessage.imageData?.height ?? 0,
          },
        });
      }
    }, 0);
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type]!.push(fn);
  }

  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    const arr = this._listeners[type];
    if (arr) this._listeners[type] = arr.filter((f) => f !== fn);
  }

  terminate() {
    this._listeners = {};
  }

  private _dispatch(data: unknown) {
    const handlers = this._listeners.message || [];
    for (const fn of handlers) {
      fn({ data } as unknown as MessageEvent);
    }
  }
}

let origWorker: typeof Worker;

function makeImageData(w = 10, h = 10): ImageData {
  return new ImageData(w, h);
}

describe('workerPool', () => {
  let workerPool: typeof import('./workerPool');

  beforeEach(async () => {
    origWorker = globalThis.Worker;
    (globalThis as any).Worker = MockWorker;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.resetModules();
    workerPool = await import('./workerPool');
  });

  afterEach(() => {
    workerPool.terminateWorkerPool();
    (globalThis as any).Worker = origWorker;
    vi.useRealTimers();
  });

  describe('pool configuration', () => {
    it('default worker count respects hardware concurrency', () => {
      const count = workerPool.__getIdealWorkerCount();
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(2);
    });

    it('uses single worker when concurrency is 1', () => {
      const orig = Object.getOwnPropertyDescriptor(navigator, 'hardwareConcurrency');
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        value: 1,
        configurable: true,
      });
      const count = workerPool.__getIdealWorkerCount();
      expect(count).toBe(1);
      if (orig) {
        Object.defineProperty(navigator, 'hardwareConcurrency', orig);
      } else {
        delete (navigator as { hardwareConcurrency?: number }).hardwareConcurrency;
      }
    });
  });

  describe('pool lifecycle', () => {
    it('initPool creates workers', () => {
      const pool = workerPool.__getPool();
      expect(pool.length).toBeGreaterThanOrEqual(1);
      for (const pw of pool) {
        expect(pw.worker).toBeDefined();
        expect(pw.busy).toBe(false);
      }
    });

    it('terminateWorkerPool cleans up all workers', () => {
      const pool = workerPool.__getPool();
      const count = pool.length;
      workerPool.terminateWorkerPool();
      const afterPool = workerPool.__getPool();
      expect(afterPool.length).toBe(count);
      // Workers are fresh after re-init
      for (const pw of afterPool) {
        expect(pw.worker).toBeDefined();
        expect(pw.busy).toBe(false);
      }
    });
  });

  describe('cancellation', () => {
    it('cancelAllWorkerJobs clears pending queue', () => {
      // Get pool to init workers
      workerPool.__getPool();
      const pending = workerPool.__getPending();
      const mockReject = vi.fn();
      pending.push({
        id: 1,
        requestId: 'req_test_1',
        reject: mockReject,
        abort: { abort: vi.fn() },
        timeout: setTimeout(() => {}, 10000) as unknown as ReturnType<typeof setTimeout>,
        workerIndex: 0,
        generation: 0,
        abortListeners: [],
      } as never);
      pending.push({
        id: 2,
        requestId: 'req_test_2',
        reject: vi.fn(),
        abort: { abort: vi.fn() },
        timeout: setTimeout(() => {}, 10000) as unknown as ReturnType<typeof setTimeout>,
        workerIndex: 0,
        generation: 0,
        abortListeners: [],
      } as never);

      workerPool.cancelAllWorkerJobs();

      expect(pending.length).toBe(0);
      expect(mockReject).toHaveBeenCalledWith(new Error('cancelled'));
    });
  });

  describe('concurrent dispatch', () => {
    it('dispatches multiple queued jobs and resolves each to its own caller', async () => {
      const pool = workerPool.__getPool();
      const jobCount = pool.length + 2;
      const promises: Promise<unknown>[] = [];

      for (let i = 0; i < jobCount; i++) {
        promises.push(
          workerPool.runPooledInference(
            makeImageData(10 + i, 10 + i),
            { method: 'ai-balanced' },
            '/models/u2netp.onnx',
            'u2netp',
          ),
        );
      }

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);

      const results = await Promise.all(promises);
      expect(results.length).toBe(jobCount);
      for (let i = 0; i < jobCount; i++) {
        const result = results[i] as { width: number; height: number };
        expect(result.width).toBe(10 + i);
        expect(result.height).toBe(10 + i);
      }

      for (const pw of pool) {
        expect(pw.busy).toBe(false);
      }
    });

    it('does not reassign an in-flight job to a second worker', async () => {
      const pool = workerPool.__getPool();
      const p1 = workerPool.runPooledInference(
        makeImageData(10, 10),
        { method: 'ai-balanced' },
        '/models/u2netp.onnx',
        'u2netp',
      );
      const p2 = workerPool.runPooledInference(
        makeImageData(20, 20),
        { method: 'ai-balanced' },
        '/models/u2netp.onnx',
        'u2netp',
      );

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect((r1 as { width: number }).width).toBe(10);
      expect((r2 as { width: number }).width).toBe(20);
      for (const pw of pool) {
        expect(pw.busy).toBe(false);
      }
    });
  });
});
