/**
 * Side-button classification for the canvas pointer pipeline.
 *
 * Mouse buttons 3 (back) and 4 (forward) are the platform-standard
 * history-navigation buttons. Varve has no browser history to navigate, but
 * it does have a selection history — the two are analogous enough that
 * back/forward map to "previous selection" / "next selection" while the
 * canvas owns the interaction. Without this mapping the buttons are dead
 * (and, in the browser, would navigate the webview itself).
 */

export type SideButtonAction = 'previous-selection' | 'next-selection' | null;

/** Map a mouse button to its selection-history action. */
export function resolveSideButtonAction(button: number): SideButtonAction {
  if (button === 3) return 'previous-selection';
  if (button === 4) return 'next-selection';
  return null;
}
