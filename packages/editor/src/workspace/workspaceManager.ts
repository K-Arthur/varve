/**
 * Workspace Manager (M10) — named layout CRUD, active layout tracking,
 * multi-window diagnostics, and display-aware window management.
 *
 * Pure functions + stateless helpers. No React, no Tauri. The caller owns
 * persistence (layoutPersistence.ts) and window service interaction.
 */

import {
  clampPlacementToWorkArea,
  type DisplayFingerprint,
  type DisplayInfo,
  fingerprintFromDisplay,
  logicalWorkAreaForDisplay,
  normalizePlacementForDisplay,
  type PhysicalSize,
  pickDisplayForFingerprint,
  placementFromNormalizedBounds,
  type WindowPlacement,
  type WindowState,
} from '@varve/platform';
import { collectPanelInstances, normalizeDockTree } from './dockOps';
import type { NativeWorkspaceLayout, PanelInstance, WorkspaceWindowLayout } from './dockTypes';
import { WORKSPACE_LAYOUT_VERSION } from './dockTypes';
import type { PanelTypeId } from './panelRegistry';

// ---------------------------------------------------------------------------
// Named layout store (in-memory, caller persists)
// ---------------------------------------------------------------------------

export interface NamedLayout {
  id: string;
  name: string;
  layout: NativeWorkspaceLayout;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceManagerState {
  namedLayouts: NamedLayout[];
  activeLayoutId: string | null;
}

/** Create an empty initial state. */
export function createInitialState(): WorkspaceManagerState {
  return { namedLayouts: [], activeLayoutId: null };
}

// ---------------------------------------------------------------------------
// Named layout CRUD
// ---------------------------------------------------------------------------

/** Save (create or update) a named layout. */
export function saveNamedLayout(
  state: WorkspaceManagerState,
  name: string,
  layout: NativeWorkspaceLayout,
): WorkspaceManagerState {
  const now = Date.now();
  const existing = state.namedLayouts.find((nl) => nl.name.toLowerCase() === name.toLowerCase());

  if (existing) {
    return {
      ...state,
      namedLayouts: state.namedLayouts.map((nl) =>
        nl.id === existing.id ? { ...nl, layout, updatedAt: now } : nl,
      ),
    };
  }

  const id = `nl-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    ...state,
    namedLayouts: [...state.namedLayouts, { id, name, layout, createdAt: now, updatedAt: now }],
  };
}

/** Load a named layout by id. Returns undefined if not found. */
export function loadNamedLayout(
  state: WorkspaceManagerState,
  layoutId: string,
): NativeWorkspaceLayout | undefined {
  return state.namedLayouts.find((nl) => nl.id === layoutId)?.layout;
}

/** Delete a named layout by id. */
export function deleteNamedLayout(
  state: WorkspaceManagerState,
  layoutId: string,
): WorkspaceManagerState {
  return {
    ...state,
    namedLayouts: state.namedLayouts.filter((nl) => nl.id !== layoutId),
    activeLayoutId: state.activeLayoutId === layoutId ? null : state.activeLayoutId,
  };
}

/** Rename a named layout. */
export function renameNamedLayout(
  state: WorkspaceManagerState,
  layoutId: string,
  newName: string,
): WorkspaceManagerState {
  return {
    ...state,
    namedLayouts: state.namedLayouts.map((nl) =>
      nl.id === layoutId ? { ...nl, name: newName, updatedAt: Date.now() } : nl,
    ),
  };
}

/** List all named layouts (sorted by name). */
export function listNamedLayouts(state: WorkspaceManagerState): NamedLayout[] {
  return [...state.namedLayouts].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Active layout tracking
// ---------------------------------------------------------------------------

/** Set the active layout by id. Validates the layout exists. */
export function setActiveLayout(
  state: WorkspaceManagerState,
  layoutId: string,
): WorkspaceManagerState {
  const exists = state.namedLayouts.some((nl) => nl.id === layoutId);
  return exists ? { ...state, activeLayoutId: layoutId } : state;
}

/** Clear the active layout. */
export function clearActiveLayout(state: WorkspaceManagerState): WorkspaceManagerState {
  return { ...state, activeLayoutId: null };
}

/** Get the currently active layout, or undefined if none. */
export function getActiveLayout(state: WorkspaceManagerState): NativeWorkspaceLayout | undefined {
  if (!state.activeLayoutId) return undefined;
  return loadNamedLayout(state, state.activeLayoutId);
}

// ---------------------------------------------------------------------------
// Capture current layout
// ---------------------------------------------------------------------------

export interface CaptureOptions {
  /** Layout name. Defaults to 'Unnamed'. */
  name?: string;
  /** Optional workspace mode association. */
  workspaceMode?: string;
}

/**
 * Capture a snapshot of the current layout from a set of windows and panel
 * instances. Produces a serializable NativeWorkspaceLayout.
 */
export function captureCurrentLayout(
  windows: WorkspaceWindowLayout[],
  panelInstances: PanelInstance[],
  options: CaptureOptions = {},
): NativeWorkspaceLayout {
  return {
    schemaVersion: WORKSPACE_LAYOUT_VERSION,
    id: `layout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: options.name ?? 'Unnamed',
    workspaceMode: options.workspaceMode,
    windows: windows.map((w) => ({
      ...w,
      dockRoot: normalizeDockTree(w.dockRoot),
    })),
    panelInstances: [...panelInstances],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Window diagnostics
// ---------------------------------------------------------------------------

export interface WindowDiagnostic {
  windowId: string;
  role: string;
  panelCount: number;
  panelTypes: PanelTypeId[];
  hasEmptyRoot: boolean;
  state: string;
}

/**
 * Diagnose the health of all windows in a layout. Returns per-window
 * diagnostics useful for crash recovery and UI reporting.
 */
export function diagnoseWindows(layout: NativeWorkspaceLayout): WindowDiagnostic[] {
  return layout.windows.map((w) => {
    const panelIds = collectPanelInstances(w.dockRoot);
    const panelTypes = panelIds
      .map((pid) => layout.panelInstances.find((p) => p.id === pid)?.panelTypeId)
      .filter((t): t is PanelTypeId => t !== undefined);

    return {
      windowId: w.id,
      role: w.role,
      panelCount: panelIds.length,
      panelTypes,
      hasEmptyRoot: w.dockRoot.kind === 'empty',
      state: w.state,
    };
  });
}

// ---------------------------------------------------------------------------
// Display-aware window management
// ---------------------------------------------------------------------------

/**
 * Determine which display has the most windows from a layout.
 * Returns the display runtimeId, or undefined if no windows match.
 */
export function primaryDisplayForLayout(
  layout: NativeWorkspaceLayout,
  placements: Array<{ windowId: string; displayId?: string }>,
): string | undefined {
  const displayCounts = new Map<string, number>();
  for (const win of layout.windows) {
    const placement = placements.find((p) => p.windowId === win.id);
    if (placement?.displayId) {
      displayCounts.set(placement.displayId, (displayCounts.get(placement.displayId) ?? 0) + 1);
    }
  }

  let bestDisplay: string | undefined;
  let bestCount = 0;
  for (const [displayId, count] of displayCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestDisplay = displayId;
    }
  }
  return bestDisplay;
}

/**
 * Compute placements that gather all windows onto a single target display.
 * Returns new placement for each window, cascaded within the display's work area.
 */
export function gatherWindowsOntoDisplay(
  layout: NativeWorkspaceLayout,
  targetDisplay: DisplayInfo,
): Array<{ windowId: string; x: number; y: number; width: number; height: number }> {
  const windowWidth = Math.min(400, targetDisplay.workArea.width);
  const windowHeight = Math.min(600, targetDisplay.workArea.height);
  const cascadeOffset = 32;

  return layout.windows.map((win, index) => {
    const x =
      targetDisplay.workArea.x +
      ((index * cascadeOffset) % (targetDisplay.workArea.width - windowWidth));
    const y =
      targetDisplay.workArea.y +
      ((index * cascadeOffset) % (targetDisplay.workArea.height - windowHeight));
    return {
      windowId: win.id,
      x,
      y,
      width: windowWidth,
      height: windowHeight,
    };
  });
}

/**
 * Compute a fullscreen placement for a window on a given display.
 */
export function fullscreenOnDisplay(
  windowId: string,
  display: DisplayInfo,
): { windowId: string; x: number; y: number; width: number; height: number } {
  return {
    windowId,
    x: display.workArea.x,
    y: display.workArea.y,
    width: display.workArea.width,
    height: display.workArea.height,
  };
}

/**
 * Compute a placement that moves a window to a target display,
 * preserving relative offset from the display's top-left corner.
 * If the window is not currently placed, centers it on the target.
 */
export function moveWindowToDisplay(
  _windowId: string,
  currentPlacement: { x: number; y: number; width: number; height: number } | undefined,
  sourceDisplay: DisplayInfo | undefined,
  targetDisplay: DisplayInfo,
): { x: number; y: number; width: number; height: number } {
  const width = currentPlacement?.width ?? Math.min(400, targetDisplay.workArea.width);
  const height = currentPlacement?.height ?? Math.min(600, targetDisplay.workArea.height);

  if (currentPlacement && sourceDisplay) {
    // Preserve relative offset within the display
    const relX = currentPlacement.x - sourceDisplay.workArea.x;
    const relY = currentPlacement.y - sourceDisplay.workArea.y;
    return {
      x:
        targetDisplay.workArea.x +
        Math.max(0, Math.min(relX, targetDisplay.workArea.width - width)),
      y:
        targetDisplay.workArea.y +
        Math.max(0, Math.min(relY, targetDisplay.workArea.height - height)),
      width,
      height,
    };
  }

  // No current placement — center on target
  return {
    x: targetDisplay.workArea.x + (targetDisplay.workArea.width - width) / 2,
    y: targetDisplay.workArea.y + (targetDisplay.workArea.height - height) / 2,
    width,
    height,
  };
}

// ---------------------------------------------------------------------------
// Per-panel window placement persistence (ADR-0210)
// ---------------------------------------------------------------------------

const PANEL_PLACEMENTS_KEY = 'varve-panel-placements';

/** The on-disk envelope version for independently detached panel windows. */
export const PANEL_PLACEMENT_SCHEMA_VERSION = 2 as const;

const DEFAULT_PANEL_MIN_SIZE: PhysicalSize = { width: 240, height: 160 };

/**
 * Bounds expressed as fractions of the display's *logical* work area.
 * They deliberately survive a changed resolution, taskbar, or DPI scale.
 */
export interface NormalizedPanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelPlacementRecord {
  /** Always `PANEL_PLACEMENT_SCHEMA_VERSION` for records returned by this module. */
  schemaVersion: typeof PANEL_PLACEMENT_SCHEMA_VERSION;
  panelTypeId: string;
  /** Current window id hosting this panel. */
  windowId: string;
  /** Session-scoped monitor hint. The fingerprint is used after topology changes. */
  displayId?: string;
  /** Durable monitor descriptor; never rely on a runtime id across sessions. */
  displayFingerprint?: DisplayFingerprint;
  /** Monitor-relative logical bounds for DPI- and topology-safe restoration. */
  normalizedBounds?: NormalizedPanelBounds;
  logicalPosition: { x: number; y: number };
  logicalSize: { width: number; height: number };
  state: WindowState;
  updatedAt: number;
}

/**
 * Input accepted from the window service. `schemaVersion` is optional so
 * existing callers can keep passing the v1 shape; persisted records are
 * immediately migrated to the v2 envelope.
 */
export interface PanelPlacementInput {
  schemaVersion?: number;
  panelTypeId: string;
  windowId: string;
  displayId?: string;
  displayFingerprint?: DisplayFingerprint;
  normalizedBounds?: NormalizedPanelBounds;
  logicalPosition: { x: number; y: number };
  logicalSize: { width: number; height: number };
  state: WindowState;
  updatedAt: number;
}

export interface PanelPlacementSaveOptions {
  /**
   * The display currently hosting the window. When supplied, it is the only
   * source used for the persisted fingerprint and normalized bounds.
   */
  display?: DisplayInfo;
  /** Current monitor topology, used to compute the display's relative role. */
  displays?: readonly DisplayInfo[];
}

export interface PanelPlacementRestoreOptions {
  /** Minimum logical window size enforced by the destination window host. */
  minSize?: PhysicalSize;
}

export type PanelPlacementRecoverySource = 'normalized' | 'legacy';

export interface RestoredPanelPlacement {
  record: PanelPlacementRecord;
  placement: WindowPlacement;
  display: DisplayInfo;
  source: PanelPlacementRecoverySource;
}

interface PanelPlacementStore {
  schemaVersion: typeof PANEL_PLACEMENT_SCHEMA_VERSION;
  records: PanelPlacementRecord[];
}

/**
 * Normalize an incoming placement before it crosses the persistence boundary.
 * This is deliberately pure so native/window event code can test its recovery
 * policy without a browser storage implementation.
 */
export function preparePanelPlacementRecord(
  input: PanelPlacementInput,
  options: PanelPlacementSaveOptions = {},
): PanelPlacementRecord | null {
  const record = sanitizePanelPlacementRecord(input);
  if (!record) return null;

  const display = isUsableDisplay(options.display) ? options.display : undefined;
  if (!display) return record;

  const displays = usableDisplays(options.displays);
  const primary = displays.find((candidate) => candidate.isPrimary);
  const workArea = logicalWorkAreaForDisplay(display);
  const geometryState = geometryStateFor(record.state);
  const geometry = clampPlacementToWorkArea(
    {
      displayId: display.runtimeId,
      logicalPosition: record.logicalPosition,
      logicalSize: record.logicalSize,
      state: record.state,
    },
    workArea,
    DEFAULT_PANEL_MIN_SIZE,
    geometryState,
  );
  const placement = { ...geometry, state: record.state };

  return {
    ...record,
    displayId: display.runtimeId,
    displayFingerprint: fingerprintFromDisplay(display, primary),
    normalizedBounds: normalizePlacementForDisplay(placement, display),
    logicalPosition: placement.logicalPosition,
    logicalSize: placement.logicalSize,
  };
}

/**
 * Persist a panel window's placement (keyed by panel type — stable across
 * sessions). Invalid input is ignored rather than making a corrupt record
 * durable. Supplying the current display produces a v2 portable record.
 */
export function savePanelPlacement(
  input: PanelPlacementInput,
  options: PanelPlacementSaveOptions = {},
): void {
  try {
    const record = preparePanelPlacementRecord(input, options);
    if (!record) return;
    const all = loadPanelPlacements();
    const next = all.filter((r) => r.panelTypeId !== record.panelTypeId);
    next.push(record);
    const store: PanelPlacementStore = {
      schemaVersion: PANEL_PLACEMENT_SCHEMA_VERSION,
      records: next,
    };
    localStorage.setItem(PANEL_PLACEMENTS_KEY, JSON.stringify(store));
  } catch {
    // Non-fatal
  }
}

export function loadPanelPlacements(): PanelPlacementRecord[] {
  try {
    const raw = localStorage.getItem(PANEL_PLACEMENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return parsePanelPlacementStore(parsed);
  } catch {
    return [];
  }
}

export function loadPanelPlacement(panelTypeId: string): PanelPlacementRecord | null {
  return loadPanelPlacements().find((r) => r.panelTypeId === panelTypeId) ?? null;
}

export function clearPanelPlacement(panelTypeId: string): void {
  try {
    const store: PanelPlacementStore = {
      schemaVersion: PANEL_PLACEMENT_SCHEMA_VERSION,
      records: loadPanelPlacements().filter((record) => record.panelTypeId !== panelTypeId),
    };
    localStorage.setItem(PANEL_PLACEMENTS_KEY, JSON.stringify(store));
  } catch {
    // Non-fatal
  }
}

/**
 * Clear every detached-panel placement while retaining an explicit, current
 * schema envelope. This is intentionally limited to machine-local panel
 * geometry: it does not alter workspace preferences or document data.
 */
export function clearPanelPlacements(): void {
  try {
    const store: PanelPlacementStore = {
      schemaVersion: PANEL_PLACEMENT_SCHEMA_VERSION,
      records: [],
    };
    localStorage.setItem(PANEL_PLACEMENTS_KEY, JSON.stringify(store));
  } catch {
    // Non-fatal
  }
}

/**
 * Clear a placement only when it still belongs to the window being recovered.
 * A newly detached replacement uses a new canonical window id and must not
 * lose its fresh placement to a late reset operation.
 */
export function clearPanelPlacementForWindow(panelTypeId: string, windowId: string): void {
  try {
    const records = loadPanelPlacements();
    const record = records.find((candidate) => candidate.panelTypeId === panelTypeId);
    if (!record || record.windowId !== windowId) return;
    const store: PanelPlacementStore = {
      schemaVersion: PANEL_PLACEMENT_SCHEMA_VERSION,
      records: records.filter((candidate) => candidate.panelTypeId !== panelTypeId),
    };
    localStorage.setItem(PANEL_PLACEMENTS_KEY, JSON.stringify(store));
  } catch {
    // Non-fatal
  }
}

/**
 * Restore one saved panel placement onto the current monitor topology.
 * A missing or renamed monitor resolves by fingerprint, then safely falls
 * back to the current primary display. No displays means no placement can be
 * applied, so callers retain their normal host default.
 */
export function restorePanelPlacement(
  input: unknown,
  displays: readonly DisplayInfo[],
  options: PanelPlacementRestoreOptions = {},
): RestoredPanelPlacement | null {
  const record = sanitizePanelPlacementRecord(input);
  const usable = usableDisplays(displays);
  if (!record || usable.length === 0) return null;

  const display = resolvePanelPlacementDisplay(record, usable);
  const minSize = sanitizeSize(options.minSize) ?? DEFAULT_PANEL_MIN_SIZE;
  const primary = usable.find((candidate) => candidate.isPrimary);
  const workArea = logicalWorkAreaForDisplay(display);

  const geometryState = geometryStateFor(record.state);
  const geometry = record.normalizedBounds
    ? placementFromNormalizedBounds(record.normalizedBounds, display, minSize, geometryState)
    : clampPlacementToWorkArea(
        {
          displayId: display.runtimeId,
          logicalPosition: record.logicalPosition,
          logicalSize: record.logicalSize,
          state: record.state,
        },
        workArea,
        minSize,
        geometryState,
      );
  const placement = { ...geometry, state: record.state };

  return {
    record,
    placement: {
      ...placement,
      displayId: display.runtimeId,
      displayFingerprint: fingerprintFromDisplay(display, primary),
    },
    display,
    source: record.normalizedBounds ? 'normalized' : 'legacy',
  };
}

/**
 * Reconcile arbitrary persisted records against current displays. It filters
 * corrupt entries, picks the newest duplicate for each panel, and returns a
 * refreshed v2 record plus the placement to apply. Callers may persist the
 * returned records after a successful native placement update.
 */
export function reconcilePanelPlacements(
  inputs: readonly unknown[],
  displays: readonly DisplayInfo[],
  options: PanelPlacementRestoreOptions = {},
): RestoredPanelPlacement[] {
  const usable = usableDisplays(displays);
  if (usable.length === 0) return [];

  return newestPanelPlacements(inputs).flatMap((record) => {
    const restored = restorePanelPlacement(record, usable, options);
    if (!restored) return [];
    const refreshed = preparePanelPlacementRecord(
      {
        ...restored.record,
        displayId: restored.placement.displayId,
        displayFingerprint: restored.placement.displayFingerprint,
        logicalPosition: restored.placement.logicalPosition,
        logicalSize: restored.placement.logicalSize,
        state: restored.placement.state,
      },
      { display: restored.display, displays: usable },
    );
    return refreshed ? [{ ...restored, record: refreshed }] : [];
  });
}

/**
 * Build a safe, cascaded "bring all panel windows here" plan. It is pure:
 * callers decide whether to apply these placements through the window service
 * and persist the refreshed records only after those operations succeed.
 */
export function gatherPanelPlacementsOntoDisplay(
  inputs: readonly unknown[],
  targetDisplay: DisplayInfo,
  options: PanelPlacementRestoreOptions = {},
): RestoredPanelPlacement[] {
  if (!isUsableDisplay(targetDisplay)) return [];

  const minSize = sanitizeSize(options.minSize) ?? DEFAULT_PANEL_MIN_SIZE;
  const workArea = logicalWorkAreaForDisplay(targetDisplay);
  const primary = targetDisplay.isPrimary ? targetDisplay : undefined;

  return newestPanelPlacements(inputs).flatMap((record, index) => {
    const restored = restorePanelPlacement(record, [targetDisplay], { minSize });
    if (!restored) return [];

    const width = restored.placement.logicalSize.width;
    const height = restored.placement.logicalSize.height;
    const step = 32;
    const maxOffsetX = Math.max(0, workArea.width - width);
    const maxOffsetY = Math.max(0, workArea.height - height);
    const offset = index * step;
    const cascaded = clampPlacementToWorkArea(
      {
        displayId: targetDisplay.runtimeId,
        logicalPosition: {
          x: workArea.x + (offset % Math.max(step, maxOffsetX + step)),
          y: workArea.y + (offset % Math.max(step, maxOffsetY + step)),
        },
        logicalSize: { width, height },
        state: restored.placement.state,
      },
      workArea,
      minSize,
      restored.placement.state,
    );
    const placement: WindowPlacement = {
      ...cascaded,
      displayId: targetDisplay.runtimeId,
      displayFingerprint: fingerprintFromDisplay(targetDisplay, primary),
    };
    const refreshed = preparePanelPlacementRecord(
      {
        ...record,
        displayId: placement.displayId,
        displayFingerprint: placement.displayFingerprint,
        logicalPosition: placement.logicalPosition,
        logicalSize: placement.logicalSize,
        state: placement.state,
      },
      { display: targetDisplay, displays: [targetDisplay] },
    );
    return refreshed
      ? [
          {
            record: refreshed,
            placement,
            display: targetDisplay,
            source: restored.source,
          },
        ]
      : [];
  });
}

function parsePanelPlacementStore(value: unknown): PanelPlacementRecord[] {
  const records = Array.isArray(value)
    ? value // v1 stored the record array directly.
    : isRecord(value) &&
        isKnownPanelPlacementSchemaVersion(value.schemaVersion) &&
        Array.isArray(value.records)
      ? value.records
      : [];
  return newestPanelPlacements(records);
}

function newestPanelPlacements(inputs: readonly unknown[]): PanelPlacementRecord[] {
  const newestByPanel = new Map<string, PanelPlacementRecord>();
  for (const input of inputs) {
    const record = sanitizePanelPlacementRecord(input);
    if (!record) continue;
    const existing = newestByPanel.get(record.panelTypeId);
    if (!existing || record.updatedAt >= existing.updatedAt) {
      newestByPanel.set(record.panelTypeId, record);
    }
  }
  return [...newestByPanel.values()];
}

function sanitizePanelPlacementRecord(value: unknown): PanelPlacementRecord | null {
  if (!isRecord(value)) return null;
  const panelTypeId = validIdentifier(value.panelTypeId);
  const windowId = validIdentifier(value.windowId);
  const logicalPosition = sanitizePoint(value.logicalPosition);
  const logicalSize = sanitizeSize(value.logicalSize);
  if (!panelTypeId || !windowId || !logicalPosition || !logicalSize) return null;

  const state = isWindowState(value.state) ? value.state : 'normal';
  const updatedAt = finiteNonNegative(value.updatedAt) ? value.updatedAt : 0;
  const displayId = validIdentifier(value.displayId);
  const displayFingerprint = sanitizeDisplayFingerprint(value.displayFingerprint);
  const normalizedBounds = sanitizeNormalizedBounds(value.normalizedBounds);

  return {
    schemaVersion: PANEL_PLACEMENT_SCHEMA_VERSION,
    panelTypeId,
    windowId,
    ...(displayId ? { displayId } : {}),
    ...(displayFingerprint ? { displayFingerprint } : {}),
    ...(normalizedBounds ? { normalizedBounds } : {}),
    logicalPosition,
    logicalSize,
    state,
    updatedAt,
  };
}

function resolvePanelPlacementDisplay(
  record: PanelPlacementRecord,
  displays: readonly DisplayInfo[],
): DisplayInfo {
  if (record.displayFingerprint) {
    return pickDisplayForFingerprint(record.displayFingerprint, [...displays]);
  }
  if (record.displayId) {
    const direct = displays.find((display) => display.runtimeId === record.displayId);
    if (direct) return direct;
  }
  return displays.find((display) => display.isPrimary) ?? displays[0]!;
}

function usableDisplays(displays: readonly DisplayInfo[] | undefined): DisplayInfo[] {
  return (displays ?? []).filter(isUsableDisplay);
}

function isUsableDisplay(value: unknown): value is DisplayInfo {
  if (!isRecord(value)) return false;
  return (
    validIdentifier(value.runtimeId) !== undefined &&
    typeof value.isPrimary === 'boolean' &&
    isFinitePoint(value.position) &&
    sanitizeSize(value.size) !== undefined &&
    isFiniteLogicalRectLike(value.workArea) &&
    typeof value.scaleFactor === 'number' &&
    Number.isFinite(value.scaleFactor) &&
    value.scaleFactor > 0
  );
}

function sanitizeDisplayFingerprint(value: unknown): DisplayFingerprint | undefined {
  if (!isRecord(value) || !sanitizeSize(value.resolution)) return undefined;
  if (
    typeof value.scaleFactor !== 'number' ||
    !Number.isFinite(value.scaleFactor) ||
    value.scaleFactor <= 0
  ) {
    return undefined;
  }
  const relativeRole = value.relativeRole;
  if (
    relativeRole !== undefined &&
    relativeRole !== 'primary' &&
    relativeRole !== 'left' &&
    relativeRole !== 'right' &&
    relativeRole !== 'above' &&
    relativeRole !== 'below'
  ) {
    return undefined;
  }
  const name = typeof value.name === 'string' && value.name.length <= 256 ? value.name : undefined;
  const physicalSizeHint = sanitizeSize(value.physicalSizeHint);
  return {
    ...(name ? { name } : {}),
    ...(physicalSizeHint ? { physicalSizeHint } : {}),
    resolution: sanitizeSize(value.resolution)!,
    scaleFactor: value.scaleFactor,
    ...(relativeRole ? { relativeRole } : {}),
  };
}

function sanitizeNormalizedBounds(value: unknown): NormalizedPanelBounds | undefined {
  if (!isRecord(value)) return undefined;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const width = finiteNumber(value.width);
  const height = finiteNumber(value.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined)
    return undefined;
  // Values beyond this range cannot describe a useful restored panel and are
  // almost certainly corrupted storage; reject rather than creating a giant
  // off-screen placement that has to be repaired later.
  if (
    width <= 0 ||
    height <= 0 ||
    width > 10 ||
    height > 10 ||
    Math.abs(x) > 10 ||
    Math.abs(y) > 10
  ) {
    return undefined;
  }
  return { x, y, width, height };
}

function isWindowState(value: unknown): value is WindowState {
  return (
    value === 'normal' || value === 'maximized' || value === 'fullscreen' || value === 'minimized'
  );
}

function isKnownPanelPlacementSchemaVersion(value: unknown): boolean {
  return value === 1 || value === PANEL_PLACEMENT_SCHEMA_VERSION;
}

/** Maximized/fullscreen state is restored after clamping its stored geometry. */
function geometryStateFor(state: WindowState): WindowState {
  return state === 'maximized' || state === 'fullscreen' ? 'normal' : state;
}

function validIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;
}

function sanitizePoint(value: unknown): { x: number; y: number } | undefined {
  if (!isRecord(value)) return undefined;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  return x === undefined || y === undefined ? undefined : { x, y };
}

function sanitizeSize(value: unknown): PhysicalSize | undefined {
  if (!isRecord(value)) return undefined;
  const width = finiteNumber(value.width);
  const height = finiteNumber(value.height);
  return width === undefined || height === undefined || width <= 0 || height <= 0
    ? undefined
    : { width, height };
}

function isFinitePoint(value: unknown): boolean {
  return sanitizePoint(value) !== undefined;
}

function isFiniteLogicalRectLike(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    finiteNumber(value.x) !== undefined &&
    finiteNumber(value.y) !== undefined &&
    sanitizeSize(value) !== undefined
  );
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
