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

function mockBitmap(): ImageBitmap {
  return { width: 1, height: 1, close: vi.fn() } as unknown as ImageBitmap;
}

function renderCommand(
  overrides: Partial<Extract<WorkerCommand, { type: 'render' }>> = {},
): Extract<WorkerCommand, { type: 'render' }> {
  return {
    type: 'render',
    nodes: [],
    ir: [],
    camera: { pan: { x: 0, y: 0 }, zoom: 1 },
    viewport: { width: 100, height: 100 },
    docVersion: 1,
    dpr: 1,
    ...overrides,
  };
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

  it('never retries a render whose ImageBitmaps were transferred', () => {
    const onPermanentFailure = vi.fn();
    const host = createRenderWorkerHost(vi.fn(), onPermanentFailure);
    const bitmap = mockBitmap();
    const command = renderCommand({ images: { image: bitmap } });

    expect(host!.post(command, [bitmap])).toBe(true);
    mockWorkers[0]!.onerror!();
    vi.runAllTimers();

    expect(host!.permanentFailure).toBe(true);
    expect(onPermanentFailure).toHaveBeenCalledTimes(1);
    expect(mockWorkers).toHaveLength(1);
    expect(mockWorkers[0]!.postMessage).toHaveBeenCalledTimes(1);
  });

  it('closes render ImageBitmaps when a permanent host refuses the post', () => {
    const host = createRenderWorkerHost(vi.fn());
    host!.terminate();
    const bitmap = mockBitmap();

    expect(host!.post(renderCommand({ images: { image: bitmap } }), [bitmap])).toBe(false);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('closes render ImageBitmaps and signals fallback when postMessage throws', () => {
    const onPermanentFailure = vi.fn();
    const host = createRenderWorkerHost(vi.fn(), onPermanentFailure);
    const bitmap = mockBitmap();
    mockWorkers[0]!.postMessage.mockImplementationOnce(() => {
      throw new DOMException('detached', 'DataCloneError');
    });

    expect(host!.post(renderCommand({ images: { image: bitmap } }), [bitmap])).toBe(false);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(host!.permanentFailure).toBe(true);
    expect(onPermanentFailure).toHaveBeenCalledTimes(1);
  });

  it('closes and drops frames whose viewport identity does not match the latest render', () => {
    const onResponse = vi.fn();
    const host = createRenderWorkerHost(onResponse);
    expect(host!.post(renderCommand())).toBe(true);
    const bitmap = mockBitmap();

    mockWorkers[0]!.onmessage!(
      new MessageEvent('message', {
        data: {
          type: 'frameRendered',
          docVersion: 1,
          camera: { pan: { x: 0, y: 0 }, zoom: 1 },
          viewport: { width: 200, height: 100 },
          dpr: 1,
          bitmap,
        },
      }),
    );

    expect(onResponse).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('closes and drops frames whose DPR does not match the latest render', () => {
    const onResponse = vi.fn();
    const host = createRenderWorkerHost(onResponse);
    expect(host!.post(renderCommand({ dpr: 2 }))).toBe(true);
    const bitmap = mockBitmap();

    mockWorkers[0]!.onmessage!(
      new MessageEvent('message', {
        data: {
          type: 'frameRendered',
          docVersion: 1,
          camera: { pan: { x: 0, y: 0 }, zoom: 1 },
          viewport: { width: 100, height: 100 },
          dpr: 1,
          bitmap,
        },
      }),
    );

    expect(onResponse).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('forwards frames whose viewport and DPR match the latest render', () => {
    const onResponse = vi.fn();
    const host = createRenderWorkerHost(onResponse);
    expect(host!.post(renderCommand())).toBe(true);
    const bitmap = mockBitmap();
    const response = {
      type: 'frameRendered' as const,
      docVersion: 1,
      camera: { pan: { x: 0, y: 0 }, zoom: 1 },
      viewport: { width: 100, height: 100 },
      dpr: 1,
      bitmap,
    };

    mockWorkers[0]!.onmessage!(new MessageEvent('message', { data: response }));

    expect(onResponse).toHaveBeenCalledWith(response);
    expect(bitmap.close).not.toHaveBeenCalled();
  });
});
