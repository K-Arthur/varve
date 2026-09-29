/**
 * History-state flag for the platform back-gesture overlay guard.
 *
 * Kept in a dependency-free module so both the React publisher
 * (`TabletBackDismiss`) and the deep-link listener can share it without
 * importing each other.
 */
export const OVERLAY_GUARD_FLAG = 'varveOverlayGuard';

const overlayGuardTraversals = new WeakSet<PopStateEvent>();

/** Mark the same-URL history traversal owned by the overlay Back guard. */
export function markOverlayGuardTraversal(event: PopStateEvent): void {
  overlayGuardTraversals.add(event);
}

/** Deep-link routing must ignore a Back event already claimed by the overlay guard. */
export function isOverlayGuardTraversal(event: PopStateEvent): boolean {
  return overlayGuardTraversals.has(event);
}
