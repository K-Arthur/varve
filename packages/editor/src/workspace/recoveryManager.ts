/**
 * Auxiliary Recovery Manager (M11) — crash tracking, safe mode detection,
 * orphaned panel recovery, and safe-mode layout generation.
 *
 * Pure functions. No React, no Tauri, no DOM. Caller owns persistence
 * and window service interaction.
 */

import { collectPanelInstances } from './dockOps';
import type { DockNode, NativeWorkspaceLayout, PanelInstance } from './dockTypes';
import {
  createEmptyDockNode,
  createPanelDockNode,
  createSplitDockNode,
  WORKSPACE_LAYOUT_VERSION,
} from './dockTypes';
import type { PanelTypeId } from './panelRegistry';

// ---------------------------------------------------------------------------
// Crash tracking
// ---------------------------------------------------------------------------

export interface CrashRecord {
  timestamp: number;
  /** Window ids that were open at crash time. */
  openWindows: string[];
  /** Panel instance ids that were active. */
  activePanels: string[];
  /** Optional error message from the crash handler. */
  error?: string;
  /** Layout snapshot at crash time (for diagnostics). */
  layoutSnapshot?: NativeWorkspaceLayout;
}

export interface CrashHistory {
  crashes: CrashRecord[];
  /** Number of consecutive crashes since last clean shutdown. */
  consecutiveCrashes: number;
  /** Timestamp of last clean shutdown. */
  lastCleanShutdown: number | null;
}

/** Create an empty crash history. */
export function createCrashHistory(): CrashHistory {
  return { crashes: [], consecutiveCrashes: 0, lastCleanShutdown: null };
}

/** Record a crash event. */
export function recordCrash(history: CrashHistory, record: CrashRecord): CrashHistory {
  return {
    ...history,
    crashes: [...history.crashes, record],
    consecutiveCrashes: history.consecutiveCrashes + 1,
  };
}

