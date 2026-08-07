/**
 * Pure dock-tree operations (ADR-0206).
 *
 * Every function is a pure `DockNode → DockNode` transformation (or
 * `NativeWorkspaceLayout → NativeWorkspaceLayout`). No side effects,
 * no React, no Tauri. Fully unit-testable.
 *
 * Operations:
 * - findNode / findParent
 * - insertPanel (before/after, as tab, split)
 * - removePanel
 * - movePanel (to another window)
 * - addTab / removeTab
 * - splitHost
 * - mergeSingleChild
 * - normalize (cleanup empty splits, enforce ratios)
 * - collectPanelInstances (tree walk)
 * - serialize / deserialize
 */

import type {
  DockNode,
  DockSplitNode,
  DockTabGroupNode,
  NativeWorkspaceLayout,
  PanelInstance,
  PanelInstanceNodeId,
  WorkspaceWindowLayout,
} from './dockTypes';
import type { PanelTypeId } from './panelRegistry';
import {
  clampRatio,
  createEmptyDockNode,
  createPanelDockNode,
  createSplitDockNode,
} from './dockTypes';

// ---------------------------------------------------------------------------
// Tree traversal
// ---------------------------------------------------------------------------

export type DockNodeVisitor<T> = (node: DockNode, path: DockNode[]) => T | undefined;

/** Walk the tree depth-first, calling `visitor` on each node. Return true from visitor to stop. */
export function walkDockTree(
  node: DockNode,
  visitor: DockNodeVisitor<unknown>,
  path: DockNode[] = [],
): boolean {
  const result = visitor(node, path);
  if (result !== undefined) return true; // visitor signaled stop
  const nextPath = [...path, node];
  if (node.kind === 'split') {
    if (walkDockTree(node.first, visitor, nextPath)) return true;
    if (walkDockTree(node.second, visitor, nextPath)) return true;
  }
  return false;
}

/** Find a node by id. Returns the node and its path from root. */
export function findNode(
  root: DockNode,
  targetId: string,
): { node: DockNode; path: DockNode[] } | undefined {
  let result: { node: DockNode; path: DockNode[] } | undefined;
  walkDockTree(root, (node, path) => {
    if (node.id === targetId) {
      result = { node, path: [...path] };
      return true; // stop
    }
    return undefined;
  });
  return result;
}

/** Find the parent of a node by id. */
export function findParent(
  root: DockNode,
  targetId: string,
): { parent: DockSplitNode; child: DockNode; side: 'first' | 'second' } | undefined {
  let result: { parent: DockSplitNode; child: DockNode; side: 'first' | 'second' } | undefined;
  walkDockTree(root, (node) => {
    if (node.kind === 'split') {
      if (node.first.id === targetId) {
        result = { parent: node, child: node.first, side: 'first' };
        return true;
      }
      if (node.second.id === targetId) {
        result = { parent: node, child: node.second, side: 'second' };
        return true;
      }
    }
    return undefined;
  });
  return result;
}

/** Collect all panel instance ids referenced in the tree. */
export function collectPanelInstances(node: DockNode): PanelInstanceNodeId[] {
  const ids: PanelInstanceNodeId[] = [];
  walkDockTree(node, (n) => {
    if (n.kind === 'panel') ids.push(n.panelInstanceId);
    else if (n.kind === 'tab-group') ids.push(...n.tabs);
  });
  return ids;
}

/** Replace a node by id with a new subtree. */
export function replaceNode(root: DockNode, targetId: string, replacement: DockNode): DockNode {
  if (root.id === targetId) return replacement;
  if (root.kind === 'split') {
    return {
      ...root,
      first: replaceNode(root.first, targetId, replacement),
      second: replaceNode(root.second, targetId, replacement),
    };
  }
  return root;
}

// ---------------------------------------------------------------------------
// Insert operations
// ---------------------------------------------------------------------------

