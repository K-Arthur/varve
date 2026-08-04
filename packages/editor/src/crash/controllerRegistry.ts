/**
 * Shared CrashCenter controller registry.
 *
 * The controller is created once at app boot by <CrashCenter/> (mounted in
 * apps/desktop/src/App.tsx) and read by the Privacy & Diagnostics settings
 * section inside the editor without prop drilling.
 */

import { CrashCenterController, type CrashControllerDeps } from './crashController';

let controller: CrashCenterController | null = null;

export function registerCrashController(instance: CrashCenterController): void {
  controller = instance;
}

export function getCrashController(): CrashCenterController | null {
  return controller;
}

/** Creates the controller if none exists (idempotent). */
export function getOrCreateCrashController(deps: CrashControllerDeps): CrashCenterController {
  if (!controller) {
    controller = new CrashCenterController(deps);
    registerCrashController(controller);
  }
  return controller;
}

export function resetCrashControllerForTests(): void {
  controller?.dispose();
  controller = null;
}
