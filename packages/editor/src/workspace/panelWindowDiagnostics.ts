/**
 * Bounded, local diagnostics for detached panel windows.
 *
 * This is intentionally an in-memory development/opt-in aid, not telemetry:
 * it never sends events, persists them, or accepts arbitrary payloads.  The
 * narrow input shape keeps document contents, paths, credentials, clipboard
 * data, and panel-local snapshots out of diagnostic output by construction.
 */

export const PANEL_WINDOW_DIAGNOSTICS_STORAGE_KEY = 'varve:panel-window-diagnostics';
export const PANEL_WINDOW_DIAGNOSTICS_MAX_EVENTS = 200;

export type PanelWindowDiagnosticType =
  | 'detach-requested'
  | 'destination-host-reserved'
  | 'destination-window-create-started'
  | 'destination-window-created'
  | 'destination-host-registered'
  | 'panel-hydration-started'
  | 'panel-hydrated'
  | 'panel-hydration-failed'
  | 'source-removal-committed'
  | 'detach-rollback-started'
  | 'detach-rollback-completed'
  | 'dock-requested'
  | 'focus-requested'
  | 'focus-confirmed'
  | 'auxiliary-close-requested'
  | 'host-cleanup-completed'
  | 'stale-message-rejected'
  | 'invalid-message-rejected'
  | 'window-moved'
  | 'window-resized'
  | 'monitor-topology-changed'
  | 'topology-reconciliation-started'
  | 'topology-reconciled'
  | 'placement-applied'
  | 'layout-persisted'
  | 'layout-persistence-failed';

export interface PanelWindowDiagnosticBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Deliberately whitelist-only event payload. Do not add document data,
 * arbitrary error messages, URLs, or panel snapshots here.
 */
export interface PanelWindowDiagnosticInput {
  type: PanelWindowDiagnosticType;
  transactionId?: string;
  panelTypeId?: string;
  panelInstanceId?: string;
  sourceWindowId?: string;
  destinationWindowId?: string;
  windowId?: string;
  sessionId?: string;
  protocolVersion?: number;
  generation?: number;
  lifecyclePhase?: string;
  displayId?: string;
  logicalBounds?: PanelWindowDiagnosticBounds;
  displayCount?: number;
  result?: string;
  errorCode?: string;
}

export interface PanelWindowDiagnosticEvent extends PanelWindowDiagnosticInput {
  /** Wall-clock time is useful when correlating a manually captured trace. */
  timestamp: number;
  /** Monotonic time is useful for ordering and duration calculations. */
  monotonicTimestamp: number;
}

type DiagnosticsGlobal = typeof globalThis & {
  __VARVE_PANEL_WINDOW_DIAGNOSTICS__?: boolean;
};

let enabledForTest: boolean | null = null;
let events: PanelWindowDiagnosticEvent[] = [];
const listeners = new Set<(event: PanelWindowDiagnosticEvent) => void>();

function isDevelopmentBuild(): boolean {
  return (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;
}

function isOptedIn(): boolean {
  if ((globalThis as DiagnosticsGlobal).__VARVE_PANEL_WINDOW_DIAGNOSTICS__ === true) return true;
  try {
    return (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(PANEL_WINDOW_DIAGNOSTICS_STORAGE_KEY) === '1'
    );
  } catch {
    return false;
  }
}

/** Development builds record automatically; production must be explicitly opted in. */
export function isPanelWindowDiagnosticsEnabled(): boolean {
  return enabledForTest ?? (isDevelopmentBuild() || isOptedIn());
}

function boundedIdentifier(value: string | undefined, maxLength = 128): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return undefined;
  return /^[A-Za-z0-9_.:-]+$/.test(value) ? value : undefined;
}

function boundedPhase(value: string | undefined): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return undefined;
  return /^[A-Za-z0-9_.:-]+$/.test(value) ? value : undefined;
}

function boundedFiniteInteger(value: number | undefined, max: number): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
    ? value
    : undefined;
}

