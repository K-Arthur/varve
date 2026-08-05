/**
 * Tauri window service (ADR-0022).
 *
 * Wraps the `window.__TAURI__.window` global (withGlobalTauri) — the same
 * convention as the rest of @varve/platform — behind the NativeWindowService
 * port. Logical workspace window ids are mapped to sanitized Tauri labels
 * (ADR-0020); the mapping lives here, per session.
 *
 * Auxiliary windows are created hidden and only shown after the caller
 * places them (ADR-0024: visible only when the destination is ready).
 * Only application-owned routes are accepted (ADR-0040).
 */

import { clampPlacementToWorkArea, matchDisplayFingerprint } from './geometry';
import type {
  CreateWorkspaceWindowOptions,
  DisplayInfo,
  NativeWindowService,
  WindowPlacement,
  WorkspaceWindowEvent,
  WorkspaceWindowId,
  WorkspaceWindowInfo,
} from './types';
import { deriveWindowLabel } from './types';

interface TauriMonitor {
  name: string | null;
  size: { width: number; height: number };
  position: { x: number; y: number };
  scaleFactor: number;
}

interface TauriWindowApi {
  WebviewWindow: new (label: string, options?: Record<string, unknown>) => TauriWindowLike;
  getCurrentWindow(): TauriWindowLike;
  getAllWindows(): TauriWindowLike[];
  availableMonitors(): Promise<TauriMonitor[]>;
  currentMonitor(): Promise<TauriMonitor | null>;
  primaryMonitor(): Promise<TauriMonitor | null>;
}

interface TauriWindowLike {
  label: string;
  title?: string;
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
  outerPosition(): Promise<{ x: number; y: number }>;
  outerSize(): Promise<{ width: number; height: number }>;
  currentMonitor(): Promise<TauriMonitor | null>;
  onMoved(handler: (event: { payload: { x: number; y: number } }) => void): Promise<() => void>;
  onResized(
    handler: (event: { payload: { width: number; height: number } }) => void,
  ): Promise<() => void>;
  onFocusChanged(handler: (event: { payload: boolean }) => void): Promise<() => void>;
  onScaleChanged(
    handler: (event: { payload: { scaleFactor: number } }) => void,
  ): Promise<() => void>;
  onCloseRequested(handler: (event: { preventDefault(): void }) => void): Promise<() => void>;
}

function getTauriWindowApi(): TauriWindowApi {
  const globalWithTauri = window as unknown as {
    __TAURI__?: { window?: TauriWindowApi };
  };
  const api = globalWithTauri.__TAURI__?.window;
  if (!api) {
    throw new Error('Tauri window API is not available in this runtime');
  }
  return api;
}

function newLogicalPosition(x: number, y: number): unknown {
  return { x, y };
}

function newLogicalSize(width: number, height: number): unknown {
  return { width, height };
}

/** Map Tauri's Monitor type into the normalized DisplayInfo model. */
function toDisplayInfo(monitor: TauriMonitor, index: number): DisplayInfo {
  const primary = monitor.position.x === 0 && monitor.position.y === 0;
  return {
    runtimeId: `tauri-monitor-${index}`,
    name: monitor.name ?? undefined,
    isPrimary: primary,
    position: { x: monitor.position.x, y: monitor.position.y },
    size: { width: monitor.size.width, height: monitor.size.height },
    workArea: {
      x: monitor.position.x,
      y: monitor.position.y,
      width: monitor.size.width,
      height: monitor.size.height,
    },
    scaleFactor: monitor.scaleFactor,
  };
}

export class TauriWindowService implements NativeWindowService {
  readonly capability = 'native' as const;

  private idByLabel = new Map<string, WorkspaceWindowId>();
  private labelById = new Map<WorkspaceWindowId, string>();
  private listeners = new Set<(event: WorkspaceWindowEvent) => void>();
  private subscribedLabels = new Set<string>();
  private unsubscribes: Array<() => void> = [];
  private cleanupRegistered = false;

