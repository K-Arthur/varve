import type { RenderItem } from '@varve/engine';
import { getImageCache, resetImageCache } from '@varve/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePressureBudgets } from '../canvas/memoryBudget';
import { collectImageBitmaps } from './collectImageBitmaps';
import { injectFault } from './faultInjection';
import { createRenderWorkerHost } from './workerHost';

function bitmap(close: () => void): ImageBitmap {
  return { width: 1, height: 1, close } as unknown as ImageBitmap;
}

function image(src: string): HTMLImageElement {
  return { src, naturalWidth: 1, naturalHeight: 1 } as unknown as HTMLImageElement;
}

function imageItem(...srcs: string[]): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    fills: srcs.map((src) => ({
      type: 'image',
      src,
      fit: 'fill',
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    })),
    primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    opacity: 1,
    blendMode: 'normal',
  };
}

const mockWorkers: Array<{
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: (() => void) | null;
  postMessage: (msg: unknown) => void;
  terminate: () => void;
}> = [];

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor(_url: URL | string, _opts?: WorkerOptions) {
    mockWorkers.push(this);
  }
}

function renderCommand(overrides: Record<string, unknown> = {}) {
  return {
    type: 'render' as const,
    nodes: [],
    ir: [],
    camera: { pan: { x: 0, y: 0 }, zoom: 1 },
    viewport: { width: 100, height: 100 },
    docVersion: 1,
    dpr: 1,
    ...overrides,
  };
}

describe('fault injection — graceful degradation', () => {
  beforeEach(() => {
    injectFault('none');
    mockWorkers.length = 0;
    (globalThis as unknown as { Worker: typeof MockWorker }).Worker = MockWorker;
    resetImageCache();
  });

  afterEach(() => {
    injectFault('none');
    vi.restoreAllMocks();
    delete (globalThis as unknown as { Worker?: typeof MockWorker }).Worker;
  });

  it('a worker-start fault makes the host report null (main-thread fallback, no retry loop)', () => {
    injectFault('worker-start');
    const host = createRenderWorkerHost(vi.fn());
    expect(host).toBeNull();
    expect(mockWorkers.length).toBe(0);
  });

  it('a postMessage fault marks the host permanently failed, closes bitmaps, returns false', () => {
    injectFault('post-message');
    const onPermanentFailure = vi.fn();
    const host = createRenderWorkerHost(vi.fn(), onPermanentFailure)!;
    const bmp = bitmap(vi.fn());
    expect(host.post(renderCommand({ images: { a: bmp } }), [bmp])).toBe(false);
    expect(host.permanentFailure).toBe(true);
    expect(onPermanentFailure).toHaveBeenCalledTimes(1);
    expect(bmp.close).toHaveBeenCalledTimes(1);
  });

  it('a createImageBitmap fault makes collection fail gracefully', async () => {
    injectFault('image-bitmap-create');
    getImageCache().setLoaded('a.png', image('a.png'));
    globalThis.createImageBitmap = vi.fn();

    // The fault throws before any decode, so nothing is allocated and the
    // caller receives null (main-thread fallback) rather than a throw.
    await expect(collectImageBitmaps([imageItem('a.png')])).resolves.toBeNull();
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });

  it('clearing the fault restores normal behavior', async () => {
    injectFault('image-bitmap-create');
    injectFault('none');
    const bmp = bitmap(vi.fn());
    getImageCache().setLoaded('a.png', image('a.png'));
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(bmp);
    const collected = await collectImageBitmaps([imageItem('a.png')]);
    expect(collected).not.toBeNull();
    expect(collected!.images['a.png']).toBe(bmp);
    collected!.images['a.png']!.close();
  });
});

describe('pressure profiles', () => {
  beforeEach(() => {
    injectFault('none');
    mockWorkers.length = 0;
    (globalThis as unknown as { Worker: typeof MockWorker }).Worker = MockWorker;
  });

  afterEach(() => {
    injectFault('none');
    vi.restoreAllMocks();
    delete (globalThis as unknown as { Worker?: typeof MockWorker }).Worker;
  });

  it('2gb tightens every budget below 4gb, which is below normal', () => {
    const normal = resolvePressureBudgets('normal');
    const four = resolvePressureBudgets('4gb');
    const two = resolvePressureBudgets('2gb');
    for (const key of [
      'subtreeIrCacheBytes',
      'workerBitmapBytes',
      'imageCacheBytes',
      'engineNodeMemoEntries',
      'transformCacheEntries',
      'thumbnailCacheEntries',
      'backdropCacheEntries',
      'gradientCacheEntries',
    ] as const) {
      expect(two[key]).toBeLessThanOrEqual(four[key]);
      expect(four[key]).toBeLessThanOrEqual(normal[key]);
    }
  });

  it('2gb worker bitmap budget refuses an over-budget render (graceful fallback)', () => {
    const budgets = resolvePressureBudgets('2gb');
    const host = createRenderWorkerHost(vi.fn(), undefined, {
      budgetBytes: budgets.workerBitmapBytes,
    })!;
    const big = bitmap(vi.fn());
    // 8192x8192x4 = 256 MiB > 32 MiB budget.
    (big as { width: number }).width = 8192;
    (big as { height: number }).height = 8192;
    expect(host.post(renderCommand({ images: { big } }), [big])).toBe(false);
    expect(big.close).toHaveBeenCalledTimes(1);
    expect(host.getBitmapBudgetState().admissionRejections).toBe(1);
    expect(host.getBitmapBudgetState().pendingBytes).toBe(0);
  });

  it('a document does not lose image data when collection is refused — it returns null only', async () => {
    // Collection failure returns null (caller keeps main-thread path); it never
    // mutates the document or throws.
    injectFault('image-bitmap-create');
    getImageCache().setLoaded('a.png', image('a.png'));
    globalThis.createImageBitmap = vi.fn().mockRejectedValue(new DOMException('boom'));
    const result = await collectImageBitmaps([imageItem('a.png')]);
    expect(result).toBeNull();
  });
});
