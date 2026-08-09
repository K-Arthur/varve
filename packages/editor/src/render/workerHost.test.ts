import { asRenderRevision } from '@varve/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerCommand } from './workerHost';
import {
  createRenderWorkerHost,
  disposeWorkerFrame,
  getRegisteredWorkerHost,
  registerWorkerHostForDiagnostics,
} from './workerHost';

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
    expect(firstWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'render', docVersion: 1, renderRevision: 1 }),
    );

    firstWorker.onerror!();

    expect(firstWorker.terminate).toHaveBeenCalledTimes(1);
    expect(mockWorkers.length).toBe(2);

    const secondWorker = mockWorkers[1]!;
    expect(secondWorker.postMessage).not.toHaveBeenCalled();
    expect(host!.restartCount).toBe(1);

    vi.advanceTimersByTime(2000);

    expect(secondWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'render', docVersion: 1, renderRevision: 1 }),
    );
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
    expect(firstWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'render', docVersion: 5, renderRevision: 5 }),
    );

    firstWorker.onerror!();

    vi.advanceTimersByTime(2000);

    const secondWorker = mockWorkers[1]!;
    expect(secondWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'render', docVersion: 5 }),
    );

    expect(host!.restartCount).toBe(1);
    expect(host!.permanentFailure).toBe(false);
  });

  it('restarts with the latest pending render instead of replaying obsolete work', () => {
    const host = createRenderWorkerHost(vi.fn())!;
    host.post(renderCommand({ renderRevision: asRenderRevision(1) }));
    host.post(renderCommand({ docVersion: 2, renderRevision: asRenderRevision(2) }));

    mockWorkers[0]!.onerror!();
    vi.advanceTimersByTime(2000);

    expect(mockWorkers[1]!.postMessage).toHaveBeenCalledTimes(1);
    expect(mockWorkers[1]!.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ docVersion: 2, renderRevision: 2 }),
    );
    expect(host.inFlightRenderRevision).toBe(2);
    expect(host.pendingRenderRevision).toBeNull();
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

  it('exposes image sources already resident or dispatched to the worker', () => {
    const host = createRenderWorkerHost(vi.fn())!;
    const bitmap = mockBitmap();

    expect(host.knownImageSources.size).toBe(0);
    expect(
      host.post(renderCommand({ imageSources: ['fresh'], images: { fresh: bitmap } }), [bitmap]),
    ).toBe(true);
    expect([...host.knownImageSources]).toEqual(['fresh']);

    host.terminate();
    expect(host.knownImageSources.size).toBe(0);
  });

  it('releases transferred bitmap reservations when a render returns an error', () => {
    const host = createRenderWorkerHost(vi.fn())!;
    const bitmap = mockBitmap();

    expect(
      host.post(renderCommand({ imageSources: ['fresh'], images: { fresh: bitmap } }), [bitmap]),
    ).toBe(true);
    expect(host.getBitmapBudgetState().inFlightBytes).toBe(4);

    mockWorkers[0]!.onmessage!(
      new MessageEvent('message', {
        data: {
          type: 'error',
          message: 'render failed',
          docVersion: 1,
          renderRevision: 1,
        },
      }),
    );

    expect(host.getBitmapBudgetState().inFlightBytes).toBe(0);
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
      renderRevision: asRenderRevision(1),
      camera: { pan: { x: 0, y: 0 }, zoom: 1 },
      viewport: { width: 100, height: 100 },
      dpr: 1,
      bitmap,
    };

    mockWorkers[0]!.onmessage!(new MessageEvent('message', { data: response }));

    expect(onResponse).toHaveBeenCalledWith(response);
    expect(bitmap.close).not.toHaveBeenCalled();
  });

  it('keeps one in-flight render and only dispatches the latest pending revision', () => {
    const onResponse = vi.fn();
    const host = createRenderWorkerHost(onResponse)!;
    const supersededBitmap = mockBitmap();
    const staleFrameBitmap = mockBitmap();

    expect(
      host.post(
        renderCommand({
          renderRevision: asRenderRevision(1),
        }),
      ),
    ).toBe(true);
    expect(
      host.post(
        renderCommand({
          renderRevision: asRenderRevision(2),
          images: { superseded: supersededBitmap },
        }),
        [supersededBitmap],
      ),
    ).toBe(true);
    expect(host.post(renderCommand({ renderRevision: asRenderRevision(3) }))).toBe(true);

    expect(mockWorkers[0]!.postMessage).toHaveBeenCalledTimes(1);
    expect(mockWorkers[0]!.postMessage.mock.calls[0]![0]).not.toHaveProperty('nodes');
    expect(supersededBitmap.close).toHaveBeenCalledTimes(1);
    expect(host.inFlightRenderRevision).toBe(1);
    expect(host.pendingRenderRevision).toBe(3);

    mockWorkers[0]!.onmessage!(
      new MessageEvent('message', {
        data: {
          type: 'frameRendered',
          docVersion: 1,
          renderRevision: asRenderRevision(1),
          camera: { pan: { x: 0, y: 0 }, zoom: 1 },
          viewport: { width: 100, height: 100 },
          dpr: 1,
          bitmap: staleFrameBitmap,
        },
      }),
    );

    expect(staleFrameBitmap.close).toHaveBeenCalledTimes(1);
    expect(onResponse).not.toHaveBeenCalled();
    expect(mockWorkers[0]!.postMessage).toHaveBeenCalledTimes(2);
    expect(mockWorkers[0]!.postMessage.mock.calls[1]![0]).toEqual(
      expect.objectContaining({ renderRevision: 3 }),
    );
    expect(host.inFlightRenderRevision).toBe(3);
    expect(host.pendingRenderRevision).toBeNull();
  });

  it('rejects a render older than the latest requested revision and closes its resources', () => {
    const host = createRenderWorkerHost(vi.fn())!;
    const obsoleteBitmap = mockBitmap();
    host.post(renderCommand({ renderRevision: asRenderRevision(5) }));

    expect(
      host.post(
        renderCommand({
          renderRevision: asRenderRevision(4),
          images: { obsolete: obsoleteBitmap },
        }),
        [obsoleteBitmap],
      ),
    ).toBe(false);
    expect(obsoleteBitmap.close).toHaveBeenCalledTimes(1);
    expect(mockWorkers[0]!.postMessage).toHaveBeenCalledTimes(1);
  });

  it('closes a pending render when the host terminates', () => {
    const host = createRenderWorkerHost(vi.fn())!;
    const pendingBitmap = mockBitmap();
    host.post(renderCommand({ renderRevision: asRenderRevision(1) }));
    host.post(
      renderCommand({
        renderRevision: asRenderRevision(2),
        images: { pending: pendingBitmap },
      }),
      [pendingBitmap],
    );

    host.terminate();

    expect(pendingBitmap.close).toHaveBeenCalledTimes(1);
    expect(host.inFlightRenderRevision).toBeNull();
    expect(host.pendingRenderRevision).toBeNull();
  });

  it('refuses a render whose image transfer exceeds the byte budget and closes its bitmaps', () => {
    const onResponse = vi.fn();
    const host = createRenderWorkerHost(onResponse, undefined, {
      budgetBytes: 1000,
    })!;
    const bitmap = mockBitmap();
    // mockBitmap() is 1x1 (4 bytes); patch width/height to exceed the budget.
    (bitmap as { width: number }).width = 64;
    (bitmap as { height: number }).height = 64; // 16,384 bytes > 1000

    expect(host.post(renderCommand({ images: { big: bitmap } }), [bitmap])).toBe(false);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(mockWorkers[0]!.postMessage).not.toHaveBeenCalled();
    expect(host.getBitmapBudgetState().admissionRejections).toBe(1);
  });

  it('accounts pending, in-flight, resident, and worker-canvas bytes', () => {
    const host = createRenderWorkerHost(vi.fn(), undefined, {
      budgetBytes: 1_000_000,
    })!;
    expect(host.post({ type: 'resize', width: 800, height: 600, dpr: 2 })).toBe(true);
    expect(host.getBitmapBudgetState().workerCanvasBytes).toBe(800 * 2 * 600 * 2 * 4);

    const bitmap = mockBitmap();
    expect(host.post(renderCommand({ images: { img: bitmap } }), [bitmap])).toBe(true);
    expect(host.getBitmapBudgetState().inFlightBytes).toBe(4);

    const frame = mockBitmap();
    mockWorkers[0]!.onmessage!(
      new MessageEvent('message', {
        data: {
          type: 'frameRendered',
          docVersion: 1,
          renderRevision: asRenderRevision(1),
          camera: { pan: { x: 0, y: 0 }, zoom: 1 },
          viewport: { width: 100, height: 100 },
          dpr: 1,
          bitmap: frame,
        },
      }),
    );
    expect(host.getBitmapBudgetState().residentBytes).toBe(4);
    expect(host.getBitmapBudgetState().inFlightBytes).toBe(0);
  });

  it('releases resident accounting when the canvas disposes the forwarded frame', () => {
    const host = createRenderWorkerHost(vi.fn(), undefined, {
      budgetBytes: 1_000_000,
    })!;
    expect(host.post(renderCommand())).toBe(true);
    const frame = mockBitmap();
    mockWorkers[0]!.onmessage!(
      new MessageEvent('message', {
        data: {
          type: 'frameRendered',
          docVersion: 1,
          renderRevision: asRenderRevision(1),
          camera: { pan: { x: 0, y: 0 }, zoom: 1 },
          viewport: { width: 100, height: 100 },
          dpr: 1,
          bitmap: frame,
        },
      }),
    );
    expect(host.getBitmapBudgetState().residentBytes).toBe(4);

    disposeWorkerFrame(host, frame);
    expect(frame.close).toHaveBeenCalledTimes(1);
    expect(host.getBitmapBudgetState().residentBytes).toBe(0);
    expect(host.releaseFrame(frame)).toBe(false);
    expect(host.getBitmapBudgetState().residentBytes).toBe(0);
  });

  it('releases in-flight and resident accounting on terminate', () => {
    const host = createRenderWorkerHost(vi.fn(), undefined, {
      budgetBytes: 1_000_000,
    })!;
    const bitmap = mockBitmap();
    expect(host.post(renderCommand({ images: { img: bitmap } }), [bitmap])).toBe(true);
    const frame = mockBitmap();
    mockWorkers[0]!.onmessage!(
      new MessageEvent('message', {
        data: {
          type: 'frameRendered',
          docVersion: 1,
          renderRevision: asRenderRevision(1),
          camera: { pan: { x: 0, y: 0 }, zoom: 1 },
          viewport: { width: 100, height: 100 },
          dpr: 1,
          bitmap: frame,
        },
      }),
    );
    host.terminate();
    const state = host.getBitmapBudgetState();
    expect(state.inFlightBytes).toBe(0);
    expect(state.residentBytes).toBe(0);
    expect(state.pendingBytes).toBe(0);
  });

  it('registers itself as the diagnostics host and unregisters on terminate', () => {
    const host = createRenderWorkerHost(vi.fn())!;
    expect(getRegisteredWorkerHost()).toBe(host);
    host.terminate();
    expect(getRegisteredWorkerHost()).toBeNull();
  });

  it('the latest created host wins the diagnostics slot', () => {
    const first = createRenderWorkerHost(vi.fn())!;
    const second = createRenderWorkerHost(vi.fn())!;
    expect(getRegisteredWorkerHost()).toBe(second);
    first.terminate();
    expect(getRegisteredWorkerHost()).toBe(second);
    second.terminate();
    expect(getRegisteredWorkerHost()).toBeNull();
  });

  it('diagnostics can register/unregister a host explicitly', () => {
    registerWorkerHostForDiagnostics(null);
    expect(getRegisteredWorkerHost()).toBeNull();
    const host = createRenderWorkerHost(vi.fn())!;
    expect(getRegisteredWorkerHost()).toBe(host);
    registerWorkerHostForDiagnostics(null);
    expect(getRegisteredWorkerHost()).toBeNull();
    host.terminate();
  });
});
