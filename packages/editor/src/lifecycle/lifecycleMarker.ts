/**
 * Clean-shutdown marker — single reader/writer authority (ADR-0216 D6).
 *
 * Startup: the previous run's value is read exactly once and the current run
 * is armed as not-clean. Successful graceful finalization writes 'true' ONLY
 * after required finalizers completed. A quit that merely started — or
 * crashed mid-save — leaves the run unclean, so next launch classifies it
 * as a crash and offers recovery.
 */

import type { LifecycleMarker } from './coordinator';

export const CLEAN_SHUTDOWN_KEY = 'strata-clean-shutdown';

export interface ShutdownMarkerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class ShutdownMarker implements LifecycleMarker {
  private storage: ShutdownMarkerStorage;
  private key: string;
  private begun = false;
  private previous: boolean | null = null;
  private readFailed = false;

  constructor(storage: ShutdownMarkerStorage, key = CLEAN_SHUTDOWN_KEY) {
    this.storage = storage;
    this.key = key;
  }

  /** Read the previous run's marker once; arm the current run as unclean.
   *  Returns its result, or null when no valid marker is available. Idempotent. */
  begin(): boolean | null {
    if (this.begun) return this.previous;
    this.begun = true;
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      this.readFailed = true;
    }
    this.previous = this.readFailed || (raw !== 'true' && raw !== 'false') ? null : raw === 'true';
    try {
      this.storage.setItem(this.key, 'false');
    } catch {
      // Storage unavailable — recovery stays conservatively unclean.
    }
    return this.previous;
  }

  previousSessionWasClean(): boolean | null {
    return this.begun ? this.previous : this.begin();
  }

  previousSessionResultIfStarted(): boolean | null | undefined {
    return this.begun ? this.previous : undefined;
  }

  /** Written only by the coordinator after completed finalization. */
  markClean(): void {
    try {
      this.storage.setItem(this.key, 'true');
    } catch {
      // Storage unavailable — recovery stays conservatively unclean.
    }
    this.previous = true;
  }
}

let shared: ShutdownMarker | null = null;

/**
 * Crash-loop classification for the clean-shutdown marker (ADR-0216 D6).
 *
 * Only an explicitly armed, never-finalized marker (`'false'`) is evidence
 * that a previous session started and was interrupted: `begin()` writes
 * `'false'` at startup and `markClean()` replaces it with `'true'` after
 * completed finalization.
 *
 * An **absent** marker means no session ever armed it — a fresh profile, or
 * a surface such as Home that never mounts `LifecycleProvider`. That is not
 * an interrupted run and must never count toward the crash-loop threshold:
 * with the previous `!== 'true'` classification, every Home load accrued a
 * "startup failure" and the third load within the window opened the
 * safe-mode screen with no error anywhere (probe evidence:
 * docs/audits/design-system-audit-2026-09-27.md §7.4). A storage read
 * error likewise yields no evidence — the crash loop must never fire
 * without evidence; the ephemeral-storage banner owns that failure mode.
 *
 * Deliberately a standalone reader (not `previousSessionWasClean()`):
 * asking the shared marker to `begin()` would arm `'false'` on surfaces
 * that otherwise never write the key, manufacturing the very evidence this
 * function exists to require.
 */
export function readUncleanShutdownMarker(getItem: (key: string) => string | null): boolean {
  const previous = shared?.previousSessionResultIfStarted();
  if (previous !== undefined) return previous === false;
  try {
    return getItem(CLEAN_SHUTDOWN_KEY) === 'false';
  } catch {
    return false;
  }
}

/** Native state is authoritative when present; otherwise migrate from the
 * previous release's WebView marker. `null` from both means no evidence. */
export function resolvePreviousCleanShutdown(
  nativeClean: boolean | null,
  legacyClean: boolean | null,
): boolean | null {
  return nativeClean ?? legacyClean;
}

/** App-wide singleton. LifecycleProvider installs the real localStorage
 *  instance; tests install a memory instance. */
export function getSharedShutdownMarker(): ShutdownMarker {
  if (!shared) {
    shared = new ShutdownMarker(localStorageLike());
  }
  return shared;
}

export function resetSharedShutdownMarker(marker?: ShutdownMarker): void {
  shared = marker ?? null;
}

function localStorageLike(): ShutdownMarkerStorage {
  try {
    return typeof localStorage !== 'undefined'
      ? localStorage
      : { getItem: () => null, setItem: () => undefined };
  } catch {
    return { getItem: () => null, setItem: () => undefined };
  }
}
