/**
 * Native detached-panel placement tests. These exercise machine-local bounds,
 * display-topology recovery, migration, and the single-panel window policy.
 */
import type { DisplayInfo } from '@varve/platform';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPanelPlacement,
  clearPanelPlacements,
  gatherPanelPlacementsOntoDisplay,
  loadPanelPlacement,
  loadPanelPlacements,
  PANEL_PLACEMENT_SCHEMA_VERSION,
  preparePanelPlacementRecord,
  reconcilePanelPlacements,
  restorePanelPlacement,
  savePanelPlacement,
} from '../panelWindowPlacement';

const DISPLAY_PRIMARY: DisplayInfo = {
  runtimeId: 'display-1',
  name: 'Primary',
  isPrimary: true,
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};

const DISPLAY_HIDPI_LEFT: DisplayInfo = {
  runtimeId: 'display-left-old',
  name: 'Studio Display',
  isPrimary: false,
  position: { x: -3840, y: 0 },
  size: { width: 3840, height: 2160 },
  workArea: { x: -3840, y: 0, width: 3840, height: 2080 },
  scaleFactor: 2,
};

const DISPLAY_HIDPI_LEFT_CHANGED: DisplayInfo = {
  runtimeId: 'display-left-new',
  name: 'Studio Display',
  isPrimary: false,
  position: { x: -3000, y: 0 },
  size: { width: 3000, height: 1800 },
  workArea: { x: -3000, y: 0, width: 3000, height: 1740 },
  scaleFactor: 1.5,
};
describe('panelWindowPlacement: per-panel placement persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes a versioned envelope and stores monitor-relative bounds when a display is supplied', () => {
    savePanelPlacement(
      {
        panelTypeId: 'layers',
        windowId: 'browser-popup-1',
        logicalPosition: { x: -1440, y: 240 },
        logicalSize: { width: 480, height: 600 },
        state: 'normal',
        updatedAt: 1,
      },
      { display: DISPLAY_HIDPI_LEFT, displays: [DISPLAY_PRIMARY, DISPLAY_HIDPI_LEFT] },
    );

    const stored = JSON.parse(localStorage.getItem('varve-panel-placements') ?? '{}');
    expect(stored.schemaVersion).toBe(PANEL_PLACEMENT_SCHEMA_VERSION);
    expect(stored.records).toHaveLength(1);

    const loaded = loadPanelPlacement('layers');
    expect(loaded).not.toBeNull();
    expect(loaded!.schemaVersion).toBe(PANEL_PLACEMENT_SCHEMA_VERSION);
    expect(loaded!.displayId).toBe('display-left-old');
    expect(loaded!.displayFingerprint?.relativeRole).toBe('left');
    expect(loaded!.normalizedBounds).toEqual({
      x: 0.25,
      y: 240 / 1040,
      width: 0.25,
      height: 600 / 1040,
    });
  });

  it('later saves replace earlier ones for the same panel', () => {
    savePanelPlacement({
      panelTypeId: 'layers',
      windowId: 'w1',
      logicalPosition: { x: 0, y: 0 },
      logicalSize: { width: 320, height: 480 },
      state: 'normal',
      updatedAt: 1,
    });
    savePanelPlacement({
      panelTypeId: 'layers',
      windowId: 'w2',
      logicalPosition: { x: 50, y: 60 },
      logicalSize: { width: 400, height: 600 },
      state: 'normal',
      updatedAt: 2,
    });
    const all = loadPanelPlacements();
    expect(all).toHaveLength(1);
    expect(all[0]!.windowId).toBe('w2');
    expect(all[0]!.schemaVersion).toBe(PANEL_PLACEMENT_SCHEMA_VERSION);
  });

  it('returns null for unknown panel', () => {
    expect(loadPanelPlacement('nope')).toBeNull();
  });

  it('clearPanelPlacement removes the record', () => {
    savePanelPlacement({
      panelTypeId: 'layers',
      windowId: 'w1',
      logicalPosition: { x: 0, y: 0 },
      logicalSize: { width: 320, height: 480 },
      state: 'normal',
      updatedAt: 1,
    });
    clearPanelPlacement('layers');
    expect(loadPanelPlacement('layers')).toBeNull();
    expect(JSON.parse(localStorage.getItem('varve-panel-placements') ?? '{}').schemaVersion).toBe(
      PANEL_PLACEMENT_SCHEMA_VERSION,
    );
  });

  it('clearPanelPlacements retains a current empty schema envelope', () => {
    savePanelPlacement({
      panelTypeId: 'layers',
      windowId: 'w1',
      logicalPosition: { x: 0, y: 0 },
      logicalSize: { width: 320, height: 480 },
      state: 'normal',
      updatedAt: 1,
    });
    savePanelPlacement({
      panelTypeId: 'inspector',
      windowId: 'w2',
      logicalPosition: { x: 20, y: 20 },
      logicalSize: { width: 360, height: 560 },
      state: 'normal',
      updatedAt: 2,
    });

    clearPanelPlacements();

    expect(loadPanelPlacements()).toEqual([]);
    expect(JSON.parse(localStorage.getItem('varve-panel-placements') ?? '{}')).toEqual({
      schemaVersion: PANEL_PLACEMENT_SCHEMA_VERSION,
      records: [],
    });
  });

  it('migrates legacy bare-array and v1 envelope formats without trusting invalid geometry', () => {
    localStorage.setItem(
      'varve-panel-placements',
      JSON.stringify([
        {
          panelTypeId: 'layers',
          windowId: 'old-popup',
          logicalPosition: { x: 100, y: 200 },
          logicalSize: { width: 320, height: 480 },
          state: 'normal',
          updatedAt: 1,
        },
        {
          panelTypeId: 'invalid',
          windowId: 'bad-popup',
          logicalPosition: { x: 'not-a-number', y: 0 },
          logicalSize: { width: 320, height: 480 },
          state: 'normal',
          updatedAt: 2,
        },
      ]),
    );

    const records = loadPanelPlacements();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      schemaVersion: PANEL_PLACEMENT_SCHEMA_VERSION,
      panelTypeId: 'layers',
      windowId: 'old-popup',
    });
    expect(records[0]!.normalizedBounds).toBeUndefined();

    localStorage.setItem(
      'varve-panel-placements',
      JSON.stringify({ schemaVersion: 1, records: [records[0]] }),
    );
    expect(loadPanelPlacements()).toMatchObject([
      { schemaVersion: PANEL_PLACEMENT_SCHEMA_VERSION },
    ]);
  });

  it('keeps the newest duplicate record for each panel', () => {
    localStorage.setItem(
      'varve-panel-placements',
      JSON.stringify([
        {
          panelTypeId: 'layers',
          windowId: 'old',
          logicalPosition: { x: 0, y: 0 },
          logicalSize: { width: 320, height: 480 },
          state: 'normal',
          updatedAt: 1,
        },
        {
          panelTypeId: 'layers',
          windowId: 'new',
          logicalPosition: { x: 20, y: 30 },
          logicalSize: { width: 400, height: 500 },
          state: 'normal',
          updatedAt: 2,
        },
      ]),
    );

    expect(loadPanelPlacements()).toMatchObject([{ windowId: 'new' }]);
  });

  it('survives corrupt storage and rejects an unknown future envelope', () => {
    localStorage.setItem('varve-panel-placements', 'not json');
    expect(loadPanelPlacements()).toEqual([]);
    expect(loadPanelPlacement('layers')).toBeNull();

    localStorage.setItem(
      'varve-panel-placements',
      JSON.stringify({ schemaVersion: 99, records: [] }),
    );
    expect(loadPanelPlacements()).toEqual([]);
  });

  it('keeps a future envelope instead of overwriting it with a v2 store', () => {
    const future = JSON.stringify({ schemaVersion: 99, records: [{ windowId: 'future' }] });
    localStorage.setItem('varve-panel-placements', future);

    savePanelPlacement({
      panelTypeId: 'layers',
      windowId: 'panel-layers',
      logicalPosition: { x: 0, y: 0 },
    });
    expect(localStorage.getItem('varve-panel-placements')).toBe(future);

    clearPanelPlacement('layers');
    expect(localStorage.getItem('varve-panel-placements')).toBe(future);
  });
});

