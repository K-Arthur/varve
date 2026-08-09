/**
 * Module-level coordinator accessor — follows the repo's singleton pattern
 * (getSharedRecoveryManager / getActionRegistry). LifecycleProvider installs
 * the instance; the native bridge and unload handlers read it. A null
 * coordinator means no editor is mounted, so no unsaved work can exist.
 */

import type { TerminationCoordinator } from './coordinator';

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
