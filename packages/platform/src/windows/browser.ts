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

import { defaultPanelWindowRoute, parsePanelWindowRoute } from './panelRoute';
import type {
  CreateWorkspaceWindowOptions,
  DisplayInfo,
  NativeWindowService,
  WindowPlacement,
  WorkspaceWindowEvent,
  WorkspaceWindowId,
  WorkspaceWindowInfo,
} from './types';
import { isWorkspaceWindowId, UnsupportedOperationError } from './types';

const POPUP_BASE_URL = typeof location !== 'undefined' ? location.origin : 'http://localhost:1420';

function currentWindowId(): WorkspaceWindowId {
  if (typeof location === 'undefined') return 'main';
  return parsePanelWindowRoute(location.search)?.windowId ?? 'main';
}

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
      id: currentWindowId(),
      label: currentWindowId() === 'main' ? 'main' : `browser-panel-${currentWindowId()}`,
      title: typeof document !== 'undefined' ? document.title || 'Varve' : 'Varve',
      visible: true,
      focused: true,
      minimized: false,
      maximized: false,
      fullscreen: false,
      monitor: singleDisplayInfo(),
    };
  }

  private requirePopups(op: string): void {
    if (this.capability !== 'browser-popup') {
      throw new UnsupportedOperationError(op, this.capability);
    }
  }

  createWindow(options: CreateWorkspaceWindowOptions): Promise<WorkspaceWindowInfo> {
    try {
      this.requirePopups('createWindow');
    } catch (error) {
      return Promise.reject(error);
    }

    this.counter += 1;
    const id = options.id ?? `browser-popup-${this.counter}`;
    if (!isWorkspaceWindowId(id)) {
      return Promise.reject(new Error(`invalid workspace window id '${String(id)}'`));
    }
    const route = options.route ?? defaultPanelWindowRoute(id);
    const parsedRoute = parsePanelWindowRoute(route);
    if (!parsedRoute) {
      return Promise.reject(new Error('refusing invalid auxiliary application route (ADR-0040)'));
    }
    if (parsedRoute.windowId !== id) {
      return Promise.reject(
        new Error(
          `window route identity '${parsedRoute.windowId}' does not match requested window identity '${id}'`,
        ),
      );
    }
    if (this.popups.has(id)) {
      return Promise.reject(new Error(`window '${id}' already exists`));
    }
    const name = `varve-panel-${this.counter}`;
    const width = options.size?.width ?? 320;
    const height = options.size?.height ?? 480;
    const left = typeof screen !== 'undefined' ? screen.availWidth - width - 24 : 24;
    const top = 24;
    const features = `width=${width},height=${height},left=${left},top=${top},popup=yes`;

    // Browser popups have deliberately limited placement guarantees, but the
    // application identity must still be identical to the service ID. Never
    // rewrite it: the broker and the popup need the same protocol target.
    // Preserve the bounded application route assigned by the coordinator.
    // In particular, the transaction and panel-instance identities are part
    // of the readiness proof; dropping them makes a browser popup look ready
    // while the primary correctly waits forever for a matching host.
    const routeParams = new URLSearchParams(parsedRoute.params);
    if (!routeParams.get('session')) routeParams.set('session', 'current');
    const url = `${POPUP_BASE_URL}/index.html?${routeParams.toString()}`;

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
    try {
      this.requirePopups('closeWindow');
    } catch (error) {
      return Promise.reject(error);
    }
    if (windowId === currentWindowId() && windowId !== 'main') {
      try {
        window.close();
      } catch {
        // The browser may deny closing a non-script-opened tab.
      }
      return Promise.resolve();
    }
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
    try {
      this.requirePopups('focusWindow');
    } catch (error) {
      return Promise.reject(error);
    }
    if (windowId === currentWindowId()) {
      try {
        window.focus();
      } catch {
        // Best-effort browser focus.
      }
      return Promise.resolve();
    }
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
    try {
      this.requirePopups('showWindow');
    } catch (error) {
      return Promise.reject(error);
    }
    if (windowId === currentWindowId()) return Promise.resolve();
    const popup = this.popups.get(windowId);
    if (!popup) return Promise.reject(new Error(`unknown window '${windowId}'`));
    this.emit({ type: 'restored', windowId });
    return Promise.resolve();
  }

  hideWindow(windowId: WorkspaceWindowId): Promise<void> {
    try {
      this.requirePopups('hideWindow');
    } catch (error) {
      return Promise.reject(error);
    }
    if (windowId === currentWindowId()) return Promise.resolve();
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
    if (windowId === currentWindowId()) {
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
    try {
      this.requirePopups('setWindowPlacement');
    } catch (error) {
      return Promise.reject(error);
    }
    if (windowId === currentWindowId()) return Promise.resolve();
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

export function createBrowserWindowService(popupsEnabled?: boolean): NativeWindowService {
  return new BrowserWindowService(popupsEnabled);
}
