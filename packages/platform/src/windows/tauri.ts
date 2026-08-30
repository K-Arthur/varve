/**
 * Tauri 2 window service (ADR-0022 / ADR-0210).
 *
 * This adapter is deliberately the only place that knows Tauri's window API.
 * The Tauri 2 global API exposes WebviewWindow under `webviewWindow`, returns
 * window lists asynchronously, and reports monitor/window bounds in physical
 * pixels. We normalize those details here and expose logical placements to
 * the rest of Varve.
 */

import {
  clampPlacementToWorkArea,
  fingerprintFromDisplay,
  logicalWorkAreaForDisplay,
  matchDisplayFingerprint,
} from './geometry';
import type {
  CreateWorkspaceWindowOptions,
  DisplayInfo,
  NativeWindowService,
  WindowPlacement,
  WorkspaceWindowEvent,
  WorkspaceWindowId,
  WorkspaceWindowInfo,
} from './types';
import { deriveWindowLabel, isWorkspaceWindowId } from './types';

interface TauriPhysicalPoint {
  x: number;
  y: number;
}

interface TauriPhysicalSize {
  width: number;
  height: number;
}

interface TauriMonitor {
  name: string | null;
  size: TauriPhysicalSize;
  position: TauriPhysicalPoint;
  workArea?: { position: TauriPhysicalPoint; size: TauriPhysicalSize };
  scaleFactor: number;
}

interface TauriWindowLike {
  label: string;
  setTitle(title: string): Promise<void>;
  setPosition(position: unknown): Promise<void>;
  setSize(size: unknown): Promise<void>;
  setMinSize(size: unknown): Promise<void>;
  setFocus(): Promise<void>;
  show(): Promise<void>;
  hide(): Promise<void>;
  close(): Promise<void>;
  isVisible(): Promise<boolean>;
  isFocused(): Promise<boolean>;
  isMinimized(): Promise<boolean>;
  isMaximized(): Promise<boolean>;
  isFullscreen(): Promise<boolean>;
  outerPosition(): Promise<TauriPhysicalPoint>;
  outerSize(): Promise<TauriPhysicalSize>;
  currentMonitor(): Promise<TauriMonitor | null>;
  onMoved(handler: (event: { payload: TauriPhysicalPoint }) => void): Promise<() => void>;
  onResized(handler: (event: { payload: TauriPhysicalSize }) => void): Promise<() => void>;
  onFocusChanged(handler: (event: { payload: boolean }) => void): Promise<() => void>;
  onScaleChanged(
    handler: (event: { payload: { scaleFactor: number; size: TauriPhysicalSize } }) => void,
  ): Promise<() => void>;
  onCloseRequested(handler: (event: { preventDefault(): void }) => void): Promise<() => void>;
  once?(
    event: 'tauri://created' | 'tauri://error',
    handler: (event: { payload?: unknown }) => void,
  ): Promise<() => void>;
}

interface TauriWebviewWindowApi {
  WebviewWindow: new (label: string, options?: Record<string, unknown>) => TauriWindowLike;
  getCurrentWebviewWindow?: () => TauriWindowLike;
  getAllWebviewWindows?: () => Promise<TauriWindowLike[]>;
  /** Compatibility with Tauri's static methods and the old test stub. */
  getCurrent?: () => TauriWindowLike;
  getAll?: () => Promise<TauriWindowLike[]> | TauriWindowLike[];
}

interface TauriWindowApi {
  getCurrentWindow?: () => TauriWindowLike;
  getAllWindows?: () => Promise<TauriWindowLike[]> | TauriWindowLike[];
  availableMonitors(): Promise<TauriMonitor[]>;
  primaryMonitor(): Promise<TauriMonitor | null>;
}

interface TauriDpiApi {
  LogicalPosition?: new (x: number, y: number) => unknown;
  LogicalSize?: new (width: number, height: number) => unknown;
}

