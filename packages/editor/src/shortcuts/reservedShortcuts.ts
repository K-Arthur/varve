/**
 * Platform-reserved shortcuts that Strata cannot override.
 *
 * Shown in Settings → Keyboard Shortcuts so users know why certain combos
 * are unavailable in the browser build vs the Tauri desktop build.
 */

export interface ReservedShortcut {
  keys: string;
  action: string;
}

/** Shortcuts reserved by browsers — cannot be bound in the web build. */
export const BROWSER_RESERVED_SHORTCUTS: ReservedShortcut[] = [
  { keys: 'Ctrl/Cmd+W', action: 'Close tab' },
  { keys: 'Ctrl/Cmd+T', action: 'New tab' },
  { keys: 'Ctrl/Cmd+N', action: 'New window' },
  { keys: 'Ctrl/Cmd+Tab', action: 'Switch tabs' },
  { keys: 'Ctrl/Cmd+Q', action: 'Quit browser (macOS)' },
  { keys: 'F5 / Ctrl/Cmd+R', action: 'Reload page' },
];

/** Desktop can register global shortcuts via Tauri; these remain OS-level. */
export const DESKTOP_OS_RESERVED_SHORTCUTS: ReservedShortcut[] = [
  { keys: 'Alt+Tab', action: 'Switch applications (OS)' },
  { keys: 'Super / Cmd+Space', action: 'System launcher (OS)' },
  { keys: 'Print Screen', action: 'Screenshot (OS)' },
];

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

export function getReservedShortcutsForTarget(): {
  target: 'browser' | 'desktop';
  shortcuts: ReservedShortcut[];
} {
  if (isTauriRuntime()) {
    return { target: 'desktop', shortcuts: DESKTOP_OS_RESERVED_SHORTCUTS };
  }
  return { target: 'browser', shortcuts: BROWSER_RESERVED_SHORTCUTS };
}
