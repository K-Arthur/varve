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
 * - A back gesture pops the guard; the topmost Back-capable layer is closed
 *   through its owning dismissal API. If more layers remain, another guard
 *   is pushed so each back gesture dismisses exactly one layer.
 * - Closing the last layer from the UI removes the guard with
 *   `history.back()` so no dead history entry is left behind.
 *
 * Layers: registered overlays (menus, popovers, context menus, selects) via
 * the shared registry, plus app dialogs with an explicit Back handler. Legacy
 * raw dialogs retain Escape fallback behavior.
 *
 * Deep links listen to `popstate` too; `deepLinkHandler` skips entries marked
 * by the history state or the shared event-ownership marker.
 */
import {
  dismissTopmostOverlay,
  getBackDismissOverlayCount,
  requestBackDismiss,
  subscribeToOverlayCount,
} from '@varve/ui';
import { useEffect } from 'react';
import { markOverlayGuardTraversal, OVERLAY_GUARD_FLAG } from './overlayGuardFlag';

export { OVERLAY_GUARD_FLAG } from './overlayGuardFlag';

function openDialogs(ownerDocument: Document): HTMLDialogElement[] {
  return Array.from(ownerDocument.querySelectorAll<HTMLDialogElement>('dialog[open]'));
}

function topmostOpenDialog(ownerDocument: Document): HTMLDialogElement | null {
  const dialogs = openDialogs(ownerDocument);
  const active = ownerDocument.activeElement;
  return dialogs.find((dialog) => active && dialog.contains(active)) ?? dialogs.at(-1) ?? null;
}

function hasDismissableLayer(ownerDocument: Document): boolean {
  const dialog = topmostOpenDialog(ownerDocument);
  if (dialog) {
    return (
      getBackDismissOverlayCount(ownerDocument, { within: dialog }) > 0 ||
      dialog.dataset.backDismiss !== 'false'
    );
  }
  return getBackDismissOverlayCount(ownerDocument) > 0;
}

function dismissDialog(ownerDocument: Document, dialog: HTMLDialogElement): boolean {
  if (dialog.dataset.backDismiss === 'false') return false;
  if (dialog.dataset.backDismiss === 'true') return requestBackDismiss(dialog);
  const active = ownerDocument.activeElement;
  const target = active && dialog.contains(active) ? active : dialog;
  const KeyboardEventConstructor = ownerDocument.defaultView?.KeyboardEvent ?? KeyboardEvent;
  target.dispatchEvent(
    new KeyboardEventConstructor('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  );
  return true;
}

/** Dismiss one topmost eligible surface and report whether Back was handled. */
function dismissTopLayer(ownerDocument: Document): { handled: boolean } {
  const dialog = topmostOpenDialog(ownerDocument);
  if (dialog) {
    const nestedOverlay = dismissTopmostOverlay(ownerDocument, { within: dialog });
    if (nestedOverlay.handled) return nestedOverlay;
    return { handled: dismissDialog(ownerDocument, dialog) };
  }
  return dismissTopmostOverlay(ownerDocument);
}

function baseHistoryState(): Record<string, unknown> {
  const state = history.state as unknown;
  return state && typeof state === 'object' ? (state as Record<string, unknown>) : {};
}

export function TabletBackDismiss(): null {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof history === 'undefined') return;
    let guardPushed = false;
    // Removing a guard uses history.back(), whose popstate is asynchronous.
    // Keep the guard logically owned until that pop arrives; otherwise a new
    // overlay opened during the handoff gets a second guard and the old
    // popstate is mistaken for a user back gesture (dispatching Escape into
    // the newly focused control).
    let guardDropPending = false;

    const pushGuard = () => {
      if (guardPushed || guardDropPending || !hasDismissableLayer(document)) return;
      try {
        history.pushState({ ...baseHistoryState(), [OVERLAY_GUARD_FLAG]: true }, '', location.href);
        guardPushed = true;
      } catch {
        // Sandboxed or history-restricted contexts: degrade to normal back
        // navigation rather than breaking overlay teardown.
      }
    };

    const dropGuard = () => {
      if (!guardPushed || guardDropPending) return;
      // Only pop when the guard is actually the current entry; otherwise the
      // back traversal belongs to a real document entry and must not be
      // consumed by overlay cleanup.
      const state = history.state as Record<string, unknown> | null;
      if (state?.[OVERLAY_GUARD_FLAG] !== true) {
        guardPushed = false;
        return;
      }
      guardDropPending = true;
      try {
        history.back();
      } catch {
        // See pushGuard. There will be no popstate to reconcile after a
        // history failure, so release the logical ownership immediately.
        guardDropPending = false;
        guardPushed = false;
      }
    };

    const syncGuard = () => {
      if (hasDismissableLayer(document)) pushGuard();
      else dropGuard();
    };

    const unsubscribe = subscribeToOverlayCount(document, () => syncGuard());

    // Native dialogs do not register with the overlay registry. Observe only
    // their open/dismissibility attributes so busy dialogs do not hold a
    // browser-history guard they cannot handle.
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
      attributeFilter: ['open', 'data-back-dismiss'],
    });

    const onPopState = (event: PopStateEvent) => {
      if (!guardPushed && !guardDropPending) return;
      if (guardDropPending) {
        markOverlayGuardTraversal(event);
        guardDropPending = false;
        guardPushed = false;
        // The pop was the cleanup requested by dropGuard, not a user back
        // gesture. If a new layer opened during the handoff, replace the
        // consumed guard without sending Escape to that layer.
        if (hasDismissableLayer(document)) pushGuard();
        return;
      }
      if (!hasDismissableLayer(document)) {
        guardPushed = false;
        return;
      }
      const result = dismissTopLayer(document);
      if (!result.handled) {
        guardPushed = false;
        return;
      }
      markOverlayGuardTraversal(event);
      guardPushed = false;
      // One guard per remaining layer, so the next back gesture closes the
      // next layer instead of leaving the document.
      if (hasDismissableLayer(document)) pushGuard();
    };
    // Capture runs before deep-link routing's bubbling listener. The shared
    // event marker prevents this guard-owned traversal from replaying the
    // same URL as a fresh navigation request.
    window.addEventListener('popstate', onPopState, true);

    return () => {
      unsubscribe();
      observer.disconnect();
      window.removeEventListener('popstate', onPopState, true);
    };
  }, []);

  return null;
}
