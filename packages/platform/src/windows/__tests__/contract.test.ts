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

  it('preserves transaction identity in the browser popup route', async () => {
    const opened = {
      close: vi.fn(),
      focus: vi.fn(),
      screenX: 20,
      screenY: 30,
      outerWidth: 320,
      outerHeight: 480,
    } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(opened);
    const service = createBrowserWindowService();

    await service.createWindow({
      id: 'panel_layers_123',
      title: 'Layers — Varve',
      size: { width: 320, height: 480 },
      route:
        '?surface=panel-window&windowId=panel_layers_123&session=session_123&panels=layers&transaction=tx_123&panelInstanceId=layers_primary',
    });

    const route = String(open.mock.calls[0]?.[0]);
    expect(route).toContain('windowId=panel_layers_123');
    expect(route).toContain('session=session_123');
    expect(route).toContain('transaction=tx_123');
    expect(route).toContain('panelInstanceId=layers_primary');
    open.mockRestore();
  });

  it('rejects browser popup routes with foreign or unbounded query data', async () => {
    const service = createBrowserWindowService();
    await expect(
      service.createWindow({
        id: 'panel_layers_123',
        title: 'Layers — Varve',
        size: { width: 320, height: 480 },
        route:
          '?surface=panel-window&windowId=panel_layers_123&redirect=https%3A%2F%2Fevil.example',
      }),
    ).rejects.toThrow(/refusing .*application route/);
    await expect(
      service.createWindow({
        id: 'panel_layers_123',
        title: 'Layers — Varve',
        size: { width: 320, height: 480 },
        route: '?surface=panel-window&windowId=panel_layers_123#https://evil.example',
      }),
    ).rejects.toThrow(/refusing .*application route/);
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
  let creationOptions: Array<{ label: string; options: Record<string, unknown> }>;
  let positions: Map<string, unknown>;
  let sizes: Map<string, unknown>;
  let omitInstanceCurrentMonitor: boolean;
  let nativeWindows: Map<
    string,
    {
      maximize: ReturnType<typeof vi.fn>;
      unmaximize: ReturnType<typeof vi.fn>;
      minimize: ReturnType<typeof vi.fn>;
      unminimize: ReturnType<typeof vi.fn>;
      setFullscreen: ReturnType<typeof vi.fn>;
    }
  >;

  beforeEach(() => {
    createdLabels = [];
    closedLabels = [];
    listeners = [];
    creationOptions = [];
    positions = new Map();
    sizes = new Map();
    omitInstanceCurrentMonitor = false;
    nativeWindows = new Map();

    const primaryMonitor = {
      name: 'Primary',
      size: { width: 2560, height: 1440 },
      position: { x: -2560, y: 0 },
      workArea: {
        position: { x: -2560, y: 40 },
        size: { width: 2560, height: 1360 },
      },
      scaleFactor: 2,
    };
    const secondaryMonitor = {
      name: 'Secondary',
      size: { width: 1920, height: 1080 },
      position: { x: 0, y: 0 },
      workArea: {
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1040 },
      },
      scaleFactor: 1,
    };

    const makeWindowLike = (label: string) => {
      let closeRequested: ((event: { preventDefault(): void }) => void) | undefined;
      const state = {
        visible: false,
        focused: false,
        minimized: false,
        maximized: false,
        fullscreen: false,
        position: { x: 0, y: 0 },
        size: { width: 400, height: 300 },
      };
      return {
        label,
        title: 'Varve',
        setTitle: vi.fn(async () => {}),
        setPosition: vi.fn(async (p: unknown) => {
          positions.set(label, p);
          const position = p as { x: number; y: number };
          state.position = {
            x: position.x * primaryMonitor.scaleFactor,
            y: position.y * primaryMonitor.scaleFactor,
          };
        }),
        setSize: vi.fn(async (s: unknown) => {
          sizes.set(label, s);
          const size = s as { width: number; height: number };
          state.size = {
            width: size.width * primaryMonitor.scaleFactor,
            height: size.height * primaryMonitor.scaleFactor,
          };
        }),
        setMinSize: vi.fn(async () => {}),
        setFocus: vi.fn(async () => {}),
        show: vi.fn(async () => {
          state.visible = true;
        }),
        hide: vi.fn(async () => {
          state.visible = false;
        }),
        minimize: vi.fn(async () => {
          state.minimized = true;
        }),
        unminimize: vi.fn(async () => {
          state.minimized = false;
        }),
        maximize: vi.fn(async () => {
          state.maximized = true;
        }),
        unmaximize: vi.fn(async () => {
          state.maximized = false;
        }),
        setFullscreen: vi.fn(async (fullscreen: boolean) => {
          state.fullscreen = fullscreen;
        }),
        close: vi.fn(async () => {
          closedLabels.push(label);
          closeRequested?.({ preventDefault() {} });
        }),
        isVisible: vi.fn(async () => state.visible),
        isFocused: vi.fn(async () => state.focused),
        isMinimized: vi.fn(async () => state.minimized),
        isMaximized: vi.fn(async () => state.maximized),
        isFullscreen: vi.fn(async () => state.fullscreen),
        outerPosition: vi.fn(async () => state.position),
        outerSize: vi.fn(async () => state.size),
        currentMonitor: omitInstanceCurrentMonitor ? undefined : vi.fn(async () => primaryMonitor),
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
        onCloseRequested: vi.fn(async (handler: (event: { preventDefault(): void }) => void) => {
          closeRequested = handler;
          const unlisten = () => {};
          listeners.push(unlisten);
          return unlisten;
        }),
        once: vi.fn(async (event: 'tauri://created' | 'tauri://error', handler: () => void) => {
          const unlisten = () => {};
          listeners.push(unlisten);
          if (event === 'tauri://created') queueMicrotask(handler);
          return unlisten;
        }),
      };
    };

    const allWindows = new Map<string, ReturnType<typeof makeWindowLike>>();
    const main = makeWindowLike('main');
    main.show();
    nativeWindows.set('main', main);
    allWindows.set('main', main);

    (window as unknown as { __TAURI__?: Record<string, unknown> }).__TAURI__ = {
      webviewWindow: {
        // Tauri 2 exposes WebviewWindow and async webview enumeration here.
        WebviewWindow: vi.fn(function WebviewWindowMock(
          label: string,
          options: Record<string, unknown>,
        ) {
          const created = makeWindowLike(label);
          nativeWindows.set(label, created);
          creationOptions.push({ label, options });
          createdLabels.push(label);
          if (options.visible === true) created.show();
          allWindows.set(label, created);
          return created;
        }),
        getCurrentWebviewWindow: () => main,
        getAllWebviewWindows: async () => [...allWindows.values()],
      },
      window: {
        getCurrentWindow: () => main,
        getAllWindows: async () => [...allWindows.values()],
        availableMonitors: async () => [primaryMonitor, secondaryMonitor],
        primaryMonitor: async () => primaryMonitor,
      },
      dpi: {
        LogicalPosition: class LogicalPosition {
          type = 'Logical';
          constructor(
            public x: number,
            public y: number,
          ) {}
        },
        LogicalSize: class LogicalSize {
          type = 'Logical';
          constructor(
            public width: number,
            public height: number,
          ) {}
        },
      },
    };
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  });

  it('creates windows with a caller-owned canonical identity and application route', async () => {
    const { TauriWindowService } = await import('../tauri');
    service = new TauriWindowService();
    const created = await service.createWindow({
      id: 'panel_layers_123',
      title: 'Layers',
      size: { width: 400, height: 600 },
      route: '?surface=panel-window&windowId=panel_layers_123',
    });
    expect(created.id).toBe('panel_layers_123');
    expect(created.label).toMatch(/^varve-w-[a-z0-9-]{1,12}$/);
    expect(createdLabels).toContain(created.label);
    expect(creationOptions[0]?.options.url).toContain('windowId=panel_layers_123');
    expect(creationOptions[0]?.options.visible).toBe(false);
    expect(creationOptions[0]?.options.decorations).toBe(true);
  });

  it('does not require currentMonitor on a Tauri 2 WebviewWindow instance', async () => {
    // Tauri 2 exports currentMonitor from the window module; WebviewWindow
    // instances in the live desktop runtime do not expose that method.
    omitInstanceCurrentMonitor = true;
    const { TauriWindowService } = await import('../tauri');
    service = new TauriWindowService();

    const created = await service.createWindow({
      id: 'panel_layers_no_instance_monitor',
      title: 'Layers',
      size: { width: 400, height: 600 },
      route: '?surface=panel-window&windowId=panel_layers_no_instance_monitor',
    });

    expect(created.placement?.logicalSize).toEqual({ width: 400, height: 300 });
    expect(created.monitor?.name).toBe('Secondary');
    await expect(service.getWindowPlacement(created.id)).resolves.toMatchObject({
      logicalSize: { width: 400, height: 300 },
    });
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
    ).rejects.toThrow(/refusing .*application route/);
    await expect(
      service.createWindow({
        title: 'Bad2',
        size: { width: 300, height: 200 },
        route: 'javascript://alert(1)',
      }),
    ).rejects.toThrow(/refusing .*application route/);
  });

  it('requires a bounded canonical panel route for native auxiliary webviews', async () => {
    const { TauriWindowService } = await import('../tauri');
    service = new TauriWindowService();
    await expect(
      service.createWindow({
        id: 'panel_layers_123',
        title: 'Bad query',
        size: { width: 300, height: 200 },
        route: '?surface=panel-window&windowId=panel_layers_123&windowId=other',
      }),
    ).rejects.toThrow(/refusing .*application route/);
    await expect(
      service.createWindow({
        id: 'panel_layers_123',
        title: 'Hash route',
        size: { width: 300, height: 200 },
        route: '?surface=panel-window&windowId=panel_layers_123#https://evil.example',
      }),
    ).rejects.toThrow(/refusing .*application route/);
    await expect(
      service.createWindow({
        id: 'panel_layers_123',
        title: 'Unsafe metadata',
        size: { width: 300, height: 200 },
        route: '?surface=panel-window&windowId=panel_layers_123&session=%3Cscript%3E',
      }),
    ).rejects.toThrow(/refusing .*application route/);
  });

  it('refuses a route whose panel identity disagrees with the requested identity', async () => {
    const { TauriWindowService } = await import('../tauri');
    service = new TauriWindowService();
    await expect(
      service.createWindow({
        id: 'panel_one',
        title: 'Mismatch',
        size: { width: 300, height: 200 },
        route: '?surface=panel-window&windowId=panel_two',
      }),
    ).rejects.toThrow(/does not match requested window identity/);
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

  it('uses Tauri logical DPI values for logical placement operations', async () => {
    const { TauriWindowService } = await import('../tauri');
    service = new TauriWindowService();
    const created = await service.createWindow({ title: 'P', size: { width: 400, height: 600 } });
    const displays = await service.listMonitors();
    await service.setWindowPlacement(created.id, {
      displayId: displays[0]?.runtimeId,
      logicalPosition: { x: -1100, y: 100 },
      logicalSize: { width: 500, height: 350 },
      state: 'normal',
    });

    expect(positions.get(created.label)).toMatchObject({ type: 'Logical', x: -1100, y: 100 });
    expect(sizes.get(created.label)).toMatchObject({ type: 'Logical', width: 500, height: 350 });
  });

  it('restores maximized and fullscreen placement state through native APIs', async () => {
    const { TauriWindowService } = await import('../tauri');
    service = new TauriWindowService();
    const created = await service.createWindow({ title: 'P', size: { width: 400, height: 600 } });
    const native = nativeWindows.get(created.label);
    if (!native) throw new Error('missing created native window');

    await service.setWindowPlacement(created.id, {
      logicalPosition: { x: 20, y: 30 },
      logicalSize: { width: 400, height: 300 },
      state: 'maximized',
    });
    expect(native.maximize).toHaveBeenCalledOnce();

    await service.setWindowPlacement(created.id, {
      logicalPosition: { x: 20, y: 30 },
      logicalSize: { width: 400, height: 300 },
      state: 'fullscreen',
    });
    expect(native.unmaximize).toHaveBeenCalledOnce();
    expect(native.setFullscreen).toHaveBeenLastCalledWith(true);

    await service.setWindowPlacement(created.id, {
      logicalPosition: { x: 20, y: 30 },
      logicalSize: { width: 400, height: 300 },
      state: 'normal',
    });
    expect(native.setFullscreen).toHaveBeenLastCalledWith(false);

    await service.setWindowPlacement(created.id, {
      logicalPosition: { x: 20, y: 30 },
      logicalSize: { width: 400, height: 300 },
      state: 'minimized',
    });
    expect(native.minimize).toHaveBeenCalledOnce();

    await service.setWindowPlacement(created.id, {
      logicalPosition: { x: 20, y: 30 },
      logicalSize: { width: 400, height: 300 },
      state: 'normal',
    });
    expect(native.unminimize).toHaveBeenCalledOnce();
  });

  it('emits a close lifecycle event exactly once when native close also notifies', async () => {
    const { TauriWindowService } = await import('../tauri');
    service = new TauriWindowService();
    const events: WorkspaceWindowEvent[] = [];
    await service.listenToWindowEvents((event) => events.push(event));
    const created = await service.createWindow({ title: 'P', size: { width: 400, height: 600 } });
    await service.closeWindow(created.id);
    expect(
      events.filter((event) => event.type === 'closed' && event.windowId === created.id),
    ).toHaveLength(1);
  });

  it('maps monitors into the normalized DisplayInfo model', async () => {
    const { TauriWindowService } = await import('../tauri');
    service = new TauriWindowService();
    const monitors = await service.listMonitors();
    expect(monitors).toHaveLength(2);
    expect(monitors[0]?.isPrimary).toBe(true);
    expect(monitors[0]?.position.x).toBe(-2560);
    expect(monitors[0]?.workArea).toEqual({ x: -2560, y: 40, width: 2560, height: 1360 });
    expect(monitors[0]?.scaleFactor).toBe(2);
    expect(monitors[1]?.name).toBe('Secondary');
  });
});