interface TauriApi {
  webviewWindow: TauriWebviewWindowApi;
  window: TauriWindowApi;
  dpi?: TauriDpiApi;
}

function getTauriApi(): TauriApi {
  const globalWithTauri = window as unknown as {
    __TAURI__?: {
      webviewWindow?: TauriWebviewWindowApi;
      window?: TauriWindowApi & Partial<TauriWebviewWindowApi>;
      dpi?: TauriDpiApi;
    };
  };
  const globalApi = globalWithTauri.__TAURI__;
  const webviewCandidate = globalApi?.webviewWindow ?? globalApi?.window;
  const windowApi = globalApi?.window;
  if (
    !webviewCandidate?.WebviewWindow ||
    !windowApi?.availableMonitors ||
    !windowApi.primaryMonitor
  ) {
    throw new Error('Tauri 2 window API is not available in this runtime');
  }
  return {
    webviewWindow: webviewCandidate as TauriWebviewWindowApi,
    window: windowApi,
    dpi: globalApi?.dpi,
  };
}

function logicalPosition(api: TauriApi, x: number, y: number): unknown {
  if (api.dpi?.LogicalPosition) return new api.dpi.LogicalPosition(x, y);
  // Tauri's IPC serializer reads the `type` discriminator. This fallback is
  // deliberately not a lookalike plain position object.
  return { type: 'Logical', x, y };
}

function logicalSize(api: TauriApi, width: number, height: number): unknown {
  if (api.dpi?.LogicalSize) return new api.dpi.LogicalSize(width, height);
  return { type: 'Logical', width, height };
}

function monitorKey(monitor: TauriMonitor): string {
  return [
    monitor.name ?? '',
    monitor.position.x,
    monitor.position.y,
    monitor.size.width,
    monitor.size.height,
    monitor.scaleFactor,
  ].join('|');
}

function monitorRuntimeId(monitor: TauriMonitor): string {
  const readable = (monitor.name ?? 'display').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 24);
  return `tauri-${readable}-${monitor.position.x}-${monitor.position.y}-${monitor.size.width}x${monitor.size.height}`;
}

function toDisplayInfo(monitor: TauriMonitor, isPrimary: boolean): DisplayInfo {
  const workArea = monitor.workArea ?? { position: monitor.position, size: monitor.size };
  return {
    runtimeId: monitorRuntimeId(monitor),
    name: monitor.name ?? undefined,
    isPrimary,
    position: { x: monitor.position.x, y: monitor.position.y },
    size: { width: monitor.size.width, height: monitor.size.height },
    workArea: {
      x: workArea.position.x,
      y: workArea.position.y,
      width: workArea.size.width,
      height: workArea.size.height,
    },
    scaleFactor: monitor.scaleFactor,
  };
}

function currentRouteWindowId(): WorkspaceWindowId | undefined {
  if (typeof window === 'undefined') return undefined;
  const id = new URLSearchParams(window.location.search).get('windowId');
  return isWorkspaceWindowId(id) ? id : undefined;
}

/** Native creation is asynchronous even though `new WebviewWindow()` returns a handle. */
async function waitForWindowCreation(nativeWindow: TauriWindowLike): Promise<void> {
  if (!nativeWindow.once) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let createdUnlisten: (() => void) | undefined;
    let errorUnlisten: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error('timed out while creating the auxiliary window')));
    }, 10_000);

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      createdUnlisten?.();
      errorUnlisten?.();
      callback();
    };

    void Promise.all([
      nativeWindow.once?.('tauri://created', () => finish(resolve)),
      nativeWindow.once?.('tauri://error', (event) =>
        finish(() =>
          reject(new Error(`failed to create auxiliary window: ${String(event.payload)}`)),
        ),
      ),
    ])
      .then(([created, failed]) => {
        createdUnlisten = created;
        errorUnlisten = failed;
      })
      .catch((error) => finish(() => reject(error)));
  });
}

