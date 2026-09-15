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
  addPanelToWindow,
  addToTabGroup,
  clampRatio,
  createWindow,
  deserializeDockTree,
  findPanelInstance,
  insertBeside,
  listPanelInstances,
  migrateSidebarPreferences,
  movePanelBetweenWindows,
  normalizeDockTree,
  removePanel,
  serializeDockTree,
  splitHost,
  validateDockLayout,
  validateDockTree,
} from '../dockOps';
import type { DockNode, PanelInstanceRef } from '../dockTypes';

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
