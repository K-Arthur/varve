/**
 * @varve/platform — window chrome state and strategy model.
 *
 * Canonical model for cross-platform window chrome (title bar, menubar,
 * window controls). Provides platform-specific strategy resolution and
 * window state management.
 *
 * Design:
 *  - WindowChromeStrategy — platform-specific chrome configuration
 *  - WindowChromeState — dynamic window state (focus, maximize, fullscreen)
 *  - resolveWindowChromeStrategy() — central strategy resolver
 *  - Display server detection for Linux (Wayland/X11)
 *  - Button layout detection for Linux window managers
 */

import type { PlatformInfo } from './runtime';

// ─── Test Support ───────────────────────────────────────────────────────────

let _displayServerOverride: DisplayServer | null = null;
let _buttonLayoutOverride: ButtonLayout | null = null;

/**
 * Override display server detection for tests.
 */
export function setDisplayServerForTest(server: DisplayServer | null): void {
  _displayServerOverride = server;
}

/**
 * Override button layout detection for tests.
 */
export function setButtonLayoutForTest(layout: ButtonLayout | null): void {
  _buttonLayoutOverride = layout;
}

/**
 * Reset test overrides.
 */
export function resetWindowChromeTestOverrides(): void {
  _displayServerOverride = null;
  _buttonLayoutOverride = null;
}

// ─── Strategy Types ──────────────────────────────────────────────────────────

export type MenubarStrategy =
  | 'native-application-menu' // macOS system menu bar
  | 'custom-window-menubar' // In-window custom menubar
  | 'native-titlebar-custom-menubar' // Native title bar with custom menubar
  | 'fully-custom-window-chrome' // Fully custom title bar + menubar
  | 'browser-menubar'; // Browser-only in-page menubar

export type DecorationMode = 'native' | 'client-side' | 'server-side' | 'custom';

export type ControlsPosition = 'left' | 'right' | 'native' | 'hidden';

export type DisplayServer = 'wayland' | 'x11' | 'unknown';

export type ButtonLayout = 'left' | 'right';

export type MenubarPlacement = 'below-titlebar' | 'integrated' | 'top-of-page';

// ─── Window Chrome Strategy ───────────────────────────────────────────────────

export interface WindowChromeStrategy {
  /** How the menubar should be rendered */
  menubarStrategy: MenubarStrategy;
  /** Window decoration mode */
  decorationMode: DecorationMode;
  /** Window controls position */
  controlsPosition: ControlsPosition;
  /** Whether to show custom title bar component */
  showCustomTitleBar: boolean;
  /** Whether to show custom menubar component */
  showCustomMenubar: boolean;
  /** Menubar placement (when custom) */
  menubarPlacement?: MenubarPlacement;
  /** Display server (Linux only) */
  displayServer?: DisplayServer;
  /** Button layout (Linux only) */
  buttonLayout?: ButtonLayout;
}

// ─── Window Chrome State ─────────────────────────────────────────────────────

export interface WindowChromeState {
  /** Active strategy */
  strategy: WindowChromeStrategy;
  /** Window focus state */
  isFocused: boolean;
  /** Window maximize state */
  isMaximized: boolean;
  /** Window fullscreen state */
  isFullscreen: boolean;
  /** Window resizable state */
  isResizable: boolean;
  /** Whether minimize is available */
  canMinimize: boolean;
  /** Whether maximize is available */
  canMaximize: boolean;
  /** Whether close is available */
  canClose: boolean;
  /** Display scale factor */
  scaleFactor: number;
  /** Window title */
  title: string;
}

// ─── Window Events ───────────────────────────────────────────────────────────

export type WindowEvent =
  | { type: 'focus'; focused: boolean }
  | { type: 'maximize'; maximized: boolean }
  | { type: 'fullscreen'; fullscreen: boolean }
  | { type: 'resizable'; resizable: boolean }
  | { type: 'scale'; scaleFactor: number }
  | { type: 'title'; title: string };

// ─── Display Server Detection ───────────────────────────────────────────────

/**
 * Detect the display server on Linux.
 *
 * Returns 'wayland' or 'x11' when detectable, 'unknown' otherwise.
 * This is a best-effort detection; the sandboxed webview environment
 * may not provide reliable signals.
 */
