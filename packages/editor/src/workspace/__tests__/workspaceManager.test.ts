/**
 * Workspace Manager tests (M10).
 *
 * Pure unit tests for named layout CRUD, active layout tracking,
 * captureCurrentLayout, window diagnostics, and display-aware
 * window management. No React, no Tauri, no DOM.
 */

import type { DisplayInfo } from '@varve/platform';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NativeWorkspaceLayout, WorkspaceWindowLayout } from '../dockTypes';
import { createEmptyDockNode, createPanelDockNode } from '../dockTypes';
import {
  captureCurrentLayout,
  clearActiveLayout,
  createInitialState,
  deleteNamedLayout,
  diagnoseWindows,
  fullscreenOnDisplay,
  gatherWindowsOntoDisplay,
  getActiveLayout,
  listNamedLayouts,
  loadNamedLayout,
  moveWindowToDisplay,
  primaryDisplayForLayout,
  renameNamedLayout,
  saveNamedLayout,
  setActiveLayout,
} from '../workspaceManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLayout(overrides: Partial<NativeWorkspaceLayout> = {}): NativeWorkspaceLayout {
  return {
    schemaVersion: 1,
    id: `layout-${Date.now().toString(36)}`,
    name: 'Test Layout',
    windows: [
      {
        id: 'main',
        role: 'primary',
        dockRoot: createPanelDockNode('pi-1'),
        state: 'normal',
      },
    ],
    panelInstances: [{ id: 'pi-1', panelTypeId: 'layers' as any, hostNodeId: 'h-1' }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

const DISPLAY_PRIMARY: DisplayInfo = {
  runtimeId: 'display-1',
  name: 'Primary',
  isPrimary: true,
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};

const DISPLAY_SECONDARY: DisplayInfo = {
  runtimeId: 'display-2',
  name: 'Secondary',
  isPrimary: false,
  position: { x: 1920, y: 0 },
  size: { width: 1920, height: 1080 },
  workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};

// ---------------------------------------------------------------------------
// Named layout CRUD
// ---------------------------------------------------------------------------

describe('workspaceManager: named layout CRUD', () => {
  let state: ReturnType<typeof createInitialState>;

  beforeEach(() => {
    state = createInitialState();
  });

  it('starts with no layouts', () => {
    expect(state.namedLayouts).toHaveLength(0);
    expect(state.activeLayoutId).toBeNull();
  });

  it('saves a new named layout', () => {
    const layout = makeLayout();
    const next = saveNamedLayout(state, 'My Layout', layout);
    expect(next.namedLayouts).toHaveLength(1);
    expect(next.namedLayouts[0]!.name).toBe('My Layout');
    expect(next.namedLayouts[0]!.layout.id).toBe(layout.id);
  });

  it('updates an existing layout with the same name', () => {
    const layout1 = makeLayout({ name: 'V1' });
    const layout2 = makeLayout({ name: 'V2' });
    const state1 = saveNamedLayout(state, 'My Layout', layout1);
    const state2 = saveNamedLayout(state1, 'My Layout', layout2);
    expect(state2.namedLayouts).toHaveLength(1);
    expect(state2.namedLayouts[0]!.layout.name).toBe('V2');
  });

  it('is case-insensitive on name matching', () => {
    const layout = makeLayout();
    const state1 = saveNamedLayout(state, 'My Layout', layout);
    const state2 = saveNamedLayout(state1, 'my layout', makeLayout());
    expect(state2.namedLayouts).toHaveLength(1);
  });

  it('loads a layout by id', () => {
    const layout = makeLayout();
    const next = saveNamedLayout(state, 'Test', layout);
    expect(loadNamedLayout(next, next.namedLayouts[0]!.id)).toBeDefined();
  });

  it('loads returns undefined for unknown id', () => {
    expect(loadNamedLayout(state, 'unknown')).toBeUndefined();
  });

  it('deletes a layout', () => {
    const layout = makeLayout();
    let next = saveNamedLayout(state, 'Test', layout);
    const layoutId = next.namedLayouts[0]!.id;
    next = deleteNamedLayout(next, layoutId);
    expect(next.namedLayouts).toHaveLength(0);
  });

  it('clears activeLayoutId when deleting active layout', () => {
    const layout = makeLayout();
    let next = saveNamedLayout(state, 'Test', layout);
    const layoutId = next.namedLayouts[0]!.id;
    next = setActiveLayout(next, layoutId);
    next = deleteNamedLayout(next, layoutId);
    expect(next.activeLayoutId).toBeNull();
  });

  it('renames a layout', () => {
    const layout = makeLayout();
    let next = saveNamedLayout(state, 'Old Name', layout);
    const layoutId = next.namedLayouts[0]!.id;
    next = renameNamedLayout(next, layoutId, 'New Name');
    expect(next.namedLayouts[0]!.name).toBe('New Name');
  });

  it('lists layouts sorted by name', () => {
    let next = state;
    next = saveNamedLayout(next, 'Zebra', makeLayout());
    next = saveNamedLayout(next, 'Alpha', makeLayout());
    next = saveNamedLayout(next, 'Middle', makeLayout());
    const listed = listNamedLayouts(next);
    expect(listed.map((l) => l.name)).toEqual(['Alpha', 'Middle', 'Zebra']);
  });
});

// ---------------------------------------------------------------------------
// Active layout tracking
// ---------------------------------------------------------------------------

describe('workspaceManager: active layout tracking', () => {
  let state: ReturnType<typeof createInitialState>;

  beforeEach(() => {
    state = createInitialState();
  });

  it('sets active layout', () => {
    const layout = makeLayout();
    let next = saveNamedLayout(state, 'Test', layout);
    const layoutId = next.namedLayouts[0]!.id;
    next = setActiveLayout(next, layoutId);
    expect(next.activeLayoutId).toBe(layoutId);
  });

  it('ignores unknown layout id', () => {
    const next = setActiveLayout(state, 'unknown-id');
    expect(next.activeLayoutId).toBeNull();
  });

  it('gets active layout', () => {
    const layout = makeLayout();
    let next = saveNamedLayout(state, 'Test', layout);
    const layoutId = next.namedLayouts[0]!.id;
    next = setActiveLayout(next, layoutId);
    const active = getActiveLayout(next);
    expect(active).toBeDefined();
    expect(active!.id).toBe(layout.id);
  });

  it('gets undefined when no active layout', () => {
    expect(getActiveLayout(state)).toBeUndefined();
  });

  it('clears active layout', () => {
    const layout = makeLayout();
    let next = saveNamedLayout(state, 'Test', layout);
    next = setActiveLayout(next, next.namedLayouts[0]!.id);
    next = clearActiveLayout(next);
    expect(next.activeLayoutId).toBeNull();
    expect(getActiveLayout(next)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Capture current layout
// ---------------------------------------------------------------------------

describe('workspaceManager: captureCurrentLayout', () => {
  it('captures windows and panel instances', () => {
    const windows: WorkspaceWindowLayout[] = [
      { id: 'main', role: 'primary', dockRoot: createPanelDockNode('pi-1'), state: 'normal' },
    ];
    const panels = [{ id: 'pi-1', panelTypeId: 'layers' as any, hostNodeId: 'h-1' }];

    const layout = captureCurrentLayout(windows, panels, { name: 'Snapshot' });
    expect(layout.name).toBe('Snapshot');
    expect(layout.windows).toHaveLength(1);
    expect(layout.panelInstances).toHaveLength(1);
    expect(layout.schemaVersion).toBe(1);
  });

  it('defaults name to Unnamed', () => {
    const layout = captureCurrentLayout([], []);
    expect(layout.name).toBe('Unnamed');
  });

  it('normalizes dock roots', () => {
    const windows: WorkspaceWindowLayout[] = [
      {
        id: 'main',
        role: 'primary',
        dockRoot: {
          kind: 'split',
          id: 's1',
          direction: 'horizontal',
          ratio: 0.5,
          first: { kind: 'empty', id: 'e1' },
          second: createPanelDockNode('pi-1'),
        },
        state: 'normal',
      },
    ];
    const panels = [{ id: 'pi-1', panelTypeId: 'layers' as any, hostNodeId: 'h-1' }];

    const layout = captureCurrentLayout(windows, panels);
    // Empty first child should be collapsed
    expect(layout.windows[0]!.dockRoot.kind).toBe('panel');
  });

  it('associates workspace mode', () => {
    const layout = captureCurrentLayout([], [], { workspaceMode: 'design' });
    expect(layout.workspaceMode).toBe('design');
  });
});

// ---------------------------------------------------------------------------
// Window diagnostics
// ---------------------------------------------------------------------------

describe('workspaceManager: diagnoseWindows', () => {
  it('reports per-window diagnostics', () => {
    const layout = makeLayout({
      windows: [
        { id: 'main', role: 'primary', dockRoot: createPanelDockNode('pi-1'), state: 'normal' },
        {
          id: 'aux-1',
          role: 'auxiliary-panel',
          dockRoot: createEmptyDockNode(),
          state: 'minimized',
        },
      ],
      panelInstances: [{ id: 'pi-1', panelTypeId: 'layers' as any, hostNodeId: 'h-1' }],
    });

    const diagnostics = diagnoseWindows(layout);
    expect(diagnostics).toHaveLength(2);

    const mainDiag = diagnostics.find((d) => d.windowId === 'main');
    expect(mainDiag).toBeDefined();
    expect(mainDiag!.panelCount).toBe(1);
    expect(mainDiag!.hasEmptyRoot).toBe(false);
    expect(mainDiag!.state).toBe('normal');

    const auxDiag = diagnostics.find((d) => d.windowId === 'aux-1');
    expect(auxDiag).toBeDefined();
    expect(auxDiag!.panelCount).toBe(0);
    expect(auxDiag!.hasEmptyRoot).toBe(true);
    expect(auxDiag!.state).toBe('minimized');
  });

  it('reports panel types', () => {
    const layout = makeLayout({
      windows: [
        { id: 'main', role: 'primary', dockRoot: createPanelDockNode('pi-1'), state: 'normal' },
      ],
      panelInstances: [{ id: 'pi-1', panelTypeId: 'inspector' as any, hostNodeId: 'h-1' }],
    });

    const diagnostics = diagnoseWindows(layout);
    expect(diagnostics[0]!.panelTypes).toEqual(['inspector']);
  });
});

// ---------------------------------------------------------------------------
// Display-aware window management
// ---------------------------------------------------------------------------

describe('workspaceManager: primaryDisplayForLayout', () => {
  it('finds the display with the most windows', () => {
    const layout = makeLayout({
      windows: [
        { id: 'w1', role: 'primary', dockRoot: createPanelDockNode('pi-1'), state: 'normal' },
        {
          id: 'w2',
          role: 'auxiliary-panel',
          dockRoot: createPanelDockNode('pi-2'),
          state: 'normal',
        },
      ],
      panelInstances: [
        { id: 'pi-1', panelTypeId: 'layers' as any, hostNodeId: 'h-1' },
        { id: 'pi-2', panelTypeId: 'inspector' as any, hostNodeId: 'h-2' },
      ],
    });

    const placements = [
      { windowId: 'w1', displayId: 'display-1' },
      { windowId: 'w2', displayId: 'display-1' },
    ];

    expect(primaryDisplayForLayout(layout, placements)).toBe('display-1');
  });

  it('returns undefined when no placements', () => {
    const layout = makeLayout();
    expect(primaryDisplayForLayout(layout, [])).toBeUndefined();
  });
});

describe('workspaceManager: gatherWindowsOntoDisplay', () => {
  it('returns placements for all windows', () => {
    const layout = makeLayout({
      windows: [
        { id: 'w1', role: 'primary', dockRoot: createPanelDockNode('pi-1'), state: 'normal' },
        {
          id: 'w2',
          role: 'auxiliary-panel',
          dockRoot: createPanelDockNode('pi-2'),
          state: 'normal',
        },
      ],
      panelInstances: [
        { id: 'pi-1', panelTypeId: 'layers' as any, hostNodeId: 'h-1' },
        { id: 'pi-2', panelTypeId: 'inspector' as any, hostNodeId: 'h-2' },
      ],
    });

    const placements = gatherWindowsOntoDisplay(layout, DISPLAY_PRIMARY);
    expect(placements).toHaveLength(2);
    for (const p of placements) {
      expect(p.x).toBeGreaterThanOrEqual(DISPLAY_PRIMARY.workArea.x);
      expect(p.y).toBeGreaterThanOrEqual(DISPLAY_PRIMARY.workArea.y);
    }
  });

  it('cascades windows within display bounds', () => {
    const layout = makeLayout({
      windows: Array.from({ length: 5 }, (_, i) => ({
        id: `w${i}`,
        role: 'auxiliary-panel' as const,
        dockRoot: createPanelDockNode(`pi-${i}`),
        state: 'normal' as const,
      })),
      panelInstances: Array.from({ length: 5 }, (_, i) => ({
        id: `pi-${i}`,
        panelTypeId: 'layers' as any,
        hostNodeId: `h-${i}`,
      })),
    });

    const placements = gatherWindowsOntoDisplay(layout, DISPLAY_PRIMARY);
    expect(placements).toHaveLength(5);
    // All placements should be within the display work area
    for (const p of placements) {
      expect(p.x + p.width).toBeLessThanOrEqual(
        DISPLAY_PRIMARY.workArea.x + DISPLAY_PRIMARY.workArea.width,
      );
      expect(p.y + p.height).toBeLessThanOrEqual(
        DISPLAY_PRIMARY.workArea.y + DISPLAY_PRIMARY.workArea.height,
      );
    }
  });
});

describe('workspaceManager: fullscreenOnDisplay', () => {
  it('returns work area dimensions', () => {
    const result = fullscreenOnDisplay('w1', DISPLAY_PRIMARY);
    expect(result.windowId).toBe('w1');
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1040);
  });

  it('uses secondary display work area', () => {
    const result = fullscreenOnDisplay('w1', DISPLAY_SECONDARY);
    expect(result.x).toBe(1920);
  });
});

describe('workspaceManager: moveWindowToDisplay', () => {
  it('preserves relative offset from source display', () => {
    const current = { x: 100, y: 50, width: 400, height: 300 };
    const result = moveWindowToDisplay('w1', current, DISPLAY_PRIMARY, DISPLAY_SECONDARY);
    expect(result.x).toBe(1920 + 100);
    expect(result.y).toBe(0 + 50);
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
  });

  it('clamps to target display bounds', () => {
    const current = { x: 1800, y: 900, width: 400, height: 300 };
    const result = moveWindowToDisplay('w1', current, DISPLAY_PRIMARY, DISPLAY_PRIMARY);
    expect(result.x).toBeLessThanOrEqual(1920 - 400);
    expect(result.y).toBeLessThanOrEqual(1040 - 300);
  });

  it('centers window when no current placement', () => {
    const result = moveWindowToDisplay('w1', undefined, undefined, DISPLAY_PRIMARY);
    expect(result.x).toBeGreaterThan(0);
    expect(result.y).toBeGreaterThan(0);
    expect(result.width).toBe(400);
    expect(result.height).toBe(600);
  });

  it('uses default size when no current placement', () => {
    const result = moveWindowToDisplay('w1', undefined, undefined, DISPLAY_PRIMARY);
    expect(result.width).toBe(400);
    expect(result.height).toBe(600);
  });
});
