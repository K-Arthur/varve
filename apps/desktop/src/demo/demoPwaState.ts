/**
 * Browser install/offline state for the public demo.
 *
 * `beforeinstallprompt` is a Chromium-only progressive enhancement: when the
 * browser considers the demo installable it fires the event, and the app may
 * defer it and trigger the same install dialog later from a button. When it
 * never fires (Firefox/Safari, already installed, criteria not met), the
 * controller simply reports no pending prompt and the UI hides the control —
 * installability is never simulated.
 *
 * Online/offline state comes from the browser's `online`/`offline` events;
 * `navigator.onLine` is only a hint (a captive portal reports online), so the
 * UI copy stays about "the network is unavailable" rather than promising what
 * a failed fetch means.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallPromptController {
  /** The deferred prompt, or null when the browser has not offered one. */
  getPending(): BeforeInstallPromptEvent | null;
  /**
   * Show the browser's install dialog. Resolves with the user's choice, or
   * 'unavailable' when no prompt is pending. A prompt can only be used once,
   * so it is cleared before the dialog is shown.
   */
  prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'>;
  /** Subscribe to pending-prompt changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

interface EventTargetLike {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

function isBeforeInstallPromptEvent(value: unknown): value is BeforeInstallPromptEvent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { prompt?: unknown; userChoice?: unknown };
  return typeof candidate.prompt === 'function' && candidate.userChoice instanceof Promise;
}

/** Create the demo's install-prompt controller for one window. */
export function createInstallPromptController(target: EventTargetLike): InstallPromptController {
  let pending: BeforeInstallPromptEvent | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const onBeforeInstallPrompt = (event: Event) => {
    if (!isBeforeInstallPromptEvent(event)) return;
    // The default mini-infobar is suppressed so the install affordance lives
    // in the demo banner instead; the event stays usable for one prompt().
    event.preventDefault();
    pending = event;
    notify();
  };

  target.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);

  return {
    getPending: () => pending,
    async prompt() {
      const event = pending;
      if (!event) return 'unavailable';
      pending = null;
      notify();
      try {
        const choice = await Promise.race([
          event.prompt().then(() => event.userChoice),
          // A browser that never resolves userChoice (or a test double) must
          // not leave the button stuck; report the conservative outcome.
          new Promise<{ outcome: 'accepted' | 'dismissed' }>((resolve) =>
            setTimeout(() => resolve({ outcome: 'dismissed' }), 30000),
          ),
        ]);
        return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
      } catch {
        return 'dismissed';
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      target.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      listeners.clear();
      pending = null;
    },
  };
}

/**
 * Observe online/offline transitions. Returns an unsubscribe function.
 * The initial value is delivered through `getOnline()`; the watcher only
 * reports transitions.
 */
export function watchOnlineStatus(
  target: EventTargetLike,
  listener: (online: boolean) => void,
): () => void {
  const onOnline = () => listener(true);
  const onOffline = () => listener(false);
  target.addEventListener('online', onOnline);
  target.addEventListener('offline', onOffline);
  return () => {
    target.removeEventListener('online', onOnline);
    target.removeEventListener('offline', onOffline);
  };
}

/** `navigator.onLine` is a hint; default to online when unavailable. */
export function getOnlineStatus(navigatorLike?: { onLine?: boolean }): boolean {
  return navigatorLike?.onLine !== false;
}
