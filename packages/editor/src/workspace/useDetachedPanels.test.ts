// @vitest-environment jsdom

import { createMemoryWindowService, type NativeWindowService } from '@varve/platform';
import { beforeEach, describe, expect, it } from 'vitest';
import { markPanelDetached, resetDetachedPanelsStore } from './detachedPanelsStore';
import {
  clearPanelWindowDiagnostics,
  getPanelWindowDiagnostics,
  setPanelWindowDiagnosticsEnabledForTest,
} from './panelWindowDiagnostics';
import { reconcileDetachedPanelWindowTopology } from './useDetachedPanels';
import { savePanelPlacement } from './workspaceManager';

type MutableMemoryWindowService = NativeWindowService & {
  setMonitorFixture(
    fixtures: Array<{
      runtimeId: string;
      name?: string;
      isPrimary: boolean;
      position: { x: number; y: number };
      size: { width: number; height: number };
      workArea?: { x: number; y: number; width: number; height: number };
      scaleFactor: number;
    }>,
  ): void;
};

describe('detached panel topology reconciliation', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDetachedPanelsStore();
  });

  it('moves a live detached host onto the surviving logical work area after its display disappears', async () => {
    setPanelWindowDiagnosticsEnabledForTest(true);
    clearPanelWindowDiagnostics();
    const service = createMemoryWindowService({
      currentWindowId: 'main',
      monitors: [
        {
          runtimeId: 'primary-old',
          name: 'Laptop',
          isPrimary: true,
          position: { x: 0, y: 0 },
          size: { width: 1920, height: 1080 },
          scaleFactor: 1,
        },
        {
          runtimeId: 'external-old',
          name: 'Studio Display',
          isPrimary: false,
          position: { x: -3840, y: 0 },
          size: { width: 3840, height: 2160 },
          scaleFactor: 2,
        },
      ],
    }) as MutableMemoryWindowService;
    const sessionId = 'panel-session-topology';
    await service.createWindow({
      id: 'panel-layers-topology',
      title: 'Layers — Varve',
      size: { width: 320, height: 480 },
    });
    markPanelDetached('layers', 'layers-primary', 'panel-layers-topology', sessionId);

    const oldDisplays = await service.listMonitors();
    const oldExternal = oldDisplays.find((display) => display.runtimeId === 'external-old');
    if (!oldExternal) throw new Error('expected external fixture display');
    savePanelPlacement(
      {
        panelTypeId: 'layers',
        windowId: 'panel-layers-topology',
        displayId: oldExternal.runtimeId,
        logicalPosition: { x: -1600, y: 140 },
        logicalSize: { width: 320, height: 480 },
        state: 'maximized',
        updatedAt: 1,
      },
      { display: oldExternal, displays: oldDisplays },
    );

    service.setMonitorFixture([
      {
        runtimeId: 'primary-new',
        name: 'Laptop',
        isPrimary: true,
        position: { x: 0, y: 0 },
        size: { width: 1440, height: 900 },
        workArea: { x: 0, y: 24, width: 1440, height: 836 },
        scaleFactor: 1.25,
      },
    ]);
    const newDisplays = await service.listMonitors();

    await reconcileDetachedPanelWindowTopology(service, sessionId, newDisplays);

    const restored = await service.getWindowPlacement('panel-layers-topology');
    expect(restored).toMatchObject({ displayId: 'primary-new', state: 'maximized' });
    expect(restored?.logicalPosition.x).toBeGreaterThanOrEqual(0);
    expect(restored?.logicalPosition.y).toBeGreaterThanOrEqual(24);
    expect(restored?.logicalPosition.x).toBeLessThan(1440);
    expect(restored?.logicalPosition.y).toBeLessThan(860);
    expect(getPanelWindowDiagnostics().map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'topology-reconciliation-started',
        'placement-applied',
        'layout-persisted',
        'topology-reconciled',
      ]),
    );
    setPanelWindowDiagnosticsEnabledForTest(null);
    clearPanelWindowDiagnostics();
  });
});
