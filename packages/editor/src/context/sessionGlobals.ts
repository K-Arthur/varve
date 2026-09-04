import { THEME_CHANGE_EVENT } from '@varve/ui/tokens';

export { isCapabilityRestricted } from '../capabilities/restrictions';

/** Module-level bridge used by theme and rendering controls to invalidate
 * canvas colour caches without making the editor tree consume a theme object. */
let bumpThemeRevisionHandler: (() => void) | null = null;
let listeningForThemeChanges = false;

function handleThemeChange(): void {
  bumpThemeRevisionHandler?.();
}

export function setBumpThemeRevisionHandler(fn: (() => void) | null): void {
  bumpThemeRevisionHandler = fn;
  if (typeof window === 'undefined') return;
  if (fn && !listeningForThemeChanges) {
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    listeningForThemeChanges = true;
  } else if (!fn && listeningForThemeChanges) {
    window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    listeningForThemeChanges = false;
  }
}

export function bumpThemeRevision(): void {
  bumpThemeRevisionHandler?.();
}

/** Module-level bridge: starts inline text editing for a node.
 *  Registered by CanvasArea on mount. Used by createActionHandlers' editText. */
let startTextEditingHandler: ((nodeId: string) => void) | null = null;

export function setStartTextEditingHandler(fn: ((nodeId: string) => void) | null): void {
  startTextEditingHandler = fn;
}

export function startTextEditing(nodeId: string): void {
  startTextEditingHandler?.(nodeId);
}
