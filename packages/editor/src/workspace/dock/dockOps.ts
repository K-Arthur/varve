/**
 * Pure dock-tree operations (ADR-0021).
 *
 * Every mutation returns a new tree/layout — no in-place editing. The
 * operations are deterministic and validated by property tests:
 * - every panel instance appears in at most one host
 * - singleton policies are respected (registry-backed)
 * - every referenced panel and node exists
 * - empty splits are normalized
 * - ratios remain finite and bounded in (0, 1)
 * - removing any panel cannot corrupt the tree
 * - serialize/restore preserves semantics
 * - random operation sequences never produce unreachable panels
 */

import { type PanelSize, tryGetPanelDefinition } from '../panelRegistry';
import {
  createCanvasNode,
  createPanelInstanceRef,
  DOCK_LAYOUT_SCHEMA_VERSION,
  type DockFloatingGroup,
  type DockLayout,
  type DockNode,
  type DockSplitDirection,
  newId,
  type PanelInstanceRef,
  type PanelTypeId,
  type WorkspaceWindowId,
  type WorkspaceWindowLayout,
  type WorkspaceWindowRole,
} from './dockTypes';

export const MIN_SPLIT_RATIO = 0.05;
export const MAX_SPLIT_RATIO = 0.95;
/** Imported layouts stay small enough to validate and render predictably. */
export const MAX_DOCK_DEPTH = 16;
export const MAX_DOCK_NODES = 64;
export const MAX_DOCK_PANELS = 32;
export const MAX_DOCK_WINDOWS = 8;
export const MAX_DOCK_FLOAT_GROUPS = 16;
export const DOCK_TAB_STRIP_MIN_HEIGHT = 32;

export const DEFAULT_DOCK_FLOAT_BOUNDS = { x: 0.18, y: 0.1, width: 0.38, height: 0.72 } as const;

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

export function createEmptyNode(id: string): DockNode {
  return { kind: 'empty', id };
}

export function createWindow(
  role: WorkspaceWindowRole,
  id: WorkspaceWindowId,
): WorkspaceWindowLayout {
  return { id, role, dockRoot: createEmptyNode(`root-${id}`), floatingGroups: [] };
}

/** Default single-window layout: one protected central canvas anchor. */
export function createDefaultDockLayout(): DockLayout {
  return {
    schemaVersion: DOCK_LAYOUT_SCHEMA_VERSION,
    windows: [{ id: 'main', role: 'primary', dockRoot: createCanvasNode(), floatingGroups: [] }],
  };
}

/**
 * Upgrade the panel-only and canvas-anchor schemas while retaining panel
 * ownership. The conversion is idempotent and rejects malformed layouts
 * instead of guessing at lost panel ownership.
 */
export function migrateDockLayoutToCanvas(layout: DockLayout): DockLayout {
  if (layout.schemaVersion === DOCK_LAYOUT_SCHEMA_VERSION) {
    const violations = validateDockLayout(layout);
    if (violations.length > 0) throw new Error(`Invalid dock layout: ${violations[0]}`);
    return layout;
  }
  if (layout.schemaVersion !== 1 && layout.schemaVersion !== 2) {
    throw new Error('Unsupported dock layout version');
  }
  if (validateDockLayout(layout).length > 0) throw new Error('Invalid legacy dock layout');

  let primaryCount = 0;
  const windows = layout.windows.map((window) => {
    if (window.role !== 'primary') {
      return { ...window, floatingGroups: [] };
    }
    primaryCount += 1;
    const canvases = findCanvasNodes(window.dockRoot);
    if (canvases.length > 1) throw new Error('Legacy layout contains multiple canvas anchors');
    if (canvases.length === 1) return { ...window, floatingGroups: [] };
    const root =
      window.dockRoot.kind === 'empty'
        ? createCanvasNode(newId())
        : {
            kind: 'split' as const,
            id: newId(),
            direction: 'row' as const,
            ratio: 0.25,
            first: window.dockRoot,
            second: createCanvasNode(newId()),
          };
    return { ...window, dockRoot: root, floatingGroups: [] };
  });
  if (primaryCount !== 1) throw new Error('Legacy layout must have one primary window');

  const migrated = { ...layout, schemaVersion: DOCK_LAYOUT_SCHEMA_VERSION, windows };
  const violations = validateDockLayout(migrated);
  if (violations.length > 0) throw new Error(`Migrated dock layout is invalid: ${violations[0]}`);
  return migrated;
}

function findCanvasNodes(root: DockNode): DockNode[] {
  const canvases: DockNode[] = [];
  const seen = new WeakSet<object>();
  const pending: unknown[] = [root];
  let visited = 0;
  while (pending.length > 0 && visited < MAX_DOCK_NODES) {
    const node = pending.pop();
    if (typeof node !== 'object' || node === null || seen.has(node)) continue;
    seen.add(node);
    visited += 1;
    const dockNode = node as DockNode;
    if (dockNode.kind === 'canvas') canvases.push(dockNode);
    else if (dockNode.kind === 'split') pending.push(dockNode.first, dockNode.second);
  }
  return canvases;
}

/** Collect panel references without recursion or revisiting malformed cycles. */
function collectPanelInstances(root: DockNode): PanelInstanceRef[] {
  const panels: PanelInstanceRef[] = [];
  const seen = new WeakSet<object>();
  const pending: unknown[] = [root];
  let visited = 0;
  while (pending.length > 0 && visited < MAX_DOCK_NODES) {
    const node = pending.pop();
    if (typeof node !== 'object' || node === null || seen.has(node)) continue;
    seen.add(node);
    visited += 1;
    const dockNode = node as DockNode;
    if (dockNode.kind === 'panel') {
      panels.push({
        instanceId: dockNode.panelInstanceId,
        panelTypeId: dockNode.panelTypeId,
      });
    } else if (dockNode.kind === 'tabs' && Array.isArray(dockNode.panels)) {
      panels.push(...dockNode.panels);
    } else if (dockNode.kind === 'split') {
      pending.push(dockNode.first, dockNode.second);
    }
  }
  return panels;
}

function collectDockNodeIds(root: DockNode): string[] {
  const ids: string[] = [];
  const seen = new WeakSet<object>();
  const pending: unknown[] = [root];
  while (pending.length > 0 && ids.length < MAX_DOCK_NODES) {
    const value = pending.pop();
    if (typeof value !== 'object' || value === null || seen.has(value)) continue;
    seen.add(value);
    const node = value as DockNode;
    ids.push(node.id);
    if (node.kind === 'split') pending.push(node.first, node.second);
  }
  return ids;
}

