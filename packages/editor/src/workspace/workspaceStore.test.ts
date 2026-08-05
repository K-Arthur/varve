/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getEffectiveWorkspaceConfig,
  getWorkspacePreferences,
  loadWorkspacePreferences,
  resetAllPreferences,
  resetModePreferences,
  resetWorkspacePreferenceCache,
  saveWorkspacePreferences,
  setPanelOverride,
  setWorkspacePreferences,
  subscribeWorkspacePreferences,
  updateWorkspacePreferences,
} from './workspaceStore';

const STORAGE_KEY = 'varve-workspace-preferences';
const LEGACY_STORAGE_KEY = 'strata-workspace-preferences';

describe('workspaceStore — persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspacePreferenceCache();
  });

  it('loads defaults when nothing is stored', () => {
    const prefs = loadWorkspacePreferences();
    for (const mode of ['design', 'print', 'drawing', 'image', 'motion', 'codegen', 'logo']) {
      expect(prefs[mode as keyof typeof prefs].customized).toBe(false);
    }
  });

  it('survives a save/load round-trip', () => {
    let prefs = loadWorkspacePreferences();
    prefs = setPanelOverride(prefs, 'design', 'layers', { visible: false });
    saveWorkspacePreferences(prefs);
    resetWorkspacePreferenceCache();
    const reloaded = loadWorkspacePreferences();
    expect(reloaded.design.panelOverrides?.layers?.visible).toBe(false);
    expect(reloaded.design.customized).toBe(true);
  });

  it('falls back to the legacy strata-* key', () => {
    localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({
        design: { customized: true, panelOverrides: { layers: { visible: false } } },
      }),
    );
    const prefs = loadWorkspacePreferences();
    expect(prefs.design.customized).toBe(true);
    expect(prefs.design.panelOverrides?.layers?.visible).toBe(false);
  });

  it('recovers from corrupted JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json!!');
    const prefs = loadWorkspacePreferences();
    expect(prefs.design.customized).toBe(false);
  });

  it('sanitizes unknown panel ids and invalid field types in overrides', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        design: {
          customized: true,
          panelOverrides: {
            layers: { visible: false, collapsed: 'yes', order: 'three' },
            notAPanel: { visible: true },
            timeline: { visible: 'nope' },
          },
        },
      }),
    );
    const prefs = loadWorkspacePreferences();
    const ov = prefs.design.panelOverrides!;
    expect(ov.layers?.visible).toBe(false);
    // Invalid-typed fields are dropped, not kept.
    expect(ov.layers?.collapsed).toBeUndefined();
    expect(ov.layers?.order).toBeUndefined();
    // Unknown panel ids never surface.
    expect((ov as Record<string, unknown>).notAPanel).toBeUndefined();
    expect(ov.timeline?.visible).toBeUndefined();
  });

  it('missing modes fall back to defaults', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ design: { customized: true } }));
    const prefs = loadWorkspacePreferences();
    expect(prefs.design.customized).toBe(true);
    expect(prefs.logo.customized).toBe(false);
  });
});

describe('workspaceStore — effective configuration', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspacePreferenceCache();
  });

  it('equals the built-in config with no overrides', () => {
    const effective = getEffectiveWorkspaceConfig('design');
    expect(effective.panels.layers.visible).toBe(true);
    expect(effective.panels.codegen.visible).toBe(false);
    expect(effective.statusBar).toBe(true);
  });

  it('merges panel overrides into the effective config', () => {
    setWorkspacePreferences(
      setPanelOverride(getWorkspacePreferences(), 'design', 'layers', { visible: false }),
    );
    const effective = getEffectiveWorkspaceConfig('design');
    expect(effective.panels.layers.visible).toBe(false);
    // Unoverridden panels keep their built-in values.
    expect(effective.panels.inspector.visible).toBe(true);
  });

  it('resetModePreferences restores the built-in config', () => {
    updateWorkspacePreferences((prefs) =>
      setPanelOverride(prefs, 'design', 'inspector', { visible: false }),
    );
    expect(getEffectiveWorkspaceConfig('design').panels.inspector.visible).toBe(false);
    updateWorkspacePreferences((prefs) => resetModePreferences(prefs, 'design'));
    expect(getEffectiveWorkspaceConfig('design').panels.inspector.visible).toBe(true);
  });

  it('resetAllPreferences clears every mode', () => {
    updateWorkspacePreferences((prefs) =>
      setPanelOverride(prefs, 'design', 'layers', { visible: false }),
    );
    setWorkspacePreferences(resetAllPreferences());
    expect(getEffectiveWorkspaceConfig('design').panels.layers.visible).toBe(true);
  });

  it('notifies subscribers on change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspacePreferences(listener);
    updateWorkspacePreferences((prefs) =>
      setPanelOverride(prefs, 'logo', 'logo', { visible: false }),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    updateWorkspacePreferences((prefs) => prefs);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
