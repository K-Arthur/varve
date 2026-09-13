/**
 * Workspace layout persistence (ADR-0210).
 *
 * Two-layer persistence:
 * - Logical layout: window roles, dock trees, panel instances, split ratios
 *   (portable across machines)
 * - Machine placement: window geometry, display fingerprints (device-specific)
 *
 * Both are versioned and sanitized on load. Corrupt data falls back to
 * safe defaults.
 */

import {
  type DisplayFingerprint,
  type DisplayInfo,
  pickDisplayForFingerprint,
} from '@varve/platform';
import { normalizeDockTree } from './dockOps';
import type { DockNode, NativeWorkspaceLayout, PanelInstance } from './dockTypes';
import { WORKSPACE_LAYOUT_VERSION } from './dockTypes';
import type { PanelTypeId } from './panelRegistry';

// ---------------------------------------------------------------------------
// Persistence keys
// ---------------------------------------------------------------------------

const LOGICAL_LAYOUT_KEY = 'varve-workspace-layout';
const MACHINE_PLACEMENT_KEY = 'varve-window-placements';
const LAST_KNOWN_GOOD_KEY = 'varve-workspace-layout-last-good';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MachinePlacement {
  windowId: string;
  displayFingerprint?: DisplayFingerprint;
  displayId?: string;
  logicalPosition: { x: number; y: number };
  logicalSize: { width: number; height: number };
  state: 'normal' | 'maximized' | 'fullscreen' | 'minimized';
}

export interface WorkspaceLayoutStore {
  logical: NativeWorkspaceLayout;
  placements: MachinePlacement[];
}

// ---------------------------------------------------------------------------
// Logical layout persistence
// ---------------------------------------------------------------------------

export function saveLogicalLayout(layout: NativeWorkspaceLayout): void {
  try {
    localStorage.setItem(LOGICAL_LAYOUT_KEY, JSON.stringify({ ...layout, updatedAt: Date.now() }));
  } catch {
    // Storage full or unavailable — non-fatal
  }
}

/**
 * Promote a layout to last-known-good.
 *
 * Called only after the layout has actually been validated and restored
 * successfully — never from the save path. Writing the same payload to both
 * keys made "last-known-good" a synonym for "last written", including a
 * layout that was never proven to mount; the recovery path below can then
 * fall back to a snapshot that predates the damage. The payload is
 * re-parsed through the same sanitizer as loading, so a caller cannot
 * promote an object that fails restore-time validation.
 */
export function promoteLastKnownGood(layout: NativeWorkspaceLayout): boolean {
  try {
    const sanitized = sanitizeLogicalLayout(
      JSON.parse(JSON.stringify({ ...layout, updatedAt: Date.now() })) as Record<string, unknown>,
    );
    if (!sanitized) return false;
    localStorage.setItem(LAST_KNOWN_GOOD_KEY, JSON.stringify(sanitized));
    return true;
  } catch {
    return false;
  }
}

