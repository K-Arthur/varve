/**
 * Window action service — the only place presentation components call Tauri
 * window actions. Browser-safe (returns early when the Tauri global is
 * absent), rejection-safe, and guards against uncontrolled concurrent
 * dispatches from rapid clicks.
 */

declare global {
  interface Window {
    __TAURI__?: {
      window?: {
        getCurrentWindow?: () => {
          minimize: () => Promise<void>;
          toggleMaximize: () => Promise<void>;
          close: () => Promise<void>;
        };
      };
    };
  }
}

export type WindowAction = 'minimize' | 'toggleMaximize' | 'close';

const ACTION_METHOD: Record<WindowAction, 'minimize' | 'toggleMaximize' | 'close'> = {
  minimize: 'minimize',
  toggleMaximize: 'toggleMaximize',
  close: 'close',
};

let _inFlight: WindowAction | null = null;

/**
 * Run a window action once. Returns false when the action was skipped (no
 * Tauri window available, or an action is already in flight) — callers can
 * use this to keep controls from swallowing clicks.
 */
export function runWindowAction(action: WindowAction): boolean {
  const win = window.__TAURI__?.window?.getCurrentWindow?.();
  if (!win) return false;
  if (_inFlight !== null) return false;

  _inFlight = action;
  const method = win[ACTION_METHOD[action]];
  Promise.resolve(method.call(win))
    .catch(() => {
      // The window may be closed, destroyed, or the API may reject — swallow
      // silently rather than surfacing a UI error for a best-effort action.
    })
    .finally(() => {
      _inFlight = null;
    });
  return true;
}

/** Whether a window action is currently being dispatched. */
export function isWindowActionInFlight(): boolean {
  return _inFlight !== null;
}

/** Reset in-flight state (mainly for tests). */
export function resetWindowActionState(): void {
  _inFlight = null;
}
