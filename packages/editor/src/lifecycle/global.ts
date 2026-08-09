/**
 * Module-level coordinator accessor — follows the repo's singleton pattern
 * (getSharedRecoveryManager / getActionRegistry). LifecycleProvider installs
 * the instance; the native bridge and unload handlers read it. A null
 * coordinator means no editor is mounted, so no unsaved work can exist.
 */

import type { TerminationCoordinator } from './coordinator';
import type { TerminationIntent } from './types';

let coordinator: TerminationCoordinator | null = null;

export function installLifecycleCoordinator(instance: TerminationCoordinator): void {
  coordinator = instance;
}

export function getLifecycleCoordinator(): TerminationCoordinator | null {
  return coordinator;
}

export function uninstallLifecycleCoordinator(): void {
  coordinator = null;
}

/** Platform commit action: desktop installs the native close/exit bridge;
 *  web leaves it unset (browser unload is browser-controlled). */
let finalizeHandler: ((intent: TerminationIntent) => void | Promise<void>) | null = null;

/** DOM event dispatched by the commit-phase finalizers so UI-owned jobs
 *  (export batches, print jobs) can cancel themselves (ADR-0216 D8). */
export const LIFECYCLE_COMMIT_EVENT = 'varve:lifecycle-commit';

export function setLifecycleFinalizeHandler(
  handler: ((intent: TerminationIntent) => void | Promise<void>) | null,
): void {
  finalizeHandler = handler;
}

export function getLifecycleFinalizeHandler():
  | ((intent: TerminationIntent) => void | Promise<void>)
  | null {
  return finalizeHandler;
}
