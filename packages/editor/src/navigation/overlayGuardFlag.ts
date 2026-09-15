/**
 * History-state flag for the platform back-gesture overlay guard.
 *
 * Kept in a dependency-free module so both the React publisher
 * (`TabletBackDismiss`) and the deep-link listener can share it without
 * importing each other.
 */
export const OVERLAY_GUARD_FLAG = 'varveOverlayGuard';