function insertPanelBesideCanvas(root: DockNode, panel: PanelInstanceRef): DockNode | null {
  const canvas = findCanvasNodes(root)[0];
  if (!canvas) return null;
  const split = splitHost(root, canvas.id, panel, 'row', 0.72, newId());
  if (split.kind !== 'split') return null;
  // Keep the canvas as the larger pane while placing new panels to its left.
  return {
    ...split,
    ratio: 1 - split.ratio,
    first: split.second,
    second: split.first,
  };
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function findDockNode(root: DockNode, nodeId: string): DockNode | undefined {
  if (root.id === nodeId) return root;
  if (root.kind === 'split') {
    return findDockNode(root.first, nodeId) ?? findDockNode(root.second, nodeId);
  }
  return undefined;
}

/** Find a panel instance anywhere in a tree. Returns its node and host id. */
export function findPanelInstance(
  root: DockNode,
  instanceId: string,
): { node: DockNode; hostNodeId: string } | undefined {
  if (root.kind === 'panel' && root.panelInstanceId === instanceId) {
    return { node: root, hostNodeId: root.id };
  }
  if (root.kind === 'tabs') {
    if (root.panels.some((p) => p.instanceId === instanceId)) {
      return { node: root, hostNodeId: root.id };
    }
  }
  if (root.kind === 'split') {
    return findPanelInstance(root.first, instanceId) ?? findPanelInstance(root.second, instanceId);
  }
  return undefined;
}

export function listPanelInstances(root: DockNode): PanelInstanceRef[] {
  if (root.kind === 'panel') {
    return [
      {
        instanceId: root.panelInstanceId,
        panelTypeId: root.panelTypeId,
      },
    ];
  }
  if (root.kind === 'tabs') return [...root.panels];
  if (root.kind === 'split') {
    return [...listPanelInstances(root.first), ...listPanelInstances(root.second)];
  }
  return [];
}

/** Find a registered panel in either a dock tree or an in-window float. */
export function findPanelInLayout(
  layout: DockLayout,
  instanceId: string,
):
  | { window: WorkspaceWindowLayout; panel: PanelInstanceRef; floatingGroupId?: string }
  | undefined {
  for (const window of layout.windows) {
    const docked = listPanelInstances(window.dockRoot).find(
      (panel) => panel.instanceId === instanceId,
    );
    if (docked) return { window, panel: docked };
    for (const group of window.floatingGroups ?? []) {
      const panel = group.panels.find((candidate) => candidate.instanceId === instanceId);
      if (panel) return { window, panel, floatingGroupId: group.id };
    }
  }
  return undefined;
}

function removePanelFromWindow(
  window: WorkspaceWindowLayout,
  instanceId: string,
): { window: WorkspaceWindowLayout; removed?: PanelInstanceRef } {
  const removedFromTree = removePanel(window.dockRoot, instanceId);
  if (removedFromTree.removed) {
    return {
      window: { ...window, dockRoot: normalizeDockTree(removedFromTree.tree) },
      removed: removedFromTree.removed,
    };
  }
  let removed: PanelInstanceRef | undefined;
  const floatingGroups = (window.floatingGroups ?? []).flatMap((group) => {
    const panel = group.panels.find((candidate) => candidate.instanceId === instanceId);
    if (!panel) return [group];
    removed = panel;
    const panels = group.panels.filter((candidate) => candidate.instanceId !== instanceId);
    if (panels.length === 0) return [];
    return [
      {
        ...group,
        panels,
        activePanelInstanceId:
          group.activePanelInstanceId === instanceId
            ? panels[0]?.instanceId
            : group.activePanelInstanceId,
      },
    ];
  });
  return removed ? { window: { ...window, floatingGroups }, removed } : { window };
}

/** Minimum dimensions required by the registered panels below a node. */
export function getDockNodeMinimumSize(root: DockNode): PanelSize {
  switch (root.kind) {
    case 'canvas':
      // The editor's canvas remains a fixed central surface at every dock size.
      return { width: 320, height: 240 };
    case 'empty':
      return { width: 0, height: 0 };
    case 'panel': {
      const size = tryGetPanelDefinition(root.panelTypeId)?.minimumSize;
      return size ? { ...size } : { width: 0, height: 0 };
    }
    case 'tabs': {
      const minimum = root.panels.reduce<PanelSize>(
        (minimum, panel) => {
          const size = tryGetPanelDefinition(panel.panelTypeId)?.minimumSize;
          if (!size) return minimum;
          return {
            width: Math.max(minimum.width, size.width),
            height: Math.max(minimum.height, size.height),
          };
        },
        { width: 0, height: 0 },
      );
      return {
        width: minimum.width,
        height: minimum.height + (root.panels.length > 1 ? DOCK_TAB_STRIP_MIN_HEIGHT : 0),
      };
    }
    case 'split': {
      const first = getDockNodeMinimumSize(root.first);
      const second = getDockNodeMinimumSize(root.second);
      return root.direction === 'row'
        ? { width: first.width + second.width, height: Math.max(first.height, second.height) }
        : { width: Math.max(first.width, second.width), height: first.height + second.height };
    }
  }
}

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

/**
 * Insert a panel next to a target node, creating a split. `direction` is
 * the orientation of the new split; `ratio` is the share of the target
 * pane. The target node must exist.
 */
export function insertBeside(
  root: DockNode,
  targetNodeId: string,
  panel: PanelInstanceRef,
  direction: DockSplitDirection,
  ratio: number,
  splitId: string,
): DockNode {
  const target = findDockNode(root, targetNodeId);
  if (!target) return root;
  const newPanel: DockNode = {
    kind: 'panel',
    id: `panel-${panel.instanceId}`,
    panelInstanceId: panel.instanceId,
    panelTypeId: panel.panelTypeId,
  };
  const split: DockNode = {
    kind: 'split',
    id: splitId,
    direction,
    ratio: clampRatio(ratio),
    first: target,
    second: newPanel,
  };
  return replaceNode(root, targetNodeId, split);
}

function replaceNode(root: DockNode, nodeId: string, replacement: DockNode): DockNode {
  if (root.id === nodeId) return replacement;
  if (root.kind === 'split') {
    if (root.first.id === nodeId || containsNodeId(root.first, nodeId)) {
      return { ...root, first: replaceNode(root.first, nodeId, replacement) };
    }
    if (root.second.id === nodeId || containsNodeId(root.second, nodeId)) {
      return { ...root, second: replaceNode(root.second, nodeId, replacement) };
    }
  }
  return root;
}

function containsNodeId(root: DockNode, nodeId: string): boolean {
  if (root.id === nodeId) return true;
  if (root.kind === 'split') {
    return containsNodeId(root.first, nodeId) || containsNodeId(root.second, nodeId);
  }
  return false;
}

/**
 * Add a panel to a tab group (creating one when the target is a single
 * panel node). `makeActive` optionally activates it.
 */
export function addToTabGroup(
  root: DockNode,
  targetNodeId: string,
  panel: PanelInstanceRef,
  makeActive = true,
): DockNode {
  const target = findDockNode(root, targetNodeId);
  if (!target) return root;

  if (target.kind === 'tabs') {
    const panels = [...target.panels, panel];
    return replaceNode(root, targetNodeId, {
      ...target,
      panels,
      activePanelInstanceId: makeActive ? panel.instanceId : target.activePanelInstanceId,
    });
  }
  if (target.kind === 'panel') {
    const existing = listPanelInstances(target)[0];
    const tabs: DockNode = {
      kind: 'tabs',
      // A fresh id, not `tabs-${targetNodeId}`. Composing the host's id made
      // ids non-injective: a host panel node is `panel-${instanceId}`, so this
      // produced `tabs-panel-${instanceId}` — exactly the id a *previous* tabs
      // group over the same instance had already left behind in a collapsed
      // node, because a tabs group that drops to one panel keeps its own id.
      // Re-minting it put that id in the layout twice, which `validateDockLayout`
      // rejects ("duplicate dock node id"), and the dock property test found it
      // on a two-move sequence. Adding to an existing tabs group is unchanged
      // and still keeps that group's id.
      id: `tabs-${newId()}`,
      panels: existing ? [existing, panel] : [panel],
      activePanelInstanceId: makeActive ? panel.instanceId : undefined,
    };
    return replaceNode(root, targetNodeId, tabs);
  }
  return root;
}

/** Split an existing host (panel or tab group) and put `panel` in the new slot. */
export function splitHost(
  root: DockNode,
  hostNodeId: string,
  panel: PanelInstanceRef,
  direction: DockSplitDirection,
  ratio: number,
  splitId: string,
): DockNode {
  const host = findDockNode(root, hostNodeId);
  if (!host) return root;
  if (host.kind === 'empty') return root;
  const newPanel: DockNode = {
    kind: 'panel',
    id: `panel-${panel.instanceId}`,
    panelInstanceId: panel.instanceId,
    panelTypeId: panel.panelTypeId,
  };
  const split: DockNode = {
    kind: 'split',
    id: splitId,
    direction,
    ratio: clampRatio(ratio),
    first: host,
    second: newPanel,
  };
  return replaceNode(root, hostNodeId, split);
}

/** Update one split's preferred ratio without changing any other node. */
export function setSplitRatio(root: DockNode, splitNodeId: string, ratio: number): DockNode {
  const target = findDockNode(root, splitNodeId);
  if (target?.kind !== 'split' || !Number.isFinite(ratio)) return root;
  const nextRatio = clampRatio(ratio);
  if (target.ratio === nextRatio) return root;
  return replaceNode(root, splitNodeId, { ...target, ratio: nextRatio });
}

/** Reorder a panel in a tab group without changing which panel is active. */
export function reorderTab(
  root: DockNode,
  tabNodeId: string,
  instanceId: string,
  direction: 'before' | 'after',
): DockNode {
  const group = findDockNode(root, tabNodeId);
  if (group?.kind !== 'tabs') return root;
  const from = group.panels.findIndex((panel) => panel.instanceId === instanceId);
  if (from < 0) return root;
  const to = from + (direction === 'before' ? -1 : 1);
  if (to < 0 || to >= group.panels.length) return root;

  const panels = [...group.panels];
  [panels[from], panels[to]] = [panels[to]!, panels[from]!];
  return replaceNode(root, tabNodeId, { ...group, panels });
}

/** Select an instance in a tab group without changing any other dock intent. */
export function activateDockTab(root: DockNode, tabNodeId: string, instanceId: string): DockNode {
  const group = findDockNode(root, tabNodeId);
  if (group?.kind !== 'tabs' || !group.panels.some((panel) => panel.instanceId === instanceId)) {
    return root;
  }
  if (group.activePanelInstanceId === instanceId) return root;
  return replaceNode(root, tabNodeId, { ...group, activePanelInstanceId: instanceId });
}

export type DockPanelPlacement =
  | { kind: 'tab'; targetNodeId: string }
  | {
      kind: 'split';
      targetNodeId: string;
      direction: DockSplitDirection;
      side: 'before' | 'after';
      /** Share retained by the existing target host, clamped to (0, 1). */
      targetRatio: number;
    };

export type DockPanelMoveResult =
  | { ok: true; layout: DockLayout }
  | {
      ok: false;
      layout: DockLayout;
      reason:
        | 'missing-panel'
        | 'missing-window'
        | 'host-not-allowed'
        | 'target-missing'
        | 'invalid-layout';
    };

export type DockFloatResult =
  | { ok: true; layout: DockLayout }
  | {
      ok: false;
      layout: DockLayout;
      reason:
        | 'invalid-layout'
        | 'missing-panel'
        | 'missing-window'
        | 'missing-group'
        | 'already-floating'
        | 'host-not-allowed'
        | 'limit-exceeded';
    };

function validNormalizedFloatBounds(bounds: DockFloatingGroup['normalizedBounds']): boolean {
  return (
    typeof bounds === 'object' &&
    bounds !== null &&
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.x + bounds.width <= 1 &&
    bounds.y + bounds.height <= 1
  );
}

/** Move a docked panel into a new in-window floating group. */
export function floatPanel(
  layout: DockLayout,
  instanceId: string,
  normalizedBounds: DockFloatingGroup['normalizedBounds'] = DEFAULT_DOCK_FLOAT_BOUNDS,
): DockFloatResult {
  if (validateDockLayout(layout).length > 0) return { ok: false, layout, reason: 'invalid-layout' };
  if (!validNormalizedFloatBounds(normalizedBounds)) {
    return { ok: false, layout, reason: 'invalid-layout' };
  }
  const found = findPanelInLayout(layout, instanceId);
  if (!found) return { ok: false, layout, reason: 'missing-panel' };
  if (found.floatingGroupId) return { ok: false, layout, reason: 'already-floating' };
  if (found.window.role !== 'primary') return { ok: false, layout, reason: 'host-not-allowed' };
  const definition = tryGetPanelDefinition(found.panel.panelTypeId);
  if (definition && !definition.allowedHosts.includes('primary-sidebar')) {
    return { ok: false, layout, reason: 'host-not-allowed' };
  }
  const primaryGroups = found.window.floatingGroups ?? [];
  if (primaryGroups.length >= MAX_DOCK_FLOAT_GROUPS) {
    return { ok: false, layout, reason: 'limit-exceeded' };
  }
  const removed = removePanelFromWindow(found.window, instanceId);
  if (!removed.removed) return { ok: false, layout, reason: 'missing-panel' };
  const group: DockFloatingGroup = {
    id: newId(),
    panels: [removed.removed],
    activePanelInstanceId: instanceId,
    normalizedBounds: { ...normalizedBounds },
  };
  const windows = layout.windows.map((window) =>
    window.id === found.window.id
      ? { ...removed.window, floatingGroups: [...(removed.window.floatingGroups ?? []), group] }
      : window,
  );
  const next = { ...layout, windows };
  return validateDockLayout(next).length === 0
    ? { ok: true, layout: next }
    : { ok: false, layout, reason: 'invalid-layout' };
}

/** Add a panel to an existing floating group's tab order. */
export function groupPanelInFloat(
  layout: DockLayout,
  instanceId: string,
  targetGroupId: string,
): DockFloatResult {
  if (validateDockLayout(layout).length > 0) return { ok: false, layout, reason: 'invalid-layout' };
  const source = findPanelInLayout(layout, instanceId);
  if (!source) return { ok: false, layout, reason: 'missing-panel' };
  if (source.window.role !== 'primary') return { ok: false, layout, reason: 'host-not-allowed' };
  const targetGroup = source.window.floatingGroups?.find((group) => group.id === targetGroupId);
  if (!targetGroup) return { ok: false, layout, reason: 'missing-group' };
  if (source.floatingGroupId === targetGroupId) return { ok: true, layout };
  const definition = tryGetPanelDefinition(source.panel.panelTypeId);
  if (definition && !definition.allowedHosts.includes('primary-sidebar')) {
    return { ok: false, layout, reason: 'host-not-allowed' };
  }
  const removed = removePanelFromWindow(source.window, instanceId);
  if (!removed.removed) return { ok: false, layout, reason: 'missing-panel' };
  const floatingGroups = (removed.window.floatingGroups ?? []).map((group) =>
    group.id === targetGroupId
      ? {
          ...group,
          panels: [...group.panels, removed.removed!],
          activePanelInstanceId: instanceId,
        }
      : group,
  );
  const next = {
    ...layout,
    windows: layout.windows.map((window) =>
      window.id === source.window.id ? { ...removed.window, floatingGroups } : window,
    ),
  };
  return validateDockLayout(next).length === 0
    ? { ok: true, layout: next }
    : { ok: false, layout, reason: 'invalid-layout' };
}

/** Commit normalized placement intent after a drag or resize gesture. */
export function setFloatingGroupBounds(
  layout: DockLayout,
  groupId: string,
  normalizedBounds: DockFloatingGroup['normalizedBounds'],
): DockFloatResult {
  if (!validNormalizedFloatBounds(normalizedBounds)) {
    return { ok: false, layout, reason: 'invalid-layout' };
  }
  let found = false;
  const windows = layout.windows.map((window) => ({
    ...window,
    floatingGroups: (window.floatingGroups ?? []).map((group) => {
      if (group.id !== groupId) return group;
      found = true;
      return { ...group, normalizedBounds: { ...normalizedBounds } };
    }),
  }));
  if (!found) return { ok: false, layout, reason: 'missing-group' };
  const next = { ...layout, windows };
  return validateDockLayout(next).length === 0
    ? { ok: true, layout: next }
    : { ok: false, layout, reason: 'invalid-layout' };
}

/** Redock a float as one panel or one ordered tab group. */
export function redockFloatingGroup(
  layout: DockLayout,
  groupId: string,
  targetNodeId?: string,
): DockFloatResult {
  if (validateDockLayout(layout).length > 0) return { ok: false, layout, reason: 'invalid-layout' };
  const windowIndex = layout.windows.findIndex((window) =>
    window.floatingGroups?.some((group) => group.id === groupId),
  );
  if (windowIndex < 0) return { ok: false, layout, reason: 'missing-group' };
  const window = layout.windows[windowIndex]!;
  if (window.role !== 'primary') return { ok: false, layout, reason: 'host-not-allowed' };
  const group = window.floatingGroups?.find((candidate) => candidate.id === groupId);
  if (!group || group.panels.length === 0) return { ok: false, layout, reason: 'missing-group' };
  const anchorId = targetNodeId ?? findCanvasNodes(window.dockRoot)[0]?.id;
  const anchor = anchorId ? findDockNode(window.dockRoot, anchorId) : undefined;
  if (!anchor || anchor.kind === 'empty') return { ok: false, layout, reason: 'missing-group' };
  const dockNode: DockNode =
    group.panels.length === 1
      ? {
          kind: 'panel',
          id: newId(),
          panelInstanceId: group.panels[0]!.instanceId,
          panelTypeId: group.panels[0]!.panelTypeId,
        }
      : {
          kind: 'tabs',
          id: group.id,
          panels: [...group.panels],
          activePanelInstanceId: group.activePanelInstanceId ?? group.panels[0]!.instanceId,
        };
  const splitId = newId();
  const root = replaceNode(window.dockRoot, anchor.id, {
    kind: 'split',
    id: splitId,
    direction: 'row',
    ratio: anchor.kind === 'canvas' ? 0.28 : 0.72,
    first: anchor.kind === 'canvas' ? dockNode : anchor,
    second: anchor.kind === 'canvas' ? anchor : dockNode,
  });
  const windows = layout.windows.map((candidate, index) =>
    index === windowIndex
      ? {
          ...candidate,
          dockRoot: root,
          floatingGroups: (candidate.floatingGroups ?? []).filter((item) => item.id !== groupId),
        }
      : candidate,
  );
  const next = { ...layout, windows };
  return validateDockLayout(next).length === 0
    ? { ok: true, layout: next }
    : { ok: false, layout, reason: 'invalid-layout' };
}

/**
 * Move one registered panel instance to a tab group or split host. The source
 * instance is removed before insertion so it can never be duplicated, and
 * the final layout is validated against registry host and singleton rules.
 */
export function movePanelToHost(
  layout: DockLayout,
  instanceId: string,
  targetWindowId: WorkspaceWindowId,
  placement: DockPanelPlacement,
): DockPanelMoveResult {
  if (validateDockLayout(layout).length > 0) {
    return { ok: false, layout, reason: 'invalid-layout' };
  }

  const sourceLocation = findPanelInLayout(layout, instanceId);
  const sourceWindow = sourceLocation?.window;
  if (!sourceWindow || !sourceLocation) return { ok: false, layout, reason: 'missing-panel' };
  const targetWindow = layout.windows.find((window) => window.id === targetWindowId);
  if (!targetWindow) return { ok: false, layout, reason: 'missing-window' };

  const panel = sourceLocation.panel;
  const targetHost = targetWindow.role === 'primary' ? 'primary-sidebar' : 'auxiliary-window';
  const definition = tryGetPanelDefinition(panel.panelTypeId);
  if (definition && !definition.allowedHosts.includes(targetHost)) {
    return { ok: false, layout, reason: 'host-not-allowed' };
  }

  const removed = removePanelFromWindow(sourceWindow, instanceId);
  if (!removed.removed) return { ok: false, layout, reason: 'missing-panel' };
  const targetRoot =
    sourceWindow.id === targetWindow.id ? removed.window.dockRoot : targetWindow.dockRoot;
  const target = findDockNode(targetRoot, placement.targetNodeId);
  if (!target) return { ok: false, layout, reason: 'target-missing' };

  let nextRoot: DockNode;
  if (target.kind === 'empty') {
    nextRoot = {
      kind: 'panel',
      id: `panel-${removed.removed.instanceId}`,
      panelInstanceId: removed.removed.instanceId,
      panelTypeId: removed.removed.panelTypeId,
    };
  } else if (placement.kind === 'tab') {
    if (target.kind !== 'tabs' && target.kind !== 'panel') {
      return { ok: false, layout, reason: 'target-missing' };
    }
    nextRoot = addToTabGroup(targetRoot, target.id, removed.removed);
  } else {
    const split = splitHost(
      targetRoot,
      target.id,
      removed.removed,
      placement.direction,
      placement.targetRatio,
      newId(),
    );
    if (placement.side === 'before' && split.kind === 'split') {
      nextRoot = {
        ...split,
        ratio: clampRatio(1 - split.ratio),
        first: split.second,
        second: split.first,
      };
    } else {
      nextRoot = split;
    }
  }
  if (!listPanelInstances(nextRoot).some((candidate) => candidate.instanceId === instanceId)) {
    return { ok: false, layout, reason: 'target-missing' };
  }

  const windows = layout.windows.map((window) => {
    if (window.id === sourceWindow.id && window.id === targetWindow.id) {
      return { ...removed.window, dockRoot: normalizeDockTree(nextRoot) };
    }
    if (window.id === sourceWindow.id) {
      return removed.window;
    }
    if (window.id === targetWindow.id) {
      return { ...window, dockRoot: normalizeDockTree(nextRoot) };
    }
    return window;
  });
  const nextLayout = { ...layout, windows };
  if (validateDockLayout(nextLayout).length > 0) {
    return { ok: false, layout, reason: 'invalid-layout' };
  }
  return { ok: true, layout: nextLayout };
}

/** Remove a panel instance from the tree. Returns the new tree and the ref. */
export function removePanel(
  root: DockNode,
  instanceId: string,
): { tree: DockNode; removed?: PanelInstanceRef } {
  if (root.kind === 'panel' && root.panelInstanceId === instanceId) {
    return {
      // A fresh id, deliberately not `root.id`. Panel node ids are derived from
      // the instance id (`panel-${instanceId}`), which is only unique while the
      // instance sits in exactly one place: a placeholder that inherited the id
      // collided the moment the same instance was placed again — a move between
      // windows, or an insert into the emptied slot — and the layout then held
      // that id twice, which `validateDockLayout` rejects with "duplicate dock
      // node id". The dock property test reproduced it after `move`. Split and
      // tabs node ids come from `newId()` or from a host id that is consumed on
      // use, so the panel leaf was the only re-mintable one.
      tree: createEmptyNode(`empty-${newId()}`),
      removed: { instanceId: root.panelInstanceId, panelTypeId: root.panelTypeId },
    };
  }
  if (root.kind === 'tabs') {
    const index = root.panels.findIndex((p) => p.instanceId === instanceId);
    if (index === -1) return { tree: root };
    const removed = root.panels[index];
    const panels = root.panels.filter((p) => p.instanceId !== instanceId);
    if (panels.length === 0) {
      return { tree: createEmptyNode(root.id), removed };
    }
    let next: DockNode;
    if (panels.length === 1 && root.panels.length > 1) {
      const single = panels[0];
      if (!single) {
        return { tree: createEmptyNode(root.id), removed };
      }
      next = {
        kind: 'panel',
        id: root.id,
        panelInstanceId: single.instanceId,
        panelTypeId: single.panelTypeId,
      };
    } else {
      next = {
        ...root,
        panels,
        activePanelInstanceId:
          root.activePanelInstanceId === instanceId && panels.length > 0
            ? (panels[0]?.instanceId ?? undefined)
            : root.activePanelInstanceId,
      };
    }
    return { tree: next, removed };
  }
  if (root.kind === 'split') {
    const firstResult = removePanel(root.first, instanceId);
    if (firstResult.removed) {
      return {
        tree: mergeEmptySiblings(root, firstResult.tree, root.second),
        removed: firstResult.removed,
      };
    }
    const secondResult = removePanel(root.second, instanceId);
    if (secondResult.removed) {
      return {
        tree: mergeEmptySiblings(root, root.first, secondResult.tree),
        removed: secondResult.removed,
      };
    }
  }
  return { tree: root };
}

/** Rebuild a split whose sibling may have become empty. */
function mergeEmptySiblings(
  split: Extract<DockNode, { kind: 'split' }>,
  first: DockNode,
  second: DockNode,
): DockNode {
  if (first.kind !== 'empty' && second.kind !== 'empty') {
    return { ...split, first, second };
  }
  if (first.kind === 'empty' && second.kind === 'empty') {
    return createEmptyNode(split.id);
  }
  if (first.kind === 'empty') return second;
  return first;
}

/**
 * Normalize a tree: collapse single-panel tabs to panel nodes, replace
 * empty tabs with empty nodes, collapse splits with empty siblings, clamp
 * ratios. Returns a structurally valid tree.
 */
export function normalizeDockTree(root: DockNode): DockNode {
  if (root.kind === 'split') {
    const first = normalizeDockTree(root.first);
    const second = normalizeDockTree(root.second);
    if (first.kind === 'empty' && second.kind === 'empty') return createEmptyNode(root.id);
    if (first.kind === 'empty') return second;
    if (second.kind === 'empty') return first;
    return { ...root, first, second, ratio: clampRatio(root.ratio) };
  }
  if (root.kind === 'tabs') {
    const panels = root.panels;
    if (panels.length === 0) return createEmptyNode(root.id);
    if (panels.length > 1) return root;
    const single = panels[0];
    if (!single) return createEmptyNode(root.id);
    return {
      kind: 'panel',
      id: root.id,
      panelInstanceId: single.instanceId,
      panelTypeId: single.panelTypeId,
    };
  }
  return root;
}

/**
 * Validate a dock tree. Returns human-readable violations; empty = valid.
 * Does not normalize — callers decide whether to normalize or reject.
 */
export function validateDockTree(root: DockNode): string[] {
  const violations: string[] = [];
  const seenInstances = new Set<string>();
  const seenIds = new Set<string>();
  const seenNodes = new WeakSet<object>();
  const pending: Array<{ node: DockNode; depth: number }> = [{ node: root, depth: 1 }];
  let count = 0;

  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) continue;
    const { node, depth } = entry;
    count += 1;
    if (count > MAX_DOCK_NODES) {
      violations.push(`dock tree exceeds ${MAX_DOCK_NODES} nodes`);
      break;
    }
    if (depth > MAX_DOCK_DEPTH) {
      violations.push(`dock tree exceeds maximum depth ${MAX_DOCK_DEPTH}`);
      continue;
    }
    if (typeof node !== 'object' || node === null) {
      violations.push('invalid dock node');
      continue;
    }
    if (seenNodes.has(node)) {
      violations.push('dock node is referenced more than once or contains a cycle');
      continue;
    }
    seenNodes.add(node);
    if (!node.id) violations.push('node without id');
    else if (seenIds.has(node.id)) violations.push(`duplicate dock node id '${node.id}'`);
    else seenIds.add(node.id);
    switch (node.kind) {
      case 'split': {
        if (!Number.isFinite(node.ratio) || node.ratio <= 0 || node.ratio >= 1) {
          violations.push(`split '${node.id}' has invalid ratio ${node.ratio}`);
        }
        if (node.first.kind === 'empty' || node.second.kind === 'empty') {
          violations.push(`split '${node.id}' has an empty child (not normalized)`);
        }
        pending.push({ node: node.second, depth: depth + 1 });
        pending.push({ node: node.first, depth: depth + 1 });
        break;
      }
      case 'tabs': {
        if (node.panels.length === 0) {
          violations.push(`tabs '${node.id}' is empty (not normalized)`);
        }
        if (node.panels.length === 1) {
          violations.push(`tabs '${node.id}' holds a single panel (not normalized)`);
        }
        if (node.panels.length > MAX_DOCK_PANELS) {
          violations.push(`tabs '${node.id}' exceeds ${MAX_DOCK_PANELS} panels`);
        }
        for (const panel of node.panels) {
          checkPanelRef(panel);
        }
        if (
          node.activePanelInstanceId &&
          !node.panels.some((p) => p.instanceId === node.activePanelInstanceId)
        ) {
          violations.push(`tabs '${node.id}' active instance is not hosted`);
        }
        break;
      }
      case 'panel': {
        checkPanelRef({ instanceId: node.panelInstanceId, panelTypeId: node.panelTypeId });
        break;
      }
      case 'canvas':
        break;
      case 'empty':
        break;
      default:
        violations.push('unknown dock node kind');
    }
  }

  function checkPanelRef(panel: PanelInstanceRef): void {
    if (seenInstances.has(panel.instanceId)) {
      violations.push(`panel instance '${panel.instanceId}' appears more than once`);
    }
    seenInstances.add(panel.instanceId);
    if (!panel.instanceId) violations.push('panel instance without id');
    if (tryGetPanelDefinition(panel.panelTypeId)) {
      // Known type — fine.
    } else {
      violations.push(
        `panel instance '${panel.instanceId}' references unknown type '${panel.panelTypeId}'`,
      );
    }
  }

  return violations;
}

