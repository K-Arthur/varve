// @vitest-environment jsdom

import { createMemoryWindowService, type NativeWindowService } from '@varve/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDetachedPanels,
  markPanelDetached,
  resetDetachedPanelsStore,
} from './detachedPanelsStore';
import {
  clearPanelWindowDiagnostics,
  getPanelWindowDiagnostics,
  setPanelWindowDiagnosticsEnabledForTest,
} from './panelWindowDiagnostics';
import { bringAllPanelsToCurrentDisplay, resetPanelWindowLayout } from './panelWindowRecovery';
import { resetSessionBroker } from './sessionBroker';
import { loadPanelPlacements, savePanelPlacement } from './workspaceManager';

const SESSION_ID = 'panel-session-recovery-test';

beforeEach(() => {
  localStorage.clear();
  resetDetachedPanelsStore();
  resetSessionBroker();
  setPanelWindowDiagnosticsEnabledForTest(true);
  clearPanelWindowDiagnostics();
});

afterEach(() => {
  resetSessionBroker();
  setPanelWindowDiagnosticsEnabledForTest(null);
  clearPanelWindowDiagnostics();
});

function memoryService(): ReturnType<typeof createMemoryWindowService> {
  return createMemoryWindowService({ currentWindowId: 'main' });
}

function closeFailingService(
  service: ReturnType<typeof createMemoryWindowService>,
  failedWindowId: string,
): NativeWindowService {
  return {
    capability: service.capability,
    createWindow: service.createWindow.bind(service),
    closeWindow: (windowId) =>
      windowId === failedWindowId
        ? Promise.reject(new Error('compositor refused close'))
        : service.closeWindow(windowId),
    focusWindow: service.focusWindow.bind(service),
    showWindow: service.showWindow.bind(service),
    hideWindow: service.hideWindow.bind(service),
    getCurrentWindow: service.getCurrentWindow.bind(service),
    listWindows: service.listWindows.bind(service),
    listMonitors: service.listMonitors.bind(service),
    getWindowPlacement: service.getWindowPlacement.bind(service),
    setWindowPlacement: service.setWindowPlacement.bind(service),
    listenToWindowEvents: service.listenToWindowEvents.bind(service),
  };
}

