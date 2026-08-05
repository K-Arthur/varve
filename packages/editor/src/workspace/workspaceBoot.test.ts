/** @vitest-environment jsdom */

/**
 * Boot-time panel resolution.
 *
 * The app used to seed its initial panel booleans from `settings.panel`, a
 * single *global* mirror. That mirror is written by whichever workspace last
 * applied a layout, so customizing Print's panels changed the layout the app
 * booted into under Design, and a per-workspace customization did not survive
 * a restart at all. Boot now resolves through the effective config instead.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { BOOT_WORKSPACE_MODE, initialPanelVisibility } from '../context/useWorkspaceMode';
import { loadSettings, updateSettings } from '../settings';
import { getWorkspacePreferences, resetWorkspacePreferenceCache } from './workspaceStore';
import { getWorkspaceConfig } from './workspaceTypes';

const PREFS_KEY = 'varve-workspace-preferences';

describe('initialPanelVisibility', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspacePreferenceCache();
  });

  it('boots into Design', () => {
    // Not persisted across launches on purpose: a document must never open
    // into a specialist environment the user left active days ago.
    expect(BOOT_WORKSPACE_MODE).toBe('design');
  });

  it('uses the built-in defaults when nothing is customized', () => {
    const base = getWorkspaceConfig('design').panels;
    const panels = initialPanelVisibility('design');
    expect(panels.leftPanelVisible).toBe(base.layers.visible);
    expect(panels.rightPanelVisible).toBe(base.inspector.visible);
    expect(panels.libraryPanelVisible).toBe(base.library.visible);
  });

  it('re-applies a per-workspace override after a restart', () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        design: { customized: true, panelOverrides: { layers: { visible: false } } },
      }),
    );
    resetWorkspacePreferenceCache();
    expect(initialPanelVisibility('design').leftPanelVisible).toBe(false);
  });

  it('does not let another workspace customization leak into the boot layout', () => {
    // Print hides the layers panel; Design does not. Booting into Design must
    // read Design's overrides, never Print's.
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        print: { customized: true, panelOverrides: { layers: { visible: false } } },
      }),
    );
    resetWorkspacePreferenceCache();
    expect(initialPanelVisibility('design').leftPanelVisible).toBe(true);
  });

  it('migrates a pre-upgrade global panel setting into this mode once', () => {
    // Upgrading user: they hid the layers panel back when `settings.panel` was
    // the only store, so there is a mirror value but no override yet.
    updateSettings({ panel: { leftPanelVisible: false } });
    expect(getWorkspacePreferences().design.customized).toBe(false);

    expect(initialPanelVisibility('design').leftPanelVisible).toBe(false);
    expect(getWorkspacePreferences().design.panelOverrides?.layers?.visible).toBe(false);
  });

  it('does not invent an override when the mirror agrees with the default', () => {
    // Equality carries no information about what the user chose, so seeding on
    // it would mark every fresh install as "customized".
    updateSettings({
      panel: { leftPanelVisible: getWorkspaceConfig('design').panels.layers.visible },
    });
    initialPanelVisibility('design');
    expect(getWorkspacePreferences().design.customized).toBe(false);
  });

  it('leaves an existing customization alone rather than re-seeding from the mirror', () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        design: { customized: true, panelOverrides: { layers: { visible: true } } },
      }),
    );
    resetWorkspacePreferenceCache();
    updateSettings({ panel: { leftPanelVisible: false } });

    expect(initialPanelVisibility('design').leftPanelVisible).toBe(true);
    expect(loadSettings().panel.leftPanelVisible).toBe(false);
  });
});
