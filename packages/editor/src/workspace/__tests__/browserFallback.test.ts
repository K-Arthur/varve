/**
 * Browser Fallback tests (M12).
 *
 * Pure unit tests for in-page dock layouts, focus mode,
 * and logical/browser layout conversion. No React, no Tauri, no DOM.
 */

import { describe, expect, it } from 'vitest';
import {
  browserToLogicalLayout,
  computeGridRegions,
  createDefaultInPageDockLayout,
  getVisibleSlots,
  hidePanel,
  logicalToBrowserLayout,
  showPanel,
  toggleFocusMode,
  togglePanelVisibility,
} from '../browserFallback';
import type { NativeWorkspaceLayout } from '../dockTypes';
import { createPanelDockNode, createSplitDockNode } from '../dockTypes';

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
    panelInstances: [
      { id: 'pi-1', panelTypeId: 'layers' as any, hostNodeId: 'h-1' },
      { id: 'pi-2', panelTypeId: 'inspector' as any, hostNodeId: 'h-2' },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Default in-page dock layout
// ---------------------------------------------------------------------------

describe('browserFallback: createDefaultInPageDockLayout', () => {
  it('creates slots for all panel instances', () => {
    const layout = createDefaultInPageDockLayout([
      { id: 'pi-1', typeId: 'layers' },
      { id: 'pi-2', typeId: 'inspector' },
      { id: 'pi-3', typeId: 'timeline' },
    ]);
    expect(layout.slots).toHaveLength(3);
  });

  it('assigns correct regions', () => {
    const layout = createDefaultInPageDockLayout([
      { id: 'pi-1', typeId: 'layers' },
      { id: 'pi-2', typeId: 'inspector' },
      { id: 'pi-3', typeId: 'timeline' },
      { id: 'pi-4', typeId: 'pagenav' },
      { id: 'pi-5', typeId: 'library' },
    ]);

    expect(layout.slots.find((s) => s.panelTypeId === 'layers')?.region).toBe('left');
    expect(layout.slots.find((s) => s.panelTypeId === 'pagenav')?.region).toBe('left');
    expect(layout.slots.find((s) => s.panelTypeId === 'inspector')?.region).toBe('right');
    expect(layout.slots.find((s) => s.panelTypeId === 'timeline')?.region).toBe('bottom');
    expect(layout.slots.find((s) => s.panelTypeId === 'library')?.region).toBe('floating');
  });

  it('first 4 panels are visible by default', () => {
    const layout = createDefaultInPageDockLayout([
      { id: 'pi-1', typeId: 'layers' },
      { id: 'pi-2', typeId: 'inspector' },
      { id: 'pi-3', typeId: 'timeline' },
      { id: 'pi-4', typeId: 'library' },
      { id: 'pi-5', typeId: 'history' },
    ]);

    const visible = layout.slots.filter((s) => s.visible);
    expect(visible).toHaveLength(4);
    expect(layout.slots[4].visible).toBe(false);
  });

  it('defaults to not in focus mode', () => {
    const layout = createDefaultInPageDockLayout([]);
    expect(layout.focusMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Focus mode
// ---------------------------------------------------------------------------

describe('browserFallback: focus mode', () => {
  it('toggles focus mode', () => {
    const layout = createDefaultInPageDockLayout([{ id: 'pi-1', typeId: 'layers' }]);
    const toggled = toggleFocusMode(layout);
    expect(toggled.focusMode).toBe(true);
    const toggledBack = toggleFocusMode(toggled);
    expect(toggledBack.focusMode).toBe(false);
  });

  it('getVisibleSlots returns all visible when not in focus mode', () => {
    const layout = createDefaultInPageDockLayout([
      { id: 'pi-1', typeId: 'layers' },
      { id: 'pi-2', typeId: 'inspector' },
    ]);
    const visible = getVisibleSlots(layout);
    expect(visible).toHaveLength(2);
  });

  it('getVisibleSlots returns empty in focus mode', () => {
    let layout = createDefaultInPageDockLayout([
      { id: 'pi-1', typeId: 'layers' },
      { id: 'pi-2', typeId: 'inspector' },
    ]);
    layout = toggleFocusMode(layout);
    expect(getVisibleSlots(layout)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Panel visibility
// ---------------------------------------------------------------------------

describe('browserFallback: panel visibility', () => {
  it('toggles panel visibility', () => {
    const layout = createDefaultInPageDockLayout([{ id: 'pi-1', typeId: 'layers' }]);
    const toggled = togglePanelVisibility(layout, 'pi-1');
    expect(toggled.slots[0].visible).toBe(false);
    const toggledBack = togglePanelVisibility(toggled, 'pi-1');
    expect(toggledBack.slots[0].visible).toBe(true);
  });

  it('showPanel sets visible and exits focus mode', () => {
    let layout = createDefaultInPageDockLayout([{ id: 'pi-1', typeId: 'layers' }]);
    layout = toggleFocusMode(layout);
    layout = showPanel(layout, 'pi-1');
    expect(layout.focusMode).toBe(false);
    expect(layout.slots[0].visible).toBe(true);
  });

  it('hidePanel sets invisible', () => {
    const layout = createDefaultInPageDockLayout([{ id: 'pi-1', typeId: 'layers' }]);
    const hidden = hidePanel(layout, 'pi-1');
    expect(hidden.slots[0].visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CSS Grid regions
// ---------------------------------------------------------------------------

describe('browserFallback: computeGridRegions', () => {
  it('computes regions for a layout with left and right panels', () => {
    const layout = createDefaultInPageDockLayout([
      { id: 'pi-1', typeId: 'layers' },
      { id: 'pi-2', typeId: 'inspector' },
    ]);

    const { regions } = computeGridRegions(layout, 1920, 1080);
    expect(regions.left.width).toBe(280);
    expect(regions.right.width).toBe(320);
    expect(regions.center.width).toBe(1920 - 280 - 320);
  });

  it('handles empty layout', () => {
    const layout = createDefaultInPageDockLayout([]);
    const { regions } = computeGridRegions(layout, 1920, 1080);
    expect(regions.center.width).toBe(1920);
    expect(regions.left.width).toBe(0);
    expect(regions.right.width).toBe(0);
  });

  it('includes bottom region when bottom panels exist', () => {
    const layout = createDefaultInPageDockLayout([{ id: 'pi-1', typeId: 'timeline' }]);

    const { regions } = computeGridRegions(layout, 1920, 1080);
    expect(regions.bottom.height).toBe(200);
    expect(regions.center.height).toBe(1080 - 200);
  });
});

// ---------------------------------------------------------------------------
// Logical <-> Browser layout conversion
// ---------------------------------------------------------------------------

describe('browserFallback: logicalToBrowserLayout', () => {
  it('converts a logical layout to browser layout', () => {
    const logical = makeLayout({
      windows: [
        {
          id: 'main',
          role: 'primary',
          dockRoot: createSplitDockNode(
            'horizontal',
            createPanelDockNode('pi-1'),
            createPanelDockNode('pi-2'),
            0.5,
          ),
          state: 'normal',
        },
      ],
      panelInstances: [
        { id: 'pi-1', panelTypeId: 'layers' as any, hostNodeId: 'h-1' },
        { id: 'pi-2', panelTypeId: 'inspector' as any, hostNodeId: 'h-2' },
      ],
    });

    const browser = logicalToBrowserLayout(logical);
    expect(browser.slots).toHaveLength(2);
    expect(browser.focusMode).toBe(false);
  });

  it('assigns floating region to auxiliary window panels', () => {
    const logical = makeLayout({
      windows: [
        {
          id: 'main',
          role: 'primary',
          dockRoot: createPanelDockNode('pi-1'),
          state: 'normal',
        },
        {
          id: 'aux-1',
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

    const browser = logicalToBrowserLayout(logical);
    const auxSlot = browser.slots.find((s) => s.panelInstanceId === 'pi-2');
    expect(auxSlot?.region).toBe('floating');
  });

  it('handles empty logical layout', () => {
    const logical = makeLayout({ windows: [], panelInstances: [] });
    const browser = logicalToBrowserLayout(logical);
    expect(browser.slots).toHaveLength(0);
  });
});

describe('browserFallback: browserToLogicalLayout', () => {
  it('converts browser layout to logical layout', () => {
    const browser = createDefaultInPageDockLayout([
      { id: 'pi-1', typeId: 'layers' },
      { id: 'pi-2', typeId: 'inspector' },
    ]);

    const logical = browserToLogicalLayout(browser);
    expect(logical.windows).toHaveLength(1);
    expect(logical.windows[0].role).toBe('primary');
    expect(logical.panelInstances).toHaveLength(2);
  });

  it('names the layout', () => {
    const browser = createDefaultInPageDockLayout([]);
    const logical = browserToLogicalLayout(browser, 'My Layout');
    expect(logical.name).toBe('My Layout');
  });

  it('defaults name to Browser Layout', () => {
    const browser = createDefaultInPageDockLayout([]);
    const logical = browserToLogicalLayout(browser);
    expect(logical.name).toBe('Browser Layout');
  });

  it('only includes visible panels', () => {
    let browser = createDefaultInPageDockLayout([
      { id: 'pi-1', typeId: 'layers' },
      { id: 'pi-2', typeId: 'inspector' },
    ]);
    browser = togglePanelVisibility(browser, 'pi-1');

    const logical = browserToLogicalLayout(browser);
    expect(logical.panelInstances).toHaveLength(1);
    expect(logical.panelInstances[0].id).toBe('pi-2');
  });

  it('excludes focus-mode-hidden panels', () => {
    let browser = createDefaultInPageDockLayout([
      { id: 'pi-1', typeId: 'layers' },
      { id: 'pi-2', typeId: 'inspector' },
    ]);
    browser = toggleFocusMode(browser);

    const logical = browserToLogicalLayout(browser);
    expect(logical.panelInstances).toHaveLength(0);
  });

  it('produces a normalized dock root', () => {
    const browser = createDefaultInPageDockLayout([
      { id: 'pi-1', typeId: 'layers' },
      { id: 'pi-2', typeId: 'inspector' },
      { id: 'pi-3', typeId: 'timeline' },
    ]);

    const logical = browserToLogicalLayout(browser);
    const root = logical.windows[0].dockRoot;
    // Should not have empty+empty splits after normalization
    expect(root.kind).not.toBe('empty');
  });
});

// ---------------------------------------------------------------------------
// Round-trip conversion
// ---------------------------------------------------------------------------

describe('browserFallback: round-trip conversion', () => {
  it('logical → browser → logical preserves panel instances', () => {
    const original = makeLayout({
      windows: [
        {
          id: 'main',
          role: 'primary',
          dockRoot: createSplitDockNode(
            'horizontal',
            createPanelDockNode('pi-1'),
            createPanelDockNode('pi-2'),
            0.5,
          ),
          state: 'normal',
        },
      ],
      panelInstances: [
        { id: 'pi-1', panelTypeId: 'layers' as any, hostNodeId: 'h-1' },
        { id: 'pi-2', panelTypeId: 'inspector' as any, hostNodeId: 'h-2' },
      ],
    });

    const browser = logicalToBrowserLayout(original);
    const roundTripped = browserToLogicalLayout(browser);

    expect(roundTripped.panelInstances).toHaveLength(2);
    const ids = roundTripped.panelInstances.map((p) => p.id).sort();
    expect(ids).toEqual(['pi-1', 'pi-2']);
  });
});