describe('panelWindowRecovery', () => {
  it('brings a just-detached panel to the primary display before placement persistence exists', async () => {
    const service = memoryService();
    await service.createWindow({
      id: 'panel-layers-recovery',
      title: 'Layers — Varve',
      size: { width: 320, height: 480 },
      placement: {
        displayId: 'display-secondary',
        logicalPosition: { x: 2048, y: 80 },
        logicalSize: { width: 320, height: 480 },
        state: 'minimized',
      },
    });
    markPanelDetached('layers', 'layers-main', 'panel-layers-recovery', SESSION_ID);
    expect(loadPanelPlacements()).toEqual([]);

    const announce = vi.fn();
    await expect(
      bringAllPanelsToCurrentDisplay({ windowService: service, sessionId: SESSION_ID, announce }),
    ).resolves.toEqual({ requested: 1, completed: 1, failed: 0 });

    const placement = await service.getWindowPlacement('panel-layers-recovery');
    expect(placement).toMatchObject({ displayId: 'display-primary', state: 'normal' });
    expect(placement?.logicalPosition.x).toBeGreaterThanOrEqual(0);
    expect(placement?.logicalPosition.x).toBeLessThan(1920);
    expect(
      (await service.listWindows()).find((window) => window.id === 'panel-layers-recovery'),
    ).toMatchObject({ visible: true });
    expect(loadPanelPlacements()).toMatchObject([
      { panelTypeId: 'layers', windowId: 'panel-layers-recovery', displayId: 'display-primary' },
    ]);
    expect(announce).toHaveBeenCalledWith('Brought 1 panel window to this display.');
    expect(getPanelWindowDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'placement-applied',
          panelTypeId: 'layers',
          windowId: 'panel-layers-recovery',
          result: 'recovery',
        }),
        expect.objectContaining({
          type: 'layout-persisted',
          panelTypeId: 'layers',
          windowId: 'panel-layers-recovery',
          result: 'recovery',
        }),
      ]),
    );
  });

  it('reattaches live panels and clears only panel-window placement state on reset', async () => {
    const service = memoryService();
    await service.createWindow({
      id: 'panel-layers-reset',
      title: 'Layers — Varve',
      size: { width: 320, height: 480 },
    });
    markPanelDetached('layers', 'layers-main', 'panel-layers-reset', SESSION_ID);
    savePanelPlacement({
      panelTypeId: 'layers',
      windowId: 'panel-layers-reset',
      logicalPosition: { x: 100, y: 80 },
      logicalSize: { width: 320, height: 480 },
      state: 'normal',
      updatedAt: 1,
    });
    localStorage.setItem('varve-workspace-layout', 'preserve-this-separate-layout-state');

    const result = await resetPanelWindowLayout({ windowService: service, sessionId: SESSION_ID });

    expect(result).toEqual({ requested: 1, completed: 1, failed: 0 });
    expect(await service.getWindowPlacement('panel-layers-reset')).toBeNull();
    expect(getDetachedPanels()).toEqual([]);
    expect(loadPanelPlacements()).toEqual([]);
    expect(JSON.parse(localStorage.getItem('varve-panel-placements') ?? '{}')).toMatchObject({
      schemaVersion: 2,
      records: [],
    });
    expect(localStorage.getItem('varve-workspace-layout')).toBe(
      'preserve-this-separate-layout-state',
    );
    expect(getPanelWindowDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'auxiliary-close-requested',
          panelTypeId: 'layers',
          windowId: 'panel-layers-reset',
          result: 'reset',
        }),
        expect.objectContaining({
          type: 'host-cleanup-completed',
          panelTypeId: 'layers',
          windowId: 'panel-layers-reset',
          result: 'reset',
        }),
      ]),
    );
  });

  it('keeps a panel record and placement when only that auxiliary window cannot close', async () => {
    const memory = memoryService();
    await memory.createWindow({
      id: 'panel-layers-reset-ok',
      title: 'Layers — Varve',
      size: { width: 320, height: 480 },
    });
    await memory.createWindow({
      id: 'panel-inspector-reset-fail',
      title: 'Inspector — Varve',
      size: { width: 360, height: 560 },
    });
    markPanelDetached('layers', 'layers-main', 'panel-layers-reset-ok', SESSION_ID);
    markPanelDetached('inspector', 'inspector-main', 'panel-inspector-reset-fail', SESSION_ID);
    savePanelPlacement({
      panelTypeId: 'layers',
      windowId: 'panel-layers-reset-ok',
      logicalPosition: { x: 20, y: 20 },
      logicalSize: { width: 320, height: 480 },
      state: 'normal',
      updatedAt: 1,
    });
    savePanelPlacement({
      panelTypeId: 'inspector',
      windowId: 'panel-inspector-reset-fail',
      logicalPosition: { x: 40, y: 40 },
      logicalSize: { width: 360, height: 560 },
      state: 'normal',
      updatedAt: 2,
    });

    const result = await resetPanelWindowLayout({
      windowService: closeFailingService(memory, 'panel-inspector-reset-fail'),
      sessionId: SESSION_ID,
    });

    expect(result).toEqual({ requested: 2, completed: 1, failed: 1 });
    expect(getDetachedPanels()).toEqual([
      expect.objectContaining({ panelTypeId: 'inspector', windowId: 'panel-inspector-reset-fail' }),
    ]);
    expect(loadPanelPlacements()).toEqual([
      expect.objectContaining({ panelTypeId: 'inspector', windowId: 'panel-inspector-reset-fail' }),
    ]);
    expect(getPanelWindowDiagnostics()).toContainEqual(
      expect.objectContaining({
        type: 'layout-persistence-failed',
        panelTypeId: 'inspector',
        windowId: 'panel-inspector-reset-fail',
        errorCode: 'reset-close-failed',
      }),
    );
  });
});
