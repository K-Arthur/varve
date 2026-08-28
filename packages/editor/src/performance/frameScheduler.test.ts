import { describe, expect, it, vi } from 'vitest';
import { createFrameScheduler, resolveFrameSchedulerWorkBudgets } from './frameScheduler';

function makeHarness() {
  let callback: FrameRequestCallback | null = null;
  let now = 0;
  const scheduler = createFrameScheduler({
    requestFrame: (next) => {
      callback = next;
      return 1;
    },
    cancelFrame: () => {
      callback = null;
    },
    now: () => now,
    frameWorkBudgetMs: 8,
  });
  return {
    scheduler,
    advance(ms = 1) {
      now += ms;
      const next = callback;
      callback = null;
      if (next) next(now);
    },
    spend(ms: number) {
      now += ms;
    },
  };
}

describe('frame scheduler', () => {
  it('derives the three work windows from the display interval', () => {
    expect(resolveFrameSchedulerWorkBudgets(20)).toEqual({
      interactionMs: 10,
      authoritativeMs: 18,
      backgroundMs: 5,
    });
    expect(resolveFrameSchedulerWorkBudgets(20, 7).interactionMs).toBe(7);
  });

  it('runs lanes in interaction, canvas, UI, background order', () => {
    const harness = makeHarness();
    const order: string[] = [];
    harness.scheduler.request('background', 'background', () => order.push('background'));
    harness.scheduler.request('ui', 'ui', () => order.push('ui'));
    harness.scheduler.request('canvas', 'canvas', () => order.push('canvas'));
    harness.scheduler.request('input', 'input', () => order.push('input'));
    harness.advance();
    expect(order).toEqual(['input', 'canvas', 'ui', 'background']);
  });

  it('replaces queued work with the latest job for a key', () => {
    const harness = makeHarness();
    const first = vi.fn();
    const latest = vi.fn();
    harness.scheduler.request('canvas-content', 'canvas', first);
    harness.scheduler.request('canvas-content', 'canvas', latest);
    harness.advance();
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
    expect(harness.scheduler.getDiagnostics().replacedJobs).toBe(1);
  });

  it('defers background work while an interaction is active', () => {
    const harness = makeHarness();
    const background = vi.fn();
    harness.scheduler.beginInteraction();
    harness.scheduler.request('prefetch', 'background', background);
    harness.advance();
    expect(background).not.toHaveBeenCalled();
    harness.scheduler.endInteraction();
    harness.advance(150);
    expect(background).toHaveBeenCalledOnce();
  });

  it('reserves authoritative headroom before beginning background work', () => {
    const harness = makeHarness();
    const background = vi.fn();
    harness.scheduler.request('canvas', 'canvas', () => harness.spend(12));
    harness.scheduler.request('prefetch', 'background', background);

    harness.advance();
    expect(background).not.toHaveBeenCalled();
    expect(harness.scheduler.getDiagnostics().deferredBackgroundFrames).toBe(1);

    harness.advance(150);
    expect(background).toHaveBeenCalledOnce();
  });

  it('retains canvas and background jobs while hidden', () => {
    const harness = makeHarness();
    const canvas = vi.fn();
    const background = vi.fn();
    harness.scheduler.setVisible(false);
    harness.scheduler.request('canvas', 'canvas', canvas);
    harness.scheduler.request('background', 'background', background);
    harness.advance();
    expect(canvas).not.toHaveBeenCalled();
    expect(background).not.toHaveBeenCalled();
    harness.scheduler.setVisible(true);
    harness.advance();
    expect(canvas).toHaveBeenCalledOnce();
    expect(background).toHaveBeenCalledOnce();
  });

  it('cancels keyed work and releases all queued work on dispose', () => {
    const harness = makeHarness();
    const job = vi.fn();
    harness.scheduler.request('job', 'canvas', job);
    expect(harness.scheduler.cancel('job')).toBe(true);
    harness.advance();
    expect(job).not.toHaveBeenCalled();
    harness.scheduler.request('job', 'canvas', job);
    harness.scheduler.dispose();
    harness.advance();
    expect(job).not.toHaveBeenCalled();
    expect(harness.scheduler.getDiagnostics().queuedJobs).toBe(0);
  });

  it('cancels the shared RAF when the final keyed job is removed', () => {
    let cancelled = 0;
    const scheduler = createFrameScheduler({
      requestFrame: () => 42,
      cancelFrame: (id) => {
        cancelled = id;
      },
    });
    scheduler.request('only-job', 'input', () => undefined);

    expect(scheduler.cancel('only-job')).toBe(true);
    expect(cancelled).toBe(42);
  });

  it('tracks interaction depth for background-yield decisions', () => {
    const scheduler = createFrameScheduler({});
    expect(scheduler.isInteractionActive()).toBe(false);
    scheduler.beginInteraction();
    expect(scheduler.isInteractionActive()).toBe(true);
    // Overlapping interactions (pointer + wheel) are reference-counted.
    scheduler.beginInteraction();
    scheduler.endInteraction();
    expect(scheduler.isInteractionActive()).toBe(true);
    scheduler.endInteraction();
    expect(scheduler.isInteractionActive()).toBe(false);
    // endInteraction never goes negative: a stray end cannot underflow.
    scheduler.endInteraction();
    expect(scheduler.isInteractionActive()).toBe(false);
  });

  it('resetInteractions force-closes all open interactions', () => {
    const harness = makeHarness();
    harness.scheduler.beginInteraction();
    harness.scheduler.beginInteraction();
    expect(harness.scheduler.isInteractionActive()).toBe(true);
    harness.scheduler.resetInteractions();
    expect(harness.scheduler.isInteractionActive()).toBe(false);
    // Background work runs promptly after the reset.
    const background = vi.fn();
    harness.scheduler.request('bg', 'background', background);
    harness.advance(150);
    expect(background).toHaveBeenCalledOnce();
  });
});