/**
 * Layout-level invariants across the whole window set (ADR-0021):
 * - a panel instance appears in at most one window
 * - singleton policy: a singleton panel type has at most one instance
 *   in the whole layout
 * - every window has a valid dock tree
 */
export function validateDockLayout(layout: DockLayout): string[] {
  const violations: string[] = [];
  if (typeof layout !== 'object' || layout === null || !Array.isArray(layout.windows)) {
    return ['dock layout windows must be an array'];
  }
  if (![1, 2, DOCK_LAYOUT_SCHEMA_VERSION].includes(layout.schemaVersion)) {
    violations.push(`unsupported schema version ${layout.schemaVersion}`);
  }
  const seenInstances = new Set<string>();
  const seenWindows = new Set<string>();
  const seenDockIds = new Set<string>();
  const panelRefsByInstance = new Map<string, PanelInstanceRef>();
  let totalPanels = 0;
  let primaryWindows = 0;
  if (layout.windows.length > MAX_DOCK_WINDOWS) {
    violations.push(`layout exceeds ${MAX_DOCK_WINDOWS} windows`);
  }
  for (const window of layout.windows) {
    if (!window || typeof window !== 'object' || !window.dockRoot) {
      violations.push('invalid dock window');
      continue;
    }
    if (seenWindows.has(window.id)) violations.push(`duplicate window id '${window.id}'`);
    seenWindows.add(window.id);
    const canvasCount = findCanvasNodes(window.dockRoot).length;
    if (window.role === 'primary') {
      primaryWindows += 1;
      if (layout.schemaVersion >= 2 && canvasCount !== 1) {
        violations.push(`primary window '${window.id}' must contain exactly one canvas anchor`);
      }
    } else if (layout.schemaVersion >= 2 && canvasCount !== 0) {
      violations.push(`auxiliary window '${window.id}' cannot contain a canvas anchor`);
    }
    const hostKind = window.role === 'primary' ? 'primary-sidebar' : 'auxiliary-window';
    const windowViolations = validateDockTree(window.dockRoot);
    violations.push(...windowViolations.map((v) => `window '${window.id}': ${v}`));
    for (const id of collectDockNodeIds(window.dockRoot)) {
      if (seenDockIds.has(id)) violations.push(`duplicate dock node id '${id}' in layout`);
      seenDockIds.add(id);
    }
    const floatingGroups = window.floatingGroups ?? [];
    if (!Array.isArray(floatingGroups)) {
      violations.push(`window '${window.id}' floating groups must be an array`);
      continue;
    }
    if (layout.schemaVersion < DOCK_LAYOUT_SCHEMA_VERSION && floatingGroups.length > 0) {
      violations.push('legacy dock layouts cannot contain floating groups');
    }
    if (floatingGroups.length > MAX_DOCK_FLOAT_GROUPS) {
      violations.push(`layout exceeds ${MAX_DOCK_FLOAT_GROUPS} floating groups`);
    }
    if (floatingGroups.length > 0 && window.role !== 'primary') {
      violations.push(`floating groups require the primary window ('${window.id}')`);
    }
    const panels = collectPanelInstances(window.dockRoot);
    for (const group of floatingGroups) {
      if (!group || typeof group !== 'object') {
        violations.push(`window '${window.id}' contains an invalid floating group`);
        continue;
      }
      if (typeof group.id !== 'string' || group.id.length === 0 || group.id.length > 128) {
        violations.push(`window '${window.id}' contains a floating group without a valid id`);
      } else if (seenDockIds.has(group.id)) {
        violations.push(`duplicate dock node id '${group.id}' in layout`);
      }
      if (typeof group.id === 'string') seenDockIds.add(group.id);
      if (!Array.isArray(group.panels) || group.panels.length === 0) {
        violations.push(`floating group '${group.id}' must contain at least one panel`);
        continue;
      }
      if (group.panels.length > MAX_DOCK_PANELS) {
        violations.push(`floating group '${group.id}' exceeds ${MAX_DOCK_PANELS} panels`);
      }
      if (!validNormalizedFloatBounds(group.normalizedBounds)) {
        violations.push(`floating group '${group.id}' has invalid normalized bounds`);
      }
      if (
        group.activePanelInstanceId &&
        !group.panels.some((panel) => panel?.instanceId === group.activePanelInstanceId)
      ) {
        violations.push(`floating group '${group.id}' active instance is not hosted`);
      }
      for (const panel of group.panels) {
        if (!panel || typeof panel !== 'object') {
          violations.push(`floating group '${group.id}' contains an invalid panel ref`);
          continue;
        }
        if (typeof panel.instanceId !== 'string' || panel.instanceId.length === 0) {
          violations.push(`floating group '${group.id}' contains a panel without an instance id`);
        }
        if (!tryGetPanelDefinition(panel.panelTypeId)) {
          violations.push(
            `floating group '${group.id}' references unknown panel type '${panel.panelTypeId}'`,
          );
        }
      }
      panels.push(
        ...group.panels.filter((panel): panel is PanelInstanceRef =>
          Boolean(panel && typeof panel === 'object'),
        ),
      );
    }
    for (const panel of panels) {
      if (seenInstances.has(panel.instanceId)) {
        violations.push(`panel instance '${panel.instanceId}' hosted in multiple windows`);
      }
      seenInstances.add(panel.instanceId);
      totalPanels += 1;
      panelRefsByInstance.set(panel.instanceId, panel);
      const definition = tryGetPanelDefinition(panel.panelTypeId);
      if (definition && !definition.allowedHosts.includes(hostKind)) {
        violations.push(
          `panel type '${panel.panelTypeId}' cannot be hosted in ${hostKind} window '${window.id}'`,
        );
      }
    }
  }
  if (layout.schemaVersion >= 2 && primaryWindows !== 1) {
    violations.push('layout must contain exactly one primary window');
  }
  if (totalPanels > MAX_DOCK_PANELS) {
    violations.push(`layout exceeds ${MAX_DOCK_PANELS} panels`);
  }
  const typeCounts = new Map<PanelTypeId, number>();
  for (const instanceId of seenInstances) {
    const def = panelRefsByInstance.get(instanceId);
    if (!def) continue;
    const count = (typeCounts.get(def.panelTypeId) ?? 0) + 1;
    typeCounts.set(def.panelTypeId, count);
    const definition = tryGetPanelDefinition(def.panelTypeId);
    if (definition?.instancePolicy === 'singleton' && count > 1) {
      violations.push(`singleton panel type '${def.panelTypeId}' has ${count} instances`);
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Window-set operations
// ---------------------------------------------------------------------------

/** Add a panel to a window as its root (replacing an empty root). */
export function addPanelToWindow(
  layout: DockLayout,
  windowId: WorkspaceWindowId,
  panelTypeId: PanelTypeId,
): { layout: DockLayout; instanceId: string } {
  const window = layout.windows.find((w) => w.id === windowId);
  if (!window) return { layout, instanceId: '' };
  const ref = createPanelInstanceRef(panelTypeId);
  let root: DockNode;
  if (window.dockRoot.kind === 'empty') {
    root = {
      kind: 'panel',
      id: `panel-${ref.instanceId}`,
      panelInstanceId: ref.instanceId,
      panelTypeId: ref.panelTypeId,
    };
  } else {
    const besideCanvas = insertPanelBesideCanvas(window.dockRoot, ref);
    if (besideCanvas) {
      root = besideCanvas;
    } else {
      const firstInstance = listPanelInstances(window.dockRoot)[0];
      const hostId = firstInstance
        ? findPanelInstance(window.dockRoot, firstInstance.instanceId)?.hostNodeId
        : undefined;
      root = hostId ? addToTabGroup(window.dockRoot, hostId, ref) : window.dockRoot;
    }
  }
  const next = layout.windows.map((w) => (w.id === windowId ? { ...w, dockRoot: root } : w));
  return { layout: { ...layout, windows: next }, instanceId: ref.instanceId };
}

/** Move a panel instance from its current window into a target window. */
export function movePanelBetweenWindows(
  layout: DockLayout,
  instanceId: string,
  targetWindowId: WorkspaceWindowId,
): { layout: DockLayout; moved: boolean } {
  const sourceLocation = findPanelInLayout(layout, instanceId);
  const source = sourceLocation?.window;
  if (!source) return { layout, moved: false };
  const targetBeforeMove = layout.windows.find((w) => w.id === targetWindowId);
  if (!targetBeforeMove) return { layout, moved: false };
  const existingPanel = sourceLocation?.panel;
  if (!existingPanel) return { layout, moved: false };
  const targetHost = targetBeforeMove.role === 'primary' ? 'primary-sidebar' : 'auxiliary-window';
  const definition = tryGetPanelDefinition(existingPanel.panelTypeId);
  if (definition && !definition.allowedHosts.includes(targetHost)) return { layout, moved: false };

  const removed = removePanelFromWindow(source, instanceId);
  if (!removed.removed) return { layout, moved: false };
  const ref = removed.removed;

  const withoutSource = layout.windows.map((w) => (w.id === source.id ? removed.window : w));

  const target = withoutSource.find((w) => w.id === targetWindowId);
  if (!target) return { layout, moved: false };

  let root: DockNode;
  if (target.dockRoot.kind === 'empty') {
    root = {
      kind: 'panel',
      id: `panel-${ref.instanceId}`,
      panelInstanceId: ref.instanceId,
      panelTypeId: ref.panelTypeId,
    };
  } else {
    const besideCanvas = insertPanelBesideCanvas(target.dockRoot, ref);
    if (besideCanvas) {
      root = besideCanvas;
    } else {
      const firstInstance = listPanelInstances(target.dockRoot)[0];
      const hostId = firstInstance
        ? findPanelInstance(target.dockRoot, firstInstance.instanceId)?.hostNodeId
        : undefined;
      root = hostId ? addToTabGroup(target.dockRoot, hostId, ref) : target.dockRoot;
    }
  }

  const windows = withoutSource.map((w) =>
    w.id === targetWindowId ? { ...w, dockRoot: root } : w,
  );
  return { layout: { ...layout, windows }, moved: true };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Deep-copy a dock tree for serialization safety. */
export function serializeDockTree(root: DockNode): DockNode {
  return structuredCloneSafe(root);
}

/**
 * Deserialize with validation: returns { ok, tree } — malformed trees are
 * rejected, never partially applied (imported layouts are untrusted input,
 * ADR-0040).
 */
export function deserializeDockTree(
  input: unknown,
): { ok: true; tree: DockNode } | { ok: false; reason: string } {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, reason: 'dock tree must be an object' };
  }
  const validationError = validateSerializedNode(input);
  if (validationError) return { ok: false, reason: validationError };
  const tree = structuredCloneSafe(input as DockNode);
  const violations = validateDockTree(normalizeDockTree(tree));
  if (violations.length > 0) {
    return { ok: false, reason: violations.join('; ') };
  }
  return { ok: true, tree: normalizeDockTree(tree) };
}

/** Deserialize a complete portable layout, then upgrade it to the current canvas schema. */
export function deserializeDockLayout(
  input: unknown,
): { ok: true; layout: DockLayout } | { ok: false; reason: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'dock layout must be an object' };
  }
  const source = input as Record<string, unknown>;
  if (![1, 2, DOCK_LAYOUT_SCHEMA_VERSION].includes(source.schemaVersion as number)) {
    return { ok: false, reason: 'unsupported dock layout version' };
  }
  if (!Array.isArray(source.windows) || source.windows.length > MAX_DOCK_WINDOWS) {
    return { ok: false, reason: `dock layout must have at most ${MAX_DOCK_WINDOWS} windows` };
  }

  const windows: WorkspaceWindowLayout[] = [];
  for (const candidate of source.windows) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      return { ok: false, reason: 'invalid dock window' };
    }
    const window = candidate as Record<string, unknown>;
    if (
      typeof window.id !== 'string' ||
      window.id.length === 0 ||
      window.id.length > 128 ||
      (window.role !== 'primary' && window.role !== 'auxiliary-panel')
    ) {
      return { ok: false, reason: 'invalid dock window identity or role' };
    }
    const tree = deserializeDockTree(window.dockRoot);
    if (!tree.ok) return { ok: false, reason: `invalid window '${window.id}': ${tree.reason}` };
    const floatingGroups: DockFloatingGroup[] = [];
    if (
      source.schemaVersion === DOCK_LAYOUT_SCHEMA_VERSION &&
      window.floatingGroups !== undefined
    ) {
      if (
        !Array.isArray(window.floatingGroups) ||
        window.floatingGroups.length > MAX_DOCK_FLOAT_GROUPS
      ) {
        return { ok: false, reason: `invalid floating groups in window '${window.id}'` };
      }
      for (const [index, candidateGroup] of window.floatingGroups.entries()) {
        if (
          typeof candidateGroup !== 'object' ||
          candidateGroup === null ||
          Array.isArray(candidateGroup)
        ) {
          return { ok: false, reason: `invalid floating group in window '${window.id}'` };
        }
        const group = candidateGroup as Record<string, unknown>;
        if (
          typeof group.id !== 'string' ||
          group.id.length === 0 ||
          group.id.length > 128 ||
          !Array.isArray(group.panels) ||
          group.panels.length === 0 ||
          group.panels.length > MAX_DOCK_PANELS ||
          typeof group.normalizedBounds !== 'object' ||
          group.normalizedBounds === null ||
          Array.isArray(group.normalizedBounds)
        ) {
          return { ok: false, reason: `invalid floating group in window '${window.id}'` };
        }
        const bounds = group.normalizedBounds as Record<string, unknown>;
        if (
          !['x', 'y', 'width', 'height'].every(
            (key) => typeof bounds[key] === 'number' && Number.isFinite(bounds[key]),
          )
        ) {
          return { ok: false, reason: `invalid bounds for floating group '${group.id}'` };
        }
        const active = group.activePanelInstanceId;
        if (active !== undefined && (typeof active !== 'string' || active.length > 128)) {
          return { ok: false, reason: `invalid active panel for floating group '${group.id}'` };
        }
        const refsValidation = validateSerializedNode({
          kind: 'tabs',
          id: `floating-validation-${index}`,
          panels: group.panels,
          ...(active ? { activePanelInstanceId: active } : {}),
        });
        if (refsValidation) {
          return {
            ok: false,
            reason: `invalid panels for floating group '${group.id}': ${refsValidation}`,
          };
        }
        floatingGroups.push({
          id: group.id,
          panels: (group.panels as Array<Record<string, unknown>>).map((panel) => ({
            instanceId: panel.instanceId as string,
            panelTypeId: panel.panelTypeId as PanelTypeId,
            ...(typeof panel.titleOverride === 'string' && panel.titleOverride.length <= 64
              ? { titleOverride: panel.titleOverride }
              : {}),
          })),
          ...(typeof active === 'string' ? { activePanelInstanceId: active } : {}),
          normalizedBounds: {
            x: bounds.x as number,
            y: bounds.y as number,
            width: bounds.width as number,
            height: bounds.height as number,
          },
        });
      }
    }
    windows.push({
      id: window.id,
      role: window.role,
      dockRoot: stripDocumentPins(tree.tree),
      floatingGroups,
    });
  }

  try {
    return {
      ok: true,
      layout: migrateDockLayoutToCanvas({ schemaVersion: source.schemaVersion as number, windows }),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'invalid dock layout',
    };
  }
}

