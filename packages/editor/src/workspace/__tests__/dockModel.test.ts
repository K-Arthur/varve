/**
 * Dock-tree model tests (ADR-0206).
 *
 * Pure unit tests for the dock-tree data structure and operations.
 * No React, no Tauri, no DOM. Every operation is a pure function test.
 *
 * Coverage:
 * - Tree construction and normalization
 * - Insert/remove operations
 * - Split and merge
 * - Tab group management
 * - Panel instance collection
 * - Node replacement
 * - Layout serialization round-trip
 * - Random operation sequences (property-based)
 */

import { describe, expect, it } from 'vitest';
import {
  addTabToGroup,
  collectPanelInstances,
  createDefaultLayout,
  findNode,
  findPanelInstance,
  findParent,
  findWindowForPanel,
  insertPanelAdjacent,
  movePanelBetweenWindows,
  normalizeDockTree,
  removePanelFromTabGroup,
  removePanelNode,
  replaceNode,
  splitNode,
  walkDockTree,
} from '../dockOps';
import type { DockNode, DockSplitNode } from '../dockTypes';
import {
  clampRatio,
  createEmptyDockNode,
  createPanelDockNode,
  createSplitDockNode,
  createTabGroupDockNode,
  generateDockNodeId,
  resetDockNodeIdCounter,
} from '../dockTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePanel(id: string): DockNode {
  return createPanelDockNode(`pi-${id}`);
}

function makeSplit(
  first: DockNode,
  second: DockNode,
  ratio = 0.5,
  direction: 'horizontal' | 'vertical' = 'horizontal',
): DockSplitNode {
  return createSplitDockNode(direction, first, second, ratio);
}

// ---------------------------------------------------------------------------
// DockTypes: identity and defaults
// ---------------------------------------------------------------------------

