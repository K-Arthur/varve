/**
 * Window service facade (ADR-0022).
 *
 * `getWindowService()` returns the singleton window service for the
 * current runtime: tauri on desktop, browser (single-window) on web,
 * memory in tests. React never imports Tauri APIs directly — this is the
 * sanctioned boundary.
 */

import { detectPlatformKind } from '../detect';
import { BrowserWindowService } from './browser';
import { MemoryWindowService } from './memory';
import { TauriWindowService } from './tauri';
import type { NativeWindowService } from './types';

let singleton: NativeWindowService | null = null;
let override: NativeWindowService | null = null;

export function getWindowService(): NativeWindowService {
  if (override) return override;
  if (singleton) return singleton;
  const kind = detectPlatformKind();
  singleton =
    kind === 'tauri'
      ? new TauriWindowService()
      : kind === 'web'
        ? new BrowserWindowService()
        : new MemoryWindowService();
  return singleton;
}

/** Test seam: pin a specific service (mirrors setPlatformInfoForTest). */
export function setWindowServiceForTest(service: NativeWindowService | null): void {
  override = service;
}

export function resetWindowServiceForTest(): void {
  override = null;
  singleton = null;
}

export { createBrowserWindowService } from './browser';
export {
  cascadePlacement,
  clampNumber,
  clampPlacementToWorkArea,
  computeRelativeRole,
  fingerprintFromDisplay,
  logicalToPhysical,
  MIN_DISPLAY_MATCH_SCORE,
  matchDisplayFingerprint,
  physicalToLogical,
  pickDisplayForFingerprint,
  TITLE_BAR_MARGIN,
} from './geometry';
export {
  createMemoryWindowService,
  DEFAULT_MEMORY_MONITORS,
  type MemoryDisplayFixture,
  type MemoryWindowServiceOptions,
} from './memory';
export { createTauriWindowService } from './tauri';
export type {
  CreateWorkspaceWindowOptions,
  DisplayFingerprint,
  DisplayInfo,
  NativeWindowCapability,
  NativeWindowService,
  PhysicalPoint,
  PhysicalSize,
  WindowPlacement,
  WindowState,
  WorkspaceWindowEvent,
  WorkspaceWindowId,
  WorkspaceWindowInfo,
} from './types';
export {
  DEFAULT_MAX_AUXILIARY_WINDOWS,
  deriveWindowLabel,
  MAX_WINDOW_LABEL_LENGTH,
  sanitizeWindowLabel,
  UnsupportedOperationError,
} from './types';
export { BrowserWindowService, MemoryWindowService, TauriWindowService };
