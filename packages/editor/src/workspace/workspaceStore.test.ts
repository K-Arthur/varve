/** @vitest-environment jsdom */

import type { Platform } from '@varve/platform';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachWorkspacePreferencePlatform,
  clearPanelWidths,
  flushWorkspacePreferences,
  getEffectiveWorkspaceConfig,
  getWorkspacePersistenceError,
  getWorkspacePreferences,
  hydrateWorkspacePreferencesFromPlatform,
  loadWorkspacePreferences,
  resetAllPreferences,
  resetModePreferences,
  resetWorkspacePreferenceCache,
  savePanelWidths,
  saveWorkspacePreferences,
  setChromeOverride,
  setInspectorTabOrderOverride,
  setInspectorTabPinnedOverride,
  setPanelOverride,
  setStatusSectionOrderOverride,
  setToolbarPlacementOverride,
  setToolbarToolLocationOverride,
  setToolbarToolOrderOverride,
  setToolbarToolOverride,
  setToolbarToolPinnedOverride,
  setWorkspacePreferences,
  subscribeWorkspacePreferences,
  updateWorkspacePreferences,
} from './workspaceStore';
import { resolveToolbarPlacement, WORKSPACE_CONFIGS } from './workspaceTypes';

const STORAGE_KEY = 'varve-workspace-preferences';
const LEGACY_STORAGE_KEY = 'strata-workspace-preferences';

