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

import { tryGetPanelDefinition } from '../panelRegistry';
import {
  createPanelInstanceRef,
  type DockLayout,
  type DockNode,
  type DockSplitDirection,
  type PanelInstanceRef,
  type PanelTypeId,
  type WorkspaceWindowId,
  type WorkspaceWindowLayout,
  type WorkspaceWindowRole,
} from './dockTypes';

export const MIN_SPLIT_RATIO = 0.05;
export const MAX_SPLIT_RATIO = 0.95;

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

  function walk(node: DockNode): void {
    if (!node.id) violations.push('node without id');
    switch (node.kind) {
      case 'split': {
        if (!Number.isFinite(node.ratio) || node.ratio <= 0 || node.ratio >= 1) {
          violations.push(`split '${node.id}' has invalid ratio ${node.ratio}`);
        }
        if (node.first.kind === 'empty' || node.second.kind === 'empty') {
          violations.push(`split '${node.id}' has an empty child (not normalized)`);
        }
        walk(node.first);
        walk(node.second);
        break;
      }
      case 'tabs': {
        if (node.panels.length === 0) {
          violations.push(`tabs '${node.id}' is empty (not normalized)`);
        }
        if (node.panels.length === 1) {
          violations.push(`tabs '${node.id}' holds a single panel (not normalized)`);
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
      case 'empty':
        break;
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

  walk(root);
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
  if (layout.schemaVersion !== 1) {
    violations.push(`unsupported schema version ${layout.schemaVersion}`);
  }
  const seenInstances = new Set<string>();
  const seenWindows = new Set<string>();
  for (const window of layout.windows) {
    if (seenWindows.has(window.id)) violations.push(`duplicate window id '${window.id}'`);
    seenWindows.add(window.id);
    violations.push(...validateDockTree(window.dockRoot).map((v) => `window '${window.id}': ${v}`));
    for (const panel of listPanelInstances(window.dockRoot)) {
      if (seenInstances.has(panel.instanceId)) {
        violations.push(`panel instance '${panel.instanceId}' hosted in multiple windows`);
      }
      seenInstances.add(panel.instanceId);
    }
  }
  const typeCounts = new Map<PanelTypeId, number>();
  for (const instanceId of seenInstances) {
    const def = findInstanceDefinition(layout, instanceId);
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

function findInstanceDefinition(
  layout: DockLayout,
  instanceId: string,
): { panelTypeId: PanelTypeId } | undefined {
  for (const window of layout.windows) {
    const found = listPanelInstances(window.dockRoot).find((p) => p.instanceId === instanceId);
    if (found) return found;
  }
  return undefined;
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
  const root =
    window.dockRoot.kind === 'empty'
      ? ({
          kind: 'panel',
          id: `panel-${ref.instanceId}`,
          panelInstanceId: ref.instanceId,
          panelTypeId: ref.panelTypeId,
        } as DockNode)
      : addToTabGroup(window.dockRoot, window.dockRoot.id, ref);
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
  const removed = removePanel(source.dockRoot, instanceId);
  if (!removed.removed) return { layout, moved: false };
  const ref = removed.removed;

  const withoutSource = layout.windows.map((w) =>
    w.id === source.id ? { ...w, dockRoot: normalizeDockTree(removed.tree) } : w,
  );

  const target = withoutSource.find((w) => w.id === targetWindowId);
  if (!target) return { layout, moved: false };

  const root =
    target.dockRoot.kind === 'empty'
      ? ({
          kind: 'panel',
          id: `panel-${ref.instanceId}`,
          panelInstanceId: ref.instanceId,
          panelTypeId: ref.panelTypeId,
        } as DockNode)
      : addToTabGroup(target.dockRoot, target.dockRoot.id, ref);

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
  const validationError = validateSerializedNode(input as DockNode);
  if (validationError) return { ok: false, reason: validationError };
  const tree = structuredCloneSafe(input as DockNode);
  const violations = validateDockTree(normalizeDockTree(tree));
  if (violations.length > 0) {
    return { ok: false, reason: violations.join('; ') };
  }
  return { ok: true, tree: normalizeDockTree(tree) };
}

function validateSerializedNode(node: DockNode): string | null {
  if (
    typeof node !== 'object' ||
    node === null ||
    typeof node.id !== 'string' ||
    node.id.length === 0
  ) {
    return 'node without id';
  }
  switch (node.kind) {
    case 'split':
      if (node.direction !== 'row' && node.direction !== 'column') return 'invalid split direction';
      if (typeof node.ratio !== 'number' || !Number.isFinite(node.ratio))
        return 'invalid split ratio';
      return validateSerializedNode(node.first) ?? validateSerializedNode(node.second);
    case 'tabs':
      if (!Array.isArray(node.panels)) return 'tabs panels must be an array';
      for (const panel of node.panels) {
        if (typeof panel !== 'object' || panel === null) return 'invalid panel ref';
        if (typeof panel.instanceId !== 'string' || panel.instanceId.length === 0)
          return 'panel ref without instanceId';
        if (typeof panel.panelTypeId !== 'string' || panel.panelTypeId.length === 0)
          return 'panel ref without panelTypeId';
      }
      return null;
    case 'panel':
      if (typeof node.panelInstanceId !== 'string' || node.panelInstanceId.length === 0) {
        return 'panel node without panelInstanceId';
      }
      if (typeof node.panelTypeId !== 'string' || node.panelTypeId.length === 0) {
        return 'panel node without panelTypeId';
      }
      return null;
    case 'empty':
      return null;
    default:
      return 'unknown dock node kind';
  }
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