  private idForLabel(label: string): WorkspaceWindowId {
    const existing = this.idByLabel.get(label);
    if (existing) return existing;
    const id =
      label === 'main'
        ? 'main'
        : `ws-${label.replace(/[^a-z0-9]/g, '')}-${Date.now().toString(36)}`;
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
    const api = getTauriWindowApi();
    if (options.route && !isApplicationRoute(options.route)) {
      throw new Error(`refusing non-application route '${options.route}' (ADR-0040)`);
    }
    const id = `ws-${cryptoRandomUuid().slice(0, 8)}`;
    const label = options.label ? deriveWindowLabel(options.label) : deriveWindowLabel(id);
    this.idByLabel.set(label, id);
    this.labelById.set(id, label);

    const url = options.route ? routeUrl(options.route) : routeUrl('?surface=panel-window');
    const width = options.size.width;
    const height = options.size.height;
    const minWidth = options.minSize?.width;
    const minHeight = options.minSize?.height;

    const webview = new api.WebviewWindow(label, {
      url,
      title: options.title,
      width,
      height,
      minWidth,
      minHeight,
      visible: false,
      decorations: false,
    });

    if (options.placement) {
      const display = await this.findDisplayForPlacement(options.placement);
      const placement = clampPlacementToWorkArea(
        options.placement,
        display?.workArea ?? { x: 0, y: 0, width: 1920, height: 1080 },
        options.minSize ?? { width: 240, height: 160 },
      );
      await webview.setPosition(
        newLogicalPosition(placement.logicalPosition.x, placement.logicalPosition.y),
      );
      await webview.setSize(
        newLogicalSize(placement.logicalSize.width, placement.logicalSize.height),
      );
    }
    if (minWidth !== undefined && minHeight !== undefined) {
      await webview.setMinSize(newLogicalSize(minWidth, minHeight));
    }

    const info = await this.wrapWindow(webview, id);
    await this.subscribeWindow(webview, id);
    this.emit({ type: 'created', windowId: id, info });
    return info;
  }

  async closeWindow(windowId: WorkspaceWindowId): Promise<void> {
    const api = getTauriWindowApi();
    const label = this.labelForId(windowId);
    const window = api.getAllWindows().find((w) => w.label === label);
    if (window) {
      await window.close();
      this.emit({ type: 'closed', windowId });
    }
  }

  async focusWindow(windowId: WorkspaceWindowId): Promise<void> {
    const api = getTauriWindowApi();
    const window = api.getAllWindows().find((w) => w.label === this.labelForId(windowId));
    if (window) await window.setFocus();
  }

  async showWindow(windowId: WorkspaceWindowId): Promise<void> {
    const api = getTauriWindowApi();
    const window = api.getAllWindows().find((w) => w.label === this.labelForId(windowId));
    if (window) await window.show();
  }

  async hideWindow(windowId: WorkspaceWindowId): Promise<void> {
    const api = getTauriWindowApi();
    const window = api.getAllWindows().find((w) => w.label === this.labelForId(windowId));
    if (window) await window.hide();
  }

  async getCurrentWindow(): Promise<WorkspaceWindowInfo> {
    const api = getTauriWindowApi();
    const window = api.getCurrentWindow();
    const id = this.idForLabel(window.label);
    await this.subscribeWindow(window, id);
    return this.wrapWindow(window, id);
  }

  async listWindows(): Promise<WorkspaceWindowInfo[]> {
    const api = getTauriWindowApi();
    const windows = api.getAllWindows();
    const results: WorkspaceWindowInfo[] = [];
    for (const window of windows) {
      const id = this.idForLabel(window.label);
      await this.subscribeWindow(window, id);
      results.push(await this.wrapWindow(window, id));
    }
    return results;
  }

  async listMonitors(): Promise<DisplayInfo[]> {
    const monitors = await getTauriWindowApi().availableMonitors();
    return monitors.map((monitor, index) => toDisplayInfo(monitor, index));
  }

  async getWindowPlacement(windowId: WorkspaceWindowId): Promise<WindowPlacement | null> {
    const api = getTauriWindowApi();
    const window = api.getAllWindows().find((w) => w.label === this.labelForId(windowId));
    if (!window) return null;
    return this.readPlacement(window);
  }

  async setWindowPlacement(windowId: WorkspaceWindowId, placement: WindowPlacement): Promise<void> {
    const api = getTauriWindowApi();
    const window = api.getAllWindows().find((w) => w.label === this.labelForId(windowId));
    if (!window) throw new Error(`unknown window '${windowId}'`);
    const display = await this.findDisplayForPlacement(placement);
    const clamped = clampPlacementToWorkArea(
      placement,
      display?.workArea ?? { x: 0, y: 0, width: 1920, height: 1080 },
      { width: 240, height: 160 },
    );
    await window.setPosition(
      newLogicalPosition(clamped.logicalPosition.x, clamped.logicalPosition.y),
    );
    await window.setSize(newLogicalSize(clamped.logicalSize.width, clamped.logicalSize.height));
    if (clamped.state === 'minimized') await window.hide();
  }

  async listenToWindowEvents(handler: (event: WorkspaceWindowEvent) => void): Promise<() => void> {
    this.listeners.add(handler);
    this.registerCleanupHook();
    return () => {
      this.listeners.delete(handler);
    };
  }