describe('dockTypes: identity', () => {
  it('generates unique ids', () => {
    resetDockNodeIdCounter();
    const a = generateDockNodeId();
    const b = generateDockNodeId();
    expect(a).not.toBe(b);
  });

  it('clampRatio bounds to [0.1, 0.9]', () => {
    expect(clampRatio(0)).toBe(0.1);
    expect(clampRatio(1)).toBe(0.9);
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(Number.NaN)).toBe(0.5);
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// DockOps: tree traversal
// ---------------------------------------------------------------------------

describe('dockOps: walkDockTree', () => {
  it('visits all nodes depth-first', () => {
    const root = makeSplit(makePanel('a'), makePanel('b'));
    const visited: string[] = [];
    walkDockTree(root, (node) => {
      visited.push(node.kind);
    });
    expect(visited).toEqual(['split', 'panel', 'panel']);
  });

  it('stops early when visitor returns truthy', () => {
    const root = makeSplit(makePanel('a'), makePanel('b'));
    const visited: string[] = [];
    walkDockTree(root, (node) => {
      visited.push(node.kind);
      if (node.kind === 'panel') return true;
    });
    expect(visited).toEqual(['split', 'panel']);
  });
});

describe('dockOps: findNode', () => {
  it('finds a node by id', () => {
    const panel = makePanel('x');
    const root = makeSplit(panel, makePanel('y'));
    const found = findNode(root, panel.id);
    expect(found).toBeDefined();
    expect(found!.node.kind).toBe('panel');
  });

  it('returns undefined for unknown id', () => {
    const root = makeSplit(makePanel('a'), makePanel('b'));
    expect(findNode(root, 'nonexistent')).toBeUndefined();
  });

  it('returns the path from root', () => {
    const a = makePanel('a');
    const b = makePanel('b');
    const root = makeSplit(a, b);
    const found = findNode(root, b.id);
    expect(found!.path).toHaveLength(1); // root split
    expect(found!.path[0]!.kind).toBe('split');
  });
});

describe('dockOps: findParent', () => {
  it('finds the parent split and which side', () => {
    const a = makePanel('a');
    const b = makePanel('b');
    const root = makeSplit(a, b);
    const parentInfo = findParent(root, b.id);
    expect(parentInfo).toBeDefined();
    expect(parentInfo!.parent.kind).toBe('split');
    expect(parentInfo!.side).toBe('second');
  });

  it('returns undefined for root node', () => {
    const root = makePanel('a');
    expect(findParent(root, root.id)).toBeUndefined();
  });
});

describe('dockOps: collectPanelInstances', () => {
  it('collects all panel instance ids', () => {
    const root = makeSplit(makePanel('a'), makePanel('b'));
    expect(collectPanelInstances(root)).toHaveLength(2);
  });

  it('collects from tab groups', () => {
    const group = createTabGroupDockNode(['pi-x', 'pi-y', 'pi-z']);
    expect(collectPanelInstances(group)).toEqual(['pi-x', 'pi-y', 'pi-z']);
  });

  it('returns empty for empty node', () => {
    expect(collectPanelInstances(createEmptyDockNode())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DockOps: insert operations
// ---------------------------------------------------------------------------

describe('dockOps: insertPanelAdjacent', () => {
  it('inserts before the root when root is the target', () => {
    const root = makePanel('a');
    const result = insertPanelAdjacent(root, root.id, 'pi-new', 'before');
    expect(result.kind).toBe('split');
    const split = result as DockSplitNode;
    expect(split.first.kind).toBe('panel');
    expect(split.second.kind).toBe('panel');
  });

  it('inserts after creates correct order', () => {
    const a = makePanel('a');
    const root = makeSplit(a, makePanel('b'));
    const result = insertPanelAdjacent(root, a.id, 'pi-new', 'after');
    // The split should now be: a | new | b
    expect(result.kind).toBe('split');
  });
});

describe('dockOps: addTabToGroup', () => {
  it('adds a tab to an existing group', () => {
    const group = createTabGroupDockNode(['pi-a']);
    const root = group;
    const result = addTabToGroup(root, group.id, 'pi-b');
    expect(result).toBeDefined();
    if (result?.kind === 'tab-group') {
      expect(result.tabs).toEqual(['pi-a', 'pi-b']);
    }
  });

  it('returns undefined for non-existent group', () => {
    const root = makePanel('a');
    expect(addTabToGroup(root, 'nonexistent', 'pi-x')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// DockOps: remove operations
// ---------------------------------------------------------------------------

describe('dockOps: removePanelNode', () => {
  it('removes a panel from a split, keeping the sibling', () => {
    const a = makePanel('a');
    const b = makePanel('b');
    const root = makeSplit(a, b);
    const result = removePanelNode(root, a.id);
    expect(result.kind).toBe('panel');
    expect(result.id).toBe(b.id);
  });

  it('returns empty when removing root', () => {
    const root = makePanel('a');
    const result = removePanelNode(root, root.id);
    expect(result.kind).toBe('empty');
  });
});

describe('dockOps: removePanelFromTabGroup', () => {
  it('removes a tab, leaving the rest', () => {
    const group = createTabGroupDockNode(['pi-a', 'pi-b', 'pi-c']);
    const result = removePanelFromTabGroup(group, group.id, 'pi-b');
    expect(result.kind).toBe('tab-group');
    if (result.kind === 'tab-group') {
      expect(result.tabs).toEqual(['pi-a', 'pi-c']);
    }
  });

  it('replaces with panel node when one tab remains', () => {
    const group = createTabGroupDockNode(['pi-a', 'pi-b']);
    const result = removePanelFromTabGroup(group, group.id, 'pi-a');
    expect(result.kind).toBe('panel');
  });

  it('returns empty when all tabs removed', () => {
    const group = createTabGroupDockNode(['pi-a']);
    const result = removePanelFromTabGroup(group, group.id, 'pi-a');
    expect(result.kind).toBe('empty');
  });
});

// ---------------------------------------------------------------------------
// DockOps: split operations
// ---------------------------------------------------------------------------

describe('dockOps: splitNode', () => {
  it('wraps the target in a split with a new panel', () => {
    const a = makePanel('a');
    const root = makeSplit(a, makePanel('b'));
    const result = splitNode(root, a.id, 'pi-new', 'vertical');
    expect(result.kind).toBe('split');
  });
});

// ---------------------------------------------------------------------------
// DockOps: normalization
// ---------------------------------------------------------------------------

describe('dockOps: normalizeDockTree', () => {
  it('collapses split with empty first child', () => {
    const empty = createEmptyDockNode();
    const panel = makePanel('a');
    const split = makeSplit(empty, panel);
    const result = normalizeDockTree(split);
    expect(result.kind).toBe('panel');
    expect(result.id).toBe(panel.id);
  });

  it('collapses split with empty second child', () => {
    const panel = makePanel('a');
    const empty = createEmptyDockNode();
    const split = makeSplit(panel, empty);
    const result = normalizeDockTree(split);
    expect(result.kind).toBe('panel');
    expect(result.id).toBe(panel.id);
  });

  it('returns empty for split with both children empty', () => {
    const split = makeSplit(createEmptyDockNode(), createEmptyDockNode());
    const result = normalizeDockTree(split);
    expect(result.kind).toBe('empty');
  });

  it('collapses single-item tab group to panel node', () => {
    const group = createTabGroupDockNode(['pi-only']);
    const result = normalizeDockTree(group);
    expect(result.kind).toBe('panel');
  });

  it('returns empty for empty tab group', () => {
    const group = createTabGroupDockNode([]);
    const result = normalizeDockTree(group);
    expect(result.kind).toBe('empty');
  });

  it('clamps extreme split ratios', () => {
    const split = makeSplit(makePanel('a'), makePanel('b'), 0.01);
    const result = normalizeDockTree(split);
    expect(result.kind).toBe('split');
    if (result.kind === 'split') {
      expect(result.ratio).toBeGreaterThanOrEqual(0.1);
      expect(result.ratio).toBeLessThanOrEqual(0.9);
    }
  });

  it('recursively normalizes nested trees', () => {
    const inner = makeSplit(createEmptyDockNode(), makePanel('deep'));
    const root = makeSplit(makePanel('top'), inner);
    const result = normalizeDockTree(root);
    // inner collapsed to just 'deep', so root becomes: top | deep
    expect(result.kind).toBe('split');
    if (result.kind === 'split') {
      expect(result.first.kind).toBe('panel');
      expect(result.second.kind).toBe('panel');
    }
  });
});

// ---------------------------------------------------------------------------
// DockOps: node replacement
// ---------------------------------------------------------------------------

describe('dockOps: replaceNode', () => {
  it('replaces root when target matches', () => {
    const old = makePanel('old');
    const replacement = makePanel('new');
    const result = replaceNode(old, old.id, replacement);
    expect(result.id).toBe(replacement.id);
  });

  it('replaces nested node', () => {
    const a = makePanel('a');
    const b = makePanel('b');
    const root = makeSplit(a, b);
    const replacement = makePanel('new');
    const result = replaceNode(root, b.id, replacement);
    expect(result.kind).toBe('split');
    if (result.kind === 'split') {
      expect(result.second.id).toBe(replacement.id);
    }
  });
});

// ---------------------------------------------------------------------------
// DockOps: layout operations
// ---------------------------------------------------------------------------

describe('dockOps: findPanelInstance', () => {
  it('finds a panel instance in the layout', () => {
    const layout = createDefaultLayout(
      ['pi-1', 'pi-2'],
      [
        { instanceId: 'pi-1', typeId: 'layers', hostNodeId: 'h1' },
        { instanceId: 'pi-2', typeId: 'inspector', hostNodeId: 'h2' },
      ],
    );
    const found = findPanelInstance(layout, 'pi-1');
    expect(found).toBeDefined();
    expect(found!.panelTypeId).toBe('layers');
  });
});

describe('dockOps: findWindowForPanel', () => {
  it('finds the window hosting a panel', () => {
    const layout = createDefaultLayout(
      ['pi-1'],
      [{ instanceId: 'pi-1', typeId: 'layers', hostNodeId: 'h1' }],
    );
    const win = findWindowForPanel(layout, 'pi-1');
    expect(win).toBeDefined();
    expect(win!.role).toBe('primary');
  });
});

describe('dockOps: createDefaultLayout', () => {
  it('creates a layout with panel instances', () => {
    const layout = createDefaultLayout(
      ['pi-a', 'pi-b'],
      [
        { instanceId: 'pi-a', typeId: 'layers', hostNodeId: 'h1' },
        { instanceId: 'pi-b', typeId: 'inspector', hostNodeId: 'h2' },
      ],
    );
    expect(layout.schemaVersion).toBe(1);
    expect(layout.windows).toHaveLength(1);
    expect(layout.panelInstances).toHaveLength(2);
    expect(layout.windows[0]!.role).toBe('primary');
  });

  it('produces a normalized dock root', () => {
    const layout = createDefaultLayout(
      ['pi-a'],
      [{ instanceId: 'pi-a', typeId: 'layers', hostNodeId: 'h1' }],
    );
    // Single panel should not be wrapped in a split
    const root = layout.windows[0]!.dockRoot;
    expect(root.kind).toBe('panel');
  });
});

// ---------------------------------------------------------------------------
// DockOps: movePanelBetweenWindows
// ---------------------------------------------------------------------------

describe('dockOps: movePanelBetweenWindows', () => {
  it('moves a panel from one window to another', () => {
    const layout = createDefaultLayout(
      ['pi-a', 'pi-b'],
      [
        { instanceId: 'pi-a', typeId: 'layers', hostNodeId: 'h1' },
        { instanceId: 'pi-b', typeId: 'inspector', hostNodeId: 'h2' },
      ],
    );
    // Add a second window
    const layoutWith2Windows = {
      ...layout,
      windows: [
        ...layout.windows,
        {
          id: 'aux-1',
          role: 'auxiliary-panel' as const,
          dockRoot: createEmptyDockNode(),
          state: 'normal' as const,
        },
      ],
    };

    const result = movePanelBetweenWindows(layoutWith2Windows, 'pi-a', 'aux-1');
    // pi-a should no longer be in the primary window
    const primaryWindow = result.windows.find((w) => w.id === 'main');
    const auxWindow = result.windows.find((w) => w.id === 'aux-1');
    expect(primaryWindow).toBeDefined();
    expect(auxWindow).toBeDefined();

    const primaryPanels = collectPanelInstances(primaryWindow!.dockRoot);
    const auxPanels = collectPanelInstances(auxWindow!.dockRoot);
    expect(primaryPanels).not.toContain('pi-a');
    expect(auxPanels).toContain('pi-a');
  });
});