describe('panelWindowPlacement: panel placement recovery', () => {
  function savedHiDpiPanel() {
    return preparePanelPlacementRecord(
      {
        panelTypeId: 'layers',
        windowId: 'panel-layers',
        logicalPosition: { x: -1440, y: 240 },
        logicalSize: { width: 480, height: 600 },
        state: 'normal',
        updatedAt: 10,
      },
      { display: DISPLAY_HIDPI_LEFT, displays: [DISPLAY_PRIMARY, DISPLAY_HIDPI_LEFT] },
    )!;
  }

  it('restores normalized bounds after a mixed-DPI display changes runtime id, scale, and resolution', () => {
    const restored = restorePanelPlacement(savedHiDpiPanel(), [
      DISPLAY_PRIMARY,
      DISPLAY_HIDPI_LEFT_CHANGED,
    ]);

    expect(restored).not.toBeNull();
    expect(restored!.display.runtimeId).toBe('display-left-new');
    expect(restored!.source).toBe('normalized');
    // New logical work area: x=-2000, width=2000, height=1160.
    expect(restored!.placement.logicalPosition.x).toBe(-1500);
    expect(restored!.placement.logicalPosition.y).toBeCloseTo(267.6923076923077);
    expect(restored!.placement.logicalSize.width).toBe(500);
    expect(restored!.placement.logicalSize.height).toBeCloseTo(669.2307692307693);
    expect(restored!.placement.displayId).toBe('display-left-new');
  });

  it('falls back to the current primary display when the saved monitor is gone', () => {
    const restored = restorePanelPlacement(savedHiDpiPanel(), [DISPLAY_PRIMARY]);

    expect(restored).not.toBeNull();
    expect(restored!.display.runtimeId).toBe('display-1');
    expect(restored!.placement.logicalPosition.x).toBeGreaterThanOrEqual(
      DISPLAY_PRIMARY.workArea.x,
    );
    expect(restored!.placement.logicalPosition.y).toBeGreaterThanOrEqual(
      DISPLAY_PRIMARY.workArea.y,
    );
    expect(
      restored!.placement.logicalPosition.x + restored!.placement.logicalSize.width,
    ).toBeLessThanOrEqual(DISPLAY_PRIMARY.workArea.x + DISPLAY_PRIMARY.workArea.width);
  });

  it('uses and clamps legacy logical geometry when no normalized bounds exist', () => {
    const restored = restorePanelPlacement(
      {
        panelTypeId: 'layers',
        windowId: 'old-popup',
        logicalPosition: { x: 99999, y: -99999 },
        logicalSize: { width: 99999, height: 99999 },
        state: 'normal',
        updatedAt: 1,
      },
      [DISPLAY_PRIMARY],
    );

    expect(restored?.source).toBe('legacy');
    expect(restored?.placement.logicalPosition).toEqual({ x: 0, y: 0 });
    expect(restored?.placement.logicalSize).toEqual({ width: 1920, height: 1040 });
  });

  it('clamps stale maximized geometry before restoring the requested window state', () => {
    const restored = restorePanelPlacement(
      {
        panelTypeId: 'layers',
        windowId: 'old-popup',
        logicalPosition: { x: 99999, y: -99999 },
        logicalSize: { width: 99999, height: 99999 },
        state: 'maximized',
        updatedAt: 1,
      },
      [DISPLAY_PRIMARY],
    );

    expect(restored?.placement.state).toBe('maximized');
    expect(restored?.placement.logicalPosition).toEqual({ x: 0, y: 0 });
    expect(restored?.placement.logicalSize).toEqual({ width: 1920, height: 1040 });
  });

  it('reconciles valid records, filters corrupt entries, and refreshes recovered metadata', () => {
    const records = reconcilePanelPlacements(
      [
        savedHiDpiPanel(),
        {
          panelTypeId: 'inspector',
          windowId: 'invalid',
          logicalPosition: { x: Number.NaN, y: 0 },
          logicalSize: { width: 320, height: 480 },
          state: 'normal',
          updatedAt: 1,
        },
      ],
      [DISPLAY_PRIMARY, DISPLAY_HIDPI_LEFT_CHANGED],
    );

    expect(records).toHaveLength(1);
    expect(records[0]!.display.runtimeId).toBe('display-left-new');
    expect(records[0]!.record.displayId).toBe('display-left-new');
    expect(records[0]!.record.normalizedBounds).toBeDefined();
    expect(records[0]!.record.schemaVersion).toBe(PANEL_PLACEMENT_SCHEMA_VERSION);
  });

  it('builds a reachable cascaded bulk-gather plan on a target display', () => {
    const layers = savedHiDpiPanel();
    const inspector = {
      ...layers,
      panelTypeId: 'inspector',
      windowId: 'panel-inspector',
      updatedAt: 11,
    };
    const gathered = gatherPanelPlacementsOntoDisplay([layers, inspector], DISPLAY_PRIMARY);

    expect(gathered).toHaveLength(2);
    expect(gathered.map((item) => item.placement.displayId)).toEqual(['display-1', 'display-1']);
    expect(gathered[0]!.placement.logicalPosition).not.toEqual(
      gathered[1]!.placement.logicalPosition,
    );
    for (const item of gathered) {
      expect(item.placement.logicalPosition.x).toBeGreaterThanOrEqual(0);
      expect(item.placement.logicalPosition.y).toBeGreaterThanOrEqual(0);
      expect(
        item.placement.logicalPosition.x + item.placement.logicalSize.width,
      ).toBeLessThanOrEqual(1920);
      expect(
        item.placement.logicalPosition.y + item.placement.logicalSize.height,
      ).toBeLessThanOrEqual(1040);
      expect(item.record.normalizedBounds).toBeDefined();
    }
  });
});
