import { describe, expect, it } from 'vitest';
import {
  CRASH_LOOP_WINDOW_MS,
  isInCrashLoop,
  MemoryCrashLoopStore,
  recordCleanStartup,
  recordStartupFailure,
  resetCrashLoop,
} from './crashLoop';

describe('crash-loop detection', () => {
  it('needs a threshold of failures inside the window', () => {
    const store = new MemoryCrashLoopStore();
    expect(recordStartupFailure(store, 1000)).toBe(1);
    expect(isInCrashLoop(store, 2000)).toBe(false);
    expect(recordStartupFailure(store, 2000)).toBe(2);
    expect(isInCrashLoop(store, 3000)).toBe(false);
    recordStartupFailure(store, 3000);
    expect(isInCrashLoop(store, 4000)).toBe(true);
  });

  it('expires failures outside the window', () => {
    const store = new MemoryCrashLoopStore();
    recordStartupFailure(store, 1000);
    recordStartupFailure(store, 2000);
    recordStartupFailure(store, 3000);
    expect(isInCrashLoop(store, 4000)).toBe(true);
    // A long-running healthy session pushes the window past the failures.
    expect(isInCrashLoop(store, 4000 + CRASH_LOOP_WINDOW_MS + 1)).toBe(false);
  });

  it('a clean startup resets the failure window', () => {
    const store = new MemoryCrashLoopStore();
    recordStartupFailure(store, 1000);
    recordStartupFailure(store, 2000);
    recordCleanStartup(store, 3000);
    expect(isInCrashLoop(store, 3000)).toBe(false);
    expect(store.load().failures).toEqual([]);
    expect(store.load().lastClean).toBe(3000);
  });

  it('resetCrashLoop clears all state', () => {
    const store = new MemoryCrashLoopStore();
    recordStartupFailure(store, 1000);
    recordStartupFailure(store, 2000);
    recordStartupFailure(store, 3000);
    resetCrashLoop(store);
    expect(store.load().failures).toEqual([]);
    expect(isInCrashLoop(store, 4000)).toBe(false);
  });

  it('keeps only window-visible failures in state', () => {
    const store = new MemoryCrashLoopStore();
    for (let i = 0; i < 20; i++) recordStartupFailure(store, i * 1000);
    // All 20 are inside the 10-minute window at 1s spacing.
    expect(store.load().failures).toHaveLength(20);
    // A later record trims failures older than the window: everything before
    // later-10min is dropped (failures at 4s..19s and the new one remain).
    const later = 4000 + CRASH_LOOP_WINDOW_MS;
    recordStartupFailure(store, later);
    expect(store.load().failures).toHaveLength(17);
    expect(store.load().failures[0]).toBe(4000);
    expect(store.load().failures.at(-1)).toBe(later);
  });
});