/**
 * Tauri window adapter. Every listener belongs to its native window and is
 * disposed immediately when that window closes.
 */
export class TauriWindowService implements NativeWindowService {
  readonly capability = 'native' as const;

  private idByLabel = new Map<string, WorkspaceWindowId>();
  private labelById = new Map<WorkspaceWindowId, string>();
  private titleById = new Map<WorkspaceWindowId, string>();
  private listeners = new Set<(event: WorkspaceWindowEvent) => void>();
  private unsubscribesByLabel = new Map<string, Array<() => void>>();
  private closedLabels = new Set<string>();
  private cleanupRegistered = false;

  private idForLabel(label: string): WorkspaceWindowId {
    const known = this.idByLabel.get(label);
    if (known) return known;

    // Auxiliary webviews carry their canonical identity in the application
    // route. Labels cannot become Date.now-based surrogate identities after
    // a reload.
    const routed = label === 'main' ? undefined : currentRouteWindowId();
    const id = routed ?? (label === 'main' ? 'main' : label);
    this.idByLabel.set(label, id);
    this.labelById.set(id, label);
    return id;
  }

  private labelForId(windowId: WorkspaceWindowId): string {
    const known = this.labelById.get(windowId);
    if (known) return known;
    const derived = deriveWindowLabel(windowId);
    this.labelById.set(windowId, derived);
    this.idByLabel.set(derived, windowId);
    return derived;
  }

  async createWindow(options: CreateWorkspaceWindowOptions): Promise<WorkspaceWindowInfo> {
    const api = getTauriApi();
    if (options.route && !isApplicationRoute(options.route)) {
      throw new Error(`refusing non-application route '${options.route}' (ADR-0040)`);
    }

    const id = options.id ?? createWorkspaceWindowId();
    if (!isWorkspaceWindowId(id)) {
      throw new Error(`invalid workspace window id '${String(id)}'`);
    }
    const routedId = options.route ? routeWindowId(options.route) : undefined;
    if (routedId && routedId !== id) {
      throw new Error(
        `window route identity '${routedId}' does not match requested window identity '${id}'`,
      );
    }
    const label = options.label ? deriveWindowLabel(options.label) : deriveWindowLabel(id);
    if ((await this.findWindowByLabel(label)).length > 0) {
      throw new Error(`a window with label '${label}' already exists`);
    }
    this.idByLabel.set(label, id);
    this.labelById.set(id, label);
    this.titleById.set(id, options.title);
    this.closedLabels.delete(label);

    const nativeWindow = new api.webviewWindow.WebviewWindow(label, {
      url: options.route ? routeUrl(options.route) : routeUrl('?surface=panel-window'),
      title: options.title,
      width: options.size.width,
      height: options.size.height,
      minWidth: options.minSize?.width,
      minHeight: options.minSize?.height,
      visible: false,
      decorations: false,
    });
    await waitForWindowCreation(nativeWindow);

    if (options.placement) {
      await this.applyPlacement(
        nativeWindow,
        options.placement,
        options.minSize ?? { width: 240, height: 160 },
      );
    }
    if (options.minSize) {
      await nativeWindow.setMinSize(
        logicalSize(api, options.minSize.width, options.minSize.height),
      );
    }

    await this.subscribeWindow(nativeWindow, id);
    const info = await this.wrapWindow(nativeWindow, id);
    this.emit({ type: 'created', windowId: id, info });
    return info;
  }

  async closeWindow(windowId: WorkspaceWindowId): Promise<void> {
    const label = this.labelForId(windowId);
    const nativeWindow = (await this.findWindowByLabel(label))[0];
    if (!nativeWindow) return;
    await nativeWindow.close();
    this.finalizeClosed(label, windowId);
  }

  async focusWindow(windowId: WorkspaceWindowId): Promise<void> {
    const nativeWindow = (await this.findWindowByLabel(this.labelForId(windowId)))[0];
    if (!nativeWindow) throw new Error(`unknown window '${windowId}'`);
    await nativeWindow.setFocus();
  }