/**
 * Insert a panel as a new tab in an existing tab group.
 * Returns the updated root, or undefined if the target is not a tab group.
 */
export function addTabToGroup(
  root: DockNode,
  tabGroupId: string,
  panelInstanceId: PanelInstanceNodeId,
  activate = false,
): DockNode | undefined {
  const found = findNode(root, tabGroupId);
  if (found?.node.kind !== 'tab-group') return undefined;
  const group = found.node;
  const newTabs = [...group.tabs, panelInstanceId];
  const newGroup: DockTabGroupNode = {
    ...group,
    tabs: newTabs,
    activeTabIndex: activate ? newTabs.length - 1 : group.activeTabIndex,
  };
  return replaceNode(root, tabGroupId, newGroup);
}

/**
 * Insert a panel adjacent to an existing panel node (before or after),
 * creating a split if needed.
 */
export function insertPanelAdjacent(
  root: DockNode,
  targetNodeId: string,
  panelInstanceId: PanelInstanceNodeId,
  side: 'before' | 'after',
  direction: 'horizontal' | 'vertical' = 'horizontal',
): DockNode {
  const parent = findParent(root, targetNodeId);
  const newPanel = createPanelDockNode(panelInstanceId);

  if (!parent) {
    // target is the root — wrap in a split
    return createSplitDockNode(direction, root, newPanel, side === 'before' ? 0.3 : 0.7);
  }

  const { parent: parentNode, side: parentSide } = parent;
  const targetNode = parentSide === 'first' ? parentNode.first : parentNode.second;
  const newNode =
    side === 'before'
      ? createSplitDockNode(direction, newPanel, targetNode, 0.3)
      : createSplitDockNode(direction, targetNode, newPanel, 0.7);

  return replaceNode(root, parentNode.id, newNode);
}

// ---------------------------------------------------------------------------
// Remove operations
// ---------------------------------------------------------------------------

/**
 * Remove a panel node by id. The parent split is collapsed (the sibling
 * takes the parent's place). If the root is removed, returns empty.
 */
export function removePanelNode(root: DockNode, targetId: string): DockNode {
  const parent = findParent(root, targetId);
  if (!parent) {
    // removing the root — return empty
    return createEmptyDockNode('Drop a panel here');
  }

  const { parent: parentNode, side } = parent;
  const sibling = side === 'first' ? parentNode.second : parentNode.first;

  return replaceNode(root, parentNode.id, sibling);
}

/**
 * Remove a specific panel instance from a tab group. If the tab group
 * has one tab left, replace it with an empty node. If it has zero tabs,
 * remove the whole group.
 */
export function removePanelFromTabGroup(
  root: DockNode,
  tabGroupId: string,
  panelInstanceId: PanelInstanceNodeId,
): DockNode {
  const found = findNode(root, tabGroupId);
  if (found?.node.kind !== 'tab-group') return root;

  const group = found.node;
  const newTabs = group.tabs.filter((t) => t !== panelInstanceId);
  if (newTabs.length === 0) {
    return removePanelNode(root, tabGroupId);
  }
  if (newTabs.length === 1) {
    return replaceNode(root, tabGroupId, createPanelDockNode(newTabs[0]!));
  }
  const newActiveIndex = Math.min(group.activeTabIndex, newTabs.length - 1);
  const newGroup: DockTabGroupNode = { ...group, tabs: newTabs, activeTabIndex: newActiveIndex };
  return replaceNode(root, tabGroupId, newGroup);
}

// ---------------------------------------------------------------------------
// Split operations
// ---------------------------------------------------------------------------

/**
 * Split a node horizontally or vertically, placing the existing content
 * on one side and a new panel on the other.
 */
