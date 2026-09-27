import { asRenderRevision } from '@varve/shared';
import { describe, expect, it, vi } from 'vitest';
import { submitWorkerFrame, WORKER_IMAGE_COLLECTION_TIMEOUT_MS } from './workerFrameSubmission';
import type { RenderWorkerHost } from './workerHost';

const revision = asRenderRevision(7);
const command = {
  ir: [],
  camera: { zoom: 1, pan: { x: 0, y: 0 } },
  viewport: { width: 800, height: 600 },
  docVersion: 3,
  dpr: 1,
};

function args(overrides: Partial<Parameters<typeof submitWorkerFrame>[0]> = {}) {
  const fallbackRevision = { current: null as number | null };
  const requestFallback = vi.fn();
  const post = vi.fn(() => true);
  const base = {
    collection: Promise.resolve({ images: {}, transfer: [], bytes: 0, sources: [] }),
    host: () => ({ post }) as unknown as RenderWorkerHost,
    currentRevision: () => revision,
    renderRevision: revision,
    fallbackRevision,
    command,
    requestFallback,
  };
  return { ...base, ...overrides, fallbackRevision, requestFallback, post };
}

describe('worker frame submission fallback', () => {
  it('schedules an authoritative redraw when image collection declines', async () => {
    const setup = args({ collection: Promise.resolve(null) });

    await submitWorkerFrame(setup);

    expect(setup.fallbackRevision.current).toBe(revision);
    expect(setup.requestFallback).toHaveBeenCalledWith('worker-collection-fallback');
    expect(setup.post).not.toHaveBeenCalled();
  });

  it('schedules an authoritative redraw when image collection rejects', async () => {
    const setup = args({ collection: Promise.reject(new Error('decode unavailable')) });

    await submitWorkerFrame(setup);

    expect(setup.fallbackRevision.current).toBe(revision);
    expect(setup.requestFallback).toHaveBeenCalledWith('worker-collection-error');
    expect(setup.post).not.toHaveBeenCalled();
  });

  it('falls back when image collection expires and closes any late result', async () => {
    vi.useFakeTimers();
    let resolveCollection!: (value: {
      images: Record<string, ImageBitmap>;
      transfer: Transferable[];
      bytes: number;
      sources: string[];
    }) => void;
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const collection = new Promise<
      Exclude<Awaited<Parameters<typeof submitWorkerFrame>[0]['collection']>, null>
    >((resolve) => {
      resolveCollection = resolve;
    });
    const setup = args({ collection });
    const submitted = submitWorkerFrame(setup);

    await vi.advanceTimersByTimeAsync(WORKER_IMAGE_COLLECTION_TIMEOUT_MS);
    await submitted;

    expect(setup.fallbackRevision.current).toBe(revision);
    expect(setup.requestFallback).toHaveBeenCalledWith('worker-collection-timeout');
    resolveCollection({
      images: { 'asset://late': bitmap },
      transfer: [bitmap],
      bytes: 4,
      sources: [],
    });
    await Promise.resolve();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('closes collected images when a newer render overtakes collection', async () => {
    type CollectedImages = Exclude<
      Awaited<Parameters<typeof submitWorkerFrame>[0]['collection']>,
      null
    >;
    let resolveCollection!: (value: CollectedImages) => void;
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const collection = new Promise<CollectedImages>((resolve) => {
      resolveCollection = resolve;
    });
    let currentRevision = revision;
    const setup = args({ collection, currentRevision: () => currentRevision });
    const submitted = submitWorkerFrame(setup);
    currentRevision = asRenderRevision(8);
    resolveCollection({
      images: { 'asset://a': bitmap },
      transfer: [bitmap],
      bytes: 4,
      sources: [],
    });

    await submitted;

    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(setup.fallbackRevision.current).toBeNull();
    expect(setup.requestFallback).not.toHaveBeenCalled();
    expect(setup.post).not.toHaveBeenCalled();
  });

  it('falls back when worker admission refuses the current render', async () => {
    const setup = args();
    setup.post.mockReturnValue(false);

    await submitWorkerFrame(setup);

    expect(setup.fallbackRevision.current).toBe(revision);
    expect(setup.requestFallback).toHaveBeenCalledWith('worker-admission-fallback');
  });

  it('closes collected images and falls back if the worker host disappeared', async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const setup = args({
      collection: Promise.resolve({
        images: { 'asset://a': bitmap },
        transfer: [bitmap],
        bytes: 4,
        sources: ['asset://a'],
      }),
      host: () => null,
    });

    await submitWorkerFrame(setup);

    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(setup.fallbackRevision.current).toBe(revision);
    expect(setup.requestFallback).toHaveBeenCalledWith('worker-host-unavailable');
  });
});