export function detectDisplayServer(): DisplayServer {
  // Check for test override first
  if (_displayServerOverride !== null) {
    return _displayServerOverride;
  }

  if (typeof window === 'undefined') return 'unknown';

  // Check for WebKitGTK backend (Tauri uses WebKitGTK on Linux)
  const w = window as unknown as {
    webkit?: { messageHandlers?: unknown };
    gtk?: { backend?: string };
  };

  // WebKitGTK may expose backend information
  if (w.gtk?.backend) {
    const backend = w.gtk.backend.toLowerCase();
    if (backend.includes('wayland')) return 'wayland';
    if (backend.includes('x11')) return 'x11';
  }

  // Check for Wayland-specific globals
  const waylandGlobal = (w as Record<string, unknown>).wayland;
  if (waylandGlobal !== undefined) {
    return 'wayland';
  }

  // Fallback: unknown (cannot reliably detect)
  return 'unknown';
}

// ─── Button Layout Detection ─────────────────────────────────────────────────

/**
 * Detect window manager button layout on Linux.
 *
 * Returns 'left' or 'right' based on window manager conventions.
 * This is a conservative default; true detection requires Tauri
 * side-channel or environment variable access.
 */
export function detectButtonLayout(): ButtonLayout {
  // Check for test override first
  if (_buttonLayoutOverride !== null) {
    return _buttonLayoutOverride;
  }

  // Most Linux environments use right-side button layout
  // GNOME, KDE (default), XFCE all default to right
  // Only some KDE configurations or custom setups use left
  return 'right';
}

// ─── Strategy Resolution ───────────────────────────────────────────────────

/**
 * Resolve the window chrome strategy for the current platform.
 *
 * This is the central resolver that determines how title bar, menubar,
 * and window controls should be rendered based on platform capabilities
 * and conventions.
 */
export function resolveWindowChromeStrategy(
  platform: PlatformInfo,
  preferences?: Partial<WindowChromeStrategy>,
): WindowChromeStrategy {
  const baseStrategy = getBaseStrategy(platform);
  return { ...baseStrategy, ...preferences };
}

function getBaseStrategy(platform: PlatformInfo): WindowChromeStrategy {
  // Browser builds can run on a Linux host, but they do not have a Linux
  // window to decorate. Resolve the runtime before the host OS so a Vite
  // browser session never reserves a native-style title bar above the
  // in-page menubar.
  if (platform.kind === 'web') return getFallbackStrategy(platform);

  switch (platform.os) {
    case 'mac':
      return getMacOSStrategy(platform);
    case 'windows':
      return getWindowsStrategy(platform);
    case 'linux':
      return getLinuxStrategy(platform);
    default:
      return getFallbackStrategy(platform);
  }
}

function getMacOSStrategy(_platform: PlatformInfo): WindowChromeStrategy {
  // If native menu capability is available, use system menu bar
  if (_platform.capabilities.has('nativeMenu')) {
    return {
      menubarStrategy: 'native-application-menu',
      decorationMode: 'native',
      controlsPosition: 'native',
      showCustomTitleBar: false,
      showCustomMenubar: false,
    };
  }

  // Fallback to custom menubar (for web or when native menu unavailable)
  return {
    menubarStrategy: 'custom-window-menubar',
    decorationMode: 'native',
    controlsPosition: 'native',
    showCustomTitleBar: false,
    showCustomMenubar: true,
    menubarPlacement: 'below-titlebar',
  };
}

function getWindowsStrategy(_platform: PlatformInfo): WindowChromeStrategy {
  return {
    menubarStrategy: 'native-titlebar-custom-menubar',
    decorationMode: 'native',
    controlsPosition: 'right',
    showCustomTitleBar: false,
    showCustomMenubar: true,
    menubarPlacement: 'below-titlebar',
  };
}

function getLinuxStrategy(_platform: PlatformInfo): WindowChromeStrategy {
  const displayServer = detectDisplayServer();
  const buttonLayout = detectButtonLayout();

  return {
    menubarStrategy: 'fully-custom-window-chrome',
    decorationMode: displayServer === 'wayland' ? 'client-side' : 'server-side',
    controlsPosition: buttonLayout,
    showCustomTitleBar: true,
    showCustomMenubar: true,
    displayServer,
    buttonLayout,
  };
}

function getFallbackStrategy(platform: PlatformInfo): WindowChromeStrategy {
  // Browser runtime
  if (platform.kind === 'web') {
    return {
      menubarStrategy: 'browser-menubar',
      decorationMode: 'native',
      controlsPosition: 'hidden',
      showCustomTitleBar: false,
      showCustomMenubar: true,
      menubarPlacement: 'top-of-page',
    };
  }

  // Unknown desktop platform - use conservative custom chrome
  return {
    menubarStrategy: 'fully-custom-window-chrome',
    decorationMode: 'custom',
    controlsPosition: 'right',
    showCustomTitleBar: true,
    showCustomMenubar: true,
  };
}