export function splitNode(
  root: DockNode,
  targetId: string,
  panelInstanceId: PanelInstanceNodeId,
  direction: 'horizontal' | 'vertical',
  side: 'first' | 'second' = 'second',
  ratio = 0.5,
): DockNode {
  const target = findNode(root, targetId);
  if (!target) return root;

  const newPanel = createPanelDockNode(panelInstanceId);
  const split =
    side === 'first'
      ? createSplitDockNode(direction, newPanel, target.node, clampRatio(1 - ratio))
      : createSplitDockNode(direction, target.node, newPanel, clampRatio(ratio));

  return replaceNode(root, targetId, split);
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a dock tree:
 * 1. Collapse single-child splits (a split with one child = replace with child).
 * 2. Clamp split ratios to [0.1, 0.9].
 * 3. Remove empty tab groups.
 * 4. Ensure root is never undefined.
 */
export function normalizeDockTree(node: DockNode): DockNode {
  if (node.kind === 'split') {
    const first = normalizeDockTree(node.first);
    const second = normalizeDockTree(node.second);

    // Collapse single-child splits
    if (first.kind === 'empty' && second.kind === 'empty') {
      return createEmptyDockNode();
    }
    if (first.kind === 'empty') return second;
    if (second.kind === 'empty') return first;

    return {
      ...node,
      ratio: clampRatio(node.ratio),
      first,
      second,
    };
  }

  if (node.kind === 'tab-group') {
    const validTabs = node.tabs.filter(Boolean);
    if (validTabs.length === 0) return createEmptyDockNode();
    if (validTabs.length === 1) {
      return createPanelDockNode(validTabs[0]!);
    }
    return {
      ...node,
      tabs: validTabs,
      activeTabIndex: Math.min(node.activeTabIndex, validTabs.length - 1),
    };
  }

  return node;
}

// ---------------------------------------------------------------------------
// Layout operations
// ---------------------------------------------------------------------------

/**
 * Find a panel instance by id across the layout.
 */
export function findPanelInstance(
  layout: NativeWorkspaceLayout,
  instanceId: PanelInstanceNodeId,
): PanelInstance | undefined {
  return layout.panelInstances.find((p) => p.id === instanceId);
}

/**
 * Find which window hosts a panel instance.
 */
export function findWindowForPanel(
  layout: NativeWorkspaceLayout,
  instanceId: PanelInstanceNodeId,
): WorkspaceWindowLayout | undefined {
  for (const win of layout.windows) {
    const instances = collectPanelInstances(win.dockRoot);
    if (instances.includes(instanceId)) return win;
  }
  return undefined;
}

/**
 * Move a panel instance from one window to another.
 * Removes from source, inserts at the target.
 */
export function movePanelBetweenWindows(
  layout: NativeWorkspaceLayout,
  instanceId: PanelInstanceNodeId,
  targetWindowId: string,
  targetNodeId?: string,
): NativeWorkspaceLayout {
  const sourceWindow = findWindowForPanel(layout, instanceId);
  if (!sourceWindow) return layout;
  if (sourceWindow.id === targetWindowId) return layout;

  const targetWindow = layout.windows.find((w) => w.id === targetWindowId);
  if (!targetWindow) return layout;

  // Remove from source
  const newSourceRoot = removePanelFromTabGroupRecursive(sourceWindow.dockRoot, instanceId);

  // Insert into target
  let newTargetRoot = targetWindow.dockRoot;
  if (targetNodeId) {
    newTargetRoot =
      addTabToGroup(newTargetRoot, targetNodeId, instanceId, true) ??
      insertPanelAdjacent(newTargetRoot, targetNodeId, instanceId, 'after');
  } else if (newTargetRoot.kind === 'empty') {
    newTargetRoot = createPanelDockNode(instanceId);
  } else {
    newTargetRoot = insertPanelAdjacent(newTargetRoot, newTargetRoot.id, instanceId, 'after');
  }

  // Update the instance's host
  const newInstances = layout.panelInstances.map((p) =>
    p.id === instanceId
      ? { ...p, hostNodeId: findRootNodeId(newTargetRoot, instanceId) ?? p.hostNodeId }
      : p,
  );

  return {
    ...layout,
    windows: layout.windows.map((w) => {
      if (w.id === sourceWindow.id) return { ...w, dockRoot: normalizeDockTree(newSourceRoot) };
      if (w.id === targetWindowId) return { ...w, dockRoot: normalizeDockTree(newTargetRoot) };
      return w;
    }),
    panelInstances: newInstances,
    updatedAt: Date.now(),
  };
}

function removePanelFromTabGroupRecursive(
  node: DockNode,
  instanceId: PanelInstanceNodeId,
): DockNode {
  if (node.kind === 'panel' && node.panelInstanceId === instanceId) {
    // This panel IS the node — signal removal by returning empty
    return createEmptyDockNode();
  }
  if (node.kind === 'tab-group' && node.tabs.includes(instanceId)) {
    return removePanelFromTabGroup(node, node.id, instanceId);
  }
  if (node.kind === 'split') {
    const newFirst = removePanelFromTabGroupRecursive(node.first, instanceId);
    const newSecond = removePanelFromTabGroupRecursive(node.second, instanceId);
    // If nothing changed, return as-is
    if (newFirst.id === node.first.id && newSecond.id === node.second.id) return node;
    // Normalize: if a child became empty, collapse
    if (newFirst.kind === 'empty' && newSecond.kind === 'empty') return createEmptyDockNode();
    if (newFirst.kind === 'empty') return newSecond;
    if (newSecond.kind === 'empty') return newFirst;
    return { ...node, first: newFirst, second: newSecond };
  }
  return node;
}

function findRootNodeId(root: DockNode, instanceId: PanelInstanceNodeId): string | undefined {
  let result: string | undefined;
  walkDockTree(root, (node) => {
    if (node.kind === 'panel' && node.panelInstanceId === instanceId) {
      result = node.id;
      return true;
    }
    if (node.kind === 'tab-group' && node.tabs.includes(instanceId)) {
      result = node.id;
      return true;
    }
  });
  return result;
}

/**
 * Create a default single-window layout from the current PanelId set.
 * Used for initial migration from the flat sidebar model.
 */
export function createDefaultLayout(
  panelInstanceIds: PanelInstanceNodeId[],
  panelTypes: Array<{ instanceId: PanelInstanceNodeId; typeId: string; hostNodeId: string }>,
): NativeWorkspaceLayout {
  let root: DockNode = createEmptyDockNode();

  // Build a vertical split tree: layers | inspector
  // Other panels go into tab groups
  const leftPanels = panelInstanceIds.filter((_, i) => i % 2 === 0);
  const rightPanels = panelInstanceIds.filter((_, i) => i % 2 === 1);

  if (leftPanels.length > 0) {
    root =
      leftPanels.length === 1
        ? createPanelDockNode(leftPanels[0]!)
        : createTabGroupWithPanels(leftPanels);
  }

  if (rightPanels.length > 0) {
    const rightNode =
      rightPanels.length === 1
        ? createPanelDockNode(rightPanels[0]!)
        : createTabGroupWithPanels(rightPanels);
    root = createSplitDockNode('horizontal', root, rightNode, 0.35);
  }

  return {
    schemaVersion: 1,
    id: `layout-${Date.now().toString(36)}`,
    name: 'Default',
    windows: [
      {
        id: 'main',
        role: 'primary',
        dockRoot: root,
        state: 'normal',
      },
    ],
    panelInstances: panelTypes.map((pt) => ({
      id: pt.instanceId,
      panelTypeId: pt.typeId as PanelTypeId, // validated at registration
      hostNodeId: pt.hostNodeId,
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createTabGroupWithPanels(ids: PanelInstanceNodeId[]): DockTabGroupNode {
  return {
    kind: 'tab-group',
    id: `dn-tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    tabs: ids,
    activeTabIndex: 0,
  };
}
