// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyThemePreference,
  getTheme,
  getThemePreference,
  initializeThemeLifecycle,
  LEGACY_THEME_STORAGE_KEY,
  normalizeThemePreference,
  readThemePreference,
  resolveTheme,
  setThemePreference,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
} from './themeRuntime';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-mode');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('theme preference resolution', () => {
  it('normalizes unknown persisted values to System', () => {
    expect(normalizeThemePreference('sepia')).toBe('system');
    expect(normalizeThemePreference(null)).toBe('system');
  });

  it('resolves System without changing explicit or high-contrast themes', () => {
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('high-contrast', true)).toBe('high-contrast');
  });

  // DESIGN.md: "Activated by prefers-contrast: more or explicit user
  // selection." The CSS-side guard for this could never match (data-theme is
  // always written before paint), so the runtime is the only place the OS
  // request can be honoured.
  it('resolves System to High Contrast when the OS asks for more contrast', () => {
    expect(resolveTheme('system', false, true)).toBe('high-contrast');
    // The contrast request outranks the colour scheme.
    expect(resolveTheme('system', true, true)).toBe('high-contrast');
    // An explicit preference always wins over the OS request.
    expect(resolveTheme('light', true, true)).toBe('light');
    expect(resolveTheme('dark', false, true)).toBe('dark');
    expect(resolveTheme('high-contrast', false, false)).toBe('high-contrast');
  });

  it('reads the current key first and migrates a valid legacy preference', () => {
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark');
    expect(readThemePreference()).toBe('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(readThemePreference()).toBe('light');
  });
});

describe('theme application', () => {
  it('keeps the preference separate from the resolved palette', () => {
    applyThemePreference('system', { prefersDark: true });
    expect(document.documentElement.dataset.themeMode).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(getThemePreference()).toBe('system');
    expect(getTheme()).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });

  it('applies OS high contrast under System without persisting it as the preference', () => {
    applyThemePreference('system', { prefersDark: false, prefersMoreContrast: true });
    expect(document.documentElement.dataset.themeMode).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('high-contrast');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });

  it('applies a theme even when persistence is unavailable', () => {
    const blockedStorage = {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      removeItem: vi.fn(),
    };
    expect(applyThemePreference('dark', { storage: blockedStorage, prefersDark: false })).toBe(
      'dark',
    );
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('dispatches one semantic event only when preference or resolution changes', () => {
    const events: string[] = [];
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ preference: string; resolvedTheme: string }>).detail;
      events.push(`${detail.preference}:${detail.resolvedTheme}`);
    };
    window.addEventListener(THEME_CHANGE_EVENT, listener);
    setThemePreference('light');
    setThemePreference('light');
    setThemePreference('high-contrast');
    window.removeEventListener(THEME_CHANGE_EVENT, listener);
    expect(events).toEqual(['light:light', 'high-contrast:high-contrast']);
  });
});

describe('theme lifecycle', () => {
  interface MediaStub {
    matches: boolean;
    listeners: Array<() => void>;
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
  }

  function makeMedia(matches: boolean): MediaStub {
    const stub: MediaStub = {
      matches,
      listeners: [],
      addEventListener: (_type, listener) => {
        stub.listeners.push(listener);
      },
      removeEventListener: (_type, listener) => {
        stub.listeners = stub.listeners.filter((l) => l !== listener);
      },
    };
    return stub;
  }

  const emit = (media: MediaStub) => {
    media.listeners.forEach((listener) => {
      listener();
    });
  };

  it('tracks OS colour-scheme and contrast changes only for System and reconciles storage events', () => {
    const darkMedia = makeMedia(false);
    const contrastMedia = makeMedia(false);
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => (query.includes('prefers-contrast') ? contrastMedia : darkMedia)),
    );
    localStorage.setItem(THEME_STORAGE_KEY, 'system');

    const cleanup = initializeThemeLifecycle();
    expect(getThemePreference()).toBe('system');
    expect(getTheme()).toBe('light');

    darkMedia.matches = true;
    emit(darkMedia);
    expect(getTheme()).toBe('dark');

    // The OS contrast request resolves System to High Contrast at runtime.
    contrastMedia.matches = true;
    emit(contrastMedia);
    expect(getTheme()).toBe('high-contrast');

    // Explicit preferences are not overridden by either OS signal.
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
    expect(getThemePreference()).toBe('light');
    expect(getTheme()).toBe('light');

    emit(darkMedia);
    emit(contrastMedia);
    expect(getTheme()).toBe('light');

    cleanup();
    expect(contrastMedia.listeners).toHaveLength(0);
    expect(darkMedia.listeners).toHaveLength(0);
  });
});
