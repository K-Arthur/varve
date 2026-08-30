/**
 * @vitest-environment node
 *
 * Auxiliary panel windows are a deliberately less-trusted Tauri surface.
 * Keep their capability narrow even when the main window needs filesystem,
 * dialog, updater, or opener access.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface CapabilityConfig {
  identifier: string;
  windows: string[];
  permissions: string[];
}

function loadPanelWindowCapability(): CapabilityConfig {
  const capabilityPath = join(__dirname, '../../src-tauri/capabilities/panel-windows.json');
  return JSON.parse(readFileSync(capabilityPath, 'utf-8')) as CapabilityConfig;
}

function loadDefaultCapability(): CapabilityConfig {
  const capabilityPath = join(__dirname, '../../src-tauri/capabilities/default.json');
  return JSON.parse(readFileSync(capabilityPath, 'utf-8')) as CapabilityConfig;
}

describe('auxiliary panel-window capability', () => {
  const capability = loadPanelWindowCapability();
  const defaultCapability = loadDefaultCapability();

  it('is scoped only to generated auxiliary labels', () => {
    expect(capability.identifier).toBe('panel-windows');
    expect(capability.windows).toEqual(['varve-w-*']);
  });

  it('permits only the native event, lifecycle, and geometry operations used by the window adapter', () => {
    expect(capability.permissions).toEqual([
      'core:event:allow-emit',
      'core:event:allow-listen',
      'core:event:allow-unlisten',
      'core:window:allow-close',
      'core:window:allow-minimize',
      'core:window:allow-unminimize',
      'core:window:allow-maximize',
      'core:window:allow-unmaximize',
      'core:window:allow-set-fullscreen',
      'core:window:allow-set-focus',
      'core:window:allow-show',
      'core:window:allow-hide',
      'core:window:allow-set-position',
      'core:window:allow-set-size',
      'core:window:allow-set-min-size',
      'core:window:allow-outer-position',
      'core:window:allow-outer-size',
      'core:window:allow-is-visible',
      'core:window:allow-is-focused',
      'core:window:allow-is-minimized',
      'core:window:allow-is-maximized',
      'core:window:allow-is-fullscreen',
      'core:window:allow-available-monitors',
      'core:window:allow-primary-monitor',
      'core:window:allow-current-monitor',
      'core:window:allow-get-all-windows',
    ]);
  });

  it('does not inherit broad core access or privileged plugin permissions', () => {
    const forbiddenPrefixes = [
      'core:default',
      'core:path:',
      'core:webview:',
      'core:app:',
      'core:menu:',
      'core:tray:',
      'dialog:',
      'fs:',
      'opener:',
      'process:',
      'updater:',
    ];

    for (const prefix of forbiddenPrefixes) {
      expect(capability.permissions.some((permission) => permission.startsWith(prefix))).toBe(
        false,
      );
    }
  });

  it('grants close-request destruction only to the primary listener context', () => {
    // Tauri's Window.onCloseRequested listener calls `this.destroy()` in the
    // source webview after its handler returns. The panel-window adapter
    // registers those listeners from the primary window, so this grant must
    // remain on `main` rather than broadening every auxiliary panel window.
    expect(defaultCapability.windows).toEqual(['main']);
    expect(defaultCapability.permissions).toContain('core:window:allow-destroy');
    expect(capability.permissions).not.toContain('core:window:allow-destroy');
  });
});
