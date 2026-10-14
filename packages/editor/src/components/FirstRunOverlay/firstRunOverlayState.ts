/**
 * First-run overlay visibility.
 *
 * Shown once for a real first-time user, then remembered in localStorage.
 * Playwright (and other WebDriver clients) always look like first-time
 * users because each spec gets a fresh profile — so automation skips the
 * overlay unless a coverage spec opts back in with the force key.
 */

export const FIRST_RUN_OVERLAY_DISMISSED_KEY = 'varve:first-run-overlay:dismissed';
export const FIRST_RUN_OVERLAY_FORCE_KEY = 'varve:first-run-overlay:force';

export interface FirstRunOverlayVisibilityInput {
  dismissed: boolean;
  forced: boolean;
  automated: boolean;
}

export function shouldShowFirstRunOverlay(input: FirstRunOverlayVisibilityInput): boolean {
  if (input.dismissed) return false;
  if (input.forced) return true;
  if (input.automated) return false;
  return true;
}

export function isAutomatedBrowser(): boolean {
  return typeof navigator !== 'undefined' && navigator.webdriver === true;
}

export function readFirstRunOverlayVisibility(
  storage: Pick<Storage, 'getItem'> | null,
  automated = isAutomatedBrowser(),
): boolean {
  if (!storage) return false;
  try {
    return shouldShowFirstRunOverlay({
      dismissed: storage.getItem(FIRST_RUN_OVERLAY_DISMISSED_KEY) === 'true',
      forced: storage.getItem(FIRST_RUN_OVERLAY_FORCE_KEY) === '1',
      automated,
    });
  } catch {
    return false;
  }
}

export function markFirstRunOverlayDismissed(
  storage: Pick<Storage, 'setItem'> | null = getLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(FIRST_RUN_OVERLAY_DISMISSED_KEY, 'true');
  } catch {
    // Privacy modes can throw; the in-memory dismiss still stands.
  }
}

export function getLocalStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
