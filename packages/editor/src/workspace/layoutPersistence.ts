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
    const serialized = JSON.stringify({
      ...layout,
      updatedAt: Date.now(),
    });
    localStorage.setItem(LOGICAL_LAYOUT_KEY, serialized);
    // Save as last-known-good
    localStorage.setItem(LAST_KNOWN_GOOD_KEY, serialized);
  } catch {
    // Storage full or unavailable — non-fatal
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

function sanitizeLogicalLayout(raw: Record<string, unknown>): NativeWorkspaceLayout | null {
  if (typeof raw !== 'object' || raw === null) return null;
  if (typeof raw.schemaVersion !== 'number') return null;
  if (!Array.isArray(raw.windows)) return null;
  if (!Array.isArray(raw.panelInstances)) return null;

  // Normalize all dock roots
  const windows = (raw.windows as Record<string, unknown>[]).map((w) => ({
    id: String(w.id ?? ''),
    role: (w.role as 'primary' | 'auxiliary-panel' | 'document-view') ?? 'auxiliary-panel',
    dockRoot: normalizeDockTree(w.dockRoot as DockNode),
    state: (w.state as 'normal' | 'maximized' | 'fullscreen' | 'minimized') ?? 'normal',
  }));

  return {
    schemaVersion: WORKSPACE_LAYOUT_VERSION,
    id: String(raw.id ?? ''),
    name: String(raw.name ?? 'Unnamed'),
    workspaceMode: raw.workspaceMode ? String(raw.workspaceMode) : undefined,
    windows: windows as NativeWorkspaceLayout['windows'],
    panelInstances: raw.panelInstances as PanelInstance[],
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

function isValidMachinePlacement(p: unknown): p is MachinePlacement {
  if (typeof p !== 'object' || p === null) return false;
  const m = p as Record<string, unknown>;
  return (
    typeof m.windowId === 'string' &&
    typeof m.logicalPosition === 'object' &&
    m.logicalPosition !== null &&
    typeof m.logicalSize === 'object' &&
    m.logicalSize !== null
  );
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
  try {
    const parsed = JSON.parse(json);
    return sanitizeLogicalLayout(parsed);
  } catch {
    return null;
  }
}
