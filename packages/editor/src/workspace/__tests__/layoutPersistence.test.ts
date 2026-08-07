/**
 * Layout persistence tests (ADR-0210).
 *
 * Tests logical layout save/load, migration from current settings,
 * export/import, and monitor-aware restoration.
 */

import type { DisplayInfo } from '@varve/platform';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NativeWorkspaceLayout } from '../dockTypes';
import type { MachinePlacement } from '../layoutPersistence';
import {
  exportLogicalLayout,
  importLogicalLayout,
  loadLastKnownGoodLayout,
  loadLogicalLayout,
  loadMachinePlacements,
  migrateFromCurrentSettings,
  restoreLayoutAgainstMonitors,
  saveLogicalLayout,
  saveMachinePlacements,
} from '../layoutPersistence';

const TEST_LAYOUT: NativeWorkspaceLayout = {
  schemaVersion: 1,
  id: 'test-layout',
  name: 'Test Layout',
  windows: [
    {
      id: 'main',
      role: 'primary',
      dockRoot: { kind: 'empty', id: 'dn-1' },
      state: 'normal',
    },
  ],
  panelInstances: [{ id: 'pi-1', panelTypeId: 'layers' as any, hostNodeId: 'h-1' }],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const TEST_DISPLAYS: DisplayInfo[] = [
  {
    runtimeId: 'display-1',
    name: 'Primary',
    isPrimary: true,
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1,
  },
  {
    runtimeId: 'display-2',
    name: 'Secondary',
    isPrimary: false,
    position: { x: 1920, y: 0 },
    size: { width: 1920, height: 1080 },
    workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1,
  },
];

describe('layoutPersistence: logical layout round-trip', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and loads a layout', () => {
    saveLogicalLayout(TEST_LAYOUT);
    const loaded = loadLogicalLayout();
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe('test-layout');
    expect(loaded!.windows).toHaveLength(1);
  });

  it('returns null when no layout is saved', () => {
    expect(loadLogicalLayout()).toBeNull();
  });

  it('survives corrupt JSON', () => {
    localStorage.setItem('varve-workspace-layout', '{bad json');
    expect(loadLogicalLayout()).toBeNull();
  });

  it('saves last-known-good separately', () => {
    saveLogicalLayout(TEST_LAYOUT);
    const lastGood = loadLastKnownGoodLayout();
    expect(lastGood).toBeDefined();
    expect(lastGood!.id).toBe('test-layout');
  });
});

describe('layoutPersistence: machine placements', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and loads placements', () => {
    const placements: MachinePlacement[] = [
      {
        windowId: 'main',
        logicalPosition: { x: 0, y: 0 },
        logicalSize: { width: 1280, height: 800 },
        state: 'normal',
      },
    ];
    saveMachinePlacements(placements);
    const loaded = loadMachinePlacements();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!. windowId).toBe('main');
  });

  it('returns empty for corrupt data', () => {
    localStorage.setItem('varve-window-placements', 'not json');
    expect(loadMachinePlacements()).toEqual([]);
  });
});

describe('layoutPersistence: migration from current settings', () => {
  it('creates a two-panel layout when both panels visible', () => {
    const layout = migrateFromCurrentSettings({
      leftPanelVisible: true,
      rightPanelVisible: true,
      leftPanelWidth: 280,
      rightPanelWidth: 320,
      workspaceMode: 'design',
    });

    expect(layout.windows).toHaveLength(1);
    expect(layout.panelInstances).toHaveLength(2);
    expect(layout.windows[0]!.dockRoot.kind).toBe('split');
    expect(layout.workspaceMode).toBe('design');
  });

  it('creates a single-panel layout when only left visible', () => {
    const layout = migrateFromCurrentSettings({
      leftPanelVisible: true,
      rightPanelVisible: false,
      leftPanelWidth: 280,
      rightPanelWidth: 320,
      workspaceMode: 'design',
    });

    expect(layout.panelInstances).toHaveLength(1);
    expect(layout.panelInstances[0]!. panelTypeId).toBe('layers');
  });

  it('creates a single-panel layout when only right visible', () => {
    const layout = migrateFromCurrentSettings({
      leftPanelVisible: false,
      rightPanelVisible: true,
      leftPanelWidth: 280,
      rightPanelWidth: 320,
      workspaceMode: 'design',
    });

    expect(layout.panelInstances).toHaveLength(1);
    expect(layout.panelInstances[0]!. panelTypeId).toBe('inspector');
  });

  it('creates an empty layout when no panels visible', () => {
    const layout = migrateFromCurrentSettings({
      leftPanelVisible: false,
      rightPanelVisible: false,
      leftPanelWidth: 280,
      rightPanelWidth: 320,
      workspaceMode: 'design',
    });

    expect(layout.panelInstances).toHaveLength(0);
    expect(layout.windows[0]!.dockRoot.kind).toBe('empty');
  });
});

describe('layoutPersistence: restore against monitors', () => {
  it('restores windows with no saved placements to primary display', () => {
    const result = restoreLayoutAgainstMonitors(TEST_LAYOUT, [], TEST_DISPLAYS);
    expect(result.placements).toHaveLength(1);
    expect(result.placements[0]!. displayId).toBe('display-1');
  });

  it('restores windows to matched displays when fingerprint is available', () => {
    const placements: MachinePlacement[] = [
      {
        windowId: 'main',
        displayFingerprint: {
          name: 'Secondary',
          resolution: { width: 1920, height: 1080 },
          scaleFactor: 1,
          relativeRole: 'right',
        },
        logicalPosition: { x: 2000, y: 100 },
        logicalSize: { width: 400, height: 600 },
        state: 'normal',
      },
    ];

    const result = restoreLayoutAgainstMonitors(TEST_LAYOUT, placements, TEST_DISPLAYS);
    expect(result.placements).toHaveLength(1);
    // Should be clamped to the secondary display's work area
    expect(result.placements[0]!. logicalPosition.x).toBeGreaterThanOrEqual(1920);
  });
});

describe('layoutPersistence: export/import', () => {
  it('export strips machine-specific placement data', () => {
    const layoutWithPlacement: NativeWorkspaceLayout = {
      ...TEST_LAYOUT,
      windows: [
        {
          ...TEST_LAYOUT.windows[0]!,
          placement: {
            logicalPosition: { x: 0, y: 0 },
            logicalSize: { width: 1280, height: 800 },
            state: 'normal' as const,
          },
        },
      ],
    };

    const exported = exportLogicalLayout(layoutWithPlacement);
    const parsed = JSON.parse(exported);
    expect(parsed.windows[0]!. placement).toBeUndefined();
  });

  it('import round-trips through export', () => {
    const exported = exportLogicalLayout(TEST_LAYOUT);
    const imported = importLogicalLayout(exported);
    expect(imported).toBeDefined();
    expect(imported!.id).toBe('test-layout');
  });

  it('import returns null for invalid JSON', () => {
    expect(importLogicalLayout('not json')).toBeNull();
  });
});
