/**
 * Bounded startup crash-loop detection (Phase 8).
 *
 * Uses local, bounded state: repeated abnormal exits or failed startups
 * within a short window. A clean shutdown resets the counter. The loop
 * marker survives restarts but is small and never contains report data.
 *
 * Crash-loop detection is deliberately conservative — long exports, model
 * downloads, migrations, or OS suspend/resume must not trip it.
 */

export const CRASH_LOOP_WINDOW_MS = 10 * 60 * 1000;
export const CRASH_LOOP_THRESHOLD = 3;
export const CRASH_LOOP_STORAGE_KEY = 'varve:crash-loop';

export interface CrashLoopState {
  /** Epoch ms of abnormal exits/failed startups within the window. */
  failures: number[];
  /** Epoch ms of the last clean startup. */
  lastClean?: number;
}

export interface CrashLoopStore {
  load(): CrashLoopState;
  save(state: CrashLoopState): void;
  clear(): void;
}

export class LocalStorageCrashLoopStore implements CrashLoopStore {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {}

  load(): CrashLoopState {
    try {
      const raw = this.storage.getItem(CRASH_LOOP_STORAGE_KEY);
      if (!raw) return { failures: [] };
      const parsed = JSON.parse(raw) as Partial<CrashLoopState>;
      const failures = Array.isArray(parsed.failures)
        ? parsed.failures.filter((n): n is number => typeof n === 'number')
        : [];
      return {
        failures,
        lastClean: typeof parsed.lastClean === 'number' ? parsed.lastClean : undefined,
      };
    } catch {
      return { failures: [] };
    }
  }

  save(state: CrashLoopState): void {
    try {
      this.storage.setItem(CRASH_LOOP_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(CRASH_LOOP_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

export class MemoryCrashLoopStore implements CrashLoopStore {
  private state: CrashLoopState = { failures: [] };
  load(): CrashLoopState {
    return { failures: [...this.state.failures], lastClean: this.state.lastClean };
  }
  save(state: CrashLoopState): void {
    this.state = { failures: [...state.failures], lastClean: state.lastClean };
  }
  clear(): void {
    this.state = { failures: [] };
  }
}

function trimWindow(state: CrashLoopState, now: number): CrashLoopState {
  const cutoff = now - CRASH_LOOP_WINDOW_MS;
  return {
    ...state,
    failures: state.failures.filter((t) => t >= cutoff),
  };
}

/** Records an abnormal exit or failed startup. */
export function recordStartupFailure(store: CrashLoopStore, now: number = Date.now()): number {
  const state = trimWindow(store.load(), now);
  const next: CrashLoopState = { ...state, failures: [...state.failures, now] };
  store.save(next);
  return next.failures.length;
}

/** Records a clean startup, resetting the failure window. */
export function recordCleanStartup(store: CrashLoopStore, now: number = Date.now()): void {
  store.save({ failures: [], lastClean: now });
}

/** True when the app is likely in a startup crash loop. */
export function isInCrashLoop(store: CrashLoopStore, now: number = Date.now()): boolean {
  const state = trimWindow(store.load(), now);
  return state.failures.length >= CRASH_LOOP_THRESHOLD;
}

/** Explicit user decision to leave safe mode resets loop tracking. */
export function resetCrashLoop(store: CrashLoopStore): void {
  store.clear();
}
