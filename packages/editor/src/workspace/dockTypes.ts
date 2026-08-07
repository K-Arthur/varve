/**
 * Dock-tree model (ADR-0206) — normalized, serializable representation
 * of panel arrangements across windows.
 *
 * A dock tree is a recursive discriminated union. Every node has a stable
 * `DockNodeId`. Pure operations (insert, remove, move, split, merge,
 * normalize) transform the tree without side effects.
 *
 * This module defines TYPES ONLY. Operations are in `dockOps.ts`.
 */

import type { PanelTypeId } from './panelRegistry';

// ---------------------------------------------------------------------------
// Stable identity
// ---------------------------------------------------------------------------

/** Collision-resistant stable node id (ADR-0207). */
export type DockNodeId = string;

/** Stable panel instance id — distinct from panel type id. */
export type PanelInstanceNodeId = string;

// ---------------------------------------------------------------------------
// Dock node kinds
// ---------------------------------------------------------------------------

export type DockDirection = 'horizontal' | 'vertical';

export interface DockSplitNode {
  kind: 'split';
  id: DockNodeId;
  direction: DockDirection;
  /** Ratio of first child's size (0..1). Default 0.5. */
  ratio: number;
  first: DockNode;
  second: DockNode;
}

export interface DockTabGroupNode {
  kind: 'tab-group';
  id: DockNodeId;
  /** Ordered panel instance ids. */
  tabs: PanelInstanceNodeId[];
  /** Index of the active tab. */
  activeTabIndex: number;
}

export interface DockPanelNode {
  kind: 'panel';
  id: DockNodeId;
  panelInstanceId: PanelInstanceNodeId;
}

export interface DockEmptyNode {
  kind: 'empty';
  id: DockNodeId;
  /** Hint text shown in the empty region. */
  hint?: string;
}

export type DockNode = DockSplitNode | DockTabGroupNode | DockPanelNode | DockEmptyNode;

// ---------------------------------------------------------------------------
// Panel instance (hosted in a dock node)
// ---------------------------------------------------------------------------

export interface PanelInstance {
  id: PanelInstanceNodeId;
  panelTypeId: PanelTypeId;
  /** The dock node hosting this instance. */
  hostNodeId: DockNodeId;
  /** Optional pinned document id (deferred, ADR-0205). */
  pinnedDocumentId?: string;
  /** Optional title override. */
  titleOverride?: string;
}

// ---------------------------------------------------------------------------
// Window layout
// ---------------------------------------------------------------------------

export type WindowRole = 'primary' | 'auxiliary-panel' | 'document-view';

export interface WorkspaceWindowLayout {
  id: string;
  role: WindowRole;
  /** Root dock node for this window. */
  dockRoot: DockNode;
  /** Window placement (machine-local, ADR-0210). */
  placement?: WindowPlacementRef;
  state: 'normal' | 'maximized' | 'fullscreen' | 'minimized';
}

/** Reference to a display for placement (ADR-0033). */
export interface WindowPlacementRef {
  displayId?: string;
  logicalPosition: { x: number; y: number };
  logicalSize: { width: number; height: number };
  state: 'normal' | 'maximized' | 'fullscreen' | 'minimized';
}

// ---------------------------------------------------------------------------
// Full workspace layout
// ---------------------------------------------------------------------------

export const WORKSPACE_LAYOUT_VERSION = 1;

export interface NativeWorkspaceLayout {
  schemaVersion: number;
  id: string;
  name: string;
  /** Optional workspace mode association. */
  workspaceMode?: string;
  /** Windows in this layout. */
  windows: WorkspaceWindowLayout[];
  /** Panel instances across all windows. */
  panelInstances: PanelInstance[];
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function createEmptyDockNode(hint?: string): DockEmptyNode {
  return { kind: 'empty', id: generateDockNodeId(), hint };
}

export function createPanelDockNode(panelInstanceId: PanelInstanceNodeId): DockPanelNode {
  return { kind: 'panel', id: generateDockNodeId(), panelInstanceId };
}

export function createTabGroupDockNode(
  panelInstanceIds: PanelInstanceNodeId[],
  activeIndex = 0,
): DockTabGroupNode {
  return {
    kind: 'tab-group',
    id: generateDockNodeId(),
    tabs: panelInstanceIds,
    activeTabIndex: Math.min(activeIndex, Math.max(0, panelInstanceIds.length - 1)),
  };
}

export function createSplitDockNode(
  direction: DockDirection,
  first: DockNode,
  second: DockNode,
  ratio = 0.5,
): DockSplitNode {
  return {
    kind: 'split',
    id: generateDockNodeId(),
    direction,
    ratio: clampRatio(ratio),
    first,
    second,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;

/** Generate a collision-resistant dock node id. */
export function generateDockNodeId(): DockNodeId {
  idCounter += 1;
  return `dn-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Reset the id counter (tests only). */
export function resetDockNodeIdCounter(): void {
  idCounter = 0;
}

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(0.9, Math.max(0.1, ratio));
}
