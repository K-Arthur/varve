/**
 * Focus movement helpers for composite widgets.
 *
 * Shared by Menu, Toolbar, and any widget that needs to:
 *  - resolve the next/previous *enabled* item index (roving tabindex), and
 *  - walk the global tab order from a given anchor element (e.g. "Tab closed
 *    this menu — move focus to the next control after the trigger").
 */

export const TABBABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])';

export function isTabbable(el: Element): boolean {
  if (el.matches(TABBABLE_SELECTOR)) {
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    return true;
  }
  return false;
}

/**
 * Walk the tab order from `anchor` in `dir` direction, optionally scoped to
 * `scope` (inclusive of the anchor when the anchor is inside the scope).
 * Returns null when no further focusable element exists.
 */
export function walkFocus(
  anchor: HTMLElement,
  dir: 1 | -1,
  scope?: HTMLElement | null,
): HTMLElement | null {
  const all = Array.from(
    (scope ?? document.body).querySelectorAll<HTMLElement>(TABBABLE_SELECTOR),
  ).filter(isTabbable);
  const i = all.indexOf(anchor);
  if (i === -1) {
    return dir > 0 ? (all[0] ?? null) : (all[all.length - 1] ?? null);
  }
  return all[i + dir] ?? null;
}

/**
 * Resolve the next enabled index in a circular item list, skipping disabled
 * items. Returns the same index when every item is disabled or the list is
 * empty.
 */
export function nextEnabledIndex(
  length: number,
  from: number,
  dir: 1 | -1,
  isDisabledAt: (i: number) => boolean,
): number {
  if (length <= 0) return from;
  const norm = ((from % length) + length) % length;
  for (let step = 1; step <= length; step += 1) {
    const i = (((norm + dir * step) % length) + length) % length;
    if (!isDisabledAt(i)) return i;
  }
  return norm;
}

/** First enabled index in [0, length), or -1 when none are enabled. */
export function firstEnabledIndex(length: number, isDisabledAt: (i: number) => boolean): number {
  for (let i = 0; i < length; i += 1) {
    if (!isDisabledAt(i)) return i;
  }
  return -1;
}
