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
    // The drain chain (requestIdleCallback → setTimeout(0) → promise) can be
    // delayed arbitrarily under parallel load; a fixed wall-clock wait raced
    // it (seen 2026-08-14: all three assertions failed with 0 calls after
    // 100ms in the full-suite run, passing 10/10 in isolation). Wait for the
    // condition instead — the assertions below are unchanged.
    await vi.waitFor(() => {
      expect(a.ran).toHaveBeenCalledTimes(1);
      expect(b.ran).toHaveBeenCalledTimes(1);
      expect(c.ran).toHaveBeenCalledTimes(1);
    });
    // All three ran; the visible one ran first.
    const order = [c, b, a].map((x) => x.ran.mock.invocationCallOrder[0]);
    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]!).toBeLessThan(order[2]!);
  });

  it('deduplicates by key — a newer enqueue replaces the queued job', async () => {
    const first = job('k', 'background');
    const second = job('k', 'visible');
    scheduler.enqueue(first.j);
    scheduler.enqueue(second.j);
    await vi.waitFor(() => {
      expect(second.ran).toHaveBeenCalledTimes(1);
    });
    // Deduplication replaced the queued job in place, so once the replacement
    // has run the original can never run.
    expect(first.ran).not.toHaveBeenCalled();
  });

  it('aborts a running job when a newer request for the same key arrives', async () => {
    const first = job('k', 'visible', 500);
    scheduler.enqueue(first.j);
    // Wait until the first job is exactly the one running (queued drained,
    // one active) before enqueueing the replacement — deterministic under
    // any load, unlike a fixed wall-clock wait. The 500ms delay keeps the
    // state observable for the poll interval; the 10ms poll catches it.
    await vi.waitFor(
      () => {
        expect(scheduler.pendingCount).toBe(0);
        expect(scheduler.activeCount).toBe(1);
      },
      { interval: 10 },
    );
    const second = job('k', 'visible', 10);
    scheduler.enqueue(second.j);
    await vi.waitFor(() => {
      expect(second.ran).toHaveBeenCalled();
    });
    expect(first.ran).toHaveBeenCalled();
  });

  it('cancels queued jobs by key', async () => {
    const slow = job('slow', 'visible', 500);
    const queued = job('q', 'background');
    scheduler.enqueue(slow.j);
    scheduler.enqueue(queued.j);
    // Wait until slow is running and q is still queued (exact queue state,
    // not elapsed time) before cancelling.
    await vi.waitFor(
      () => {
        expect(scheduler.pendingCount).toBe(1);
        expect(scheduler.activeCount).toBe(1);
      },
      { interval: 10 },
    );
    scheduler.cancel('q');
    await vi.waitFor(() => {
      expect(scheduler.pendingCount).toBe(0);
      expect(scheduler.activeCount).toBe(0);
    });
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
    await vi.waitFor(() => {
      expect(ok.ran).toHaveBeenCalledTimes(1);
    });
  });

  it('provides an application-wide singleton', () => {
    const global = getThumbnailScheduler();
    expect(getThumbnailScheduler()).toBe(global);
    expect(global.maxConcurrency).toBe(1);
  });
});