  async showWindow(windowId: WorkspaceWindowId): Promise<void> {
    const nativeWindow = (await this.findWindowByLabel(this.labelForId(windowId)))[0];
    if (!nativeWindow) throw new Error(`unknown window '${windowId}'`);
    await nativeWindow.show();
  }

  async hideWindow(windowId: WorkspaceWindowId): Promise<void> {
    const nativeWindow = (await this.findWindowByLabel(this.labelForId(windowId)))[0];
    if (!nativeWindow) throw new Error(`unknown window '${windowId}'`);
    await nativeWindow.hide();
  }

  async getCurrentWindow(): Promise<WorkspaceWindowInfo> {
    const api = getTauriApi();
    const current =
      api.webviewWindow.getCurrentWebviewWindow?.() ??
      api.webviewWindow.getCurrent?.() ??
      api.window.getCurrentWindow?.();
    if (!current) throw new Error('unable to resolve the current Tauri window');
    const id = this.idForLabel(current.label);
    await this.subscribeWindow(current, id);
    return this.wrapWindow(current, id);
  }

  async listWindows(): Promise<WorkspaceWindowInfo[]> {
    const results: WorkspaceWindowInfo[] = [];
    for (const nativeWindow of await this.getAllNativeWindows()) {
      const id = this.idForLabel(nativeWindow.label);
      await this.subscribeWindow(nativeWindow, id);
      results.push(await this.wrapWindow(nativeWindow, id));
    }
    return results;
  }

  async listMonitors(): Promise<DisplayInfo[]> {
    const api = getTauriApi();
    const [monitors, primary] = await Promise.all([
      api.window.availableMonitors(),
      api.window.primaryMonitor(),
    ]);
    const primaryKey = primary ? monitorKey(primary) : undefined;
    return monitors.map((monitor) => toDisplayInfo(monitor, monitorKey(monitor) === primaryKey));
  }

  async getWindowPlacement(windowId: WorkspaceWindowId): Promise<WindowPlacement | null> {
    const nativeWindow = (await this.findWindowByLabel(this.labelForId(windowId)))[0];
    return nativeWindow ? this.readPlacement(nativeWindow) : null;
  }

  async setWindowPlacement(windowId: WorkspaceWindowId, placement: WindowPlacement): Promise<void> {
    const nativeWindow = (await this.findWindowByLabel(this.labelForId(windowId)))[0];
    if (!nativeWindow) throw new Error(`unknown window '${windowId}'`);
    await this.applyPlacement(nativeWindow, placement, { width: 240, height: 160 });
    if (placement.state === 'minimized') await nativeWindow.hide();
  }

  async listenToWindowEvents(handler: (event: WorkspaceWindowEvent) => void): Promise<() => void> {
    this.listeners.add(handler);
    this.registerCleanupHook();
    return () => this.listeners.delete(handler);
  }

  private async getAllNativeWindows(): Promise<TauriWindowLike[]> {
    const api = getTauriApi();
    if (api.webviewWindow.getAllWebviewWindows) {
      return api.webviewWindow.getAllWebviewWindows();
    }
    if (api.webviewWindow.getAll) {
      return Promise.resolve(api.webviewWindow.getAll());
    }
    if (api.window.getAllWindows) {
      return Promise.resolve(api.window.getAllWindows());
    }
    return [];
  }

  private async findWindowByLabel(label: string): Promise<TauriWindowLike[]> {
    return (await this.getAllNativeWindows()).filter(
      (nativeWindow) => nativeWindow.label === label,
    );
  }

