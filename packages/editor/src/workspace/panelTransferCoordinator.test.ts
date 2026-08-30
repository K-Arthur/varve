// @vitest-environment jsdom

import { createMemoryWindowService, type NativeWindowService } from '@varve/platform';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDetachedPanels,
  markPanelReattached,
  resetDetachedPanelsStore,
} from './detachedPanelsStore';
import { registerBuiltinPanels } from './panelDefinitions';
import { resetPanelRegistry } from './panelRegistry';
import { type PanelHostBroker, PanelTransferCoordinator } from './panelTransferCoordinator';
import {
  clearPanelWindowDiagnostics,
  getPanelWindowDiagnostics,
  setPanelWindowDiagnosticsEnabledForTest,
} from './panelWindowDiagnostics';
import { TransferStateMachine } from './transferStateMachine';

interface ControlledBroker extends PanelHostBroker {
  resolveReady(): void;
  readonly requests: Array<Parameters<PanelHostBroker['reservePanelHost']>[0]>;
  readonly abort: ReturnType<typeof vi.fn>;
}

function createControlledBroker(): ControlledBroker {
  let resolve: (() => void) | undefined;
  const requests: Array<Parameters<PanelHostBroker['reservePanelHost']>[0]> = [];
  const abort = vi.fn(() => true);
  return {
    requests,
    abort,
    abortPanelHost: abort,
    reservePanelHost: vi.fn((request) => {
      requests.push(request);
      return new Promise<void>((ready) => {
        resolve = ready;
      });
    }),
    resolveReady: () => resolve?.(),
  };
}

function makeCoordinator(
  windowService: NativeWindowService,
  broker: PanelHostBroker,
  stateMachine = new TransferStateMachine(),
) {
  return new PanelTransferCoordinator({
    windowService,
    broker,
    sessionId: 'panel-session-test',
    stateMachine,
    createWindowId: () => 'panel-layers-test',
  });
}

beforeEach(() => {
  localStorage.clear();
  resetDetachedPanelsStore();
  resetPanelRegistry();
  registerBuiltinPanels();
});

