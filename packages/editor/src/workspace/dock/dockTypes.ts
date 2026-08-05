/**
 * Dock layout model (ADR-0021).
 *
 * A normalized tree of split/tabs/panel/empty nodes per application window,
 * plus the window set of a workspace layout. Pure data — no React, no
 * platform APIs. All mutations go through the pure operations in dockOps.ts
 * so the model stays testable without a DOM.
 *
 * Identity rules (ADR-0020): every node and instance carries a stable
 * uuid; titles and array indexes are never used as identity.
 */

import type { PanelTypeId } from '../panelRegistry';

export type DockNodeId = string;
export type PanelInstanceId = string;
export type WorkspaceWindowId = string;
export type WorkspaceWindowRole = 'primary' | 'auxiliary-panel';

/** Dock's reference to a concrete panel instance hosted in a window. */
export interface PanelInstanceRef {
  instanceId: PanelInstanceId;
  panelTypeId: PanelTypeId;
  /** Set only when a panel is pinned to a document (deferred, ADR-0027). */
  documentId?: string;
  titleOverride?: string;
}

export type DockSplitDirection = 'row' | 'column';

export type DockNode =
  | {
      kind: 'split';
      id: DockNodeId;
      direction: DockSplitDirection;
      /** First pane share, in (0, 1); second pane takes 1 - ratio. */
      ratio: number;
      first: DockNode;
      second: DockNode;
    }
  | {
      kind: 'tabs';
      id: DockNodeId;
      activePanelInstanceId?: PanelInstanceId;
      panels: PanelInstanceRef[];
    }
  | {
      kind: 'panel';
      id: DockNodeId;
      panelInstanceId: PanelInstanceId;
      /** Self-describing: required so serialized trees are validatable. */
      panelTypeId: PanelTypeId;
    }
  | { kind: 'empty'; id: DockNodeId };

export interface WorkspaceWindowLayout {
  id: WorkspaceWindowId;
  role: WorkspaceWindowRole;
  dockRoot: DockNode;
}

/** A complete (portable) workspace layout: the window set. */
export interface DockLayout {
  schemaVersion: number;
  windows: WorkspaceWindowLayout[];
}

export const DOCK_LAYOUT_SCHEMA_VERSION = 1;

export function createPanelInstanceRef(panelTypeId: PanelTypeId): PanelInstanceRef {
  return { instanceId: newId(), panelTypeId };
}

export function newId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Deterministic fallback for environments without crypto (tests, old
  // WebKitGTK baselines). Collision-resistant enough for session identity.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
