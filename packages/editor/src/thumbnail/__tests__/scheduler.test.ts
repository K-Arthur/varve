import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getThumbnailScheduler,
  setThumbnailSchedulerForTest,
  type ThumbnailJob,
  ThumbnailScheduler,
} from '../scheduler';

function job(
  key: string,
  priority: 'visible' | 'current-doc' | 'background' | 'idle' = 'background',
  delay = 0,
): { j: ThumbnailJob; ran: ReturnType<typeof vi.fn> } {
  const ran = vi.fn(async (signal: AbortSignal) => {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    void signal.aborted;
  });
  return { j: { key, priority, run: ran }, ran };
}

describe('ThumbnailScheduler', () => {
  let scheduler: ThumbnailScheduler;

  beforeEach(() => {
    scheduler = new ThumbnailScheduler(1);
  });

  afterEach(() => {
    scheduler.shutdown();
    setThumbnailSchedulerForTest(null);
  });

  it('runs jobs in priority order with bounded concurrency', async () => {
    const a = job('a', 'idle');
    const b = job('b', 'background');
    const c = job('c', 'visible');
    scheduler.enqueue(a.j);
    scheduler.enqueue(b.j);
    scheduler.enqueue(c.j);
    await new Promise((resolve) => setTimeout(resolve, 100));
    // All three ran; the visible one ran first.
    expect(a.ran).toHaveBeenCalledTimes(1);
    expect(b.ran).toHaveBeenCalledTimes(1);
    expect(c.ran).toHaveBeenCalledTimes(1);
    const order = [c, b, a].map((x) => x.ran.mock.invocationCallOrder[0]);
    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]!).toBeLessThan(order[2]!);
  });

  it('deduplicates by key — a newer enqueue replaces the queued job', async () => {
    const first = job('k', 'background');
    const second = job('k', 'visible');
    scheduler.enqueue(first.j);
    scheduler.enqueue(second.j);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(first.ran).not.toHaveBeenCalled();
    expect(second.ran).toHaveBeenCalledTimes(1);
  });

  it('aborts a running job when a newer request for the same key arrives', async () => {
    const first = job('k', 'visible', 60);
    scheduler.enqueue(first.j);
    // Let the first job start running.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = job('k', 'visible', 10);
    scheduler.enqueue(second.j);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(first.ran).toHaveBeenCalled();
    expect(second.ran).toHaveBeenCalled();
  });

  it('cancels queued jobs by key', async () => {
    const slow = job('slow', 'visible', 40);
    const queued = job('q', 'background');
    scheduler.enqueue(slow.j);
    scheduler.enqueue(queued.j);
    await new Promise((resolve) => setTimeout(resolve, 10));
    scheduler.cancel('q');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(slow.ran).toHaveBeenCalledTimes(1);
    expect(queued.ran).not.toHaveBeenCalled();
  });

  it('reports pending and active counts', () => {
    scheduler.enqueue(job('a').j);
    scheduler.enqueue(job('b').j);
    expect(scheduler.pendingCount).toBe(2);
    expect(scheduler.activeCount).toBe(0);
    expect(scheduler.has('a')).toBe(true);
  });

  it('shutdown aborts running jobs and refuses new ones', async () => {
    const slow = job('s', 'visible', 60);
    scheduler.enqueue(slow.j);
    await new Promise((resolve) => setTimeout(resolve, 10));
    scheduler.shutdown();
    scheduler.enqueue(job('late').j);
    expect(scheduler.isShutdown).toBe(true);
    expect(scheduler.pendingCount).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(scheduler.pendingCount).toBe(0);
  });

  it('survives job failures without blocking later jobs', async () => {
    const failing: ThumbnailJob = {
      key: 'f',
      priority: 'background',
      run: () => {
        throw new Error('boom');
      },
    };
    const ok = job('ok', 'background');
    scheduler.enqueue(failing);
    scheduler.enqueue(ok.j);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ok.ran).toHaveBeenCalledTimes(1);
  });

  it('provides an application-wide singleton', () => {
    const global = getThumbnailScheduler();
    expect(getThumbnailScheduler()).toBe(global);
    expect(global.maxConcurrency).toBe(1);
  });
});
