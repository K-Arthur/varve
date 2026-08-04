/**
 * Safe-mode configuration (Phase 8).
 *
 * Safe mode is visibly indicated and fully reversible. It never erases user
 * settings, files, models, fonts, or autosaves — it only toggles startup
 * behavior. Crash-reporting consent remains respected in safe mode.
 */

export const SAFE_MODE_STORAGE_KEY = 'varve:safe-mode';

export interface SafeModeOptions {
  disableGpu: boolean;
  skipLastDocument: boolean;
  skipWorkspaceRestore: boolean;
  resetWindowLayout: boolean;
  disableModels: boolean;
  disableExtensions: boolean;
  resetCaches: boolean;
}

export const DEFAULT_SAFE_MODE_OPTIONS: SafeModeOptions = {
  disableGpu: true,
  skipLastDocument: true,
  skipWorkspaceRestore: true,
  resetWindowLayout: false,
  disableModels: true,
  disableExtensions: true,
  resetCaches: false,
};

export interface SafeModeState {
  active: boolean;
  options: SafeModeOptions;
  enteredAt: number;
  /** App version in which safe mode was entered. */
  appVersion: string;
}

export interface SafeModeStore {
  load(): SafeModeState | null;
  save(state: SafeModeState): void;
  clear(): void;
}

export class LocalStorageSafeModeStore implements SafeModeStore {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {}

  load(): SafeModeState | null {
    try {
      const raw = this.storage.getItem(SAFE_MODE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<SafeModeState>;
      if (parsed.active !== true) return null;
      return {
        active: true,
        options: { ...DEFAULT_SAFE_MODE_OPTIONS, ...(parsed.options ?? {}) },
        enteredAt: typeof parsed.enteredAt === 'number' ? parsed.enteredAt : Date.now(),
        appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : '',
      };
    } catch {
      return null;
    }
  }

  save(state: SafeModeState): void {
    try {
      this.storage.setItem(SAFE_MODE_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(SAFE_MODE_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

export class MemorySafeModeStore implements SafeModeStore {
  private state: SafeModeState | null = null;
  load(): SafeModeState | null {
    return this.state ? { ...this.state, options: { ...this.state.options } } : null;
  }
  save(state: SafeModeState): void {
    this.state = { ...state, options: { ...state.options } };
  }
  clear(): void {
    this.state = null;
  }
}

export function enterSafeMode(
  store: SafeModeStore,
  appVersion: string,
  options: Partial<SafeModeOptions> = {},
  now: number = Date.now(),
): SafeModeState {
  const state: SafeModeState = {
    active: true,
    options: { ...DEFAULT_SAFE_MODE_OPTIONS, ...options },
    enteredAt: now,
    appVersion,
  };
  store.save(state);
  return state;
}

export function exitSafeMode(store: SafeModeStore): void {
  store.clear();
}

export function isInSafeMode(store: SafeModeStore): boolean {
  return store.load() !== null;
}

export function updateSafeModeOptions(
  store: SafeModeStore,
  patch: Partial<SafeModeOptions>,
): SafeModeState | null {
  const current = store.load();
  if (!current) return null;
  const next: SafeModeState = { ...current, options: { ...current.options, ...patch } };
  store.save(next);
  return next;
}
