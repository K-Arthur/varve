/**
 * Platform back-gesture dismissal.
 *
 * ChromeOS tablet mode turns a swipe from the left screen edge into a browser
 * Back navigation (Chromium's `BackGestureEventHandler` sends a back event;
 * see the Stage 4 research ledger). In an installed PWA or a browser tab that
 * reaches the app as `popstate`. Native apps close the topmost overlay on
 * back, so the web app must do the same or the gesture leaves the document.
 *
 * Mechanism (the standard modal/back pattern):
 * - While at least one dismissible layer is open, one history entry (the
 *   "guard") is pushed on top of the current one. The URL never changes.
 * - A back gesture pops the guard; the topmost dismissible layer is closed
 *   with the same semantics as Escape. If more layers remain, another guard
 *   is pushed so each back gesture dismisses exactly one layer.
 * - Closing the last layer from the UI removes the guard with
 *   `history.back()` so no dead history entry is left behind.
 *
 * Layers: registered overlays (menus, popovers, context menus, selects) via
 * the shared registry, plus native `<dialog>` elements, which are dismissed
 * by dispatching Escape so their own dismissible/nested-overlay contracts
 * stay in charge.
 *
 * Deep links listen to `popstate` too; `deepLinkHandler` skips entries whose
 * state carries {@link OVERLAY_GUARD_FLAG}.
 */
import { getOverlayCount, subscribeToOverlayCount } from '@varve/ui';
import { useEffect } from 'react';
import { OVERLAY_GUARD_FLAG } from './overlayGuardFlag';

export { OVERLAY_GUARD_FLAG } from './overlayGuardFlag';

function openDialogs(ownerDocument: Document): HTMLDialogElement[] {
  return Array.from(ownerDocument.querySelectorAll<HTMLDialogElement>('dialog[open]'));
}

function hasDismissableLayer(ownerDocument: Document): boolean {
  return getOverlayCount(ownerDocument) > 0 || openDialogs(ownerDocument).length > 0;
}

/**
 * Dismiss the topmost layer exactly the way the Escape key does. Dispatching
 * on the focused element preserves every consumer's own contract: menubar
 * menus handle Escape in their keynav, registered overlays through the
 * registry's document listener, and native dialogs through their React
 * keydown handler (which respects dismissible/nested-overlay rules).
 */
function dismissTopLayer(ownerDocument: Document): void {
  const active = ownerDocument.activeElement;
  const target = active instanceof Element ? active : ownerDocument.body;
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
}

function baseHistoryState(): Record<string, unknown> {
  const state = history.state as unknown;
  return state && typeof state === 'object' ? (state as Record<string, unknown>) : {};
}

export function TabletBackDismiss(): null {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof history === 'undefined') return;
    let guardPushed = false;

    const pushGuard = () => {
      if (guardPushed || !hasDismissableLayer(document)) return;
      try {
        history.pushState({ ...baseHistoryState(), [OVERLAY_GUARD_FLAG]: true }, '', location.href);
        guardPushed = true;
      } catch {
        // Sandboxed or history-restricted contexts: degrade to normal back
        // navigation rather than breaking overlay teardown.
      }
    };

    const dropGuard = () => {
      if (!guardPushed) return;
      guardPushed = false;
      // Only pop when the guard is actually the current entry; otherwise the
      // back traversal belongs to a real document entry and must not be
      // consumed by overlay cleanup.
      const state = history.state as Record<string, unknown> | null;
      if (state?.[OVERLAY_GUARD_FLAG] !== true) return;
      try {
        history.back();
      } catch {
        // See pushGuard.
      }
    };

    const syncGuard = () => {
      if (hasDismissableLayer(document)) pushGuard();
      else dropGuard();
    };

    const unsubscribe = subscribeToOverlayCount(document, () => syncGuard());

    // Native dialogs never register with the overlay registry; observe only
    // their `open` attribute so the guard covers them without paying for
    // every DOM mutation in the editor.
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.target instanceof Element && mutation.target.tagName === 'DIALOG') {
          syncGuard();
          return;
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    });

    const onPopState = () => {
      if (!guardPushed) return;
      guardPushed = false;
      if (!hasDismissableLayer(document)) return;
      dismissTopLayer(document);
      // One guard per remaining layer, so the next back gesture closes the
      // next layer instead of leaving the document.
      if (hasDismissableLayer(document)) pushGuard();
    };
    window.addEventListener('popstate', onPopState);

    return () => {
      unsubscribe();
      observer.disconnect();
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  return null;
}
