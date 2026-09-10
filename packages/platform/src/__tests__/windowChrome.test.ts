/**
 * Tests for window chrome strategy resolution and state management.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformInfo } from '../runtime';
import { resetPlatformInfo } from '../runtime';
import {
  createInitialChromeState,
  detectButtonLayout,
  detectDisplayServer,
  getMenubarHeight,
  getTitleBarHeight,
  getTotalTopChromeHeight,
  resetWindowChromeTestOverrides,
  resolveWindowChromeStrategy,
  setButtonLayoutForTest,
  setDisplayServerForTest,
  shouldRenderCustomMenubar,
  shouldRenderCustomTitleBar,
  shouldUseNativeMenu,
  updateChromeState,
  usesCustomControls,
  usesCustomMenubar,
  usesNativeDecorations,
  usesNativeMenu,
  type WindowChromeStrategy,
  type WindowEvent,
} from '../windowChrome';

describe('windowChrome', () => {
  afterEach(() => {
    resetWindowChromeTestOverrides();
    resetPlatformInfo();
  });

  describe('display server detection', () => {
    it('returns unknown by default', () => {
      expect(detectDisplayServer()).toBe('unknown');
    });

    it('respects test override', () => {
      setDisplayServerForTest('wayland');
      expect(detectDisplayServer()).toBe('wayland');
      setDisplayServerForTest('x11');
      expect(detectDisplayServer()).toBe('x11');
    });

    it('resets after override cleared', () => {
      setDisplayServerForTest('wayland');
      expect(detectDisplayServer()).toBe('wayland');
      resetWindowChromeTestOverrides();
      expect(detectDisplayServer()).toBe('unknown');
    });
  });

  describe('button layout detection', () => {
    it('returns right by default', () => {
      expect(detectButtonLayout()).toBe('right');
    });

    it('respects test override', () => {
      setButtonLayoutForTest('left');
      expect(detectButtonLayout()).toBe('left');
      setButtonLayoutForTest('right');
      expect(detectButtonLayout()).toBe('right');
    });

    it('resets after override cleared', () => {
      setButtonLayoutForTest('left');
      expect(detectButtonLayout()).toBe('left');
      resetWindowChromeTestOverrides();
      expect(detectButtonLayout()).toBe('right');
    });
  });

  describe('strategy resolution', () => {
    const mockPlatform: PlatformInfo = {
      kind: 'tauri',
      os: 'linux',
      capabilities: new Set(['nativeMenu']),
      hasTauriIpc: true,
      hasNativeFs: true,
      hasWebGpu: false,
      hasWebWorker: true,
      hasWasm: true,
    };

    it('resolves macOS strategy with native menu', () => {
      const platform: PlatformInfo = { ...mockPlatform, os: 'mac' };
      const strategy = resolveWindowChromeStrategy(platform);

      expect(strategy.menubarStrategy).toBe('native-application-menu');
      expect(strategy.decorationMode).toBe('native');
      expect(strategy.controlsPosition).toBe('native');
      expect(strategy.showCustomTitleBar).toBe(false);
      expect(strategy.showCustomMenubar).toBe(false);
    });

    it('resolves macOS strategy without native menu', () => {
      const platform: PlatformInfo = {
        ...mockPlatform,
        os: 'mac',
        capabilities: new Set(), // No nativeMenu capability
      };
      const strategy = resolveWindowChromeStrategy(platform);

      expect(strategy.menubarStrategy).toBe('custom-window-menubar');
      expect(strategy.decorationMode).toBe('native');
      expect(strategy.controlsPosition).toBe('native');
      expect(strategy.showCustomTitleBar).toBe(false);
      expect(strategy.showCustomMenubar).toBe(true);
      expect(strategy.menubarPlacement).toBe('below-titlebar');
    });

    it('resolves Windows strategy', () => {
      const platform: PlatformInfo = { ...mockPlatform, os: 'windows' };
      const strategy = resolveWindowChromeStrategy(platform);

      expect(strategy.menubarStrategy).toBe('native-titlebar-custom-menubar');
      expect(strategy.decorationMode).toBe('native');
      expect(strategy.controlsPosition).toBe('right');
      expect(strategy.showCustomTitleBar).toBe(false);
      expect(strategy.showCustomMenubar).toBe(true);
      expect(strategy.menubarPlacement).toBe('below-titlebar');
    });

    it('resolves Linux strategy with Wayland', () => {
      setDisplayServerForTest('wayland');
      const platform: PlatformInfo = { ...mockPlatform, os: 'linux' };
      const strategy = resolveWindowChromeStrategy(platform);

      expect(strategy.menubarStrategy).toBe('fully-custom-window-chrome');
      expect(strategy.decorationMode).toBe('client-side');
      expect(strategy.controlsPosition).toBe('right');
      expect(strategy.showCustomTitleBar).toBe(true);
      expect(strategy.showCustomMenubar).toBe(true);
      expect(strategy.displayServer).toBe('wayland');
      expect(strategy.buttonLayout).toBe('right');
    });

    it('resolves Linux strategy with X11', () => {
      setDisplayServerForTest('x11');
      const platform: PlatformInfo = { ...mockPlatform, os: 'linux' };
      const strategy = resolveWindowChromeStrategy(platform);

      expect(strategy.menubarStrategy).toBe('fully-custom-window-chrome');
      expect(strategy.decorationMode).toBe('server-side');
      expect(strategy.controlsPosition).toBe('right');
      expect(strategy.showCustomTitleBar).toBe(true);
      expect(strategy.showCustomMenubar).toBe(true);
      expect(strategy.displayServer).toBe('x11');
      expect(strategy.buttonLayout).toBe('right');
    });

    it('resolves browser strategy', () => {
      const platform: PlatformInfo = { ...mockPlatform, kind: 'web', os: 'unknown' };
      const strategy = resolveWindowChromeStrategy(platform);

      expect(strategy.menubarStrategy).toBe('browser-menubar');
      expect(strategy.decorationMode).toBe('native');
      expect(strategy.controlsPosition).toBe('hidden');
      expect(strategy.showCustomTitleBar).toBe(false);
      expect(strategy.showCustomMenubar).toBe(true);
      expect(strategy.menubarPlacement).toBe('top-of-page');
    });

    it('resolves browser strategy even when hosted on Linux', () => {
      const platform: PlatformInfo = { ...mockPlatform, kind: 'web', os: 'linux' };
      const strategy = resolveWindowChromeStrategy(platform);

      expect(strategy.menubarStrategy).toBe('browser-menubar');
      expect(strategy.showCustomTitleBar).toBe(false);
      expect(strategy.controlsPosition).toBe('hidden');
    });

    it('resolves fallback strategy for unknown OS', () => {
      const platform: PlatformInfo = { ...mockPlatform, os: 'unknown' };
      const strategy = resolveWindowChromeStrategy(platform);

      expect(strategy.menubarStrategy).toBe('fully-custom-window-chrome');
      expect(strategy.decorationMode).toBe('custom');
      expect(strategy.controlsPosition).toBe('right');
      expect(strategy.showCustomTitleBar).toBe(true);
      expect(strategy.showCustomMenubar).toBe(true);
    });

    it('applies preferences override', () => {
      const platform: PlatformInfo = { ...mockPlatform, os: 'windows' };
      const preferences: Partial<WindowChromeStrategy> = {
        showCustomTitleBar: true,
        controlsPosition: 'left',
      };
      const strategy = resolveWindowChromeStrategy(platform, preferences);

      expect(strategy.showCustomTitleBar).toBe(true);
      expect(strategy.controlsPosition).toBe('left');
      // Other values should come from base strategy
      expect(strategy.menubarStrategy).toBe('native-titlebar-custom-menubar');
    });
  });

  describe('platform-level decision helpers', () => {
    const mockPlatform: PlatformInfo = {
      kind: 'tauri',
      os: 'linux',
      capabilities: new Set(['nativeMenu']),
      hasTauriIpc: true,
      hasNativeFs: true,
      hasWebGpu: false,
      hasWebWorker: true,
      hasWasm: true,
    };

    it('shouldUseNativeMenu is true only for macOS with nativeMenu capability', () => {
      expect(shouldUseNativeMenu({ ...mockPlatform, os: 'mac' })).toBe(true);
      expect(shouldUseNativeMenu({ ...mockPlatform, os: 'windows' })).toBe(false);
      expect(shouldUseNativeMenu(mockPlatform)).toBe(false);
      expect(shouldUseNativeMenu({ ...mockPlatform, kind: 'web', os: 'unknown' })).toBe(false);
    });

    it('shouldRenderCustomTitleBar is true only for custom-chrome platforms', () => {
      // Linux (fully-custom chrome) and unknown desktop platforms render a
      // custom title bar with window controls.
      expect(shouldRenderCustomTitleBar({ ...mockPlatform, os: 'linux' })).toBe(true);
      expect(shouldRenderCustomTitleBar({ ...mockPlatform, kind: 'web', os: 'unknown' })).toBe(
        false,
      );
      // Windows and macOS use native title bars.
      expect(shouldRenderCustomTitleBar({ ...mockPlatform, os: 'windows' })).toBe(false);
      expect(shouldRenderCustomTitleBar({ ...mockPlatform, os: 'mac' })).toBe(false);
    });

    it('shouldRenderCustomMenubar is true everywhere except macOS native menu', () => {
      expect(shouldRenderCustomMenubar({ ...mockPlatform, os: 'linux' })).toBe(true);
      expect(shouldRenderCustomMenubar({ ...mockPlatform, os: 'windows' })).toBe(true);
      expect(shouldRenderCustomMenubar({ ...mockPlatform, kind: 'web', os: 'unknown' })).toBe(true);
      // macOS with native menu capability hides the custom menubar.
      expect(shouldRenderCustomMenubar({ ...mockPlatform, os: 'mac' })).toBe(false);
    });
  });

  describe('state management', () => {
    const mockStrategy: WindowChromeStrategy = {
      menubarStrategy: 'fully-custom-window-chrome',
      decorationMode: 'custom',
      controlsPosition: 'right',
      showCustomTitleBar: true,
      showCustomMenubar: true,
    };

    it('creates initial state', () => {
      const state = createInitialChromeState(mockStrategy, 'Test Title');

      expect(state.strategy).toBe(mockStrategy);
      expect(state.isFocused).toBe(true);
      expect(state.isMaximized).toBe(false);
      expect(state.isFullscreen).toBe(false);
      expect(state.isResizable).toBe(true);
      expect(state.canMinimize).toBe(true);
      expect(state.canMaximize).toBe(true);
      expect(state.canClose).toBe(true);
      expect(state.scaleFactor).toBe(1.0);
      expect(state.title).toBe('Test Title');
    });

    it('updates focus state', () => {
      const state = createInitialChromeState(mockStrategy);
      const event: WindowEvent = { type: 'focus', focused: false };
      const updated = updateChromeState(state, event);

      expect(updated.isFocused).toBe(false);
      expect(updated).not.toBe(state); // Should return new object
    });

    it('updates maximize state', () => {
      const state = createInitialChromeState(mockStrategy);
      const event: WindowEvent = { type: 'maximize', maximized: true };
      const updated = updateChromeState(state, event);

      expect(updated.isMaximized).toBe(true);
    });

    it('updates fullscreen state', () => {
      const state = createInitialChromeState(mockStrategy);
      const event: WindowEvent = { type: 'fullscreen', fullscreen: true };
      const updated = updateChromeState(state, event);

      expect(updated.isFullscreen).toBe(true);
    });

    it('updates resizable state', () => {
      const state = createInitialChromeState(mockStrategy);
      const event: WindowEvent = { type: 'resizable', resizable: false };
      const updated = updateChromeState(state, event);

      expect(updated.isResizable).toBe(false);
    });

    it('updates scale factor', () => {
      const state = createInitialChromeState(mockStrategy);
      const event: WindowEvent = { type: 'scale', scaleFactor: 1.5 };
      const updated = updateChromeState(state, event);

      expect(updated.scaleFactor).toBe(1.5);
    });

    it('updates title', () => {
      const state = createInitialChromeState(mockStrategy);
      const event: WindowEvent = { type: 'title', title: 'New Title' };
      const updated = updateChromeState(state, event);

      expect(updated.title).toBe('New Title');
    });

    it('ignores unknown event types', () => {
      const state = createInitialChromeState(mockStrategy);
      const event = { type: 'unknown' } as unknown as WindowEvent;
      const updated = updateChromeState(state, event);

      expect(updated).toBe(state);
    });
  });

  describe('strategy utilities', () => {
    it('detects native decorations', () => {
      const strategy: WindowChromeStrategy = {
        menubarStrategy: 'native-application-menu',
        decorationMode: 'native',
        controlsPosition: 'native',
        showCustomTitleBar: false,
        showCustomMenubar: false,
      };
      expect(usesNativeDecorations(strategy)).toBe(true);

      const customStrategy: WindowChromeStrategy = {
        ...strategy,
        decorationMode: 'custom',
      };
      expect(usesNativeDecorations(customStrategy)).toBe(false);
    });

    it('detects custom controls', () => {
      const strategy: WindowChromeStrategy = {
        menubarStrategy: 'fully-custom-window-chrome',
        decorationMode: 'custom',
        controlsPosition: 'right',
        showCustomTitleBar: true,
        showCustomMenubar: true,
      };
      expect(usesCustomControls(strategy)).toBe(true);

      const noControlsStrategy: WindowChromeStrategy = {
        ...strategy,
        showCustomTitleBar: false,
      };
      expect(usesCustomControls(noControlsStrategy)).toBe(false);

      const hiddenControlsStrategy: WindowChromeStrategy = {
        ...strategy,
        controlsPosition: 'hidden',
      };
      expect(usesCustomControls(hiddenControlsStrategy)).toBe(false);
    });

    it('detects custom menubar', () => {
      const strategy: WindowChromeStrategy = {
        menubarStrategy: 'custom-window-menubar',
        decorationMode: 'native',
        controlsPosition: 'native',
        showCustomTitleBar: false,
        showCustomMenubar: true,
      };
      expect(usesCustomMenubar(strategy)).toBe(true);

      const noMenubarStrategy: WindowChromeStrategy = {
        ...strategy,
        showCustomMenubar: false,
      };
      expect(usesCustomMenubar(noMenubarStrategy)).toBe(false);
    });

    it('detects native menu', () => {
      const strategy: WindowChromeStrategy = {
        menubarStrategy: 'native-application-menu',
        decorationMode: 'native',
        controlsPosition: 'native',
        showCustomTitleBar: false,
        showCustomMenubar: false,
      };
      expect(usesNativeMenu(strategy)).toBe(true);

      const customStrategy: WindowChromeStrategy = {
        ...strategy,
        menubarStrategy: 'custom-window-menubar',
      };
      expect(usesNativeMenu(customStrategy)).toBe(false);
    });

    it('calculates title bar height', () => {
      const customStrategy: WindowChromeStrategy = {
        menubarStrategy: 'fully-custom-window-chrome',
        decorationMode: 'custom',
        controlsPosition: 'right',
        showCustomTitleBar: true,
        showCustomMenubar: true,
      };
      expect(getTitleBarHeight(customStrategy)).toBe(32);

      const nativeStrategy: WindowChromeStrategy = {
        menubarStrategy: 'native-application-menu',
        decorationMode: 'native',
        controlsPosition: 'native',
        showCustomTitleBar: false,
        showCustomMenubar: false,
      };
      expect(getTitleBarHeight(nativeStrategy)).toBe(0);
    });

    it('calculates menubar height', () => {
      const customStrategy: WindowChromeStrategy = {
        menubarStrategy: 'custom-window-menubar',
        decorationMode: 'native',
        controlsPosition: 'native',
        showCustomTitleBar: false,
        showCustomMenubar: true,
      };
      expect(getMenubarHeight(customStrategy)).toBe(28);

      const noMenubarStrategy: WindowChromeStrategy = {
        ...customStrategy,
        showCustomMenubar: false,
      };
      expect(getMenubarHeight(noMenubarStrategy)).toBe(0);
    });

    it('calculates total top chrome height', () => {
      const fullCustomStrategy: WindowChromeStrategy = {
        menubarStrategy: 'fully-custom-window-chrome',
        decorationMode: 'custom',
        controlsPosition: 'right',
        showCustomTitleBar: true,
        showCustomMenubar: true,
      };
      expect(getTotalTopChromeHeight(fullCustomStrategy)).toBe(60); // 32 + 28

      const titleOnlyStrategy: WindowChromeStrategy = {
        ...fullCustomStrategy,
        showCustomMenubar: false,
      };
      expect(getTotalTopChromeHeight(titleOnlyStrategy)).toBe(32);

      const menubarOnlyStrategy: WindowChromeStrategy = {
        ...fullCustomStrategy,
        showCustomTitleBar: false,
      };
      expect(getTotalTopChromeHeight(menubarOnlyStrategy)).toBe(28);

      const nativeStrategy: WindowChromeStrategy = {
        menubarStrategy: 'native-application-menu',
        decorationMode: 'native',
        controlsPosition: 'native',
        showCustomTitleBar: false,
        showCustomMenubar: false,
      };
      expect(getTotalTopChromeHeight(nativeStrategy)).toBe(0);
    });
  });
});