// ─── State Management ───────────────────────────────────────────────────────

/**
 * Create initial window chrome state.
 */
export function createInitialChromeState(
  strategy: WindowChromeStrategy,
  title: string = 'Varve',
): WindowChromeState {
  return {
    strategy,
    isFocused: true,
    isMaximized: false,
    isFullscreen: false,
    isResizable: true,
    canMinimize: true,
    canMaximize: true,
    canClose: true,
    scaleFactor: 1.0,
    title,
  };
}

/**
 * Update window chrome state in response to a window event.
 */
export function updateChromeState(
  currentState: WindowChromeState,
  event: WindowEvent,
): WindowChromeState {
  switch (event.type) {
    case 'focus':
      return { ...currentState, isFocused: event.focused };
    case 'maximize':
      return { ...currentState, isMaximized: event.maximized };
    case 'fullscreen':
      return { ...currentState, isFullscreen: event.fullscreen };
    case 'resizable':
      return { ...currentState, isResizable: event.resizable };
    case 'scale':
      return { ...currentState, scaleFactor: event.scaleFactor };
    case 'title':
      return { ...currentState, title: event.title };
    default:
      return currentState;
  }
}

// ─── Strategy Utilities ─────────────────────────────────────────────────────

/**
 * Check if a strategy uses native decorations.
 */
export function usesNativeDecorations(strategy: WindowChromeStrategy): boolean {
  return strategy.decorationMode === 'native';
}

/**
 * Check if a strategy uses custom window controls.
 */
export function usesCustomControls(strategy: WindowChromeStrategy): boolean {
  return strategy.showCustomTitleBar && strategy.controlsPosition !== 'hidden';
}

/**
 * Check if a strategy uses a custom menubar.
 */
export function usesCustomMenubar(strategy: WindowChromeStrategy): boolean {
  return strategy.showCustomMenubar;
}

// ─── Platform-level decision helpers ─────────────────────────────────────────
// These resolve the strategy once and answer the questions components actually
// ask. Using them avoids scattering `resolveWindowChromeStrategy` + property
// checks through presentation code.

/**
 * Whether the current platform should install a native application menu
 * (macOS system menu bar). On Windows and Linux the in-window custom menubar
 * is the source of truth — installing a native menu there produces a stray
 * GTK/win32 menubar strip above the webview content.
 */
export function shouldUseNativeMenu(platform: PlatformInfo): boolean {
  return usesNativeMenu(resolveWindowChromeStrategy(platform));
}

/**
 * Whether a custom in-window title bar (drag region + window controls) should
 * be rendered for the current platform.
 */
export function shouldRenderCustomTitleBar(platform: PlatformInfo): boolean {
  return resolveWindowChromeStrategy(platform).showCustomTitleBar;
}

/**
 * Whether a custom in-window menubar should be rendered for the current
 * platform.
 */
export function shouldRenderCustomMenubar(platform: PlatformInfo): boolean {
  return resolveWindowChromeStrategy(platform).showCustomMenubar;
}

/**
 * Check if a strategy uses native application menu (macOS).
 */
export function usesNativeMenu(strategy: WindowChromeStrategy): boolean {
  return strategy.menubarStrategy === 'native-application-menu';
}

/**
 * Get the effective title bar height for a strategy.
 *
 * Returns 0 for native decorations (OS handles height).
 * Returns custom height for custom title bars.
 */
export function getTitleBarHeight(strategy: WindowChromeStrategy): number {
  if (!strategy.showCustomTitleBar) return 0;
  // TODO: Use design token for custom title bar height
  return 32; // Default custom title bar height in pixels
}

/**
 * Get the effective menubar height for a strategy.
 *
 * Returns 0 if no menubar is shown.
 * Returns custom height for custom menubars.
 */
export function getMenubarHeight(strategy: WindowChromeStrategy): number {
  if (!strategy.showCustomMenubar) return 0;
  // TODO: Use design token for menubar height
  return 28; // Default menubar height in pixels
}

/**
 * Get the total top chrome height (title bar + menubar).
 */
export function getTotalTopChromeHeight(strategy: WindowChromeStrategy): number {
  return getTitleBarHeight(strategy) + getMenubarHeight(strategy);
}