describe('workspaceStore — persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspacePreferenceCache();
  });

  it('loads defaults when nothing is stored', () => {
    const prefs = loadWorkspacePreferences();
    for (const mode of [
      'design',
      'print',
      'drawing',
      'image',
      'motion',
      'email',
      'codegen',
      'logo',
    ]) {
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
    expect((ov.layers as Record<string, unknown> | undefined)?.collapsed).toBeUndefined();
    expect((ov.layers as Record<string, unknown> | undefined)?.order).toBeUndefined();
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
    expect((ov.layers as Record<string, unknown> | undefined)?.collapsed).toBeUndefined();
    expect((ov.layers as Record<string, unknown> | undefined)?.order).toBeUndefined();
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

  it('persists toolbar ordering, existing-flyout membership, and overflow pins', () => {
    const original = getEffectiveWorkspaceConfig('design');
    const toolIds = original.toolbar.tools.map((item) => item.toolId);
    expect(toolIds.length).toBeGreaterThan(2);
    const reordered = [
      toolIds[1]!,
      toolIds[0]!,
      ...toolIds.slice(2),
      ...original.toolbar.flyouts!.flatMap((flyout) => flyout.tools),
    ];
    let prefs = getWorkspacePreferences();
    prefs = setToolbarToolOrderOverride(prefs, 'design', reordered);
    prefs = setToolbarToolLocationOverride(prefs, 'design', 'rect', 'boolean');
    prefs = setToolbarToolPinnedOverride(prefs, 'design', 'rect', true);
    setWorkspacePreferences(prefs);

    let effective = getEffectiveWorkspaceConfig('design');
    const expectedMainOrder = [toolIds[1]!, ...toolIds.slice(2).filter((id) => id !== 'rect')];
    expect(effective.toolbar.tools.slice(0, 2).map((item) => item.toolId)).toEqual(
      expectedMainOrder.slice(0, 2),
    );
    expect(effective.toolbar.tools.map((item) => item.toolId)).not.toContain('rect');
    expect(effective.toolbar.flyouts?.find((flyout) => flyout.id === 'boolean')?.tools).toContain(
      'rect',
    );
    expect(effective.toolbarPinnedToolIds).toContain('rect');

    resetWorkspacePreferenceCache();
    const reloaded = loadWorkspacePreferences();
    effective = getEffectiveWorkspaceConfig('design', reloaded);
    expect(effective.toolbar.tools.slice(0, 2).map((item) => item.toolId)).toEqual(
      expectedMainOrder.slice(0, 2),
    );
    expect(effective.toolbar.flyouts?.find((flyout) => flyout.id === 'boolean')?.tools).toContain(
      'rect',
    );
    expect(effective.toolbarPinnedToolIds).toContain('rect');
  });

  it('reorders inspector tabs and status sections while preserving visibility and pin state', () => {
    const original = getEffectiveWorkspaceConfig('design');
    const tabIds = original.inspectorTabs.map((tab) => tab.id);
    const sectionIds = original.statusSections.map((section) => section.id);
    let prefs = getWorkspacePreferences();
    prefs = setInspectorTabOrderOverride(prefs, 'design', [
      tabIds[1]!,
      tabIds[0]!,
      ...tabIds.slice(2),
    ]);
    prefs = setInspectorTabPinnedOverride(prefs, 'design', tabIds[2]!, true);
    prefs = setStatusSectionOrderOverride(prefs, 'design', [
      sectionIds[1]!,
      sectionIds[0]!,
      ...sectionIds.slice(2),
    ]);
    setWorkspacePreferences(prefs);

    const effective = getEffectiveWorkspaceConfig('design');
    expect(effective.inspectorTabs.slice(0, 2).map((tab) => tab.id)).toEqual(
      tabIds.slice(0, 2).reverse(),
    );
    expect(effective.inspectorTabs.find((tab) => tab.id === tabIds[2])?.overflowPriority).toBe(0);
    expect(effective.statusSections.slice(0, 2).map((section) => section.id)).toEqual(
      sectionIds.slice(0, 2).reverse(),
    );
  });

  it('drops unknown arrangement ids and flyout targets during preference sanitation', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        design: {
          customized: true,
          toolbarToolOrder: ['select', 'notATool'],
          toolbarToolLocations: { select: 'boolean', rect: 'boolean' },
          toolbarPinnedToolIds: ['rect', 'notATool', 'select'],
          inspectorTabOrder: ['properties', 'notATab'],
          inspectorTabPinnedOverrides: { properties: true, notATab: true },
          statusSectionOrder: ['zoom', 'notASection'],
        },
      }),
    );
    const prefs = loadWorkspacePreferences();
    expect(prefs.design.toolbarToolOrder).toEqual(['select']);
    expect(prefs.design.toolbarToolLocations).toEqual({ rect: 'boolean' });
    expect(prefs.design.toolbarPinnedToolIds).toEqual(['rect']);
    expect(prefs.design.inspectorTabOrder).toEqual(['properties']);
    expect(prefs.design.inspectorTabPinnedOverrides).toEqual({ properties: true });
    expect(prefs.design.statusSectionOrder).toEqual(['zoom']);
  });

  it('survives a reload with a flyout-only tool override', () => {
    setWorkspacePreferences(
      setToolbarToolOverride(getWorkspacePreferences(), 'design', 'booleanExclude', false),
    );
    resetWorkspacePreferenceCache();
    expect(loadWorkspacePreferences().design.toolbarToolOverrides?.booleanExclude).toBe(false);
  });

  it('does not persist redundant visibility overrides', () => {
    const prefs = setToolbarToolOverride(getWorkspacePreferences(), 'design', 'booleanUnion', true);
    expect(prefs.design.toolbarToolOverrides?.booleanUnion).toBeUndefined();
  });

  it('inherits a newly added built-in tool with sparse customizations', () => {
    const original = WORKSPACE_CONFIGS.design;
    WORKSPACE_CONFIGS.design = {
      ...original,
      toolbar: {
        ...original.toolbar,
        tools: [...original.toolbar.tools, { toolId: 'paint' }],
      },
    };

    try {
      let prefs = getWorkspacePreferences();
      prefs = setToolbarToolOverride(prefs, 'design', 'pen', false);
      setWorkspacePreferences(prefs);

      const toolIds = getEffectiveWorkspaceConfig('design').toolbar.tools.map(
        (tool) => tool.toolId,
      );
      expect(toolIds).toContain('paint');
      expect(toolIds).not.toContain('pen');
    } finally {
      WORKSPACE_CONFIGS.design = original;
    }
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

  it('merges chrome overrides into the effective config', () => {
    let prefs = getWorkspacePreferences();
    prefs = setChromeOverride(prefs, 'design', 'statusBar', false);
    prefs = setChromeOverride(prefs, 'design', 'tabStrip', false);
    setWorkspacePreferences(prefs);
    const effective = getEffectiveWorkspaceConfig('design');
    expect(effective.statusBar).toBe(false);
    expect(effective.tabStrip).toBe(false);
    expect(effective.floatingToolbar).toBe(true);
  });

  it('drops a chrome override equal to the built-in default (sparse storage)', () => {
    let prefs = setChromeOverride(getWorkspacePreferences(), 'design', 'statusBar', false);
    prefs = setChromeOverride(prefs, 'design', 'statusBar', true);
    expect(prefs.design.chromeOverrides?.statusBar).toBeUndefined();
    expect(getEffectiveWorkspaceConfig('design').statusBar).toBe(true);
  });

  it('sanitizes unknown chrome override keys and types', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        design: {
          customized: true,
          chromeOverrides: { statusBar: false, tabStrip: 'nope', notAKey: true },
        },
      }),
    );
    resetWorkspacePreferenceCache();
    const chrome = loadWorkspacePreferences().design.chromeOverrides as
      | Record<string, unknown>
      | undefined;
    expect(chrome?.statusBar).toBe(false);
    expect(chrome?.tabStrip).toBeUndefined();
    expect(chrome?.notAKey).toBeUndefined();
  });

  it('notifies subscribers on change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspacePreferences(listener);
    updateWorkspacePreferences((prefs) =>
      setPanelOverride(prefs, 'design', 'logo', { visible: false }),
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
    for (const mode of ['design', 'print', 'drawing'] as const) {
      updateWorkspacePreferences((p) => setPanelOverride(p, mode, 'layers', { visible: false }));
    }
    expect(platform.setAppSetting).not.toHaveBeenCalled();
    await flushWorkspacePreferences();
    expect(platform.setAppSetting).toHaveBeenCalledTimes(1);
  });

  it('serializes in-flight writes so the newest preference snapshot persists last', async () => {
    const platform = fakePlatform();
    const payloads: string[] = [];
    const finishWrites: Array<() => void> = [];
    vi.mocked(platform.setAppSetting).mockImplementation(async (_key, value) => {
      payloads.push(value);
      await new Promise<void>((resolve) => finishWrites.push(resolve));
    });
    attachWorkspacePreferencePlatform(platform);

    setWorkspacePreferences(
      setPanelOverride(getWorkspacePreferences(), 'design', 'layers', { visible: false }),
    );
    const firstFlush = flushWorkspacePreferences();
    await Promise.resolve();
    expect(payloads).toHaveLength(1);

    setWorkspacePreferences(
      setPanelOverride(getWorkspacePreferences(), 'design', 'inspector', { visible: false }),
    );
    const secondFlush = flushWorkspacePreferences();
    await Promise.resolve();
    expect(payloads).toHaveLength(1);

    finishWrites[0]!();
    await firstFlush;
    await Promise.resolve();
    expect(payloads).toHaveLength(2);
    expect(JSON.parse(payloads[1]!).design.panelOverrides.inspector.visible).toBe(false);

    finishWrites[1]!();
    await secondFlush;
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

  it('a reset tombstone beats a stale durable customization', async () => {
    // The user reset Design, but the durable copy still holds the pre-reset
    // customization because the debounced write never flushed. Hydration
    // must honor the reset instead of resurrecting the old layout.
    const cleared = resetAllPreferences(1_000);
    setWorkspacePreferences(resetModePreferences(cleared, 'design', 2_000));
    const platform = fakePlatform(
      JSON.stringify({
        design: {
          customized: true,
          lastCustomized: 1_500,
          panelOverrides: { layers: { visible: false } },
        },
      }),
    );
    await hydrateWorkspacePreferencesFromPlatform(platform);
    expect(getWorkspacePreferences().design.customized).toBe(false);
    expect(getWorkspacePreferences().design.panelOverrides).toBeUndefined();
    expect(getWorkspacePreferences().design.clearedAt).toBe(2_000);
  });

  it('a customization newer than a reset survives hydration', async () => {
    setWorkspacePreferences(resetModePreferences(resetAllPreferences(1_000), 'design', 2_000));
    const platform = fakePlatform(
      JSON.stringify({
        design: {
          customized: true,
          lastCustomized: 3_000,
          panelOverrides: { layers: { visible: false } },
        },
      }),
    );
    await hydrateWorkspacePreferencesFromPlatform(platform);
    expect(getWorkspacePreferences().design.customized).toBe(true);
    expect(getWorkspacePreferences().design.panelOverrides?.layers?.visible).toBe(false);
  });

  it('persists and sanitizes the clearedAt marker', () => {
    const prefs = resetModePreferences(getWorkspacePreferences(), 'print', 4_242);
    saveWorkspacePreferences(prefs);
    resetWorkspacePreferenceCache();
    expect(loadWorkspacePreferences().print.clearedAt).toBe(4_242);
  });
});

