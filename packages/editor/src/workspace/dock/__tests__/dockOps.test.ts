/**
 * Dock-tree operation tests (ADR-0021). Pure model — no React, no DOM.
 *
 * Covers insertion, tab grouping, splits, removal, normalization,
 * validation, serialization, window-set moves, and the sidebar migration.
 * Property tests for random operation sequences live in
 * dockProperty.test.ts.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { registerBuiltinPanels } from '../../panelDefinitions';
import { resetPanelRegistry } from '../../panelRegistry';
import {
  activateDockTab,
  addPanelToWindow,
  addToTabGroup,
  clampRatio,
  createDefaultDockLayout,
  createWindow,
  deserializeDockLayout,
  deserializeDockTree,
  findPanelInstance,
  getDockNodeMinimumSize,
  insertBeside,
  listPanelInstances,
  migrateDockLayoutToCanvas,
  migrateSidebarPreferences,
  movePanelBetweenWindows,
  movePanelToHost,
  normalizeDockTree,
  removePanel,
  reorderTab,
  serializeDockTree,
  setSplitRatio,
  splitHost,
  validateDockLayout,
  validateDockTree,
} from '../dockOps';
import {
  createCanvasNode,
  type DockLayout,
  type DockNode,
  type PanelInstanceRef,
} from '../dockTypes';

beforeEach(() => {
  resetPanelRegistry();
  registerBuiltinPanels();
});

const layers = (instanceId = 'i1'): PanelInstanceRef => ({
  instanceId,
  panelTypeId: 'layers' as const,
});
const inspector = (instanceId = 'i2'): PanelInstanceRef => ({
  instanceId,
  panelTypeId: 'inspector' as const,
});

function emptyRoot(): DockNode {
  return { kind: 'empty', id: 'root' };
}

describe('dock ops: insertion and splits', () => {
  it('insertBeside creates a split with the panel second', () => {
    const root = {
      kind: 'panel' as const,
      id: 'p1',
      panelInstanceId: 'i1',
      panelTypeId: 'layers' as const,
    };
    const next = insertBeside(root, 'p1', inspector(), 'row', 0.4, 'split1');
    expect(next.kind).toBe('split');
    if (next.kind === 'split') {
      expect(next.direction).toBe('row');
      expect(next.ratio).toBeCloseTo(0.4, 5);
      expect(next.second.kind).toBe('panel');
    }
    expect(findPanelInstance(next, 'i1')).toBeDefined();
    expect(findPanelInstance(next, 'i2')).toBeDefined();
  });

  it('clamps ratios into (0,1)', () => {
    expect(clampRatio(0)).toBeGreaterThan(0);
    expect(clampRatio(1)).toBeLessThan(1);
    expect(clampRatio(Number.NaN)).toBe(0.5);
    expect(clampRatio(0.5)).toBe(0.5);
  });

  it('insertBeside into a missing target is a no-op', () => {
    const root = emptyRoot();
    const next = insertBeside(root, 'missing', layers(), 'row', 0.5, 'split1');
    expect(next).toBe(root);
  });

  it('splitHost splits an existing host', () => {
    const root = {
      kind: 'panel' as const,
      id: 'p1',
      panelInstanceId: 'i1',
      panelTypeId: 'layers' as const,
    };
    const next = splitHost(root, 'p1', inspector(), 'column', 0.6, 'split1');
    expect(next.kind).toBe('split');
    if (next.kind === 'split') {
      expect(next.direction).toBe('column');
      expect(next.first).toEqual(root);
    }
  });

  it('splitHost refuses to split an empty node', () => {
    const next = splitHost(emptyRoot(), 'root', layers(), 'row', 0.5, 'split1');
    expect(next).toEqual(emptyRoot());
  });

  it('updates only the requested split ratio and ignores invalid targets', () => {
    const root = splitHost(createCanvasNode(), 'canvas-primary', layers(), 'row', 0.5, 'split1');
    const next = setSplitRatio(root, 'split1', 0.7);
    expect(next).not.toBe(root);
    expect(next.kind).toBe('split');
    if (next.kind === 'split') expect(next.ratio).toBeCloseTo(0.7, 5);
    expect(setSplitRatio(next, 'missing', 0.3)).toBe(next);
    expect(setSplitRatio(next, 'split1', Number.NaN)).toBe(next);
    expect(setSplitRatio(next, 'split1', 5)).not.toBe(next);
  });
});

describe('dock ops: tab groups', () => {
  it('addToTabGroup adds to an existing tabs node and activates', () => {
    const root: DockNode = {
      kind: 'tabs',
      id: 't1',
      panels: [layers('i1')],
      activePanelInstanceId: 'i1',
    };
    const next = addToTabGroup(root, 't1', inspector('i2'));
    expect(next.kind).toBe('tabs');
    if (next.kind === 'tabs') {
      expect(next.panels.map((p) => p.instanceId)).toEqual(['i1', 'i2']);
      expect(next.activePanelInstanceId).toBe('i2');
    }
  });

  it('addToTabGroup converts a single panel node into tabs', () => {
    const root = {
      kind: 'panel' as const,
      id: 'p1',
      panelInstanceId: 'i1',
      panelTypeId: 'layers' as const,
    };
    const next = addToTabGroup(root, 'p1', inspector('i2'));
    expect(next.kind).toBe('tabs');
    if (next.kind === 'tabs') {
      expect(next.panels.map((p) => p.instanceId)).toEqual(['i1', 'i2']);
    }
  });

  it('reorders a tab while preserving the active instance by identity', () => {
    const root: DockNode = {
      kind: 'tabs',
      id: 't1',
      panels: [layers('i1'), inspector('i2')],
      activePanelInstanceId: 'i2',
    };

    const next = reorderTab(root, 't1', 'i2', 'before');

    expect(next.kind).toBe('tabs');
    if (next.kind === 'tabs') {
      expect(next.panels.map((panel) => panel.instanceId)).toEqual(['i2', 'i1']);
      expect(next.activePanelInstanceId).toBe('i2');
    }
  });

  it('does not change a tree when a tab cannot move in the requested direction', () => {
    const root: DockNode = {
      kind: 'tabs',
      id: 't1',
      panels: [layers('i1'), inspector('i2')],
      activePanelInstanceId: 'i1',
    };

    expect(reorderTab(root, 't1', 'i1', 'before')).toBe(root);
    expect(reorderTab(root, 't1', 'missing', 'after')).toBe(root);
  });

  it('selects an existing tab and leaves invalid selections unchanged', () => {
    const root: DockNode = {
      kind: 'tabs',
      id: 't1',
      panels: [layers('i1'), inspector('i2')],
      activePanelInstanceId: 'i1',
    };

    expect(activateDockTab(root, 't1', 'i2')).toMatchObject({
      kind: 'tabs',
      activePanelInstanceId: 'i2',
    });
    expect(activateDockTab(root, 't1', 'missing')).toBe(root);
    expect(activateDockTab(root, 'missing', 'i2')).toBe(root);
  });
});

describe('dock ops: in-window panel moves', () => {
  const splitLayout = (): DockLayout => ({
    schemaVersion: 1,
    windows: [
      {
        id: 'main',
        role: 'primary',
        dockRoot: {
          kind: 'split',
          id: 'root-split',
          direction: 'row',
          ratio: 0.5,
          first: {
            kind: 'panel',
            id: 'layers-host',
            panelInstanceId: 'i1',
            panelTypeId: 'layers',
          },
          second: {
            kind: 'panel',
            id: 'inspector-host',
            panelInstanceId: 'i2',
            panelTypeId: 'inspector',
          },
        },
      },
    ],
  });

  it('moves a panel into a tab group without duplicating its instance', () => {
    const layout = splitLayout();
    const result = movePanelToHost(layout, 'i1', 'main', {
      kind: 'tab',
      targetNodeId: 'inspector-host',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const root = result.layout.windows[0]?.dockRoot;
    expect(root?.kind).toBe('tabs');
    expect(listPanelInstances(root!).map((panel) => panel.instanceId)).toEqual(['i2', 'i1']);
    expect(validateDockLayout(result.layout)).toEqual([]);
  });

  it('moves a panel before a split host while keeping the requested target share', () => {
    const result = movePanelToHost(splitLayout(), 'i2', 'main', {
      kind: 'split',
      targetNodeId: 'layers-host',
      direction: 'column',
      side: 'before',
      targetRatio: 0.65,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const root = result.layout.windows[0]?.dockRoot;
    expect(root?.kind).toBe('split');
    if (root?.kind === 'split') {
      expect(root.first.kind).toBe('panel');
      expect(root.second.kind).toBe('panel');
      expect(root.ratio).toBeCloseTo(0.35, 5);
    }
    expect(validateDockLayout(result.layout)).toEqual([]);
  });

  it('refuses host-incompatible moves and leaves the original layout untouched', () => {
    const layout: DockLayout = {
      schemaVersion: 1,
      windows: [
        {
          id: 'main',
          role: 'primary',
          dockRoot: {
            kind: 'panel',
            id: 'timeline-host',
            panelInstanceId: 'timeline-instance',
            panelTypeId: 'timeline',
          },
        },
        { id: 'aux', role: 'auxiliary-panel', dockRoot: emptyRoot() },
      ],
    };

    const result = movePanelToHost(layout, 'timeline-instance', 'aux', {
      kind: 'tab',
      targetNodeId: 'root-aux',
    });

    expect(result).toEqual({ ok: false, layout, reason: 'host-not-allowed' });
  });

  it('rejects missing targets without losing the source panel', () => {
    const layout = splitLayout();
    const result = movePanelToHost(layout, 'i1', 'main', {
      kind: 'tab',
      targetNodeId: 'absent',
    });

    expect(result).toEqual({ ok: false, layout, reason: 'target-missing' });
  });
});

describe('dock ops: removal', () => {
  it('removing the only panel leaves an empty node and returns the ref', () => {
    const root = {
      kind: 'panel' as const,
      id: 'p1',
      panelInstanceId: 'i1',
      panelTypeId: 'layers' as const,
    };
    const { tree, removed } = removePanel(root, 'i1');
    expect(tree.kind).toBe('empty');
    expect(removed?.panelTypeId).toBe('layers');
  });

  it('removing from tabs collapses single-panel groups to a panel node', () => {
    const root: DockNode = {
      kind: 'tabs',
      id: 't1',
      panels: [layers('i1'), inspector('i2')],
      activePanelInstanceId: 'i2',
    };
    const { tree, removed } = removePanel(root, 'i1');
    expect(removed?.panelTypeId).toBe('layers');
    expect(tree.kind).toBe('panel');
    if (tree.kind === 'panel') {
      expect(tree.panelInstanceId).toBe('i2');
    }
  });

  it('removing all tabs leaves an empty node', () => {
    const root: DockNode = {
      kind: 'tabs',
      id: 't1',
      panels: [layers('i1')],
      activePanelInstanceId: 'i1',
    };
    const { tree } = removePanel(root, 'i1');
    expect(tree.kind).toBe('empty');
  });

  it('removing from a split merges the surviving sibling', () => {
    const split: DockNode = {
      kind: 'split',
      id: 's1',
      direction: 'row',
      ratio: 0.5,
      first: { kind: 'panel', id: 'p1', panelInstanceId: 'i1', panelTypeId: 'layers' as const },
      second: { kind: 'panel', id: 'p2', panelInstanceId: 'i2', panelTypeId: 'inspector' as const },
    };
    const { tree } = removePanel(split, 'i1');
    expect(tree.kind).toBe('panel');
    expect(findPanelInstance(tree, 'i2')).toBeDefined();
  });
});

describe('dock ops: normalization and validation', () => {
  it('normalizeDockTree collapses splits with empty siblings', () => {
    const split: DockNode = {
      kind: 'split',
      id: 's1',
      direction: 'row',
      ratio: 0.5,
      first: { kind: 'empty', id: 'e1' },
      second: { kind: 'panel', id: 'p1', panelInstanceId: 'i1', panelTypeId: 'layers' as const },
    };
    const normalized = normalizeDockTree(split);
    expect(normalized.kind).toBe('panel');
  });

  it('normalizeDockTree collapses double-empty splits', () => {
    const split: DockNode = {
      kind: 'split',
      id: 's1',
      direction: 'row',
      ratio: 0.5,
      first: { kind: 'empty', id: 'e1' },
      second: { kind: 'empty', id: 'e2' },
    };
    expect(normalizeDockTree(split).kind).toBe('empty');
  });

  it('validateDockTree flags duplicate instances, invalid ratios, empty tabs', () => {
    const dup: DockNode = {
      kind: 'split',
      id: 's1',
      direction: 'row',
      ratio: 0.5,
      first: { kind: 'panel', id: 'p1', panelInstanceId: 'i1', panelTypeId: 'layers' as const },
      second: {
        kind: 'tabs',
        id: 't1',
        panels: [layers('i1'), inspector('i2')],
        activePanelInstanceId: 'i1',
      },
    };
    const violations = validateDockTree(dup);
    expect(violations.some((v) => v.includes('appears more than once'))).toBe(true);

    const badRatio: DockNode = {
      kind: 'split',
      id: 's1',
      direction: 'row',
      ratio: 1.5,
      first: { kind: 'panel', id: 'p1', panelInstanceId: 'i1', panelTypeId: 'layers' as const },
      second: { kind: 'panel', id: 'p2', panelInstanceId: 'i2', panelTypeId: 'inspector' as const },
    };
    expect(validateDockTree(badRatio).some((v) => v.includes('invalid ratio'))).toBe(true);

    const unknownType: DockNode = {
      kind: 'tabs',
      id: 't1',
      panels: [{ instanceId: 'i9', panelTypeId: 'not-a-panel' as never }],
    };
    expect(validateDockTree(unknownType).some((v) => v.includes('unknown type'))).toBe(true);
  });

  it('validateDockLayout flags singletons hosted twice', () => {
    const layout = {
      schemaVersion: 1,
      windows: [createWindow('primary', 'w1'), createWindow('auxiliary-panel', 'w2')],
    };
    const withA = addPanelToWindow(layout, 'w1', 'layers');
    const withB = addPanelToWindow(withA.layout, 'w2', 'layers');
    expect(validateDockLayout(withB.layout).some((v) => v.includes('singleton'))).toBe(true);
  });

  it('validates registered host permissions for each window role', () => {
    const layout = { schemaVersion: 1, windows: [createWindow('auxiliary-panel', 'w1')] };
    const withTimeline = addPanelToWindow(layout, 'w1', 'timeline');
    expect(validateDockLayout(withTimeline.layout)).toContain(
      "panel type 'timeline' cannot be hosted in auxiliary-window window 'w1'",
    );
  });

  it('computes minimum panel dimensions from registry constraints', () => {
    const sideBySide: DockNode = {
      kind: 'split',
      id: 's1',
      direction: 'row',
      ratio: 0.5,
      first: { kind: 'panel', id: 'p1', panelInstanceId: 'i1', panelTypeId: 'layers' },
      second: { kind: 'panel', id: 'p2', panelInstanceId: 'i2', panelTypeId: 'inspector' },
    };
    expect(getDockNodeMinimumSize(sideBySide)).toEqual({ width: 420, height: 160 });

    const tabs: DockNode = {
      kind: 'tabs',
      id: 't1',
      panels: [layers('i1'), inspector('i2')],
      activePanelInstanceId: 'i1',
    };
    expect(getDockNodeMinimumSize(tabs)).toEqual({ width: 240, height: 192 });
  });
});

describe('dock ops: window-set operations', () => {
  it('addPanelToWindow fills an empty root', () => {
    const layout = { schemaVersion: 1, windows: [createWindow('primary', 'w1')] };
    const { layout: next, instanceId } = addPanelToWindow(layout, 'w1', 'layers');
    expect(instanceId).toBeTruthy();
    expect(validateDockLayout(next)).toEqual([]);
  });

  it('movePanelBetweenWindows preserves the instance and normalizes the source', () => {
    const layout = {
      schemaVersion: 1,
      windows: [createWindow('primary', 'w1'), createWindow('auxiliary-panel', 'w2')],
    };
    const withA = addPanelToWindow(layout, 'w1', 'layers');
    const withB = addPanelToWindow(withA.layout, 'w1', 'inspector');
    const instanceId = withA.instanceId;

    const moved = movePanelBetweenWindows(withB.layout, instanceId, 'w2');
    expect(moved.moved).toBe(true);
    const w2 = moved.layout.windows.find((w) => w.id === 'w2');
    const w1 = moved.layout.windows.find((w) => w.id === 'w1');
    expect(findPanelInstance(w2!.dockRoot, instanceId)).toBeDefined();
    expect(findPanelInstance(w1!.dockRoot, instanceId)).toBeUndefined();
    expect(validateDockLayout(moved.layout)).toEqual([]);
  });

  it('movePanelBetweenWindows for an unknown instance is a no-op', () => {
    const layout = { schemaVersion: 1, windows: [createWindow('primary', 'w1')] };
    const result = movePanelBetweenWindows(layout, 'ghost', 'w1');
    expect(result.moved).toBe(false);
    expect(result.layout).toBe(layout);
  });

  it('movePanelBetweenWindows refuses a host forbidden by the registry', () => {
    const layout = {
      schemaVersion: 1,
      windows: [createWindow('primary', 'w1'), createWindow('auxiliary-panel', 'w2')],
    };
    const withTimeline = addPanelToWindow(layout, 'w1', 'timeline');
    const result = movePanelBetweenWindows(withTimeline.layout, withTimeline.instanceId, 'w2');
    expect(result.moved).toBe(false);
    expect(result.layout).toBe(withTimeline.layout);
  });
});

describe('dock ops: serialization', () => {
  it('serialize/deserialize round-trips a complex tree', () => {
    const root: DockNode = {
      kind: 'split',
      id: 's1',
      direction: 'row',
      ratio: 0.5,
      first: { kind: 'panel', id: 'p1', panelInstanceId: 'i1', panelTypeId: 'layers' as const },
      second: {
        kind: 'tabs',
        id: 't1',
        activePanelInstanceId: 'i3',
        panels: [inspector('i2'), { instanceId: 'i3', panelTypeId: 'library' as const }],
      },
    };
    const serialized = serializeDockTree(root);
    const result = deserializeDockTree(JSON.parse(JSON.stringify(serialized)));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        listPanelInstances(result.tree)
          .map((p) => p.instanceId)
          .sort(),
      ).toEqual(['i1', 'i2', 'i3']);
      expect(validateDockTree(result.tree)).toEqual([]);
    }
  });

  it('deserialize rejects malformed input', () => {
    expect(deserializeDockTree(null).ok).toBe(false);
    expect(deserializeDockTree(42).ok).toBe(false);
    expect(deserializeDockTree({ kind: 'warp', id: 'x' }).ok).toBe(false);
    expect(deserializeDockTree({ kind: 'panel', id: 'p1', panelInstanceId: 'i1' }).ok).toBe(false);
    expect(
      deserializeDockTree({
        kind: 'split',
        id: 's1',
        direction: 'diagonal',
        ratio: 0.5,
        first: {},
        second: {},
      }).ok,
    ).toBe(false);
    expect(
      deserializeDockTree({
        kind: 'split',
        id: 's1',
        direction: 'row',
        ratio: Number.POSITIVE_INFINITY,
        first: { kind: 'empty', id: 'e1' },
        second: { kind: 'empty', id: 'e2' },
      }).ok,
    ).toBe(false);
  });

  it('rejects layouts beyond the bounded depth and node count without recursion', () => {
    let deep: unknown = { kind: 'empty', id: 'end' };
    for (let index = 0; index < 18; index += 1) {
      deep = {
        kind: 'split',
        id: `deep-${index}`,
        direction: 'row',
        ratio: 0.5,
        first: deep,
        second: { kind: 'empty', id: `sibling-${index}` },
      };
    }
    const depthResult = deserializeDockTree(deep);
    expect(depthResult).toMatchObject({
      ok: false,
      reason: expect.stringContaining('maximum depth'),
    });

    const leaves: unknown[] = Array.from({ length: 64 }, (_, index) => ({
      kind: 'empty',
      id: `leaf-${index}`,
    }));
    let level = leaves;
    let nodeId = 0;
    while (level.length > 1) {
      const next: unknown[] = [];
      for (let index = 0; index < level.length; index += 2) {
        const first = level[index];
        const second = level[index + 1];
        if (!first || !second) continue;
        next.push({
          kind: 'split',
          id: `wide-${nodeId++}`,
          direction: 'row',
          ratio: 0.5,
          first,
          second,
        });
      }
      level = next;
    }
    const countResult = deserializeDockTree(level[0]);
    expect(countResult).toMatchObject({ ok: false, reason: expect.stringContaining('nodes') });
  });

  it('deserialize normalizes and revalidates', () => {
    const unnormalized: DockNode = {
      kind: 'split',
      id: 's1',
      direction: 'row',
      ratio: 0.5,
      first: { kind: 'empty', id: 'e1' },
      second: { kind: 'panel', id: 'p1', panelInstanceId: 'i1', panelTypeId: 'layers' as const },
    };
    const result = deserializeDockTree(unnormalized);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tree.kind).toBe('panel');
    }
  });
});

describe('dock ops: sidebar migration', () => {
  it('migrates both visible panels into a horizontal split', () => {
    const tree = migrateSidebarPreferences({
      leftPanelVisible: true,
      rightPanelVisible: true,
      leftWidth: 288,
      rightWidth: 320,
      logoPanelVisible: false,
    });
    expect(tree.kind).toBe('split');
    expect(validateDockTree(tree)).toEqual([]);
    if (tree.kind === 'split') {
      expect(listPanelInstances(tree.first)).toEqual([
        { instanceId: 'instance-layers', panelTypeId: 'layers' as const },
      ]);
      expect(listPanelInstances(tree.second)).toEqual([
        { instanceId: 'instance-inspector', panelTypeId: 'inspector' as const },
      ]);
    }
  });

  it('migrates a single visible panel without a split', () => {
    const tree = migrateSidebarPreferences({
      leftPanelVisible: false,
      rightPanelVisible: true,
      leftWidth: null,
      rightWidth: null,
      logoPanelVisible: false,
    });
    expect(tree.kind).toBe('panel');
    expect(listPanelInstances(tree)[0]?.panelTypeId).toBe('inspector');
  });

  it('migrates a fully hidden state to an empty root', () => {
    const tree = migrateSidebarPreferences({
      leftPanelVisible: false,
      rightPanelVisible: false,
      leftWidth: null,
      rightWidth: null,
      logoPanelVisible: false,
    });
    expect(tree.kind).toBe('empty');
  });

  it('null widths fall back to defaults and keep the ratio bounded', () => {
    const tree = migrateSidebarPreferences({
      leftPanelVisible: true,
      rightPanelVisible: true,
      leftWidth: null,
      rightWidth: null,
      logoPanelVisible: false,
    });
    if (tree.kind === 'split') {
      expect(tree.ratio).toBeGreaterThan(0);
      expect(tree.ratio).toBeLessThan(1);
    }
  });
});

describe('dock ops: protected central canvas', () => {
  it('creates a versioned single-window layout with a 320px canvas floor', () => {
    const layout = createDefaultDockLayout();
    expect(layout.schemaVersion).toBe(2);
    expect(validateDockLayout(layout)).toEqual([]);
    const canvas = layout.windows[0]?.dockRoot;
    expect(canvas?.kind).toBe('canvas');
    expect(canvas && getDockNodeMinimumSize(canvas)).toEqual({ width: 320, height: 240 });
  });

  it('keeps the canvas anchor when adding and moving a panel around it', () => {
    const added = addPanelToWindow(createDefaultDockLayout(), 'main', 'layers');
    expect(validateDockLayout(added.layout)).toEqual([]);

    const moved = movePanelToHost(added.layout, added.instanceId, 'main', {
      kind: 'split',
      targetNodeId: 'canvas-primary',
      direction: 'column',
      side: 'after',
      targetRatio: 0.7,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(validateDockLayout(moved.layout)).toEqual([]);
    expect(listPanelInstances(moved.layout.windows[0]!.dockRoot)).toEqual([
      { instanceId: added.instanceId, panelTypeId: 'layers' },
    ]);
  });

  it('migrates a panel-only v1 layout without losing instances and is idempotent', () => {
    const legacy: DockLayout = {
      schemaVersion: 1,
      windows: [
        {
          id: 'main',
          role: 'primary',
          dockRoot: {
            kind: 'panel',
            id: 'layers-host',
            panelInstanceId: 'legacy-layers',
            panelTypeId: 'layers',
          },
        },
      ],
    };
    const migrated = migrateDockLayoutToCanvas(legacy);
    expect(migrated.schemaVersion).toBe(2);
    expect(validateDockLayout(migrated)).toEqual([]);
    expect(listPanelInstances(migrated.windows[0]!.dockRoot)).toEqual([
      { instanceId: 'legacy-layers', panelTypeId: 'layers' },
    ]);
    expect(migrateDockLayoutToCanvas(migrated)).toBe(migrated);
  });

  it('rejects v2 primary layouts without exactly one canvas anchor', () => {
    const layout = createDefaultDockLayout();
    const invalid: DockLayout = {
      ...layout,
      windows: [
        {
          ...layout.windows[0]!,
          dockRoot: {
            kind: 'panel',
            id: 'layers-host',
            panelInstanceId: 'i-layers',
            panelTypeId: 'layers',
          },
        },
      ],
    };
    expect(validateDockLayout(invalid).join(' ')).toContain('exactly one canvas anchor');
    expect(() => migrateDockLayoutToCanvas(invalid)).toThrow('Invalid dock layout');
  });

  it('rejects duplicate canvas anchors and anchors in auxiliary windows', () => {
    const primary = createDefaultDockLayout().windows[0]!;
    const duplicate: DockLayout = {
      schemaVersion: 2,
      windows: [
        {
          ...primary,
          dockRoot: {
            kind: 'split',
            id: 'canvas-split',
            direction: 'row',
            ratio: 0.5,
            first: createCanvasNode('canvas-a'),
            second: createCanvasNode('canvas-b'),
          },
        },
      ],
    };
    expect(validateDockLayout(duplicate).join(' ')).toContain('exactly one canvas anchor');

    const auxiliaryCanvas: DockLayout = {
      schemaVersion: 2,
      windows: [
        primary,
        { id: 'aux', role: 'auxiliary-panel', dockRoot: createCanvasNode('canvas-aux') },
      ],
    };
    expect(validateDockLayout(auxiliaryCanvas).join(' ')).toContain(
      'cannot contain a canvas anchor',
    );
  });

  it('bounds canvas counting when validating cyclic object graphs', () => {
    const cycle: DockNode = {
      kind: 'split',
      id: 'cycle',
      direction: 'row',
      ratio: 0.5,
      first: createCanvasNode(),
      second: createCanvasNode('temporary'),
    };
    if (cycle.kind === 'split') cycle.second = cycle;
    const layout: DockLayout = {
      schemaVersion: 2,
      windows: [{ id: 'main', role: 'primary', dockRoot: cycle }],
    };
    expect(validateDockLayout(layout).join(' ')).toContain('contains a cycle');
  });

  it('deserializes portable layouts, migrates v1, and strips document and machine data', () => {
    const result = deserializeDockLayout({
      schemaVersion: 1,
      localPath: '/home/user/project.varve',
      windows: [
        {
          id: 'main',
          role: 'primary',
          screenX: 540,
          dockRoot: {
            kind: 'tabs',
            id: 'root-tabs',
            activePanelInstanceId: 'layers-1',
            localPath: '/tmp/window',
            panels: [
              {
                instanceId: 'layers-1',
                panelTypeId: 'layers',
                documentId: 'document-secret',
                titleOverride: 'Layer stack',
                localPath: '/tmp/panel',
              },
              { instanceId: 'inspector-1', panelTypeId: 'inspector' },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.schemaVersion).toBe(2);
    expect(validateDockLayout(result.layout)).toEqual([]);
    const portable = JSON.stringify(result.layout);
    expect(portable).not.toContain('document-secret');
    expect(portable).not.toContain('localPath');
    expect(portable).not.toContain('screenX');
    expect(result.layout.windows[0]?.dockRoot).toMatchObject({
      kind: 'split',
      first: {
        kind: 'tabs',
        panels: [
          { instanceId: 'layers-1', titleOverride: 'Layer stack' },
          { instanceId: 'inspector-1', panelTypeId: 'inspector' },
        ],
      },
      second: { kind: 'canvas' },
    });
  });

  it('rejects duplicate windows and layouts without exactly one primary canvas', () => {
    const duplicateWindows = {
      schemaVersion: 2,
      windows: [
        { id: 'main', role: 'primary', dockRoot: createCanvasNode() },
        { id: 'main', role: 'auxiliary-panel', dockRoot: emptyRoot() },
      ],
    };
    expect(deserializeDockLayout(duplicateWindows).ok).toBe(false);
    expect(deserializeDockLayout({ schemaVersion: 2, windows: [] }).ok).toBe(false);
  });
});
