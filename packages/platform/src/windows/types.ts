/**
 * Native window service types (ADR-0022).
 *
 * The window service is the ONLY sanctioned surface for creating and
 * controlling application windows and enumerating monitors. React never
 * imports Tauri APIs directly; this module is the port, and memory /
 * browser / tauri implementations are the adapters.
 *
 * Logical `WorkspaceWindowId`s are distinct from Tauri labels: labels are
 * sanitized derivations (ADR-0020), never durable identity.
 */

export type WorkspaceWindowId = string;

export type NativeWindowCapability = 'native' | 'browser-popup' | 'single-window';

export interface PhysicalPoint {
  x: number;
  y: number;
}

export interface PhysicalSize {
  width: number;
  height: number;
}

/** A display in physical pixels, as reported by the OS. */
export interface DisplayInfo {
  /** Session-scoped runtime id — NOT durable across reboots/docks. */
  runtimeId: string;
  name?: string;
  isPrimary: boolean;
  position: PhysicalPoint;
  size: PhysicalSize;
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  rotation?: 0 | 90 | 180 | 270;
}

/**
 * Durable-enough descriptor for matching saved placement to a current
 * display (ADR-0033). Deliberately excludes runtime ids and absolute
 * coordinates.
 */
export interface DisplayFingerprint {
  name?: string;
  physicalSizeHint?: PhysicalSize;
  resolution: PhysicalSize;
  scaleFactor: number;
  relativeRole?: 'primary' | 'left' | 'right' | 'above' | 'below';
}

export type WindowState = 'normal' | 'maximized' | 'fullscreen' | 'minimized';

/**
 * Machine-local placement in logical pixels. `displayFingerprint` is the
 * portable part (used for restoration matching); `displayId` is the
 * session-scoped hint.
 */
export interface WindowPlacement {
  displayId?: string;
  displayFingerprint?: DisplayFingerprint;
  logicalPosition: PhysicalPoint;
  logicalSize: PhysicalSize;
  state: WindowState;
}

export interface WorkspaceWindowInfo {
  id: WorkspaceWindowId;
  /** Sanitized Tauri label (desktop) or synthetic label (other backends). */
  label: string;
  title: string;
  visible: boolean;
  focused: boolean;
  minimized: boolean;
  maximized: boolean;
  fullscreen: boolean;
  placement?: WindowPlacement;
  monitor?: DisplayInfo | null;
}

export interface CreateWorkspaceWindowOptions {
  title: string;
  size: PhysicalSize;
  minSize?: PhysicalSize;
  placement?: WindowPlacement;
  /**
   * Application-owned route only (e.g. `?surface=panel-window`). The
   * service rejects anything else; arbitrary URLs are never allowed
   * (ADR-0040).
   */
  route?: string;
  /** Optional label override; sanitized by the service. */
  label?: string;
}

export type WorkspaceWindowEvent =
  | { type: 'created'; windowId: WorkspaceWindowId; info: WorkspaceWindowInfo }
  | { type: 'closed'; windowId: WorkspaceWindowId }
  | { type: 'moved'; windowId: WorkspaceWindowId; placement: WindowPlacement }
  | { type: 'resized'; windowId: WorkspaceWindowId; size: PhysicalSize }
  | { type: 'focused'; windowId: WorkspaceWindowId }
  | { type: 'blurred'; windowId: WorkspaceWindowId }
  | { type: 'minimized'; windowId: WorkspaceWindowId }
  | { type: 'maximized'; windowId: WorkspaceWindowId }
  | { type: 'restored'; windowId: WorkspaceWindowId }
  | { type: 'fullscreen'; windowId: WorkspaceWindowId }
  | { type: 'unfullscreen'; windowId: WorkspaceWindowId }
  | { type: 'monitors-changed'; displays: DisplayInfo[] };

export interface NativeWindowService {
  /** What this runtime can actually do — UI must not over-promise. */
  readonly capability: NativeWindowCapability;

  createWindow(options: CreateWorkspaceWindowOptions): Promise<WorkspaceWindowInfo>;
  closeWindow(windowId: WorkspaceWindowId): Promise<void>;
  focusWindow(windowId: WorkspaceWindowId): Promise<void>;
  showWindow(windowId: WorkspaceWindowId): Promise<void>;
  hideWindow(windowId: WorkspaceWindowId): Promise<void>;

  getCurrentWindow(): Promise<WorkspaceWindowInfo>;
  listWindows(): Promise<WorkspaceWindowInfo[]>;
  listMonitors(): Promise<DisplayInfo[]>;

  getWindowPlacement(windowId: WorkspaceWindowId): Promise<WindowPlacement | null>;
  setWindowPlacement(windowId: WorkspaceWindowId, placement: WindowPlacement): Promise<void>;

  listenToWindowEvents(handler: (event: WorkspaceWindowEvent) => void): Promise<() => void>;
}

/** Error for operations this runtime cannot perform (never a silent no-op). */
export class UnsupportedOperationError extends Error {
  constructor(operation: string, capability: NativeWindowCapability) {
    super(`window operation '${operation}' is not supported by the '${capability}' window service`);
    this.name = 'UnsupportedOperationError';
  }
}

export const DEFAULT_MAX_AUXILIARY_WINDOWS = 8;

/** Max characters of a Tauri window label (ADR-0020). */
export const MAX_WINDOW_LABEL_LENGTH = 32;

/** Sanitize a window label: lowercase alphanumerics and hyphens only. */
export function sanitizeWindowLabel(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, MAX_WINDOW_LABEL_LENGTH);
  return cleaned.length > 0 ? cleaned : 'varve-w';
}

/** Derive the sanitized Tauri label for a logical window id (ADR-0020). */
export function deriveWindowLabel(windowId: WorkspaceWindowId): string {
  const short = windowId.replace(/[^a-z0-9-]/g, '').slice(0, 12);
  return sanitizeWindowLabel(`varve-w-${short}`);
}