/** Mark a clean shutdown (resets consecutive counter). */
export function markCleanShutdown(history: CrashHistory): CrashHistory {
  return {
    ...history,
    consecutiveCrashes: 0,
    lastCleanShutdown: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Safe mode
// ---------------------------------------------------------------------------

export interface SafeModeConfig {
  /** Whether safe mode is currently active. */
  isActive: boolean;
  /** Reason safe mode was activated. */
  reason: string;
  /** Timestamp when safe mode was entered. */
  enteredAt: number;
  /** Layout to use in safe mode. */
  layout: NativeWorkspaceLayout;
}

/**
 * Determine if safe mode should be activated based on crash history.
 * Activates after 2+ consecutive crashes.
 */
export function shouldActivateSafeMode(history: CrashHistory): boolean {
  return history.consecutiveCrashes >= 2;
}

/**
 * Get the reason string for entering safe mode.
 */
export function safeModeReason(history: CrashHistory): string {
  if (history.consecutiveCrashes >= 3) {
    return `${history.consecutiveCrashes} consecutive crashes detected — entering safe mode to prevent further instability.`;
  }
  if (history.consecutiveCrashes === 2) {
    return 'Multiple consecutive crashes detected. Safe mode will open with a minimal layout.';
  }
  return 'Crash detected. Monitoring for repeated failures.';
}

// ---------------------------------------------------------------------------
// Orphaned panel detection
// ---------------------------------------------------------------------------

export interface OrphanedPanel {
  panelInstanceId: string;
  panelTypeId: PanelTypeId;
  reason: string;
}

/**
 * Find panels that exist in panelInstances but are not referenced
 * by any window's dock tree.
 */
export function findOrphanedPanels(layout: NativeWorkspaceLayout): OrphanedPanel[] {
  const referencedIds = new Set<string>();
  for (const win of layout.windows) {
    for (const id of collectPanelInstances(win.dockRoot)) {
      referencedIds.add(id);
    }
  }

  return layout.panelInstances
    .filter((p) => !referencedIds.has(p.id))
    .map((p) => ({
      panelInstanceId: p.id,
      panelTypeId: p.panelTypeId,
      reason: `Panel instance '${p.id}' (${p.panelTypeId}) exists in panelInstances but is not hosted by any window dock tree.`,
    }));
}

/**
 * Find panels referenced by dock trees but missing from panelInstances.
 */
export function findMissingPanels(
  layout: NativeWorkspaceLayout,
): Array<{ panelInstanceId: string; windowId: string; reason: string }> {
  const instanceIds = new Set(layout.panelInstances.map((p) => p.id));
  const missing: Array<{ panelInstanceId: string; windowId: string; reason: string }> = [];

  for (const win of layout.windows) {
    for (const pid of collectPanelInstances(win.dockRoot)) {
      if (!instanceIds.has(pid)) {
        missing.push({
          panelInstanceId: pid,
          windowId: win.id,
          reason: `Panel instance '${pid}' is referenced in window '${win.id}' but has no PanelInstance entry.`,
        });
      }
    }
  }

  return missing;
}

/**
 * Clean orphaned panels from a layout. Removes orphaned panel instances
 * and re-normalizes affected dock trees.
 */
export function cleanOrphanedPanels(layout: NativeWorkspaceLayout): NativeWorkspaceLayout {
  const referencedIds = new Set<string>();
  for (const win of layout.windows) {
    for (const id of collectPanelInstances(win.dockRoot)) {
      referencedIds.add(id);
    }
  }

  return {
    ...layout,
    panelInstances: layout.panelInstances.filter((p) => referencedIds.has(p.id)),
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Safe mode layout
// ---------------------------------------------------------------------------

/**
 * Create a minimal safe-mode layout with only the essential panels.
 * Safe mode strips all auxiliary windows and keeps a single primary
 * window with layers + inspector in a simple split.
 */
export function createSafeModeLayout(
  previousLayout?: NativeWorkspaceLayout,
): NativeWorkspaceLayout {
  const layersId = `pi-safe-layers-${Date.now().toString(36)}`;
  const inspectorId = `pi-safe-inspector-${Date.now().toString(36)}`;

  const layersNode = createPanelDockNode(layersId);
  const inspectorNode = createPanelDockNode(inspectorId);
  const dockRoot = createSplitDockNode('horizontal', layersNode, inspectorNode, 0.35);

  const panelInstances: PanelInstance[] = [
    { id: layersId, panelTypeId: 'layers' as PanelTypeId, hostNodeId: dockRoot.id },
    { id: inspectorId, panelTypeId: 'inspector' as PanelTypeId, hostNodeId: dockRoot.id },
  ];

  // If a previous layout exists, carry forward any additional panel types
  // that are safe to include (non-auxiliary, non-detached).
  if (previousLayout) {
    const safeTypes = new Set(['timeline', 'pagenav', 'library', 'history']);
    for (const pi of previousLayout.panelInstances) {
      if (
        safeTypes.has(pi.panelTypeId as string) &&
        !panelInstances.some((p) => p.panelTypeId === pi.panelTypeId)
      ) {
        const newId = `pi-safe-${pi.panelTypeId}-${Date.now().toString(36)}`;
        panelInstances.push({
          id: newId,
          panelTypeId: pi.panelTypeId,
          hostNodeId: dockRoot.id,
        });
      }
    }
  }

  return {
    schemaVersion: WORKSPACE_LAYOUT_VERSION,
    id: `layout-safe-${Date.now().toString(36)}`,
    name: 'Safe Mode',
    windows: [
      {
        id: 'main',
        role: 'primary',
        dockRoot,
        state: 'normal',
      },
    ],
    panelInstances,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Layout repair
// ---------------------------------------------------------------------------

/**
 * Attempt to repair a corrupted layout. Steps:
 * 1. Remove orphaned panel instances (not referenced by any dock tree).
 * 2. Remove dock tree references to missing panel instances.
 * 3. Normalize all dock trees.
 * 4. Ensure at least one window exists.
 */
export function repairLayout(layout: NativeWorkspaceLayout): NativeWorkspaceLayout {
  const repaired = cleanOrphanedPanels(layout);

  // Remove missing panel references from dock trees
  const instanceIds = new Set(repaired.panelInstances.map((p) => p.id));
  const repairedWindows = repaired.windows.map((w) => ({
    ...w,
    dockRoot: removeMissingPanelRefs(w.dockRoot, instanceIds),
  }));

  // Ensure at least one window
  if (repairedWindows.length === 0) {
    repairedWindows.push({
      id: 'main',
      role: 'primary',
      dockRoot: createEmptyDockNode('No panels available'),
      state: 'normal',
    });
  }

  return {
    ...repaired,
    windows: repairedWindows,
    updatedAt: Date.now(),
  };
}

function removeMissingPanelRefs(node: DockNode, validIds: Set<string>): DockNode {
  if (node.kind === 'panel') {
    return validIds.has(node.panelInstanceId)
      ? node
      : createEmptyDockNode(`Missing panel: ${node.panelInstanceId}`);
  }
  if (node.kind === 'tab-group') {
    const validTabs = node.tabs.filter((t) => validIds.has(t));
    if (validTabs.length === 0) return createEmptyDockNode();
    if (validTabs.length === 1) return createPanelDockNode(validTabs[0]!);
    return {
      ...node,
      tabs: validTabs,
      activeTabIndex: Math.min(node.activeTabIndex, validTabs.length - 1),
    };
  }
  if (node.kind === 'split') {
    const first = removeMissingPanelRefs(node.first, validIds);
    const second = removeMissingPanelRefs(node.second, validIds);
    if (first.kind === 'empty' && second.kind === 'empty') return createEmptyDockNode();
    if (first.kind === 'empty') return second;
    if (second.kind === 'empty') return first;
    return { ...node, first, second };
  }
  return node;
}