/** Portable workspace layouts never include document-pinned panel state. */
function stripDocumentPins(root: DockNode): DockNode {
  switch (root.kind) {
    case 'split':
      return {
        kind: 'split',
        id: root.id,
        direction: root.direction,
        ratio: root.ratio,
        first: stripDocumentPins(root.first),
        second: stripDocumentPins(root.second),
      };
    case 'tabs':
      return {
        kind: 'tabs',
        id: root.id,
        ...(root.activePanelInstanceId
          ? { activePanelInstanceId: root.activePanelInstanceId }
          : {}),
        panels: root.panels.map((panel) => ({
          instanceId: panel.instanceId,
          panelTypeId: panel.panelTypeId,
          ...(typeof panel.titleOverride === 'string' && panel.titleOverride.length <= 64
            ? { titleOverride: panel.titleOverride }
            : {}),
        })),
      };
    case 'panel':
      return {
        kind: 'panel',
        id: root.id,
        panelInstanceId: root.panelInstanceId,
        panelTypeId: root.panelTypeId,
      };
    case 'canvas':
    case 'empty':
      return { kind: root.kind, id: root.id };
  }
}

function validateSerializedNode(input: unknown): string | null {
  const pending: Array<{ node: unknown; depth: number }> = [{ node: input, depth: 1 }];
  const ids = new Set<string>();
  const seen = new WeakSet<object>();
  let count = 0;

  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) continue;
    const { node, depth } = entry;
    count += 1;
    if (count > MAX_DOCK_NODES) return `dock tree exceeds ${MAX_DOCK_NODES} nodes`;
    if (depth > MAX_DOCK_DEPTH) return `dock tree exceeds maximum depth ${MAX_DOCK_DEPTH}`;
    if (typeof node !== 'object' || node === null || Array.isArray(node))
      return 'invalid dock node';
    if (seen.has(node)) return 'dock node is referenced more than once or contains a cycle';
    seen.add(node);

    const record = node as Record<string, unknown>;
    if (typeof record.id !== 'string' || record.id.length === 0 || record.id.length > 128) {
      return 'invalid dock node id';
    }
    if (ids.has(record.id)) return `duplicate dock node id '${record.id}'`;
    ids.add(record.id);

    switch (record.kind) {
      case 'split':
        if (record.direction !== 'row' && record.direction !== 'column')
          return 'invalid split direction';
        if (typeof record.ratio !== 'number' || !Number.isFinite(record.ratio))
          return 'invalid split ratio';
        pending.push({ node: record.second, depth: depth + 1 });
        pending.push({ node: record.first, depth: depth + 1 });
        break;
      case 'tabs':
        if (!Array.isArray(record.panels)) return 'tabs panels must be an array';
        if (record.panels.length > MAX_DOCK_PANELS) return `tabs exceed ${MAX_DOCK_PANELS} panels`;
        for (const panel of record.panels) {
          if (typeof panel !== 'object' || panel === null || Array.isArray(panel))
            return 'invalid panel ref';
          const ref = panel as Record<string, unknown>;
          if (typeof ref.instanceId !== 'string' || ref.instanceId.length === 0)
            return 'panel ref without instanceId';
          if (ref.instanceId.length > 128) return 'panel ref instanceId is too long';
          if (typeof ref.panelTypeId !== 'string' || ref.panelTypeId.length === 0)
            return 'panel ref without panelTypeId';
          if (ref.panelTypeId.length > 128) return 'panel ref panelTypeId is too long';
        }
        if (
          record.activePanelInstanceId !== undefined &&
          (typeof record.activePanelInstanceId !== 'string' ||
            record.activePanelInstanceId.length > 128)
        ) {
          return 'invalid active panel instance id';
        }
        break;
      case 'panel':
        if (typeof record.panelInstanceId !== 'string' || record.panelInstanceId.length === 0)
          return 'panel node without panelInstanceId';
        if (record.panelInstanceId.length > 128) return 'panel node panelInstanceId is too long';
        if (typeof record.panelTypeId !== 'string' || record.panelTypeId.length === 0)
          return 'panel node without panelTypeId';
        if (record.panelTypeId.length > 128) return 'panel node panelTypeId is too long';
        break;
      case 'canvas':
        break;
      case 'empty':
        break;
      default:
        return 'unknown dock node kind';
    }
  }
  return null;
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Migration from the single-window sidebar settings (ADR-0021/0032)
// ---------------------------------------------------------------------------

