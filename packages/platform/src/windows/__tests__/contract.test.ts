/**
 * NativeWindowService contract tests (ADR-0042 L1/L2).
 *
 * The same behavioral contract runs against the memory, browser, and
 * (mocked) Tauri implementations: capability reporting, window identity,
 * monitor enumeration, event unsubscription, close behavior, geometry
 * clamping, unsupported-operation errors, and no silent no-ops.
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserWindowService } from '../browser';
import {
  createMemoryWindowService,
  type MemoryDisplayFixture,
  type MemoryWindowService,
} from '../memory';
import type { NativeWindowService, WorkspaceWindowEvent } from '../types';
import { UnsupportedOperationError } from '../types';

// ---------------------------------------------------------------------------
// Shared contract
// ---------------------------------------------------------------------------

function describeWindowContract(
  name: string,
  factory: () => NativeWindowService,
  kind: 'native' | 'single-window' | 'browser-popup',
) {
  describe(`window service contract: ${name}`, () => {
    let service: NativeWindowService;
    let events: WorkspaceWindowEvent[];

    beforeEach(() => {
      service = factory();
      events = [];
    });

    it('reports its capability honestly', () => {
      expect(service.capability).toBe(kind);
    });

    it('getCurrentWindow returns a stable window identity', async () => {
      const info = await service.getCurrentWindow();
      expect(info.id).toBeTruthy();
      expect(info.label).toBeTruthy();
      const again = await service.getCurrentWindow();
      expect(again.id).toBe(info.id);
    });

    it('listMonitors returns at least one display with finite geometry', async () => {
      const displays = await service.listMonitors();
      expect(displays.length).toBeGreaterThan(0);
      for (const display of displays) {
        expect(Number.isFinite(display.size.width)).toBe(true);
        expect(Number.isFinite(display.position.x)).toBe(true);
        expect(display.scaleFactor).toBeGreaterThan(0);
      }
    });

    it('listenToWindowEvents returns a working unsubscribe', async () => {
      const unsubscribe = await service.listenToWindowEvents((event) => events.push(event));
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });
  });
}

// ---------------------------------------------------------------------------
// Memory service specifics
// ---------------------------------------------------------------------------

describeWindowContract(
  'memory',
  () => createMemoryWindowService({ currentWindowId: 'main' }),
  'native',
);

describe('memory window service: native behaviors', () => {
  let service: MemoryWindowService;
  let events: WorkspaceWindowEvent[];

  beforeEach(() => {
    service = createMemoryWindowService({ currentWindowId: 'main' }) as MemoryWindowService;
    events = [];
  });

  it('creates windows hidden, shows them on demand, and closes them', async () => {
    const created = await service.createWindow({
      title: 'Panels',
      size: { width: 400, height: 600 },
      minSize: { width: 240, height: 160 },
    });
    expect(created.visible).toBe(false);
    expect(created.label.startsWith('varve-w-')).toBe(true);

    await service.showWindow(created.id);
    const shown = (await service.listWindows()).find((w) => w.id === created.id);
    expect(shown?.visible).toBe(true);

    await service.closeWindow(created.id);
    expect((await service.listWindows()).find((w) => w.id === created.id)).toBeUndefined();
  });

  it('cannot close the current window through the service', async () => {
    await expect(service.closeWindow('main')).rejects.toThrow(/current window/);
  });

  it('emits lifecycle events and unsubscribes cleanly', async () => {
    const unsubscribe = await service.listenToWindowEvents((event) => events.push(event));
    const created = await service.createWindow({ title: 'P', size: { width: 300, height: 200 } });
    await service.focusWindow(created.id);
    await service.closeWindow(created.id);
    expect(events.some((e) => e.type === 'created' && e.windowId === created.id)).toBe(true);
    expect(events.some((e) => e.type === 'focused' && e.windowId === created.id)).toBe(true);
    expect(events.some((e) => e.type === 'closed' && e.windowId === created.id)).toBe(true);

    events = [];
    unsubscribe();
    await service.createWindow({ title: 'P2', size: { width: 300, height: 200 } });
    expect(events).toEqual([]);
  });

  it('simulates window disappearance for recovery tests', async () => {
    const unsubscribe = await service.listenToWindowEvents((event) => events.push(event));
    const created = await service.createWindow({ title: 'P', size: { width: 300, height: 200 } });
    service.simulateWindowDisappearance(created.id);
    expect(events.some((e) => e.type === 'closed' && e.windowId === created.id)).toBe(true);
    expect((await service.listWindows()).find((w) => w.id === created.id)).toBeUndefined();
    unsubscribe();
  });

  it('clamps placement into the primary display work area', async () => {
    const created = await service.createWindow({ title: 'P', size: { width: 400, height: 300 } });
    await service.setWindowPlacement(created.id, {
      displayId: 'display-primary',
      logicalPosition: { x: 99999, y: 99999 },
      logicalSize: { width: 400, height: 300 },
      state: 'normal',
    });
    const placement = await service.getWindowPlacement(created.id);
    expect(placement?.logicalPosition.x).toBeLessThanOrEqual(1920 - 400);
    expect(placement?.logicalPosition.y).toBeLessThanOrEqual(1080 - 300);
  });

  it('enforces the window limit', async () => {
    const limited = createMemoryWindowService({ currentWindowId: 'main', maxWindows: 3 });
    await limited.createWindow({ title: 'A', size: { width: 300, height: 200 } });
    await limited.createWindow({ title: 'B', size: { width: 300, height: 200 } });
    await expect(
      limited.createWindow({ title: 'C', size: { width: 300, height: 200 } }),
    ).rejects.toThrow(/window limit/);
  });

  it('emits monitors-changed on fixture replacement (hot-plug simulation)', async () => {
    const unsubscribe = await service.listenToWindowEvents((event) => events.push(event));
    const fixture: MemoryDisplayFixture[] = [
      {
        runtimeId: 'single',
        name: 'Single',
        isPrimary: true,
        position: { x: 0, y: 0 },
        size: { width: 1280, height: 720 },
        scaleFactor: 1,
      },
    ];
    service.setMonitorFixture(fixture);
    expect(events.some((e) => e.type === 'monitors-changed')).toBe(true);
    expect(await service.listMonitors()).toHaveLength(1);
    unsubscribe();
  });

  it('getWindowPlacement returns null for unknown windows', async () => {
    expect(await service.getWindowPlacement('ghost')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Browser service specifics
// ---------------------------------------------------------------------------

describeWindowContract('browser', () => createBrowserWindowService(), 'browser-popup');

describe('browser window service: honest popup capability (ADR-0034)', () => {
  it('reports popup capability in a windowed runtime', () => {
    const service = createBrowserWindowService();
    expect(service.capability).toBe('browser-popup');
  });

  it('reports single-window capability when popups are disabled', () => {
    const service = createBrowserWindowService(false);
    expect(service.capability).toBe('single-window');
  });

  it('never silently no-ops native operations when popups are disabled', async () => {
    const service = createBrowserWindowService(false);
    await expect(
      service.createWindow({ title: 'x', size: { width: 300, height: 200 } }),
    ).rejects.toThrow(UnsupportedOperationError);
    await expect(service.closeWindow('anything')).rejects.toThrow(UnsupportedOperationError);
    await expect(service.focusWindow('anything')).rejects.toThrow(UnsupportedOperationError);
    await expect(
      service.setWindowPlacement('anything', {
        logicalPosition: { x: 0, y: 0 },
        logicalSize: { width: 300, height: 200 },
        state: 'normal',
      }),
    ).rejects.toThrow(UnsupportedOperationError);
  });

  it('degrades honestly when the popup is blocked at open time', async () => {
    const service = createBrowserWindowService();
    await expect(
      service.createWindow({ title: 'x', size: { width: 300, height: 200 } }),
    ).rejects.toThrow(UnsupportedOperationError);
  });

  it('reports the single current window', async () => {
    const service = createBrowserWindowService(false);
    const windows = await service.listWindows();
    expect(windows).toHaveLength(1);
    expect(windows[0]?.id).toBe('main');
  });
});

// ---------------------------------------------------------------------------
// Tauri service specifics (mocked global)
// ---------------------------------------------------------------------------

describe('tauri window service: native behaviors', () => {
  let service: NativeWindowService;
  let createdLabels: string[];
  let closedLabels: string[];
  let listeners: Array<() => void>;

  beforeEach(() => {
    createdLabels = [];
    closedLabels = [];
    listeners = [];

    const makeWindowLike = (label: string) => {
      const state = {
        visible: false,
        focused: false,
        position: { x: 0, y: 0 },
        size: { width: 400, height: 300 },
      };
      return {
        label,
        title: 'Varve',
        setTitle: vi.fn(async () => {}),
        setPosition: vi.fn(async (p: unknown) => {
          state.position = p as { x: number; y: number };
        }),
        setSize: vi.fn(async (s: unknown) => {
          state.size = s as { width: number; height: number };
        }),
        setMinSize: vi.fn(async () => {}),
        setFocus: vi.fn(async () => {}),
        show: vi.fn(async () => {
          state.visible = true;
        }),
        hide: vi.fn(async () => {
          state.visible = false;
        }),
        close: vi.fn(async () => {
          closedLabels.push(label);
        }),
        isVisible: vi.fn(async () => state.visible),
        isFocused: vi.fn(async () => state.focused),
        isMinimized: vi.fn(async () => false),
        isMaximized: vi.fn(async () => false),
        isFullscreen: vi.fn(async () => false),
        outerPosition: vi.fn(async () => state.position),
        outerSize: vi.fn(async () => state.size),
        currentMonitor: vi.fn(async () => ({
          name: 'Primary',
          size: { width: 1920, height: 1080 },
          position: { x: 0, y: 0 },
          scaleFactor: 1,
        })),
        onMoved: vi.fn(async () => {
          const unlisten = () => {};
          listeners.push(unlisten);
          return unlisten;
        }),
        onResized: vi.fn(async () => {
          const unlisten = () => {};
          listeners.push(unlisten);
          return unlisten;
        }),
        onFocusChanged: vi.fn(async () => {
          const unlisten = () => {};
          listeners.push(unlisten);
          return unlisten;
        }),
        onScaleChanged: vi.fn(async () => {
          const unlisten = () => {};
          listeners.push(unlisten);
          return unlisten;
        }),
        onCloseRequested: vi.fn(async () => {
          const unlisten = () => {};
          listeners.push(unlisten);
          return unlisten;
        }),
      };
    };

    const allWindows = new Map<string, ReturnType<typeof makeWindowLike>>();
    const main = makeWindowLike('main');
    main.show();
    allWindows.set('main', main);

    (window as unknown as { __TAURI__?: Record<string, unknown> }).__TAURI__ = {
      window: {
        // Vitest 4: `new WebviewWindow(...)` requires a constructible mock.
        WebviewWindow: vi.fn(function WebviewWindowMock(
          label: string,
          options: Record<string, unknown>,
        ) {
          const created = makeWindowLike(label);
          createdLabels.push(label);
          if (options.visible === true) created.show();
          allWindows.set(label, created);
          return created;
        }),
        getCurrentWindow: () => main,
        getAllWindows: () => [...allWindows.values()],
        availableMonitors: async () => [
          {
            name: 'Primary',
            size: { width: 1920, height: 1080 },
            position: { x: 0, y: 0 },
            scaleFactor: 1,
          },
          {
            name: 'Secondary',
            size: { width: 1920, height: 1080 },
            position: { x: 1920, y: 0 },
            scaleFactor: 1,
          },
        ],
        currentMonitor: async () => ({
          name: 'Primary',
          size: { width: 1920, height: 1080 },
          position: { x: 0, y: 0 },
          scaleFactor: 1,
        }),
        primaryMonitor: async () => ({
          name: 'Primary',
          size: { width: 1920, height: 1080 },
          position: { x: 0, y: 0 },
          scaleFactor: 1,
        }),
      },
    };
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  });

  it('creates windows with sanitized labels and application routes', async () => {
    const { TauriWindowService } = await import('../tauri');
    service = new TauriWindowService();
    const created = await service.createWindow({
      title: 'Layers',
      size: { width: 400, height: 600 },
      route: '?surface=panel-window&windowId=abc',
    });
    expect(created.label).toMatch(/^varve-w-[a-z0-9-]{1,12}$/);
    expect(createdLabels).toContain(created.label);
  });

  it('refuses non-application routes', async () => {
    const { TauriWindowService } = await import('../tauri');
    service = new TauriWindowService();
    await expect(
      service.createWindow({
        title: 'Bad',
        size: { width: 300, height: 200 },
        route: 'https://evil.example/x',
      }),
    ).rejects.toThrow(/refusing non-application route/);
    await expect(
      service.createWindow({
        title: 'Bad2',
        size: { width: 300, height: 200 },
        route: 'javascript://alert(1)',
      }),
    ).rejects.toThrow(/refusing non-application route/);
  });

  it('lists the main window plus created windows with stable identities', async () => {
    const { TauriWindowService } = await import('../tauri');
    service = new TauriWindowService();
    const created = await service.createWindow({ title: 'P', size: { width: 400, height: 600 } });
    const windows = await service.listWindows();
    expect(windows.length).toBe(2);
    const createdInfo = windows.find((w) => w.id === created.id);
    expect(createdInfo?.label).toBe(created.label);
  });

  it('closes windows through the native close call', async () => {
    const { TauriWindowService } = await import('../tauri');
    service = new TauriWindowService();
    const created = await service.createWindow({ title: 'P', size: { width: 400, height: 600 } });
    await service.closeWindow(created.id);
    expect(closedLabels).toContain(created.label);
  });

  it('maps monitors into the normalized DisplayInfo model', async () => {
    const { TauriWindowService } = await import('../tauri');
    service = new TauriWindowService();
    const monitors = await service.listMonitors();
    expect(monitors).toHaveLength(2);
    expect(monitors[0]?.isPrimary).toBe(true);
    expect(monitors[0]?.size.width).toBe(1920);
    expect(monitors[1]?.name).toBe('Secondary');
  });
});
