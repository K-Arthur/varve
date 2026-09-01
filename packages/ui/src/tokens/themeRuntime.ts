import type { Theme } from './color';

export type ThemePreference = Theme | 'system';

export const THEME_STORAGE_KEY = 'varve-theme';
export const LEGACY_THEME_STORAGE_KEY = 'strata-theme';
export const THEME_CHANGE_EVENT = 'varve:theme-change';

export interface ThemeChangeDetail {
  preference: ThemePreference;
  resolvedTheme: Theme;
  previousPreference: ThemePreference | null;
  previousResolvedTheme: Theme | null;
}

interface ThemeRoot {
  dataset: DOMStringMap;
}

interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface ApplyThemeOptions {
  persist?: boolean;
  prefersDark?: boolean;
  root?: ThemeRoot;
  storage?: ThemeStorage;
  dispatch?: (detail: ThemeChangeDetail) => void;
}

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'high-contrast';
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || isTheme(value);
}

/** Unknown, corrupt, or obsolete values always return to the OS preference. */
export function normalizeThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : 'system';
}

function browserStorage(): ThemeStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function browserRoot(): ThemeRoot | undefined {
  return typeof document === 'undefined' ? undefined : document.documentElement;
}

function browserPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function readThemePreference(
  storage: ThemeStorage | undefined = browserStorage(),
): ThemePreference {
  if (!storage) return 'system';
  try {
    const current = storage.getItem(THEME_STORAGE_KEY);
    if (current !== null) return normalizeThemePreference(current);
    return normalizeThemePreference(storage.getItem(LEGACY_THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function resolveTheme(
  preference: ThemePreference,
  prefersDark = browserPrefersDark(),
): Theme {
  if (preference !== 'system') return preference;
  return prefersDark ? 'dark' : 'light';
}

function dispatchBrowserThemeChange(detail: ThemeChangeDetail): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ThemeChangeDetail>(THEME_CHANGE_EVENT, { detail }));
}

/**
 * Apply the preference and its resolved appearance to the document root.
 *
 * `data-theme-mode` preserves the user's choice; `data-theme` is always the
 * concrete palette consumed by CSS and canvas colour readers. This makes
 * System observable without asking product components to branch on it.
 */
export function applyThemePreference(
  preferenceInput: unknown,
  options: ApplyThemeOptions = {},
): Theme {
  const preference = normalizeThemePreference(preferenceInput);
  const resolvedTheme = resolveTheme(preference, options.prefersDark);
  const root = options.root ?? browserRoot();
  const storage = options.storage ?? browserStorage();
  const previousPreference = root ? normalizeThemePreference(root.dataset.themeMode) : null;
  const previousResolvedTheme = root && isTheme(root.dataset.theme) ? root.dataset.theme : null;

  if (options.persist !== false && storage) {
    try {
      storage.setItem(THEME_STORAGE_KEY, preference);
      storage.removeItem(LEGACY_THEME_STORAGE_KEY);
    } catch {
      // A blocked storage backend must not prevent the in-memory theme change.
    }
  }

  if (root) {
    root.dataset.themeMode = preference;
    root.dataset.theme = resolvedTheme;
  }

  if (previousPreference !== preference || previousResolvedTheme !== resolvedTheme) {
    const detail: ThemeChangeDetail = {
      preference,
      resolvedTheme,
      previousPreference,
      previousResolvedTheme,
    };
    (options.dispatch ?? dispatchBrowserThemeChange)(detail);
  }

  return resolvedTheme;
}

/** Apply a concrete palette without changing the persisted preference. */
export function setTheme(theme: Theme): void {
  applyThemePreference(theme, { persist: false });
}

export function setThemePreference(preference: ThemePreference): Theme {
  return applyThemePreference(preference);
}

export function getTheme(): Theme | null {
  const value = browserRoot()?.dataset.theme;
  return isTheme(value) ? value : null;
}

export function getThemePreference(): ThemePreference {
  const value = browserRoot()?.dataset.themeMode;
  return isThemePreference(value) ? value : readThemePreference();
}

let lifecycleCleanup: (() => void) | null = null;

/** Install the one OS/storage synchronization loop for an application window. */
export function initializeThemeLifecycle(): () => void {
  if (lifecycleCleanup) return lifecycleCleanup;
  if (typeof window === 'undefined') return () => {};

  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  applyThemePreference(readThemePreference(), {
    persist: false,
    prefersDark: media?.matches ?? false,
  });

  const handleSystemChange = (event: MediaQueryListEvent) => {
    if (getThemePreference() !== 'system') return;
    applyThemePreference('system', { persist: false, prefersDark: event.matches });
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== LEGACY_THEME_STORAGE_KEY) return;
    applyThemePreference(readThemePreference(), {
      persist: false,
      prefersDark: media?.matches ?? false,
    });
  };

  media?.addEventListener('change', handleSystemChange);
  window.addEventListener('storage', handleStorage);
  lifecycleCleanup = () => {
    media?.removeEventListener('change', handleSystemChange);
    window.removeEventListener('storage', handleStorage);
    lifecycleCleanup = null;
  };
  return lifecycleCleanup;
}