export interface SidebarPreferencesInput {
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
  leftWidth: number | null;
  rightWidth: number | null;
  logoPanelVisible: boolean;
}

/**
 * Migrate the legacy single-window sidebar booleans + widths into a dock
 * tree for the primary window: layers on the left, inspector on the right,
 * as a horizontal split with a center canvas gap preserved by the ratio.
 * Hidden panels are simply not hosted (they stay mounted per the Shell
 * contract until the dock renderer lands).
 */
export function migrateSidebarPreferences(input: SidebarPreferencesInput): DockNode {
  const left = input.leftPanelVisible
    ? ({
        kind: 'panel',
        id: 'panel-layers',
        panelInstanceId: 'instance-layers',
        panelTypeId: 'layers',
      } as DockNode)
    : createEmptyNode('left');
  const right = input.rightPanelVisible
    ? ({
        kind: 'panel',
        id: 'panel-inspector',
        panelInstanceId: 'instance-inspector',
        panelTypeId: 'inspector',
      } as DockNode)
    : createEmptyNode('right');

  if (left.kind === 'empty' && right.kind === 'empty') {
    return createEmptyNode('root');
  }
  if (left.kind === 'empty') return right;
  if (right.kind === 'empty') return left;

  const leftWidth = input.leftWidth ?? 288;
  const rightWidth = input.rightWidth ?? 320;
  const total = leftWidth + rightWidth + 480; // nominal canvas gap
  const ratio = clampRatio(leftWidth / total);
  return {
    kind: 'split',
    id: 'root',
    direction: 'row',
    ratio,
    first: left,
    second: right,
  };
}