export function loadLogicalLayout(): NativeWorkspaceLayout | null {
  try {
    const raw = localStorage.getItem(LOGICAL_LAYOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return sanitizeLogicalLayout(parsed);
  } catch {
    return null;
  }
}

export function loadLastKnownGoodLayout(): NativeWorkspaceLayout | null {
  try {
    const raw = localStorage.getItem(LAST_KNOWN_GOOD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return sanitizeLogicalLayout(parsed);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Machine placement persistence
// ---------------------------------------------------------------------------

export function saveMachinePlacements(placements: MachinePlacement[]): void {
  try {
    localStorage.setItem(MACHINE_PLACEMENT_KEY, JSON.stringify(placements));
  } catch {
    // Non-fatal
  }
}

export function loadMachinePlacements(): MachinePlacement[] {
  try {
    const raw = localStorage.getItem(MACHINE_PLACEMENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidMachinePlacement);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Restoration against current monitors
// ---------------------------------------------------------------------------

/**
 * Restore a saved layout against current monitor topology.
 * Returns a layout with updated window placements clamped to available displays.
 */
export function restoreLayoutAgainstMonitors(
  layout: NativeWorkspaceLayout,
  placements: MachinePlacement[],
  currentDisplays: DisplayInfo[],
): WorkspaceLayoutStore {
  const restoredPlacements: MachinePlacement[] = [];

  for (const win of layout.windows) {
    const savedPlacement = placements.find((p) => p.windowId === win.id);

    if (savedPlacement?.displayFingerprint) {
      // Match saved fingerprint to current display
      const matchedDisplay = pickDisplayForFingerprint(
        savedPlacement.displayFingerprint,
        currentDisplays,
      );

      // Clamp to matched display's work area
      const clamped = clampToWorkArea(
        savedPlacement,
        matchedDisplay.workArea,
        { width: 240, height: 160 }, // min panel window size
      );

      restoredPlacements.push({
        ...clamped,
        windowId: win.id,
        displayId: matchedDisplay.runtimeId,
        displayFingerprint: savedPlacement.displayFingerprint,
      });
    } else {
      // No saved placement — cascade on primary
      const primary = currentDisplays.find((d) => d.isPrimary) ?? currentDisplays[0];
      if (primary) {
        restoredPlacements.push({
          windowId: win.id,
          displayId: primary.runtimeId,
          displayFingerprint: undefined,
          logicalPosition: { x: primary.workArea.x + 32, y: primary.workArea.y + 32 },
          logicalSize: { width: 320, height: 480 },
          state: 'normal',
        });
      }
    }
  }

  return { logical: layout, placements: restoredPlacements };
}

// ---------------------------------------------------------------------------
// Migration from current settings
// ---------------------------------------------------------------------------

/**
 * Create an initial workspace layout from the current flat panel settings.
 * Called on first boot after multi-window lands.
 */
export function migrateFromCurrentSettings(settings: {
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
  leftPanelWidth: number | null;
  rightPanelWidth: number | null;
  workspaceMode: string;
}): NativeWorkspaceLayout {
  const panels: PanelInstance[] = [];
  let dockIndex = 0;

  const makeId = () => `pi-migrated-${dockIndex++}`;

  // Build a simple two-column layout
  let root: import('./dockTypes').DockNode | undefined;

  if (settings.leftPanelVisible && settings.rightPanelVisible) {
    const leftId = makeId();
    const rightId = makeId();
    panels.push({ id: leftId, panelTypeId: 'layers' as PanelTypeId, hostNodeId: `h-${leftId}` });
    panels.push({
      id: rightId,
      panelTypeId: 'inspector' as PanelTypeId,
      hostNodeId: `h-${rightId}`,
    });

    const leftRatio = settings.leftPanelWidth
      ? settings.leftPanelWidth / (settings.leftPanelWidth + (settings.rightPanelWidth ?? 320))
      : 0.35;

    root = {
      kind: 'split' as const,
      id: `dn-root-${Date.now().toString(36)}`,
      direction: 'horizontal' as const,
      ratio: leftRatio,
      first: { kind: 'panel' as const, id: `dn-${leftId}`, panelInstanceId: leftId },
      second: { kind: 'panel' as const, id: `dn-${rightId}`, panelInstanceId: rightId },
    };
  } else if (settings.leftPanelVisible) {
    const leftId = makeId();
    panels.push({ id: leftId, panelTypeId: 'layers' as PanelTypeId, hostNodeId: `h-${leftId}` });
    root = { kind: 'panel' as const, id: `dn-${leftId}`, panelInstanceId: leftId };
  } else if (settings.rightPanelVisible) {
    const rightId = makeId();
    panels.push({
      id: rightId,
      panelTypeId: 'inspector' as PanelTypeId,
      hostNodeId: `h-${rightId}`,
    });
    root = { kind: 'panel' as const, id: `dn-${rightId}`, panelInstanceId: rightId };
  } else {
    root = { kind: 'empty' as const, id: `dn-empty-${Date.now().toString(36)}` };
  }

  return {
    schemaVersion: WORKSPACE_LAYOUT_VERSION,
    id: `layout-migrated-${Date.now().toString(36)}`,
    name: 'Migrated Layout',
    workspaceMode: settings.workspaceMode,
    windows: [
      {
        id: 'main',
        role: 'primary',
        dockRoot: normalizeDockTree(root),
        state: 'normal',
      },
    ],
    panelInstances: panels,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

const VALID_WINDOW_ROLES = new Set(['primary', 'auxiliary-panel', 'document-view']);
const VALID_WINDOW_STATES = new Set(['normal', 'maximized', 'fullscreen', 'minimized']);

/** Imported layouts are untrusted input; bound the payload before parsing. */
const MAX_LAYOUT_IMPORT_BYTES = 2 * 1024 * 1024;

function sanitizeLogicalLayout(raw: Record<string, unknown>): NativeWorkspaceLayout | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const version = raw.schemaVersion;
  // Reject unknown future versions instead of relabelling them: rewriting a
  // payload written by a newer build as "version 1" destroys whatever the
  // future version meant, and a downgrade must leave it untouched so the
  // newer build can still read it.
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
  if (version > WORKSPACE_LAYOUT_VERSION) return null;
  if (!Array.isArray(raw.windows)) return null;
  if (!Array.isArray(raw.panelInstances)) return null;

  const windows: NativeWorkspaceLayout['windows'] = [];
  for (const value of raw.windows as unknown[]) {
    if (typeof value !== 'object' || value === null) return null;
    const w = value as Record<string, unknown>;
    if (typeof w.id !== 'string' || w.id.length === 0) return null;
    const role = typeof w.role === 'string' && VALID_WINDOW_ROLES.has(w.role) ? w.role : null;
    if (!role) return null;
    const state = typeof w.state === 'string' && VALID_WINDOW_STATES.has(w.state) ? w.state : null;
    if (!state) return null;
    let dockRoot: DockNode;
    try {
      dockRoot = normalizeDockTree(w.dockRoot as DockNode);
    } catch {
      return null;
    }
    windows.push({
      id: w.id,
      role: role as NativeWorkspaceLayout['windows'][number]['role'],
      dockRoot,
      state: state as NativeWorkspaceLayout['windows'][number]['state'],
    });
  }

  const panelInstances: PanelInstance[] = [];
  for (const value of raw.panelInstances as unknown[]) {
    if (typeof value !== 'object' || value === null) return null;
    const p = value as Record<string, unknown>;
    if (typeof p.id !== 'string' || p.id.length === 0) return null;
    if (typeof p.panelTypeId !== 'string' || p.panelTypeId.length === 0) return null;
    if (typeof p.hostNodeId !== 'string' || p.hostNodeId.length === 0) return null;
    panelInstances.push({
      id: p.id,
      panelTypeId: p.panelTypeId as PanelTypeId,
      hostNodeId: p.hostNodeId,
      ...(typeof p.pinnedDocumentId === 'string' ? { pinnedDocumentId: p.pinnedDocumentId } : {}),
      ...(typeof p.titleOverride === 'string' ? { titleOverride: p.titleOverride } : {}),
    });
  }

  return {
    schemaVersion: WORKSPACE_LAYOUT_VERSION,
    id: String(raw.id ?? ''),
    name: String(raw.name ?? 'Unnamed'),
    workspaceMode: raw.workspaceMode ? String(raw.workspaceMode) : undefined,
    windows,
    panelInstances,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

function clampToWorkArea(
  placement: MachinePlacement,
  workArea: { x: number; y: number; width: number; height: number },
  minSize: { width: number; height: number },
): MachinePlacement {
  if (placement.state === 'maximized' || placement.state === 'fullscreen') {
    return placement;
  }

  const width = Math.min(Math.max(placement.logicalSize.width, minSize.width), workArea.width);
  const height = Math.min(Math.max(placement.logicalSize.height, minSize.height), workArea.height);
  const x = Math.min(
    Math.max(placement.logicalPosition.x, workArea.x),
    workArea.x + workArea.width - width,
  );
  const y = Math.min(
    Math.max(placement.logicalPosition.y, workArea.y),
    workArea.y + workArea.height - height,
  );

  return {
    ...placement,
    logicalPosition: { x, y },
    logicalSize: { width, height },
  };
}

function isFinitePoint(value: unknown): value is { x: number; y: number } {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.x === 'number' &&
    Number.isFinite(p.x) &&
    typeof p.y === 'number' &&
    Number.isFinite(p.y)
  );
}

function isFiniteSize(value: unknown): value is { width: number; height: number } {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.width === 'number' &&
    Number.isFinite(s.width) &&
    s.width > 0 &&
    typeof s.height === 'number' &&
    Number.isFinite(s.height) &&
    s.height > 0
  );
}

function isValidMachinePlacement(p: unknown): p is MachinePlacement {
  if (typeof p !== 'object' || p === null) return false;
  const m = p as Record<string, unknown>;
  if (typeof m.windowId !== 'string' || m.windowId.length === 0) return false;
  if (!isFinitePoint(m.logicalPosition)) return false;
  if (!isFiniteSize(m.logicalSize)) return false;
  if (typeof m.state !== 'string' || !VALID_WINDOW_STATES.has(m.state)) {
    return false;
  }
  if (m.displayId !== undefined && typeof m.displayId !== 'string') return false;
  if (m.displayFingerprint !== undefined && typeof m.displayFingerprint !== 'object') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Export/import (logical layouts only, ADR-0210)
// ---------------------------------------------------------------------------

export function exportLogicalLayout(layout: NativeWorkspaceLayout): string {
  // Strip machine-specific data
  const portable = {
    ...layout,
    windows: layout.windows.map((w) => ({
      ...w,
      placement: undefined,
    })),
  };
  return JSON.stringify(portable, null, 2);
}

export function importLogicalLayout(json: string): NativeWorkspaceLayout | null {
  if (typeof json !== 'string' || json.length > MAX_LAYOUT_IMPORT_BYTES) return null;
  try {
    const parsed = JSON.parse(json);
    return sanitizeLogicalLayout(parsed);
  } catch {
    return null;
  }
}
