import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPanelWindowDiagnostics,
  getPanelWindowDiagnostics,
  PANEL_WINDOW_DIAGNOSTICS_MAX_EVENTS,
  recordPanelWindowDiagnostic,
  resetPanelWindowDiagnosticsForTest,
  setPanelWindowDiagnosticsEnabledForTest,
} from './panelWindowDiagnostics';

afterEach(() => {
  resetPanelWindowDiagnosticsForTest();
});

describe('panelWindowDiagnostics', () => {
  it('is opt-in and records only bounded, safe lifecycle metadata', () => {
    setPanelWindowDiagnosticsEnabledForTest(false);
    recordPanelWindowDiagnostic({ type: 'detach-requested', panelTypeId: 'layers' });
    expect(getPanelWindowDiagnostics()).toEqual([]);

    setPanelWindowDiagnosticsEnabledForTest(true);
    recordPanelWindowDiagnostic({
      type: 'detach-requested',
      transactionId: 'tx-42',
      panelTypeId: 'layers',
      panelInstanceId: 'layers-primary',
      sourceWindowId: 'main',
      destinationWindowId: 'panel-42',
      sessionId: 'panel-session-42',
      protocolVersion: 1,
      generation: 2,
      lifecyclePhase: 'preparing-source',
      logicalBounds: { x: -120, y: 48, width: 320, height: 480 },
      // Free-form content cannot become an event field by accident.
      result: 'document name /home/private.varve',
    });

    expect(getPanelWindowDiagnostics()).toEqual([
      expect.objectContaining({
        type: 'detach-requested',
        transactionId: 'tx-42',
        panelTypeId: 'layers',
        logicalBounds: { x: -120, y: 48, width: 320, height: 480 },
      }),
    ]);
    expect(getPanelWindowDiagnostics()[0]?.result).toBeUndefined();
  });

  it('keeps a bounded in-memory ring and never persists diagnostic records', () => {
    setPanelWindowDiagnosticsEnabledForTest(true);
    for (let index = 0; index < PANEL_WINDOW_DIAGNOSTICS_MAX_EVENTS + 3; index += 1) {
      recordPanelWindowDiagnostic({
        type: 'window-moved',
        windowId: `panel-${index}`,
        logicalBounds: { x: index, y: 0, width: 240, height: 160 },
      });
    }

    const events = getPanelWindowDiagnostics();
    expect(events).toHaveLength(PANEL_WINDOW_DIAGNOSTICS_MAX_EVENTS);
    expect(events[0]).toEqual(expect.objectContaining({ windowId: 'panel-3' }));

    clearPanelWindowDiagnostics();
    expect(getPanelWindowDiagnostics()).toEqual([]);
  });
});
