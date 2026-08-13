/** @vitest-environment jsdom */

import type { Platform } from '@varve/platform';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachWorkspacePreferencePlatform,
  flushWorkspacePreferences,
  getEffectiveWorkspaceConfig,
  getWorkspacePersistenceError,
  getWorkspacePreferences,
  hydrateWorkspacePreferencesFromPlatform,
  loadWorkspacePreferences,
  resetAllPreferences,
  resetModePreferences,
  resetWorkspacePreferenceCache,
  saveWorkspacePreferences,
  setPanelOverride,
  setToolbarToolOverride,
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

  it('drops the removed collapsed/order override fields even when well-typed (self-healing migration)', () => {
    // Pre-2026-08-13 payloads carried `collapsed`/`order` in panel overrides.
    // The fields were decorative (no runtime consumer) and are gone from the
    // schema; sanitizing them away here is the migration — stored payloads
    // heal on load instead of needing a version bump.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        design: {
          customized: true,
          panelOverrides: {
            layers: { visible: false, collapsed: false, order: 2 },
          },
        },
      }),
    );
    const prefs = loadWorkspacePreferences();
    const ov = prefs.design.panelOverrides!;
    expect(ov.layers?.visible).toBe(false);
    expect(ov.layers?.collapsed).toBeUndefined();
    expect(ov.layers?.order).toBeUndefined();
    expect(JSON.stringify(ov.layers)).toBe(JSON.stringify({ visible: false }));
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

  it('keeps essential navigation tools available when customization hides tools', () => {
    let prefs = getWorkspacePreferences();
    prefs = setToolbarToolOverride(prefs, 'design', 'rect', false);
    prefs = setToolbarToolOverride(prefs, 'design', 'select', false);
    prefs = setToolbarToolOverride(prefs, 'design', 'hand', false);
    prefs = setToolbarToolOverride(prefs, 'design', 'zoom', false);
    setWorkspacePreferences(prefs);

    const toolIds = getEffectiveWorkspaceConfig('design').toolbar.tools.map((tool) => tool.toolId);
    expect(toolIds).not.toContain('rect');
    expect(toolIds).toEqual(expect.arrayContaining(['select', 'hand', 'zoom']));
  });

  it('applies tool overrides to flyout members, not just the main row', () => {
    // Boolean operations live only in a flyout. The sanitizer used to accept
    // override ids present in `toolbar.tools` only, so hiding a boolean op was
    // discarded on save and the flyout ignored it on read.
    setWorkspacePreferences(
      setToolbarToolOverride(getWorkspacePreferences(), 'design', 'booleanExclude', false),
    );
    const boolean = getEffectiveWorkspaceConfig('design').toolbar.flyouts?.find(
      (flyout) => flyout.id === 'boolean',
    );
    expect(boolean?.tools).not.toContain('booleanExclude');
    expect(boolean?.tools).toContain('booleanUnion');
  });

  it('survives a reload with a flyout-only tool override', () => {
    setWorkspacePreferences(
      setToolbarToolOverride(getWorkspacePreferences(), 'design', 'booleanExclude', false),
    );
    resetWorkspacePreferenceCache();
    expect(loadWorkspacePreferences().design.toolbarToolOverrides?.booleanExclude).toBe(false);
  });

  it('still rejects overrides for tools the workspace does not declare', () => {
    setWorkspacePreferences(
      setToolbarToolOverride(getWorkspacePreferences(), 'design', 'notATool', false),
    );
    resetWorkspacePreferenceCache();
    expect(loadWorkspacePreferences().design.toolbarToolOverrides?.notATool).toBeUndefined();
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

describe('workspaceStore — durable (platform) persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspacePreferenceCache();
  });

  /** Minimal stand-in for the app-setting slice of the Platform facade. */
  function fakePlatform(initial?: string) {
    const store = new Map<string, string>();
    if (initial !== undefined) store.set('workspace-preferences', initial);
    return {
      store,
      getAppSetting: vi.fn(async (k: string) => store.get(k) ?? null),
      setAppSetting: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
    } as unknown as Platform & { store: Map<string, string> };
  }

  it('restores customizations when localStorage has been wiped', async () => {
    // The WebKitGTK failure mode: platform storage survived the relaunch,
    // localStorage did not.
    const platform = fakePlatform(
      JSON.stringify({
        design: {
          customized: true,
          lastCustomized: 5,
          panelOverrides: { layers: { visible: false } },
        },
      }),
    );
    expect(await hydrateWorkspacePreferencesFromPlatform(platform)).toBe(true);
    expect(getWorkspacePreferences().design.panelOverrides?.layers?.visible).toBe(false);
  });

  it('keeps the more recent customization per mode', async () => {
    setWorkspacePreferences({
      ...resetAllPreferences(),
      design: {
        customized: true,
        lastCustomized: 900,
        panelOverrides: { layers: { visible: true } },
      },
    });
    const platform = fakePlatform(
      JSON.stringify({
        design: {
          customized: true,
          lastCustomized: 100,
          panelOverrides: { layers: { visible: false } },
        },
      }),
    );
    await hydrateWorkspacePreferencesFromPlatform(platform);
    // Local is newer, so the stale durable copy must not overwrite it.
    expect(getWorkspacePreferences().design.panelOverrides?.layers?.visible).toBe(true);
  });

  it('never lets an uncustomized durable copy erase a local customization', async () => {
    setWorkspacePreferences({
      ...resetAllPreferences(),
      design: {
        customized: true,
        lastCustomized: 1,
        panelOverrides: { layers: { visible: false } },
      },
    });
    await hydrateWorkspacePreferencesFromPlatform(fakePlatform(JSON.stringify({})));
    expect(getWorkspacePreferences().design.panelOverrides?.layers?.visible).toBe(false);
  });

  it('survives a corrupt durable payload without losing local state', async () => {
    setWorkspacePreferences({
      ...resetAllPreferences(),
      design: {
        customized: true,
        lastCustomized: 1,
        panelOverrides: { layers: { visible: false } },
      },
    });
    expect(await hydrateWorkspacePreferencesFromPlatform(fakePlatform('{not json'))).toBe(false);
    expect(getWorkspacePreferences().design.panelOverrides?.layers?.visible).toBe(false);
    expect(getWorkspacePersistenceError()?.layer).toBe('platform');
  });

  it('sanitizes a durable payload the same way as the local mirror', async () => {
    const platform = fakePlatform(
      JSON.stringify({
        design: {
          customized: true,
          lastCustomized: 9,
          panelOverrides: { notAPanel: { visible: false } },
        },
      }),
    );
    await hydrateWorkspacePreferencesFromPlatform(platform);
    const ov = getWorkspacePreferences().design.panelOverrides ?? {};
    expect((ov as Record<string, unknown>).notAPanel).toBeUndefined();
  });

  it('coalesces bursty writes into one durable write', async () => {
    const platform = fakePlatform();
    attachWorkspacePreferencePlatform(platform);
    for (const mode of ['design', 'print', 'logo'] as const) {
      updateWorkspacePreferences((p) => setPanelOverride(p, mode, 'layers', { visible: false }));
    }
    expect(platform.setAppSetting).not.toHaveBeenCalled();
    await flushWorkspacePreferences();
    expect(platform.setAppSetting).toHaveBeenCalledTimes(1);
  });

  it('records a diagnostic instead of throwing when the durable write fails', async () => {
    const platform = fakePlatform();
    vi.mocked(platform.setAppSetting).mockRejectedValue(new Error('quota exceeded'));
    attachWorkspacePreferencePlatform(platform);
    updateWorkspacePreferences((p) => setPanelOverride(p, 'design', 'layers', { visible: false }));
    await flushWorkspacePreferences();
    expect(getWorkspacePersistenceError()?.message).toContain('quota exceeded');
    // …and the session snapshot is unaffected.
    expect(getWorkspacePreferences().design.panelOverrides?.layers?.visible).toBe(false);
  });
});
