/**
 * Scheduler: priority ordering, bounded queue, deduplication with
 * latest-wins revision replacement, cancellation (queued + running), layer-
 * scoped teardown, and synchronous execution when idle.
 */
import { describe, expect, it } from 'vitest';
import {
  PYRAMID_PRIORITY_BACKGROUND,
  PYRAMID_PRIORITY_VIEWPORT,
  type PyramidJob,
  PyramidScheduler,
} from './scheduler';

interface Payload {
  pixelMode: boolean;
}

function job(
  key: string,
  priority: number,
  revision = 'r1',
  payload: Payload = { pixelMode: false },
): Omit<PyramidJob<Payload>, 'cancelled' | 'enqueuedAt'> {
  return {
    id: key,
    key,
    revision,
    priority,
    layerId: 'layer-1',
    level: 1,
    col: 0,
    row: 0,
    payload,
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

describe('priority ordering', () => {
  it('runs viewport-priority jobs before background ones', async () => {
    const order: string[] = [];
    const release: { fn: (() => void) | null } = { fn: null };
    const scheduler = new PyramidScheduler<Payload>({
      run: (j) => {
        order.push(j.key);
        if (j.key === 'bg-1') {
          return new Promise<void>((resolve) => {
            release.fn = () => resolve();
          });
        }
      },
    });
    scheduler.enqueue(job('bg-1', PYRAMID_PRIORITY_BACKGROUND)); // runs, blocks
    scheduler.enqueue(job('vp-1', PYRAMID_PRIORITY_VIEWPORT)); // queued
    scheduler.enqueue(job('vp-2', PYRAMID_PRIORITY_VIEWPORT)); // queued
    scheduler.enqueue(job('bg-2', PYRAMID_PRIORITY_BACKGROUND)); // queued
    release.fn?.();
    await flush();
    expect(order).toEqual(['bg-1', 'vp-1', 'vp-2', 'bg-2']);
  });

  it('respects max concurrency', async () => {
    const order: string[] = [];
    const scheduler = new PyramidScheduler<Payload>({
      maxConcurrency: 2,
      run: (j) => {
        order.push(j.key);
        return Promise.resolve();
      },
    });
    for (let i = 0; i < 6; i++) scheduler.enqueue(job(`t${i}`, PYRAMID_PRIORITY_BACKGROUND));
    await flush();
    expect(order.length).toBe(6);
    expect(order.slice(0, 2)).toEqual(['t0', 't1']);
  });
});

describe('deduplication (latest wins)', () => {
  it('a newer revision for the same key cancels the in-flight job and runs once', async () => {
    const seen: Array<{ key: string; cancelledAtEnd: boolean }> = [];
    const jobs = new Map<string, PyramidJob<Payload>>();
    const release: { fn: (() => void) | null } = { fn: null };
    const scheduler = new PyramidScheduler<Payload>({
      run: (j) => {
        jobs.set(j.key, j);
        seen.push({ key: j.key, cancelledAtEnd: false });
        if (j.revision === 'r10') {
          return new Promise<void>((resolve) => {
            release.fn = () => resolve();
          });
        }
      },
    });
    scheduler.enqueue(job('tile-a', PYRAMID_PRIORITY_VIEWPORT, 'r10')); // runs, blocks
    const r10 = jobs.get('tile-a')!;
    scheduler.enqueue(job('tile-a', PYRAMID_PRIORITY_VIEWPORT, 'r11')); // cancels r10, queues r11
    scheduler.enqueue(job('tile-b', PYRAMID_PRIORITY_BACKGROUND, 'r1'));
    release.fn?.();
    await flush();
    // r10 ran (was cancelled before its result could commit), then r11, then b.
    expect(seen.map((s) => s.key)).toEqual(['tile-a', 'tile-a', 'tile-b']);
    expect(r10.cancelled).toBe(true); // stale result must be discarded
    expect(jobs.get('tile-a')!.revision).toBe('r11');
  });

  it('a duplicate of a queued job is a no-op', async () => {
    const order: string[] = [];
    const release: { fn: (() => void) | null } = { fn: null };
    const scheduler = new PyramidScheduler<Payload>({
      run: (j) => {
        order.push(j.key);
        if (j.key === 'x') {
          return new Promise<void>((resolve) => {
            release.fn = () => resolve();
          });
        }
      },
    });
    scheduler.enqueue(job('x', PYRAMID_PRIORITY_VIEWPORT)); // running, blocks
    scheduler.enqueue(job('tile-a', PYRAMID_PRIORITY_VIEWPORT, 'r10')); // queued
    scheduler.enqueue(job('tile-a', PYRAMID_PRIORITY_VIEWPORT, 'r10')); // no-op
    release.fn?.();
    await flush();
    expect(order).toEqual(['x', 'tile-a']);
    expect(scheduler.diagnostics().dropped).toBe(0);
  });
});

describe('cancellation', () => {
  it('cancel removes a queued job and marks running jobs', async () => {
    const order: string[] = [];
    const release: { fn: (() => void) | null } = { fn: null };
    const scheduler = new PyramidScheduler<Payload>({
      run: (j) => {
        order.push(j.key);
        if (j.key === 'slow') {
          return new Promise<void>((resolve) => {
            release.fn = () => resolve();
          });
        }
      },
    });
    scheduler.enqueue(job('slow', PYRAMID_PRIORITY_VIEWPORT));
    scheduler.enqueue(job('queued', PYRAMID_PRIORITY_VIEWPORT));
    expect(scheduler.cancel('queued')).toBe(true);
    expect(scheduler.cancel('slow')).toBe(true); // running job marked cancelled
    release.fn?.();
    await flush();
    expect(order).toEqual(['slow']);
    expect(scheduler.diagnostics().cancelled).toBe(2);
  });

  it('cancelLayer drops every job of a layer including running ones', async () => {
    const order: string[] = [];
    const release: { fn: (() => void) | null } = { fn: null };
    const scheduler = new PyramidScheduler<Payload>({
      run: (j) => {
        order.push(j.key);
        if (j.key === 'a') {
          return new Promise<void>((resolve) => {
            release.fn = () => resolve();
          });
        }
      },
    });
    scheduler.enqueue({ ...job('a', PYRAMID_PRIORITY_VIEWPORT), layerId: 'layer-1' });
    scheduler.enqueue({ ...job('b', PYRAMID_PRIORITY_VIEWPORT), layerId: 'layer-1' });
    scheduler.enqueue({ ...job('c', PYRAMID_PRIORITY_VIEWPORT), layerId: 'layer-2' });
    expect(scheduler.cancelLayer('layer-1')).toBe(2);
    expect(scheduler.queuedCount).toBe(1); // only layer-2's job remains
    release.fn?.();
    await flush();
    expect(order).toEqual(['a', 'c']); // b never ran; c (layer-2) still runs
  });
});

describe('bounded queue', () => {
  it('rejects jobs beyond the cap', async () => {
    const scheduler = new PyramidScheduler<Payload>({
      maxConcurrency: 1,
      maxQueued: 2,
      run: (j) => {
        if (j.key === 'a') {
          return new Promise<void>(() => {
            /* never resolves: keeps the queue occupied */
          });
        }
      },
    });
    expect(scheduler.enqueue(job('a', PYRAMID_PRIORITY_BACKGROUND))).toBe(true); // running
    expect(scheduler.enqueue(job('b', PYRAMID_PRIORITY_BACKGROUND))).toBe(true); // queued 1
    expect(scheduler.enqueue(job('c', PYRAMID_PRIORITY_BACKGROUND))).toBe(true); // queued 2
    expect(scheduler.enqueue(job('d', PYRAMID_PRIORITY_BACKGROUND))).toBe(false); // full
    expect(scheduler.diagnostics().rejected).toBe(1);
  });

  it('dispose empties the queue and cancels running work', () => {
    const scheduler = new PyramidScheduler<Payload>({ run: () => {} });
    scheduler.enqueue(job('a', PYRAMID_PRIORITY_BACKGROUND));
    scheduler.dispose();
    expect(scheduler.enqueue(job('b', PYRAMID_PRIORITY_BACKGROUND))).toBe(false);
    expect(scheduler.queuedCount).toBe(0);
  });
});

describe('diagnostics', () => {
  it('tracks completion counts', () => {
    const scheduler = new PyramidScheduler<Payload>({ run: () => {} });
    scheduler.enqueue(job('a', PYRAMID_PRIORITY_VIEWPORT));
    scheduler.enqueue(job('b', PYRAMID_PRIORITY_BACKGROUND));
    const d = scheduler.diagnostics();
    expect(d.completed).toBe(2);
    expect(d.queued).toBe(0);
    expect(d.running).toBe(0);
  });
});
