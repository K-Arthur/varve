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
  prefersMoreContrast?: boolean;
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

/**
 * OS-level high-contrast preference (`prefers-contrast: more` — macOS
 * "Increase Contrast", Linux high-contrast themes, and Windows contrast
 * themes whose palette clears the 7:1 ratio). Under System it resolves the
 * palette to the application's High Contrast theme; an explicit Light, Dark,
 * or High Contrast choice always wins.
 */
function browserPrefersMoreContrast(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-contrast: more)').matches
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
  prefersMoreContrast = browserPrefersMoreContrast(),
): Theme {
  if (preference !== 'system') return preference;
  // OS high-contrast outranks colour scheme: it is an accessibility request
  // for the whole application, not a colour-scheme tint.
  if (prefersMoreContrast) return 'high-contrast';
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
  const resolvedTheme = resolveTheme(preference, options.prefersDark, options.prefersMoreContrast);
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
  const contrastMedia = window.matchMedia?.('(prefers-contrast: more)');
  const currentSystemOptions = () => ({
    persist: false,
    prefersDark: media?.matches ?? false,
    prefersMoreContrast: contrastMedia?.matches ?? false,
  });

  applyThemePreference(readThemePreference(), currentSystemOptions());

  const handleSystemChange = () => {
    if (getThemePreference() !== 'system') return;
    applyThemePreference('system', currentSystemOptions());
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== LEGACY_THEME_STORAGE_KEY) return;
    applyThemePreference(readThemePreference(), currentSystemOptions());
  };

  media?.addEventListener('change', handleSystemChange);
  contrastMedia?.addEventListener('change', handleSystemChange);
  window.addEventListener('storage', handleStorage);
  lifecycleCleanup = () => {
    media?.removeEventListener('change', handleSystemChange);
    contrastMedia?.removeEventListener('change', handleSystemChange);
    window.removeEventListener('storage', handleStorage);
    lifecycleCleanup = null;
  };
  return lifecycleCleanup;
}
