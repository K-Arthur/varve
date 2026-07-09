import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Worker for Node.js test environment
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  private _listeners: Record<string, Array<(...args: any[]) => void>> = {};

  constructor(_url: string | URL, _opts?: WorkerOptions) {
    // Simulate ready after construction
    setTimeout(() => {
      this._dispatch({ type: 'ready' });
    }, 0);
  }

  postMessage(_msg: any) {
    // No-op in mock
  }

  addEventListener(type: string, fn: (...args: any[]) => void) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type]!.push(fn);
  }

  removeEventListener(type: string, fn: (...args: any[]) => void) {
    const arr = this._listeners[type];
    if (arr) this._listeners[type] = arr.filter((f) => f !== fn);
  }

  terminate() {
    this._listeners = {};
  }

  private _dispatch(data: any) {
    const handlers = this._listeners['message'] || [];
    for (const fn of handlers) {
      fn({ data } as MessageEvent);
    }
  }
}

let origWorker: typeof Worker;

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
      expect(count).toBeLessThanOrEqual(4);
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
        delete (navigator as any).hardwareConcurrency;
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
        reject: mockReject,
        abort: { abort: vi.fn() },
        timeout: setTimeout(() => {}, 10000) as unknown as ReturnType<typeof setTimeout>,
        workerIndex: 0,
      } as any);
      pending.push({
        id: 2,
        reject: vi.fn(),
        abort: { abort: vi.fn() },
        timeout: setTimeout(() => {}, 10000) as unknown as ReturnType<typeof setTimeout>,
        workerIndex: 0,
      } as any);

      workerPool.cancelAllWorkerJobs();

      expect(pending.length).toBe(0);
      expect(mockReject).toHaveBeenCalledWith(new Error('cancelled'));
    });
  });
});
