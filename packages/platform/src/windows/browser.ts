/**
 * Browser window service (ADR-0034).
 *
 * Browsers cannot deliver reliable multi-window behavior (popup blocking,
 * positioning restrictions, unreliable restoration), so the browser
 * service honestly reports `capability: 'single-window'` and throws
 * `UnsupportedOperationError` for native operations instead of pretending.
 *
 * The single current browser surface is reported via getCurrentWindow /
 * listWindows so session code has one identity to hang state off;
 * monitors degrade to a best-effort single display derived from
 * window.screen (usable by the placement math, never a lie about
 * multi-monitor support).
 */

import type {
  CreateWorkspaceWindowOptions,
  DisplayInfo,
  NativeWindowService,
  WindowPlacement,
  WorkspaceWindowEvent,
  WorkspaceWindowId,
  WorkspaceWindowInfo,
} from './types';
import { UnsupportedOperationError } from './types';

const CURRENT_WINDOW_ID = 'main';

function singleDisplayInfo(): DisplayInfo {
  const width = typeof window !== 'undefined' ? (window.screen?.width ?? 1280) : 1280;
  const height = typeof window !== 'undefined' ? (window.screen?.height ?? 800) : 800;
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio ?? 1) : 1;
  return {
    runtimeId: 'browser-display',
    name: 'Browser viewport',
    isPrimary: true,
    position: { x: 0, y: 0 },
    size: { width, height },
    workArea: { x: 0, y: 0, width, height },
    scaleFactor: dpr,
  };
}

export class BrowserWindowService implements NativeWindowService {
  readonly capability = 'single-window' as const;

  private listeners = new Set<(event: WorkspaceWindowEvent) => void>();

  private currentInfo(): WorkspaceWindowInfo {
    return {
      id: CURRENT_WINDOW_ID,
      label: 'main',
      title: typeof document !== 'undefined' ? document.title || 'Varve' : 'Varve',
      visible: true,
      focused: true,
      minimized: false,
      maximized: false,
      fullscreen: false,
      monitor: singleDisplayInfo(),
    };
  }

  createWindow(_options: CreateWorkspaceWindowOptions): Promise<WorkspaceWindowInfo> {
    return Promise.reject(new UnsupportedOperationError('createWindow', this.capability));
  }

  closeWindow(_windowId: WorkspaceWindowId): Promise<void> {
    return Promise.reject(new UnsupportedOperationError('closeWindow', this.capability));
  }

  focusWindow(_windowId: WorkspaceWindowId): Promise<void> {
    return Promise.reject(new UnsupportedOperationError('focusWindow', this.capability));
  }

  showWindow(_windowId: WorkspaceWindowId): Promise<void> {
    return Promise.reject(new UnsupportedOperationError('showWindow', this.capability));
  }

  hideWindow(_windowId: WorkspaceWindowId): Promise<void> {
    return Promise.reject(new UnsupportedOperationError('hideWindow', this.capability));
  }

  getCurrentWindow(): Promise<WorkspaceWindowInfo> {
    return Promise.resolve(this.currentInfo());
  }

  listWindows(): Promise<WorkspaceWindowInfo[]> {
    return Promise.resolve([this.currentInfo()]);
  }

  listMonitors(): Promise<DisplayInfo[]> {
    return Promise.resolve([singleDisplayInfo()]);
  }

  getWindowPlacement(_windowId: WorkspaceWindowId): Promise<WindowPlacement | null> {
    return Promise.reject(new UnsupportedOperationError('getWindowPlacement', this.capability));
  }

  setWindowPlacement(_windowId: WorkspaceWindowId, _placement: WindowPlacement): Promise<void> {
    return Promise.reject(new UnsupportedOperationError('setWindowPlacement', this.capability));
  }

  async listenToWindowEvents(handler: (event: WorkspaceWindowEvent) => void): Promise<() => void> {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }
}

export function createBrowserWindowService(): NativeWindowService {
  return new BrowserWindowService();
}
