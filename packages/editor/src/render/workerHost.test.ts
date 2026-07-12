import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerCommand } from './workerHost';
import { createRenderWorkerHost } from './workerHost';

const mockWorkers: MockWorker[] = [];

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor(_url: URL | string, _opts?: WorkerOptions) {
    mockWorkers.push(this);
  }
}

describe('render worker host restarts', () => {
  beforeEach(() => {
    mockWorkers.length = 0;
    vi.useFakeTimers();
    (globalThis as unknown as { Worker: typeof MockWorker }).Worker = MockWorker;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as unknown as { Worker?: typeof MockWorker }).Worker;
  });

  it('skips worker creation entirely when OffscreenCanvas is unavailable, instead of spinning up a worker that will only fail on first render', () => {
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;
    // @ts-expect-error simulating an engine (e.g. an unpatched WebKitGTK) without OffscreenCanvas
    delete globalThis.OffscreenCanvas;

    try {
      const host = createRenderWorkerHost(vi.fn());
      expect(host).toBeNull();
      expect(mockWorkers.length).toBe(0);
    } finally {
      globalThis.OffscreenCanvas = originalOffscreenCanvas;
    }
  });

  it('worker error triggers restart after backoff', () => {
    const onResponse = vi.fn();
    const onPermanentFailure = vi.fn();
    const host = createRenderWorkerHost(onResponse, onPermanentFailure);
    expect(host).not.toBeNull();
    expect(host!.restartCount).toBe(0);
    expect(host!.permanentFailure).toBe(false);

    const firstWorker = mockWorkers[0]!;
    const renderCmd: WorkerCommand = {
      type: 'render',
      nodes: [],
      ir: [],
      camera: { pan: { x: 0, y: 0 }, zoom: 1 },
      viewport: { width: 100, height: 100 },
      docVersion: 1,
      dpr: 1,
    };
    host!.post(renderCmd);
    expect(firstWorker.postMessage).toHaveBeenCalledTimes(1);

    firstWorker.onerror!();

    expect(firstWorker.terminate).toHaveBeenCalledTimes(1);
    expect(mockWorkers.length).toBe(2);

    const secondWorker = mockWorkers[1]!;
    expect(secondWorker.postMessage).not.toHaveBeenCalled();
    expect(host!.restartCount).toBe(1);

    vi.advanceTimersByTime(2000);

    expect(secondWorker.postMessage).toHaveBeenCalledWith(renderCmd);
    expect(onPermanentFailure).not.toHaveBeenCalled();
  });

  it('worker fails 5 times triggers permanentFailure', () => {
    const onResponse = vi.fn();
    const onPermanentFailure = vi.fn();
    const host = createRenderWorkerHost(onResponse, onPermanentFailure);
    expect(host).not.toBeNull();

    const renderCmd: WorkerCommand = {
      type: 'render',
      nodes: [],
      ir: [],
      camera: { pan: { x: 0, y: 0 }, zoom: 1 },
      viewport: { width: 100, height: 100 },
      docVersion: 1,
      dpr: 1,
    };
    host!.post(renderCmd);

    for (let i = 0; i < 4; i++) {
      const w = mockWorkers[i]!;
      w.onerror!();
      const delay = Math.min(2 ** (i + 1), 30) * 1000;
      vi.advanceTimersByTime(delay);
    }

    expect(host!.restartCount).toBe(4);
    expect(host!.permanentFailure).toBe(false);

    mockWorkers[4]!.onerror!();

    expect(host!.restartCount).toBe(5);
    expect(host!.permanentFailure).toBe(true);
    expect(onPermanentFailure).toHaveBeenCalledTimes(1);
  });

  it('worker restart re-sends last render command', () => {
    const onResponse = vi.fn();
    const host = createRenderWorkerHost(onResponse);
    expect(host).not.toBeNull();

    const renderCmd: WorkerCommand = {
      type: 'render',
      nodes: [],
      ir: [],
      camera: { pan: { x: 10, y: 20 }, zoom: 2 },
      viewport: { width: 800, height: 600 },
      docVersion: 5,
      dpr: 2,
    };
    host!.post(renderCmd);

    const firstWorker = mockWorkers[0]!;
    expect(firstWorker.postMessage).toHaveBeenCalledWith(renderCmd);

    firstWorker.onerror!();

    vi.advanceTimersByTime(2000);

    const secondWorker = mockWorkers[1]!;
    expect(secondWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'render', docVersion: 5 }),
    );

    expect(host!.restartCount).toBe(1);
    expect(host!.permanentFailure).toBe(false);
  });
});