  private async wrapWindow(
    nativeWindow: TauriWindowLike,
    id: WorkspaceWindowId,
  ): Promise<WorkspaceWindowInfo> {
    const [visible, focused, minimized, maximized, fullscreen, placement, monitor] =
      await Promise.all([
        nativeWindow.isVisible().catch(() => false),
        nativeWindow.isFocused().catch(() => false),
        nativeWindow.isMinimized().catch(() => false),
        nativeWindow.isMaximized().catch(() => false),
        nativeWindow.isFullscreen().catch(() => false),
        this.readPlacement(nativeWindow).catch(() => null),
        nativeWindow
          .currentMonitor()
          .catch(() => null)
          .then((monitor) => this.displayForNativeMonitor(monitor)),
      ]);
    return {
      id,
      label: nativeWindow.label,
      title: this.titleById.get(id) ?? 'Varve',
      visible,
      focused,
      minimized,
      maximized,
      fullscreen,
      placement: placement ?? undefined,
      monitor,
    };
  }

  private async readPlacement(nativeWindow: TauriWindowLike): Promise<WindowPlacement | null> {
    const [nativeMonitor, position, size, minimized, maximized, fullscreen] = await Promise.all([
      nativeWindow.currentMonitor().catch(() => null),
      nativeWindow.outerPosition().catch(() => ({ x: 0, y: 0 })),
      nativeWindow.outerSize().catch(() => ({ width: 800, height: 600 })),
      nativeWindow.isMinimized().catch(() => false),
      nativeWindow.isMaximized().catch(() => false),
      nativeWindow.isFullscreen().catch(() => false),
    ]);
    const display = await this.displayForNativeMonitor(nativeMonitor);
    const scale =
      nativeMonitor?.scaleFactor && Number.isFinite(nativeMonitor.scaleFactor)
        ? nativeMonitor.scaleFactor
        : 1;
    const state = fullscreen
      ? 'fullscreen'
      : maximized
        ? 'maximized'
        : minimized
          ? 'minimized'
          : 'normal';
    const displays = display ? await this.listMonitors() : [];
    return {
      displayId: display?.runtimeId,
      displayFingerprint: display
        ? fingerprintFromDisplay(
            display,
            displays.find((candidate) => candidate.isPrimary),
          )
        : undefined,
      logicalPosition: { x: position.x / scale, y: position.y / scale },
      logicalSize: { width: size.width / scale, height: size.height / scale },
      state,
    };
  }

  private async displayForNativeMonitor(monitor: TauriMonitor | null): Promise<DisplayInfo | null> {
    if (!monitor) return null;
    return (
      (await this.listMonitors()).find(
        (candidate) =>
          candidate.name === (monitor.name ?? undefined) &&
          candidate.position.x === monitor.position.x &&
          candidate.position.y === monitor.position.y &&
          candidate.size.width === monitor.size.width &&
          candidate.size.height === monitor.size.height,
      ) ?? toDisplayInfo(monitor, false)
    );
  }

  private async findDisplayForPlacement(
    placement: WindowPlacement,
  ): Promise<DisplayInfo | undefined> {
    const monitors = await this.listMonitors().catch(() => []);
    if (placement.displayId) {
      const exact = monitors.find((monitor) => monitor.runtimeId === placement.displayId);
      if (exact) return exact;
    }
    if (placement.displayFingerprint) {
      const primary = monitors.find((monitor) => monitor.isPrimary);
      let best: DisplayInfo | undefined;
      let score = 0;
      for (const candidate of monitors) {
        const candidateScore = matchDisplayFingerprint(
          placement.displayFingerprint,
          candidate,
          primary,
        );
        if (candidateScore > score) {
          score = candidateScore;
          best = candidate;
        }
      }
      if (best) return best;
    }
    return monitors.find((monitor) => monitor.isPrimary) ?? monitors[0];
  }

