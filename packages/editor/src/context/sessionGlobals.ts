export { isCapabilityRestricted } from '../capabilities/restrictions';

/** Module-level bridge: call after setTheme() + localStorage so EditorProvider
 *  bumps themeRevision, causing Minimap, Ruler, and other subscribers to
 *  re-resolve theme-dependent colours.  Registered in EditorProvider. */
let bumpThemeRevisionHandler: (() => void) | null = null;

export function setBumpThemeRevisionHandler(fn: (() => void) | null): void {
  bumpThemeRevisionHandler = fn;
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
