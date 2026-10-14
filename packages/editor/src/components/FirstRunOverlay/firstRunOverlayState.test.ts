import { describe, expect, it } from 'vitest';
import {
  FIRST_RUN_OVERLAY_DISMISSED_KEY,
  FIRST_RUN_OVERLAY_FORCE_KEY,
  markFirstRunOverlayDismissed,
  readFirstRunOverlayVisibility,
  shouldShowFirstRunOverlay,
} from './firstRunOverlayState';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = { ...initial };
  return {
    get length() {
      return Object.keys(data).length;
    },
    clear() {
      for (const key of Object.keys(data)) delete data[key];
    },
    getItem(key: string) {
      return data[key] ?? null;
    },
    key(index: number) {
      return Object.keys(data)[index] ?? null;
    },
    removeItem(key: string) {
      delete data[key];
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  };
}

describe('shouldShowFirstRunOverlay', () => {
  it('shows for a real first-time user', () => {
    expect(shouldShowFirstRunOverlay({ dismissed: false, forced: false, automated: false })).toBe(
      true,
    );
  });

  it('hides after the user has dismissed it', () => {
    expect(shouldShowFirstRunOverlay({ dismissed: true, forced: false, automated: false })).toBe(
      false,
    );
  });

  it('hides under WebDriver so Playwright profiles do not block the editor', () => {
    expect(shouldShowFirstRunOverlay({ dismissed: false, forced: false, automated: true })).toBe(
      false,
    );
  });

  it('shows under WebDriver when a coverage spec forces it', () => {
    expect(shouldShowFirstRunOverlay({ dismissed: false, forced: true, automated: true })).toBe(
      true,
    );
  });

  it('keeps a dismissed overlay hidden even when force is set', () => {
    expect(shouldShowFirstRunOverlay({ dismissed: true, forced: true, automated: true })).toBe(
      false,
    );
  });
});

describe('readFirstRunOverlayVisibility', () => {
  it('returns false when storage is unavailable', () => {
    expect(readFirstRunOverlayVisibility(null, false)).toBe(false);
  });

  it('reads dismissed and force keys from storage', () => {
    const fresh = memoryStorage();
    expect(readFirstRunOverlayVisibility(fresh, false)).toBe(true);
    expect(readFirstRunOverlayVisibility(fresh, true)).toBe(false);

    const forced = memoryStorage({ [FIRST_RUN_OVERLAY_FORCE_KEY]: '1' });
    expect(readFirstRunOverlayVisibility(forced, true)).toBe(true);

    const dismissed = memoryStorage({
      [FIRST_RUN_OVERLAY_DISMISSED_KEY]: 'true',
      [FIRST_RUN_OVERLAY_FORCE_KEY]: '1',
    });
    expect(readFirstRunOverlayVisibility(dismissed, true)).toBe(false);
  });
});

describe('markFirstRunOverlayDismissed', () => {
  it('writes the dismissed key', () => {
    const storage = memoryStorage();
    markFirstRunOverlayDismissed(storage);
    expect(storage.getItem(FIRST_RUN_OVERLAY_DISMISSED_KEY)).toBe('true');
  });
});