function safeBounds(
  value: PanelWindowDiagnosticBounds | undefined,
): PanelWindowDiagnosticBounds | undefined {
  if (!value) return undefined;
  const values = [value.x, value.y, value.width, value.height];
  if (
    values.some((candidate) => !Number.isFinite(candidate) || Math.abs(candidate) > 10_000_000) ||
    value.width <= 0 ||
    value.height <= 0
  ) {
    return undefined;
  }
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function monotonicNow(): number {
  return typeof performance !== 'undefined' && Number.isFinite(performance.now())
    ? performance.now()
    : Date.now();
}

function sanitize(input: PanelWindowDiagnosticInput): PanelWindowDiagnosticEvent {
  return {
    type: input.type,
    timestamp: Date.now(),
    monotonicTimestamp: monotonicNow(),
    ...(boundedIdentifier(input.transactionId)
      ? { transactionId: boundedIdentifier(input.transactionId) }
      : {}),
    ...(boundedIdentifier(input.panelTypeId, 64)
      ? { panelTypeId: boundedIdentifier(input.panelTypeId, 64) }
      : {}),
    ...(boundedIdentifier(input.panelInstanceId)
      ? { panelInstanceId: boundedIdentifier(input.panelInstanceId) }
      : {}),
    ...(boundedIdentifier(input.sourceWindowId)
      ? { sourceWindowId: boundedIdentifier(input.sourceWindowId) }
      : {}),
    ...(boundedIdentifier(input.destinationWindowId)
      ? { destinationWindowId: boundedIdentifier(input.destinationWindowId) }
      : {}),
    ...(boundedIdentifier(input.windowId) ? { windowId: boundedIdentifier(input.windowId) } : {}),
    ...(boundedIdentifier(input.sessionId)
      ? { sessionId: boundedIdentifier(input.sessionId) }
      : {}),
    ...(boundedFiniteInteger(input.protocolVersion, 1000) !== undefined
      ? { protocolVersion: boundedFiniteInteger(input.protocolVersion, 1000) }
      : {}),
    ...(boundedFiniteInteger(input.generation, Number.MAX_SAFE_INTEGER) !== undefined
      ? { generation: boundedFiniteInteger(input.generation, Number.MAX_SAFE_INTEGER) }
      : {}),
    ...(boundedPhase(input.lifecyclePhase)
      ? { lifecyclePhase: boundedPhase(input.lifecyclePhase) }
      : {}),
    ...(boundedIdentifier(input.displayId)
      ? { displayId: boundedIdentifier(input.displayId) }
      : {}),
    ...(safeBounds(input.logicalBounds) ? { logicalBounds: safeBounds(input.logicalBounds) } : {}),
    ...(boundedFiniteInteger(input.displayCount, 64) !== undefined
      ? { displayCount: boundedFiniteInteger(input.displayCount, 64) }
      : {}),
    ...(boundedPhase(input.result) ? { result: boundedPhase(input.result) } : {}),
    ...(boundedPhase(input.errorCode) ? { errorCode: boundedPhase(input.errorCode) } : {}),
  };
}

/** Record one safe event when local diagnostics are enabled. */
export function recordPanelWindowDiagnostic(input: PanelWindowDiagnosticInput): void {
  if (!isPanelWindowDiagnosticsEnabled()) return;
  const event = sanitize(input);
  events = [...events.slice(-(PANEL_WINDOW_DIAGNOSTICS_MAX_EVENTS - 1)), event];
  for (const listener of listeners) listener(event);
}

/** Read a snapshot of the bounded in-memory ring buffer. */
export function getPanelWindowDiagnostics(): PanelWindowDiagnosticEvent[] {
  return events.map((event) => ({
    ...event,
    ...(event.logicalBounds ? { logicalBounds: { ...event.logicalBounds } } : {}),
  }));
}

/** Subscribe to future local events. This never creates a transport or telemetry channel. */
export function subscribePanelWindowDiagnostics(
  listener: (event: PanelWindowDiagnosticEvent) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearPanelWindowDiagnostics(): void {
  events = [];
}

/** Test-only override so production/opt-in behavior remains deterministic in unit tests. */
export function setPanelWindowDiagnosticsEnabledForTest(enabled: boolean | null): void {
  enabledForTest = enabled;
}

export function resetPanelWindowDiagnosticsForTest(): void {
  enabledForTest = null;
  events = [];
  listeners.clear();
}