  private async applyPlacement(
    nativeWindow: TauriWindowLike,
    placement: WindowPlacement,
    minSize: { width: number; height: number },
  ): Promise<void> {
    const api = getTauriApi();
    const display = await this.findDisplayForPlacement(placement);
    const workArea = display
      ? logicalWorkAreaForDisplay(display)
      : { x: 0, y: 0, width: 1920, height: 1080 };
    const clamped = clampPlacementToWorkArea(placement, workArea, minSize);
    await nativeWindow.setPosition(
      logicalPosition(api, clamped.logicalPosition.x, clamped.logicalPosition.y),
    );
    await nativeWindow.setSize(
      logicalSize(api, clamped.logicalSize.width, clamped.logicalSize.height),
    );
  }

  private async subscribeWindow(
    nativeWindow: TauriWindowLike,
    id: WorkspaceWindowId,
  ): Promise<void> {
    if (this.unsubscribesByLabel.has(nativeWindow.label)) return;
    const unsubscribes: Array<() => void> = [];
    const add = async (subscribe: () => Promise<() => void>) => {
      try {
        unsubscribes.push(await subscribe());
      } catch {
        // The native window may have closed before a listener was installed.
      }
    };

    await add(() =>
      nativeWindow.onMoved(() => {
        void this.readPlacement(nativeWindow)
          .then((placement) => {
            if (placement) this.emit({ type: 'moved', windowId: id, placement });
          })
          .catch(() => {});
      }),
    );
    await add(() =>
      nativeWindow.onResized(() => {
        void this.readPlacement(nativeWindow)
          .then((placement) => {
            if (placement)
              this.emit({ type: 'resized', windowId: id, size: placement.logicalSize });
          })
          .catch(() => {});
      }),
    );
    await add(() =>
      nativeWindow.onFocusChanged((event) => {
        this.emit(
          event.payload ? { type: 'focused', windowId: id } : { type: 'blurred', windowId: id },
        );
      }),
    );
    await add(() =>
      nativeWindow.onScaleChanged(() => {
        void this.listMonitors()
          .then((displays) => this.emit({ type: 'monitors-changed', displays }))
          .catch(() => {});
      }),
    );
    await add(() =>
      nativeWindow.onCloseRequested(() => {
        this.finalizeClosed(nativeWindow.label, id);
      }),
    );
    this.unsubscribesByLabel.set(nativeWindow.label, unsubscribes);
  }

  private finalizeClosed(label: string, windowId: WorkspaceWindowId): void {
    if (this.closedLabels.has(label)) return;
    this.closedLabels.add(label);
    for (const unsubscribe of this.unsubscribesByLabel.get(label) ?? []) {
      try {
        unsubscribe();
      } catch {
        // Best-effort listener teardown.
      }
    }
    this.unsubscribesByLabel.delete(label);
    this.emit({ type: 'closed', windowId });
  }

  private registerCleanupHook(): void {
    if (this.cleanupRegistered || typeof window === 'undefined') return;
    this.cleanupRegistered = true;
    window.addEventListener('pagehide', () => {
      for (const [label, unsubscribes] of this.unsubscribesByLabel) {
        for (const unsubscribe of unsubscribes) {
          try {
            unsubscribe();
          } catch {
            // Best-effort teardown during process shutdown.
          }
        }
        this.unsubscribesByLabel.delete(label);
      }
    });
  }

  private emit(event: WorkspaceWindowEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

/** Only query-style application routes are accepted by dynamic webviews. */
function isApplicationRoute(route: string): boolean {
  return (
    route.startsWith('?') &&
    !route.includes('//') &&
    !route.includes('http:') &&
    !route.includes('https:')
  );
}

function routeUrl(route: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  return `${origin}${pathname}${route}`;
}

function routeWindowId(route: string): WorkspaceWindowId | undefined {
  const id = new URLSearchParams(route.slice(1)).get('windowId');
  return isWorkspaceWindowId(id) ? id : undefined;
}

function createWorkspaceWindowId(): WorkspaceWindowId {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `window-${random.slice(0, 48)}`;
}

export function createTauriWindowService(): NativeWindowService {
  return new TauriWindowService();
}
