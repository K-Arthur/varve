/**
 * Workspace Manager (M10) — named layout CRUD, active layout tracking,
 * multi-window diagnostics, and display-aware window management.
 *
 * Pure functions + stateless helpers. No React, no Tauri. The caller owns
 * persistence (layoutPersistence.ts) and window service interaction.
 */

import type { DisplayInfo } from '@varve/platform';
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

export interface PanelPlacementRecord {
  panelTypeId: string;
  /** Current window id hosting this panel. */
  windowId: string;
  logicalPosition: { x: number; y: number };
  logicalSize: { width: number; height: number };
  state: 'normal' | 'maximized' | 'fullscreen' | 'minimized';
  updatedAt: number;
}

/** Persist a panel window's placement (keyed by panel type — stable across sessions). */
export function savePanelPlacement(record: PanelPlacementRecord): void {
  try {
    const all = loadPanelPlacements();
    const next = all.filter((r) => r.panelTypeId !== record.panelTypeId);
    next.push(record);
    localStorage.setItem(PANEL_PLACEMENTS_KEY, JSON.stringify(next));
  } catch {
    // Non-fatal
  }
}

export function loadPanelPlacements(): PanelPlacementRecord[] {
  try {
    const raw = localStorage.getItem(PANEL_PLACEMENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is PanelPlacementRecord =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as PanelPlacementRecord).panelTypeId === 'string' &&
        typeof (r as PanelPlacementRecord).logicalPosition === 'object' &&
        typeof (r as PanelPlacementRecord).logicalSize === 'object',
    );
  } catch {
    return [];
  }
}

export function loadPanelPlacement(panelTypeId: string): PanelPlacementRecord | null {
  return loadPanelPlacements().find((r) => r.panelTypeId === panelTypeId) ?? null;
}

export function clearPanelPlacement(panelTypeId: string): void {
  try {
    localStorage.setItem(
      PANEL_PLACEMENTS_KEY,
      JSON.stringify(loadPanelPlacements().filter((r) => r.panelTypeId !== panelTypeId)),
    );
  } catch {
    // Non-fatal
  }
}
