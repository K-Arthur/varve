/**
 * Memory window service — the reference implementation (ADR-0022).
 *
 * Simulates windows, monitors, placement, and events entirely in memory so
 * the full contract (and the transfer state machine in M5+) is testable
 * without a display server. Capability reports 'native' because the
 * memory service faithfully models native behavior.
 *
 * Also used as the runtime window service in environments without a
 * windowing backend (unit tests, headless builds).
 */

import { clampPlacementToWorkArea, fingerprintFromDisplay } from './geometry';
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

export interface MemoryDisplayFixture {
  runtimeId: string;
  name?: string;
  isPrimary: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  workArea?: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  rotation?: 0 | 90 | 180 | 270;
}

export const DEFAULT_MEMORY_MONITORS: MemoryDisplayFixture[] = [
  {
    runtimeId: 'display-primary',
    name: 'Primary',
    isPrimary: true,
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1,
  },
  {
    runtimeId: 'display-secondary',
    name: 'Secondary',
    isPrimary: false,
    position: { x: 1920, y: 0 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1,
  },
];

interface SimulatedWindow {
  info: WorkspaceWindowInfo;
  placement: WindowPlacement;
  minSize: { width: number; height: number };
  route?: string;
}

export interface MemoryWindowServiceOptions {
  /** Current-window id — the caller's own window (default 'main'). */
  currentWindowId?: WorkspaceWindowId;
  monitors?: MemoryDisplayFixture[];
  /** Maximum concurrent windows including the current one. */
  maxWindows?: number;
}

export class MemoryWindowService implements NativeWindowService {
  readonly capability = 'native' as const;

  private currentWindowId: WorkspaceWindowId;
  private windows = new Map<WorkspaceWindowId, SimulatedWindow>();
  private monitors: DisplayInfo[];
  private listeners = new Set<(event: WorkspaceWindowEvent) => void>();
  private maxWindows: number;

  constructor(options: MemoryWindowServiceOptions = {}) {
    this.currentWindowId = options.currentWindowId ?? 'main';
    this.maxWindows = options.maxWindows ?? 12;
    this.monitors = (options.monitors ?? DEFAULT_MEMORY_MONITORS).map((m) => this.toDisplayInfo(m));
    // The caller's own window always exists.
    const label =
      this.currentWindowId === 'main' ? 'main' : deriveWindowLabel(this.currentWindowId);
    const primary = this.monitors.find((m) => m.isPrimary) ?? this.monitors[0];
    this.windows.set(this.currentWindowId, {
      info: {
        id: this.currentWindowId,
        label,
        title: 'Varve',
        visible: true,
        focused: true,
        minimized: false,
        maximized: false,
        fullscreen: false,
        monitor: primary ?? null,
      },
      placement: {
        displayId: primary?.runtimeId,
        logicalPosition: { x: 0, y: 0 },
        logicalSize: { width: 1280, height: 800 },
        state: 'normal',
      },
      minSize: { width: 400, height: 300 },
    });
  }

  /** Replace the monitor topology (tests, hot-plug simulation). */
  setMonitorFixture(fixtures: MemoryDisplayFixture[]): void {
    this.monitors = fixtures.map((m) => this.toDisplayInfo(m));
    this.emit({ type: 'monitors-changed', displays: this.monitors });
  }

  listMonitors(): Promise<DisplayInfo[]> {
    return Promise.resolve([...this.monitors]);
  }

  async createWindow(options: CreateWorkspaceWindowOptions): Promise<WorkspaceWindowInfo> {
    if (this.windows.size >= this.maxWindows) {
      throw new Error(`window limit reached (${this.maxWindows})`);
    }
    const id = this.nextWindowId();
    const label = options.label ? deriveWindowLabel(options.label) : deriveWindowLabel(id);
    const primary = this.monitors.find((m) => m.isPrimary) ?? this.monitors[0];
    const minSize = options.minSize ?? { width: 240, height: 160 };
    let placement: WindowPlacement = options.placement ?? {
      displayId: primary?.runtimeId,
      displayFingerprint: primary ? fingerprintFromDisplay(primary, undefined) : undefined,
      logicalPosition: { x: 0, y: 0 },
      logicalSize: options.size,
      state: 'normal',
    };
    if (primary) {
      placement = clampPlacementToWorkArea(placement, primary.workArea, minSize);
    }
    const info: WorkspaceWindowInfo = {
      id,
      label,
      title: options.title,
      visible: false,
      focused: false,
      minimized: false,
      maximized: false,
      fullscreen: false,
      placement,
      monitor: primary ?? null,
    };
    this.windows.set(id, {
      info,
      placement,
      minSize,
      route: options.route,
    });
    this.emit({ type: 'created', windowId: id, info });
    return info;
  }

  async closeWindow(windowId: WorkspaceWindowId): Promise<void> {
    if (windowId === this.currentWindowId) {
      throw new Error('cannot close the current window through the window service');
    }
    if (this.windows.delete(windowId)) {
      this.emit({ type: 'closed', windowId });
    }
  }

  async focusWindow(windowId: WorkspaceWindowId): Promise<void> {
    const window = this.requireWindow(windowId);
    for (const [id, w] of this.windows) {
      const focused = id === windowId;
      if (w.info.focused !== focused) {
        w.info = { ...w.info, focused };
        this.emit(focused ? { type: 'focused', windowId: id } : { type: 'blurred', windowId: id });
      }
    }
    this.windows.set(windowId, window);
  }

  async showWindow(windowId: WorkspaceWindowId): Promise<void> {
    const window = this.requireWindow(windowId);
    if (!window.info.visible) {
      window.info = { ...window.info, visible: true };
      this.windows.set(windowId, window);
    }
  }

  async hideWindow(windowId: WorkspaceWindowId): Promise<void> {
    const window = this.requireWindow(windowId);
    if (window.info.visible) {
      window.info = { ...window.info, visible: false, focused: false };
      this.windows.set(windowId, window);
      this.emit({ type: 'blurred', windowId });
    }
  }

  getCurrentWindow(): Promise<WorkspaceWindowInfo> {
    return Promise.resolve({ ...this.requireWindow(this.currentWindowId).info });
  }

  async listWindows(): Promise<WorkspaceWindowInfo[]> {
    return [...this.windows.values()].map((w) => ({ ...w.info }));
  }

  async getWindowPlacement(windowId: WorkspaceWindowId): Promise<WindowPlacement | null> {
    const window = this.windows.get(windowId);
    return window ? { ...window.placement } : null;
  }

  async setWindowPlacement(windowId: WorkspaceWindowId, placement: WindowPlacement): Promise<void> {
    const window = this.requireWindow(windowId);
    const clamped = clampPlacementToWorkArea(
      placement,
      this.monitors[0]?.workArea ?? {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      },
      window.minSize,
      placement.state,
    );
    window.placement = clamped;
    window.info = {
      ...window.info,
      placement: clamped,
      minimized: placement.state === 'minimized',
      maximized: placement.state === 'maximized',
      fullscreen: placement.state === 'fullscreen',
    };
    this.windows.set(windowId, window);
    this.emit({ type: 'moved', windowId, placement: clamped });
    this.emit({ type: 'resized', windowId, size: clamped.logicalSize });
  }

  async listenToWindowEvents(handler: (event: WorkspaceWindowEvent) => void): Promise<() => void> {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  /** Simulate a window crash/reload for recovery tests. */
  simulateWindowDisappearance(windowId: WorkspaceWindowId): void {
    if (this.windows.delete(windowId)) {
      this.emit({ type: 'closed', windowId });
    }
  }

  private requireWindow(windowId: WorkspaceWindowId): SimulatedWindow {
    const window = this.windows.get(windowId);
    if (!window) throw new Error(`unknown window '${windowId}'`);
    return window;
  }

  private nextWindowId(): string {
    let id: string;
    do {
      this.windowCounter += 1;
      id = `window-${this.windowCounter}`;
    } while (this.windows.has(id));
    return id;
  }

  private windowCounter = 0;

  private toDisplayInfo(fixture: MemoryDisplayFixture): DisplayInfo {
    const width = fixture.size.width;
    const height = fixture.size.height;
    return {
      runtimeId: fixture.runtimeId,
      name: fixture.name,
      isPrimary: fixture.isPrimary,
      position: fixture.position,
      size: fixture.size,
      workArea: fixture.workArea ?? {
        x: fixture.position.x,
        y: fixture.position.y,
        width,
        height,
      },
      scaleFactor: fixture.scaleFactor,
      rotation: fixture.rotation,
    };
  }

  private emit(event: WorkspaceWindowEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/** Factory matching the other platform factories' style. */
export function createMemoryWindowService(
  options?: MemoryWindowServiceOptions,
): NativeWindowService {
  return new MemoryWindowService(options);
}
