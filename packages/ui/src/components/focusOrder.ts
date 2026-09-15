/**
 * Focus-order helpers for transient surfaces (popovers, menus, portals).
 *
 * These are deliberately DOM-only and side-effect free so a portaled surface
 * can reason about the *document's* sequential focus order rather than the
 * subtree it renders into. The popover container is portaled to the end of
 * the body, so a naive Tab from the trigger walks the whole document before
 * reaching it; the helpers here let the owning surface hand focus back to the
 * trigger's position in the real order.
 */

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])';

/** Visible, sequentially focusable elements inside a container, in DOM order. */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.tabIndex >= 0 && isVisible(element) && !isInert(element),
  );
}

/**
 * Move focus to the next (direction 1) or previous (direction -1) sequentially
 * focusable element after `from` in its owner document, wrapping at the ends.
 * Used when a transient surface must yield Tab back to the page around its
 * trigger instead of letting the browser continue from a portaled node.
 */
export function focusAdjacentTabbable(
  from: HTMLElement | null | undefined,
  direction: 1 | -1,
  exclude?: HTMLElement | null,
): HTMLElement | null {
  if (!from) return null;
  const doc = from.ownerDocument;
  const tabbables = Array.from(doc.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      isVisible(element) &&
      !isInert(element) &&
      !exclude?.contains(element),
  );
  if (tabbables.length === 0) return null;
  const index = tabbables.indexOf(from);
  const start = index === -1 ? (direction === 1 ? -1 : 0) : index;
  const target = tabbables[(start + direction + tabbables.length) % tabbables.length];
  if (!target) return null;
  target.focus();
  return target;
}

function isInert(element: HTMLElement): boolean {
  return element.closest('[inert]') !== null;
}

/**
 * Visible in the sequential-focus sense. Walks ancestors for `display: none`
 * and `visibility: hidden` instead of relying on layout boxes, because
 * layout-less environments (jsdom, some detached windows) report no client
 * rects for otherwise focusable controls.
 */
function isVisible(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    current = current.parentElement;
  }
  return true;
}
