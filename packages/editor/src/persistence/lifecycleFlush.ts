export interface LifecycleFlushCoordinator {
  request(markCleanOnSuccess?: boolean): Promise<void>;
  markCleanNow(): void;
  isSaving(): boolean;
}

export interface LifecycleFlushOptions {
  save: () => unknown;
  isDirty: () => boolean;
  getRevision: () => number;
  markClean: () => void;
}

export function createLifecycleFlushCoordinator(
  options: LifecycleFlushOptions,
): LifecycleFlushCoordinator {
  let inFlight: Promise<void> | null = null;
  let cleanRequested = false;

  const markCleanNow = () => {
    options.markClean();
    cleanRequested = false;
  };

  return {
    request(markCleanOnSuccess = false) {
      cleanRequested ||= markCleanOnSuccess;
      if (!options.isDirty()) {
        if (cleanRequested) markCleanNow();
        return Promise.resolve();
      }
      if (inFlight) return inFlight;

      const revision = options.getRevision();
      inFlight = Promise.resolve(options.save())
        .then(() => {
          if (cleanRequested && options.getRevision() === revision) markCleanNow();
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    markCleanNow,
    isSaving: () => inFlight !== null,
  };
}

export interface ShutdownMarkerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Reads the previous session marker before marking the current session active. */
export function beginRecoverySession(storage: ShutdownMarkerStorage, key: string): boolean | null {
  try {
    const previousWasClean = storage.getItem(key) === 'true';
    storage.setItem(key, 'false');
    return previousWasClean;
  } catch {
    return null;
  }
}
