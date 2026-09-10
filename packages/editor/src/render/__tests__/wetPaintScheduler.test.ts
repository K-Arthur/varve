import { WetPaintManager } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { WetPaintScheduler } from '../wetPaintScheduler';

/** Manual frame pump so drying can be stepped deterministically. */
function makeHarness(dryingRate = 4) {
  const frames: Array<(t: number) => void> = [];
  const manager = new WetPaintManager();
  let clock = 0;
  const onDirty = vi.fn();
  const scheduler = new WetPaintScheduler({
    manager,
    dryingRate: () => dryingRate,
    onDirty,
    requestFrame: (cb) => {
      frames.push(cb);
      return frames.length;
    },
    cancelFrame: () => {
      frames.length = 0;
    },
    now: () => clock,
  });
  const pump = (advanceMs = 100) => {
    clock += advanceMs;
    const next = frames.shift();
    next?.(clock);
  };
  return { manager, scheduler, pump, frames, onDirty, advance: (ms: number) => (clock += ms) };
}

describe('wet paint scheduler', () => {
  it('does not schedule anything for a dry document', () => {
    const { scheduler, frames } = makeHarness();
    scheduler.wake();
    expect(scheduler.isRunning).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it('starts once paint is wet', () => {
    const { manager, scheduler, frames } = makeHarness();
    manager.addPaint('layer', 5, 5, [255, 0, 0, 255], 1, 0.5);
    scheduler.wake();
    expect(scheduler.isRunning).toBe(true);
    expect(frames).toHaveLength(1);
  });

  it('does not stack frames when woken repeatedly', () => {
    const { manager, scheduler, frames } = makeHarness();
    manager.addPaint('layer', 5, 5, [255, 0, 0, 255], 1, 0.5);
    scheduler.wake();
    scheduler.wake();
    scheduler.wake();
    expect(frames).toHaveLength(1);
  });

  it('stops completely once everything is dry', () => {
    const { manager, scheduler, pump } = makeHarness(4);
    manager.addPaint('layer', 5, 5, [255, 0, 0, 255], 1, 0.5);
    scheduler.wake();
    for (let i = 0; i < 50 && scheduler.isRunning; i++) pump(100);

    expect(manager.isActive).toBe(false);
    expect(scheduler.isRunning).toBe(false);

    // The decisive property: an idle dry document consumes no further frames.
    const before = scheduler.framesRun;
    scheduler.wake();
    expect(scheduler.framesRun).toBe(before);
    expect(scheduler.isRunning).toBe(false);
  });

  it('reports dirty regions while drying', () => {
    const { manager, scheduler, pump, onDirty } = makeHarness();
    manager.addPaint('layer', 5, 5, [255, 0, 0, 255], 1, 0.5);
    scheduler.wake();
    pump(0); // first frame only establishes the clock
    pump(100);
    expect(onDirty).toHaveBeenCalled();
    expect(onDirty.mock.calls[0]![0]).toEqual([{ x: 0, y: 0, w: 64, h: 64 }]);
  });

  it('suspends without drying the paint away', () => {
    const { manager, scheduler, pump } = makeHarness();
    manager.addPaint('layer', 5, 5, [255, 0, 0, 255], 1, 0.5);
    scheduler.wake();
    pump(0);
    scheduler.suspend();
    expect(scheduler.isRunning).toBe(false);
    expect(manager.isActive).toBe(true);

    // Resuming an hour later measures from resume, not from suspend.
    scheduler.wake();
    pump(3_600_000);
    expect(manager.isActive).toBe(true);
  });
});
