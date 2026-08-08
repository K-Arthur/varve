/**
 * Browser window service with popup support (ADR-0034 / ADR-0212).
 *
 * The browser cannot deliver reliable *multi-monitor* windows, but it CAN
 * deliver real secondary windows via window.open. This service reports:
 * - 'browser-popup' when popup windows are usable (this runtime)
 * - 'single-window' when window.open is unavailable/blocked (fallback)
 *
 * Popups are real windows: same-origin, own React root, own URL route.
 * They are deliberately NOT treated as monitors-capable; monitor APIs
 * degrade to the single best-effort display.
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
const POPUP_BASE_URL = typeof location !== 'undefined' ? location.origin : 'http://localhost:1420';

interface PopupEntry {
  info: WorkspaceWindowInfo;
  win: Window | null;
}

export function singleDisplayInfo(): DisplayInfo {
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
  readonly capability: 'browser-popup' | 'single-window';

  private listeners = new Set<(event: WorkspaceWindowEvent) => void>();
  private popups = new Map<WorkspaceWindowId, PopupEntry>();
  private counter = 0;

  constructor(popupsEnabled = typeof window !== 'undefined') {
    this.capability = popupsEnabled ? 'browser-popup' : 'single-window';
  }

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

  createWindow(options: CreateWorkspaceWindowOptions): Promise<WorkspaceWindowInfo> {
    if (this.capability !== 'browser-popup') {
      return Promise.reject(new UnsupportedOperationError('createWindow', this.capability));
    }

    this.counter += 1;
    const id = `browser-popup-${this.counter}`;
    const name = `varve-panel-${this.counter}`;
    const width = options.size?.width ?? 320;
    const height = options.size?.height ?? 480;
    const left = typeof screen !== 'undefined' ? screen.availWidth - width - 24 : 24;
    const top = 24;
    const features = `width=${width},height=${height},left=${left},top=${top},popup=yes`;

    // Build the panel-window route: strip any existing surface/windowId params
    // and substitute this service's own identity.
    const panelParam = options.route?.match(/panels=([^&]+)/)?.[1] ?? '';
    const sessionParam = options.route?.match(/session=([^&]+)/)?.[1] ?? 'current';
    const url =
      `${POPUP_BASE_URL}/index.html` +
      `?surface=panel-window` +
      `&windowId=${encodeURIComponent(id)}` +
      `&session=${encodeURIComponent(sessionParam)}` +
      (panelParam ? `&panels=${encodeURIComponent(panelParam)}` : '');

    let win: Window | null = null;
    try {
      win = window.open(url, name, features);
    } catch {
      win = null;
    }

    if (!win) {
      // Popup blocked — degrade honestly, never silently pretend.
      return Promise.reject(
        new UnsupportedOperationError('createWindow (popup blocked)', 'browser-popup'),
      );
    }

    const info: WorkspaceWindowInfo = {
      id,
      label: name,
      title: options.title,
      visible: true,
      focused: true,
      minimized: false,
      maximized: false,
      fullscreen: false,
      monitor: singleDisplayInfo(),
    };
    this.popups.set(id, { info, win });
    this.emit({ type: 'created', windowId: id, info });
    return Promise.resolve(info);
  }

  closeWindow(windowId: WorkspaceWindowId): Promise<void> {
    const popup = this.popups.get(windowId);
    if (!popup) return Promise.resolve();
    try {
      popup.win?.close();
    } catch {
      // already closed
    }
    this.popups.delete(windowId);
    this.emit({ type: 'closed', windowId });
    return Promise.resolve();
  }

  focusWindow(windowId: WorkspaceWindowId): Promise<void> {
    if (windowId === CURRENT_WINDOW_ID) return Promise.resolve();
    const popup = this.popups.get(windowId);
    if (!popup) return Promise.reject(new Error(`unknown window '${windowId}'`));
    try {
      popup.win?.focus();
    } catch {
      // ignore
    }
    this.emit({ type: 'focused', windowId });
    return Promise.resolve();
  }

  showWindow(windowId: WorkspaceWindowId): Promise<void> {
    if (windowId === CURRENT_WINDOW_ID) return Promise.resolve();
    const popup = this.popups.get(windowId);
    if (!popup) return Promise.reject(new Error(`unknown window '${windowId}'`));
    this.emit({ type: 'restored', windowId });
    return Promise.resolve();
  }

  hideWindow(windowId: WorkspaceWindowId): Promise<void> {
    if (windowId === CURRENT_WINDOW_ID) return Promise.resolve();
    const popup = this.popups.get(windowId);
    if (!popup) return Promise.reject(new Error(`unknown window '${windowId}'`));
    this.emit({ type: 'blurred', windowId });
    return Promise.resolve();
  }

  getCurrentWindow(): Promise<WorkspaceWindowInfo> {
    return Promise.resolve(this.currentInfo());
  }

  listWindows(): Promise<WorkspaceWindowInfo[]> {
    const list: WorkspaceWindowInfo[] = [this.currentInfo()];
    for (const popup of this.popups.values()) {
      list.push({ ...popup.info });
    }
    return Promise.resolve(list);
  }

  listMonitors(): Promise<DisplayInfo[]> {
    return Promise.resolve([singleDisplayInfo()]);
  }

  getWindowPlacement(windowId: WorkspaceWindowId): Promise<WindowPlacement | null> {
    if (windowId === CURRENT_WINDOW_ID) {
      return Promise.resolve({
        logicalPosition: { x: window.screenX, y: window.screenY },
        logicalSize: { width: window.outerWidth, height: window.outerHeight },
        state: 'normal',
      });
    }
    const popup = this.popups.get(windowId);
    if (!popup?.win) return Promise.resolve(null);
    try {
      const win = popup.win;
      return Promise.resolve({
        logicalPosition: { x: win.screenX, y: win.screenY },
        logicalSize: { width: win.outerWidth, height: win.outerHeight },
        state: 'normal',
      });
    } catch {
      return Promise.resolve(null);
    }
  }

  setWindowPlacement(windowId: WorkspaceWindowId, placement: WindowPlacement): Promise<void> {
    if (windowId === CURRENT_WINDOW_ID) return Promise.resolve();
    const popup = this.popups.get(windowId);
    if (!popup?.win) return Promise.reject(new Error(`unknown window '${windowId}'`));
    try {
      const win = popup.win;
      win.moveTo(Math.round(placement.logicalPosition.x), Math.round(placement.logicalPosition.y));
      win.resizeTo(
        Math.max(240, Math.round(placement.logicalSize.width)),
        Math.max(160, Math.round(placement.logicalSize.height)),
      );
    } catch {
      // Browsers may refuse cross-window positioning — best effort.
    }
    this.emit({ type: 'moved', windowId, placement });
    return Promise.resolve();
  }

  async listenToWindowEvents(handler: (event: WorkspaceWindowEvent) => void): Promise<() => void> {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  private emit(event: WorkspaceWindowEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export function createBrowserWindowService(): NativeWindowService {
  return new BrowserWindowService();
}