describe('PanelTransferCoordinator', () => {
  it('keeps the source panel mounted until the destination hydrates, then shows and commits once', async () => {
    const service = createMemoryWindowService({ currentWindowId: 'main' });
    const broker = createControlledBroker();
    const coordinator = makeCoordinator(service, broker);
    const announce = vi.fn();

    const detaching = coordinator.detach({
      panelTypeId: 'layers',
      panelInstanceId: 'layers-main',
      sourceWindowId: 'main',
      sourceWidth: 320,
      announce,
    });
    await vi.waitFor(() => expect(broker.requests).toHaveLength(1));

    const windowId = broker.requests[0]?.windowId;
    expect(windowId).toBe('panel-layers-test');
    expect(getDetachedPanels()).toEqual([]);
    expect((await service.listWindows()).find((window) => window.id === windowId)?.visible).toBe(
      false,
    );

    broker.resolveReady();
    await expect(detaching).resolves.toMatchObject({
      status: 'detached',
      windowId: 'panel-layers-test',
    });
    expect(getDetachedPanels()).toEqual([
      expect.objectContaining({
        panelTypeId: 'layers',
        windowId: 'panel-layers-test',
        sessionId: 'panel-session-test',
      }),
    ]);
    expect((await service.listWindows()).find((window) => window.id === windowId)?.visible).toBe(
      true,
    );
    expect(announce).toHaveBeenCalledWith('Layers panel detached into a new window.');
  });

  it('rolls back window creation failures without hiding the source or leaking a reservation', async () => {
    const service: NativeWindowService = {
      capability: 'native',
      createWindow: vi.fn(async () => {
        throw new Error('native creation denied');
      }),
      closeWindow: vi.fn(async () => {}),
      focusWindow: vi.fn(async () => {}),
      showWindow: vi.fn(async () => {}),
      hideWindow: vi.fn(async () => {}),
      getCurrentWindow: vi.fn(),
      listWindows: vi.fn(async () => []),
      listMonitors: vi.fn(async () => []),
      getWindowPlacement: vi.fn(async () => null),
      setWindowPlacement: vi.fn(async () => {}),
      listenToWindowEvents: vi.fn(async () => () => {}),
    };
    const broker = createControlledBroker();
    const focusSource = vi.fn();
    const coordinator = makeCoordinator(service, broker);

    await expect(
      coordinator.detach({
        panelTypeId: 'layers',
        panelInstanceId: 'layers-main',
        sourceWindowId: 'main',
        focusSource,
      }),
    ).rejects.toMatchObject({ code: 'destination-failed' });

    expect(getDetachedPanels()).toEqual([]);
    expect(broker.abort).toHaveBeenCalledTimes(1);
    expect(focusSource).toHaveBeenCalledTimes(1);
  });

  it('is idempotent for an already-detached singleton panel', async () => {
    const service = createMemoryWindowService({ currentWindowId: 'main' });
    const existing = await service.createWindow({
      id: 'panel-existing',
      title: 'Layers — Varve',
      size: { width: 320, height: 480 },
    });
    const broker = createControlledBroker();
    const coordinator = makeCoordinator(service, broker);

    // Commit through a first completed transaction to keep the test on the
    // public store boundary rather than inserting internal records.
    const first = coordinator.detach({
      panelTypeId: 'layers',
      panelInstanceId: 'layers-main',
      sourceWindowId: 'main',
    });
    await vi.waitFor(() => expect(broker.requests).toHaveLength(1));
    broker.resolveReady();
    await first;
    const result = await coordinator.detach({
      panelTypeId: 'layers',
      panelInstanceId: 'layers-main',
      sourceWindowId: 'main',
    });

    expect(existing.id).toBe('panel-existing');
    expect(result).toMatchObject({ status: 'already-detached', windowId: 'panel-layers-test' });
    expect(broker.requests).toHaveLength(1);
  });

  it('fails a concurrent duplicate detach through the normal rollback and announcement path', async () => {
    const service = createMemoryWindowService({ currentWindowId: 'main' });
    const broker = createControlledBroker();
    const coordinator = makeCoordinator(service, broker);
    const focusSource = vi.fn();
    const announce = vi.fn();

    const first = coordinator.detach({
      panelTypeId: 'layers',
      panelInstanceId: 'layers-main',
      sourceWindowId: 'main',
    });
    await vi.waitFor(() => expect(broker.requests).toHaveLength(1));

    await expect(
      coordinator.detach({
        panelTypeId: 'layers',
        panelInstanceId: 'layers-main',
        sourceWindowId: 'main',
        focusSource,
        announce,
      }),
    ).rejects.toMatchObject({ code: 'invalid-transfer-state' });
    expect(focusSource).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      'Panel detachment failed; the Layers panel remains docked.',
    );
    expect(getDetachedPanels()).toEqual([]);

    broker.resolveReady();
    await expect(first).resolves.toMatchObject({ status: 'detached' });
  });

  it('does not create a window after an immediately rejected reservation', async () => {
    const service: NativeWindowService = {
      capability: 'native',
      createWindow: vi.fn(async () => {
        throw new Error('must not allocate a window');
      }),
      closeWindow: vi.fn(async () => {}),
      focusWindow: vi.fn(async () => {}),
      showWindow: vi.fn(async () => {}),
      hideWindow: vi.fn(async () => {}),
      getCurrentWindow: vi.fn(),
      listWindows: vi.fn(async () => []),
      listMonitors: vi.fn(async () => []),
      getWindowPlacement: vi.fn(async () => null),
      setWindowPlacement: vi.fn(async () => {}),
      listenToWindowEvents: vi.fn(async () => () => {}),
    };
    const abort = vi.fn(() => false);
    const broker: PanelHostBroker = {
      reservePanelHost: vi.fn(() => Promise.reject(new Error('primary session closed'))),
      abortPanelHost: abort,
    };
    const focusSource = vi.fn();
    const coordinator = makeCoordinator(service, broker);

    await expect(
      coordinator.detach({
        panelTypeId: 'layers',
        panelInstanceId: 'layers-main',
        sourceWindowId: 'main',
        focusSource,
      }),
    ).rejects.toThrow('primary session closed');

    expect(service.createWindow).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledTimes(1);
    expect(focusSource).toHaveBeenCalledTimes(1);
    expect(getDetachedPanels()).toEqual([]);
  });

  it('uses the panel preferred width when a collapsed source header measures narrower', async () => {
    const service = createMemoryWindowService({ currentWindowId: 'main' });
    const broker = createControlledBroker();
    const coordinator = makeCoordinator(service, broker);

    const detaching = coordinator.detach({
      panelTypeId: 'layers',
      panelInstanceId: 'layers-main',
      sourceWindowId: 'main',
      sourceWidth: 0,
    });
    await vi.waitFor(() => expect(broker.requests).toHaveLength(1));
    broker.resolveReady();
    await detaching;

    await expect(service.getWindowPlacement('panel-layers-test')).resolves.toMatchObject({
      logicalSize: { width: 288, height: 480 },
    });
  });

  it('records a bounded detach lifecycle without transferring panel state into diagnostics', async () => {
    setPanelWindowDiagnosticsEnabledForTest(true);
    clearPanelWindowDiagnostics();
    const service = createMemoryWindowService({ currentWindowId: 'main' });
    const broker = createControlledBroker();
    const coordinator = makeCoordinator(service, broker);

    const detaching = coordinator.detach({
      panelTypeId: 'layers',
      panelInstanceId: 'layers-main',
      sourceWindowId: 'main',
    });
    await vi.waitFor(() => expect(broker.requests).toHaveLength(1));
    broker.resolveReady();
    await detaching;

    const events = getPanelWindowDiagnostics();
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'detach-requested',
        'destination-host-reserved',
        'destination-window-create-started',
        'destination-window-created',
        'panel-hydrated',
        'source-removal-committed',
        'focus-requested',
        'focus-confirmed',
      ]),
    );
    expect(events.every((event) => !Object.hasOwn(event, 'snapshot'))).toBe(true);
    setPanelWindowDiagnosticsEnabledForTest(null);
    clearPanelWindowDiagnostics();
  });

  it('leaves no live window or transaction after 100 detach/reattach cycles', async () => {
    const service = createMemoryWindowService({ currentWindowId: 'main' });
    const stateMachine = new TransferStateMachine();
    let counter = 0;
    for (let index = 0; index < 100; index += 1) {
      const broker: PanelHostBroker = {
        reservePanelHost: vi.fn(async () => {}),
        abortPanelHost: vi.fn(() => true),
      };
      const coordinator = new PanelTransferCoordinator({
        windowService: service,
        broker,
        sessionId: 'panel-session-test',
        stateMachine,
        createWindowId: () => `panel-cycle-${++counter}`,
      });
      const result = await coordinator.detach({
        panelTypeId: 'layers',
        panelInstanceId: 'layers-main',
        sourceWindowId: 'main',
      });
      markPanelReattached('layers');
      await service.closeWindow(result.windowId);
    }

    expect(getDetachedPanels()).toEqual([]);
    expect(await service.listWindows()).toHaveLength(1);
    expect(stateMachine.list()).toEqual([]);
  });
});
