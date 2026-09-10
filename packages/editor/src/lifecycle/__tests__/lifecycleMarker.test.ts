import { describe, expect, it } from 'vitest';
import {
  CLEAN_SHUTDOWN_KEY,
  getSharedShutdownMarker,
  resetSharedShutdownMarker,
  ShutdownMarker,
  type ShutdownMarkerStorage,
} from '../lifecycleMarker';

function memoryStorage(initial: Record<string, string> = {}): ShutdownMarkerStorage & {
  values: Record<string, string>;
} {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

describe('shutdown marker', () => {
  it('reads the previous marker once and arms the run as unclean', () => {
    const storage = memoryStorage({ [CLEAN_SHUTDOWN_KEY]: 'true' });
    const marker = new ShutdownMarker(storage);
    expect(marker.begin()).toBe(true);
    expect(storage.values[CLEAN_SHUTDOWN_KEY]).toBe('false');
    // A second begin is a cached no-op — it must not re-read the flipped value.
    expect(marker.begin()).toBe(true);
  });

  it('reports an absent marker as unclean', () => {
    const marker = new ShutdownMarker(memoryStorage({}));
    expect(marker.previousSessionWasClean()).toBe(false);
  });

  it('marks clean only via markClean', () => {
    const storage = memoryStorage({});
    const marker = new ShutdownMarker(storage);
    marker.begin();
    expect(storage.values[CLEAN_SHUTDOWN_KEY]).toBe('false');
    marker.markClean();
    expect(storage.values[CLEAN_SHUTDOWN_KEY]).toBe('true');
    expect(marker.previousSessionWasClean()).toBe(true);
  });

  it('tolerates failing storage without throwing', () => {
    const throwing: ShutdownMarkerStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const marker = new ShutdownMarker(throwing);
    expect(marker.begin()).toBeNull();
    expect(() => marker.markClean()).not.toThrow();
  });

  it('keeps a single shared instance', () => {
    resetSharedShutdownMarker();
    const first = getSharedShutdownMarker();
    const second = getSharedShutdownMarker();
    expect(first).toBe(second);
    resetSharedShutdownMarker();
    expect(getSharedShutdownMarker()).not.toBe(first);
  });
});
