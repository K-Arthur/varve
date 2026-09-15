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
  it('tracks OS changes only for System and reconciles storage events', () => {
    let systemListener: ((event: MediaQueryListEvent) => void) | undefined;
    const media = {
      matches: false,
      addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
        systemListener = listener;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media),
    );
    localStorage.setItem(THEME_STORAGE_KEY, 'system');

    const cleanup = initializeThemeLifecycle();
    expect(getThemePreference()).toBe('system');
    expect(getTheme()).toBe('light');

    systemListener?.({ matches: true } as MediaQueryListEvent);
    expect(getTheme()).toBe('dark');

    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
    expect(getThemePreference()).toBe('light');
    expect(getTheme()).toBe('light');

    systemListener?.({ matches: true } as MediaQueryListEvent);
    expect(getTheme()).toBe('light');
    cleanup();
  });
});