describe('workspaceStore — panel widths', () => {
  it('clearPanelWidths removes only the requested panels', () => {
    const base = getWorkspacePreferences();
    const withWidths = savePanelWidths(
      savePanelWidths(base, 'design', { layers: 280, library: 360 }),
      'design',
      { inspector: 320 },
    );
    const cleared = clearPanelWidths(withWidths, 'design', ['library', 'inspector']);
    expect(cleared.design.panelWidths?.layers).toBe(280);
    expect(cleared.design.panelWidths?.library).toBeUndefined();
    expect(cleared.design.panelWidths?.inspector).toBeUndefined();
  });

  it('clearPanelWidths is a no-op when nothing is saved', () => {
    // Fresh defaults — the store cache is shared across tests in this file,
    // so an earlier savePanelWidths would pollute getWorkspacePreferences().
    const base = resetAllPreferences();
    const cleared = clearPanelWidths(base, 'design', ['library']);
    expect(cleared.design.panelWidths).toBeUndefined();
    expect(cleared.design.customized).toBe(false);
  });
});

describe('workspaceStore — toolbar placement', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspacePreferenceCache();
  });

  it('resolves an absent config field to the built-in bottom default', () => {
    expect(resolveToolbarPlacement({})).toBe('bottom');
    expect(resolveToolbarPlacement({ toolbarPlacement: 'top' })).toBe('top');
  });

  it('merges a stored top override into the effective config', () => {
    let prefs = getWorkspacePreferences();
    prefs = setToolbarPlacementOverride(prefs, 'design', 'top');
    expect(getEffectiveWorkspaceConfig('design', prefs).toolbarPlacement).toBe('top');
    expect(prefs.design.customized).toBe(true);
  });

  it('keeps bottom sparse so a future default change still flows through', () => {
    let prefs = setToolbarPlacementOverride(getWorkspacePreferences(), 'design', 'top');
    prefs = setToolbarPlacementOverride(prefs, 'design', 'bottom');
    expect(prefs.design.toolbarPlacement).toBeUndefined();
    expect(getEffectiveWorkspaceConfig('design', prefs).toolbarPlacement).toBeUndefined();
  });

  it('does not mark an unchanged mode customized', () => {
    const prefs = getWorkspacePreferences();
    expect(setToolbarPlacementOverride(prefs, 'design', 'bottom')).toBe(prefs);
  });

  it('round-trips through storage and rejects invalid stored values', () => {
    const prefs = setToolbarPlacementOverride(getWorkspacePreferences(), 'design', 'top');
    saveWorkspacePreferences(prefs);
    resetWorkspacePreferenceCache();
    expect(loadWorkspacePreferences().design.toolbarPlacement).toBe('top');

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ design: { customized: true, toolbarPlacement: 'left' } }),
    );
    resetWorkspacePreferenceCache();
    expect(loadWorkspacePreferences().design.toolbarPlacement).toBeUndefined();
  });

  it('is cleared by the per-mode reset', () => {
    let prefs = setToolbarPlacementOverride(getWorkspacePreferences(), 'design', 'top');
    prefs = resetModePreferences(prefs, 'design');
    expect(prefs.design.toolbarPlacement).toBeUndefined();
    expect(getEffectiveWorkspaceConfig('design', prefs).toolbarPlacement).toBeUndefined();
  });
});

describe('workspaceStore: default tool override', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspacePreferenceCache();
  });

  it('merges a stored selectable tool into the effective config', () => {
    const base = getWorkspacePreferences();
    const prefs = {
      ...base,
      drawing: { ...base.drawing, defaultToolOverride: 'panel' as const, customized: true },
    };
    expect(getEffectiveWorkspaceConfig('drawing', prefs).defaultTool).toBe('panel');
  });

  it('drops unknown and command-only tools on load', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        design: { customized: true, defaultToolOverride: 'notATool' },
        drawing: { customized: true, defaultToolOverride: 'booleanUnion' },
      }),
    );
    resetWorkspacePreferenceCache();
    const prefs = loadWorkspacePreferences();
    expect(prefs.design.defaultToolOverride).toBeUndefined();
    expect(prefs.drawing.defaultToolOverride).toBeUndefined();
  });

  it('accepts a selectable tool the mode toolbar presents', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ drawing: { customized: true, defaultToolOverride: 'paint' } }),
    );
    resetWorkspacePreferenceCache();
    expect(loadWorkspacePreferences().drawing.defaultToolOverride).toBe('paint');
  });
});
