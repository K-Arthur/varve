import type { Document } from '@strata/scene';
import { getSharedRecoveryManager } from './recovery';

/**
 * Fire-and-forget recovery point before a large mutation.
 * This allows undo-style recovery from destructive operations
 * (batch delete, arrange, reparent, etc.) even if the user
 * has already undone past the mutation.
 */
export function snapshotBeforeMutation(doc: Document, operationLabel: string): void {
  try {
    const mgr = getSharedRecoveryManager();
    mgr.createRecoveryPoint(doc, `Before ${operationLabel}`).catch(() => {
      // Recovery point creation failure should never block the UI
    });
  } catch {
    // Silently ignore — recovery is best-effort
  }
}

/** Module-level bridge for auto-save service */
let notifyMutationHandler: (() => void) | null = null;

export function setNotifyMutationHandler(fn: (() => void) | null): void {
  notifyMutationHandler = fn;
}

/**
 * Notify the auto-save service that a large mutation occurred.
 * The service will schedule a save sooner than the regular interval.
 */
export function notifyLargeMutation(): void {
  notifyMutationHandler?.();
}