  private async wrapWindow(
    window: TauriWindowLike,
    id: WorkspaceWindowId,
  ): Promise<WorkspaceWindowInfo> {
    const [visible, focused, minimized, maximized, fullscreen, placement] = await Promise.all([
      window.isVisible().catch(() => false),
      window.isFocused().catch(() => false),
      window.isMinimized().catch(() => false),
      window.isMaximized().catch(() => false),
      window.isFullscreen().catch(() => false),
      this.readPlacement(window).catch(() => null),
    ]);
    return {
      id,
      label: window.label,
      title: window.title ?? 'Varve',
      visible,
      focused,
      minimized,
      maximized,
      fullscreen,
      placement: placement ?? undefined,
    };
  }

  private async readPlacement(window: TauriWindowLike): Promise<WindowPlacement | null> {
    const monitor = await window.currentMonitor().catch(() => null);
    const scale = monitor?.scaleFactor ?? 1;
    const [position, size] = await Promise.all([
      window.outerPosition().catch(() => ({ x: 0, y: 0 })),
      window.outerSize().catch(() => ({ width: 800, height: 600 })),
    ]);
    return {
      displayId: undefined,
      logicalPosition: { x: position.x / scale, y: position.y / scale },
      logicalSize: { width: size.width / scale, height: size.height / scale },
      state: 'normal',
    };
  }

  private async findDisplayForPlacement(placement: WindowPlacement) {
    const monitors = await this.listMonitors().catch(() => []);
    if (placement.displayId) {
      const match = monitors.find((m) => m.runtimeId === placement.displayId);
      if (match) return match;
    }
    if (placement.displayFingerprint) {
      const primary = monitors.find((m) => m.isPrimary);
      let best: DisplayInfo | undefined;
      let bestScore = 0;
      for (const candidate of monitors) {
        const score = matchDisplayFingerprint(placement.displayFingerprint, candidate, primary);
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      if (best) return best;
    }
    return monitors.find((m) => m.isPrimary) ?? monitors[0];
  }

  private async subscribeWindow(window: TauriWindowLike, id: WorkspaceWindowId): Promise<void> {
    if (this.subscribedLabels.has(window.label)) return;
    this.subscribedLabels.add(window.label);
    const unsubscribes: Array<() => void> = [];
    const cleanup = async (fn: () => Promise<() => void>) => {
      try {
        unsubscribes.push(await fn());
      } catch {
        // Window may be gone already; nothing to clean.
      }
    };
    await cleanup(() =>
      window.onMoved((event) => {
        const monitorScale = 1;
        this.emit({
          type: 'moved',
          windowId: id,
          placement: {
            logicalPosition: {
              x: event.payload.x / monitorScale,
              y: event.payload.y / monitorScale,
            },
            logicalSize: { width: 0, height: 0 },
            state: 'normal',
          },
        });
      }),
    );
    await cleanup(() =>
      window.onResized((event) => {
        this.emit({
          type: 'resized',
          windowId: id,
          size: { width: event.payload.width, height: event.payload.height },
        });
      }),
    );
    await cleanup(() =>
      window.onFocusChanged((event) => {
        this.emit(
          event.payload ? { type: 'focused', windowId: id } : { type: 'blurred', windowId: id },
        );
      }),
    );
    await cleanup(() =>
      window.onScaleChanged(() => {
        void this.listMonitors().then((displays) =>
          this.emit({ type: 'monitors-changed', displays }),
        );
      }),
    );
    await cleanup(() =>
      window.onCloseRequested(() => {
        this.emit({ type: 'closed', windowId: id });
      }),
    );
    this.unsubscribes.push(...unsubscribes);
  }

  private registerCleanupHook(): void {
    if (this.cleanupRegistered) return;
    this.cleanupRegistered = true;
    if (typeof window !== 'undefined' && 'addEventListener' in window) {
      window.addEventListener('pagehide', () => {
        for (const unsubscribe of this.unsubscribes) {
          try {
            unsubscribe();
          } catch {
            // Best-effort teardown.
          }
        }
        this.unsubscribes = [];
      });
    }
  }

  private emit(event: WorkspaceWindowEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/** Only '?query'-style application routes are allowed (ADR-0040). */
function isApplicationRoute(route: string): boolean {
  if (!route.startsWith('?')) return false;
  if (route.includes('//')) return false;
  if (route.includes('http:') || route.includes('https:')) return false;
  return true;
}

function routeUrl(route: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  return `${origin}${pathname}${route}`;
}

function cryptoRandomUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createTauriWindowService(): NativeWindowService {
  return new TauriWindowService();
}
