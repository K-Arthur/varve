/**
 * NavigationRequest / NavigationResult — the typed contract every navigation
 * entry point (workspace switcher, document tabs, page nav, minimap, deep
 * links, "Go to…") funnels through.
 *
 * The coordinator (navigationCoordinator.ts) is the single interpreter; the
 * request carries *policy* (activation, focus, fit, history, failure), never
 * implementation details, so callers stay decoupled from how a destination
 * is actually reached.
 */

import type { NavigationTarget } from './navigationTargets';

export type NavigationSource = 'user' | 'shortcut' | 'command-palette' | 'deep-link' | 'internal';

/** Whether the destination should be activated or merely revealed. */
export type ActivationPolicy = 'manual' | 'auto';

/**
 * Where keyboard/AT focus should land after navigation. Pointer-triggered
 * navigation must never steal focus (`preserve`).
 */
export type FocusPolicy = 'preserve' | 'canvas' | 'target';

/** How the camera should treat the destination. */
export type FitPolicy = 'none' | 'fit' | 'reveal';

/**
 * Whether this navigation should be recorded in the viewport/selection
 * history stack (kept separate from artwork undo/redo).
 */
export type HistoryPolicy = 'record' | 'ignore';

/** What the caller should do when navigation cannot complete. */
export type FailurePolicy = 'toast' | 'silent' | 'block';

export interface NavigationRequest {
  target: NavigationTarget;
  source: NavigationSource;
  /** Defaults: manual (deep links may pass auto). */
  activation?: ActivationPolicy;
  /** Defaults: preserve (never steal focus on pointer input). */
  focus?: FocusPolicy;
  /** Defaults: none. */
  fit?: FitPolicy;
  /** Defaults: ignore (callers opt into history recording). */
  history?: HistoryPolicy;
  /** Defaults: toast. */
  failure?: FailurePolicy;
}

export type NavigationResult =
  | { status: 'completed'; target: NavigationTarget }
  | { status: 'blocked'; reason: string; target: NavigationTarget }
  | { status: 'cancelled'; target: NavigationTarget }
  | { status: 'stale'; reason: string; target: NavigationTarget }
  | { status: 'document-unavailable'; target: NavigationTarget }
  /** The target belongs to another document; the caller may offer open-or-cancel. */
  | { status: 'cross-document'; documentId?: string; target: NavigationTarget }
  | { status: 'partially-completed'; reason?: string; target: NavigationTarget };

export const NAVIGATION_RESULT_STATUSES = [
  'completed',
  'blocked',
  'cancelled',
  'stale',
  'document-unavailable',
  'cross-document',
  'partially-completed',
] as const;

export type NavigationResultStatus = (typeof NAVIGATION_RESULT_STATUSES)[number];

export function isSuccessfulResult(result: NavigationResult): boolean {
  return result.status === 'completed' || result.status === 'partially-completed';
}

export function resultIsBlocked(result: NavigationResult): boolean {
  return (
    result.status === 'blocked' ||
    result.status === 'cancelled' ||
    result.status === 'stale' ||
    result.status === 'document-unavailable'
  );
}

/** Human-readable summary for announcements/toasts; empty string = silent. */
export function describeNavigationResult(result: NavigationResult): string {
  switch (result.status) {
    case 'completed':
      return '';
    case 'blocked':
      return `Navigation blocked: ${result.reason}`;
    case 'cancelled':
      return 'Navigation cancelled';
    case 'stale':
      return `Destination is no longer available: ${result.reason}`;
    case 'document-unavailable':
      return 'The document could not be opened';
    case 'cross-document':
      return 'This destination belongs to another document';
    case 'partially-completed':
      return result.reason ?? 'Destination partially reached';
  }
}
