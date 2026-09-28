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
export const DOCK_TAB_STRIP_MIN_HEIGHT = 32;

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
  return { id, role, dockRoot: createEmptyNode(`root-${id}`) };
}

/** Default single-window layout: one protected central canvas anchor. */
export function createDefaultDockLayout(): DockLayout {
  return {
    schemaVersion: DOCK_LAYOUT_SCHEMA_VERSION,
    windows: [{ id: 'main', role: 'primary', dockRoot: createCanvasNode() }],
  };
}

/**
 * Upgrade the original panel-only tree schema by retaining its panel tree
 * beside one central canvas anchor. The conversion is idempotent and rejects
 * malformed layouts instead of guessing at lost panel ownership.
 */
export function migrateDockLayoutToCanvas(layout: DockLayout): DockLayout {
  if (layout.schemaVersion === DOCK_LAYOUT_SCHEMA_VERSION) {
    const violations = validateDockLayout(layout);
    if (violations.length > 0) throw new Error(`Invalid dock layout: ${violations[0]}`);
    return layout;
  }
  if (layout.schemaVersion !== 1) throw new Error('Unsupported dock layout version');
  if (validateDockLayout(layout).length > 0) throw new Error('Invalid legacy dock layout');

  let primaryCount = 0;
  const windows = layout.windows.map((window) => {
    if (window.role !== 'primary') return window;
    primaryCount += 1;
    const canvases = findCanvasNodes(window.dockRoot);
    if (canvases.length > 1) throw new Error('Legacy layout contains multiple canvas anchors');
    if (canvases.length === 1) return window;
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
    return { ...window, dockRoot: root };
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
      id: `tabs-${targetNodeId}`,
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

  const sourceWindow = layout.windows.find((window) =>
    findPanelInstance(window.dockRoot, instanceId),
  );
  if (!sourceWindow) return { ok: false, layout, reason: 'missing-panel' };
  const targetWindow = layout.windows.find((window) => window.id === targetWindowId);
  if (!targetWindow) return { ok: false, layout, reason: 'missing-window' };

  const panel = listPanelInstances(sourceWindow.dockRoot).find(
    (candidate) => candidate.instanceId === instanceId,
  );
  if (!panel) return { ok: false, layout, reason: 'missing-panel' };
  const targetHost = targetWindow.role === 'primary' ? 'primary-sidebar' : 'auxiliary-window';
  const definition = tryGetPanelDefinition(panel.panelTypeId);
  if (definition && !definition.allowedHosts.includes(targetHost)) {
    return { ok: false, layout, reason: 'host-not-allowed' };
  }

  const removed = removePanel(sourceWindow.dockRoot, instanceId);
  if (!removed.removed) return { ok: false, layout, reason: 'missing-panel' };
  const targetRoot =
    sourceWindow.id === targetWindow.id ? normalizeDockTree(removed.tree) : targetWindow.dockRoot;
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
      return { ...window, dockRoot: normalizeDockTree(nextRoot) };
    }
    if (window.id === sourceWindow.id) {
      return { ...window, dockRoot: normalizeDockTree(removed.tree) };
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
      tree: createEmptyNode(root.id),
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
  if (layout.schemaVersion !== 1 && layout.schemaVersion !== DOCK_LAYOUT_SCHEMA_VERSION) {
    violations.push(`unsupported schema version ${layout.schemaVersion}`);
  }
  const seenInstances = new Set<string>();
  const seenWindows = new Set<string>();
  const panelRefsByInstance = new Map<string, PanelInstanceRef>();
  let primaryWindows = 0;
  if (layout.windows.length > MAX_DOCK_WINDOWS) {
    violations.push(`layout exceeds ${MAX_DOCK_WINDOWS} windows`);
  }
  for (const window of layout.windows) {
    if (seenWindows.has(window.id)) violations.push(`duplicate window id '${window.id}'`);
    seenWindows.add(window.id);
    const canvasCount = findCanvasNodes(window.dockRoot).length;
    if (window.role === 'primary') {
      primaryWindows += 1;
      if (layout.schemaVersion === DOCK_LAYOUT_SCHEMA_VERSION && canvasCount !== 1) {
        violations.push(`primary window '${window.id}' must contain exactly one canvas anchor`);
      }
    } else if (layout.schemaVersion === DOCK_LAYOUT_SCHEMA_VERSION && canvasCount !== 0) {
      violations.push(`auxiliary window '${window.id}' cannot contain a canvas anchor`);
    }
    const hostKind = window.role === 'primary' ? 'primary-sidebar' : 'auxiliary-window';
    const windowViolations = validateDockTree(window.dockRoot);
    violations.push(...windowViolations.map((v) => `window '${window.id}': ${v}`));
    for (const panel of collectPanelInstances(window.dockRoot)) {
      if (seenInstances.has(panel.instanceId)) {
        violations.push(`panel instance '${panel.instanceId}' hosted in multiple windows`);
      }
      seenInstances.add(panel.instanceId);
      panelRefsByInstance.set(panel.instanceId, panel);
      const definition = tryGetPanelDefinition(panel.panelTypeId);
      if (definition && !definition.allowedHosts.includes(hostKind)) {
        violations.push(
          `panel type '${panel.panelTypeId}' cannot be hosted in ${hostKind} window '${window.id}'`,
        );
      }
    }
  }
  if (layout.schemaVersion === DOCK_LAYOUT_SCHEMA_VERSION && primaryWindows !== 1) {
    violations.push('layout must contain exactly one primary window');
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
  const source = layout.windows.find((w) => findPanelInstance(w.dockRoot, instanceId));
  if (!source) return { layout, moved: false };
  const targetBeforeMove = layout.windows.find((w) => w.id === targetWindowId);
  if (!targetBeforeMove) return { layout, moved: false };
  const existingPanel = listPanelInstances(source.dockRoot).find(
    (panel) => panel.instanceId === instanceId,
  );
  if (!existingPanel) return { layout, moved: false };
  const targetHost = targetBeforeMove.role === 'primary' ? 'primary-sidebar' : 'auxiliary-window';
  const definition = tryGetPanelDefinition(existingPanel.panelTypeId);
  if (definition && !definition.allowedHosts.includes(targetHost)) return { layout, moved: false };

  const removed = removePanel(source.dockRoot, instanceId);
  if (!removed.removed) return { layout, moved: false };
  const ref = removed.removed;

  const withoutSource = layout.windows.map((w) =>
    w.id === source.id ? { ...w, dockRoot: normalizeDockTree(removed.tree) } : w,
  );

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
  if (source.schemaVersion !== 1 && source.schemaVersion !== DOCK_LAYOUT_SCHEMA_VERSION) {
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
    windows.push({
      id: window.id,
      role: window.role,
      dockRoot: stripDocumentPins(tree.tree),
    });
  }

  try {
    return {
      ok: true,
      layout: migrateDockLayoutToCanvas({ schemaVersion: source.schemaVersion, windows }),
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
