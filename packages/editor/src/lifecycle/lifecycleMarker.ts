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
   *  Returns whether the previous session ended cleanly (null if the
   *  storage is unavailable). Idempotent. */
  begin(): boolean | null {
    if (this.begun) return this.previous;
    this.begun = true;
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      this.readFailed = true;
    }
    this.previous = this.readFailed ? null : raw === 'true';
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
