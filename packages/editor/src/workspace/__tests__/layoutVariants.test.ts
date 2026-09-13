/**
 * Layout variant store tests — capture/apply semantics, CRUD safety,
 * hostile imports, tombstones, and durable hydration.
 */

import type { Platform } from '@varve/platform';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addImportedLayoutVariant,
  addLayoutVariant,
  applyLayoutPayloadToPreferences,
  attachLayoutStorePlatform,
  BUILT_IN_LAYOUT_VARIANTS,
  captureLayoutPayload,
  captureResetSnapshot,
  createEmptyLayoutStore,
  deleteLayoutVariant,
  duplicateLayoutVariant,
  exportLayoutVariant,
  flushLayoutStore,
  getLayoutStore,
  hydrateLayoutStoreFromPlatform,
  importLayoutVariantFromJson,
  isLayoutVariantApplied,
  layoutPayloadsEqual,
  loadLayoutStore,
  mergeLayoutStores,
  normalizeLayoutName,
  renameLayoutVariant,
  resetLayoutStoreCache,
  restoreResetSnapshotToPreferences,
  sanitizeLayoutPayload,
  sanitizeLayoutStore,
  setLayoutStore,
  updateLayoutVariantPayload,
} from '../layoutVariants';
import {
  getEffectiveWorkspaceConfig,
  getWorkspacePreferences,
  resetAllPreferences,
  resetWorkspacePreferenceCache,
  setPanelOverride,
  setToolbarToolOverride,
  setWorkspacePreferences,
} from '../workspaceStore';

describe('layoutVariants: capture', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspacePreferenceCache();
    resetLayoutStoreCache();
    resetAllPreferences();
  });

  it('captures an empty payload for an uncustomized mode', () => {
    const payload = captureLayoutPayload('design');
    expect(payload).toEqual({});
  });

  it('captures sparse panel, tab, tool, width, and chrome differences only', () => {
    let prefs = getWorkspacePreferences();
    prefs = setPanelOverride(prefs, 'design', 'history', { visible: true });
    prefs = setToolbarToolOverride(prefs, 'design', 'rect', false);
    prefs = { ...prefs, design: { ...prefs.design, panelWidths: { layers: 300 } } };
    prefs = {
      ...prefs,
      design: { ...prefs.design, chromeOverrides: { statusBar: false } },
    };
    setWorkspacePreferences(prefs);

    const payload = captureLayoutPayload('design', prefs);
    expect(payload.panelOverrides?.history?.visible).toBe(true);
    // Unchanged panels are not enumerated.
    expect(payload.panelOverrides?.layers).toBeUndefined();
    expect(payload.toolbarToolOverrides?.rect).toBe(false);
    expect(payload.panelWidths?.layers).toBe(300);
    expect(payload.chromeOverrides?.statusBar).toBe(false);
  });

  it('reports whether a variant matches the current arrangement', () => {
    const variant = {
      id: 'lv-1',
      name: 'Test',
      builtIn: false,
      createdAt: 1,
      updatedAt: 1,
      payload: { panelOverrides: { history: { visible: true } } },
    };
    expect(isLayoutVariantApplied(variant, 'design')).toBe(false);
    setWorkspacePreferences(
      setPanelOverride(getWorkspacePreferences(), 'design', 'history', { visible: true }),
    );
    expect(isLayoutVariantApplied(variant, 'design')).toBe(true);
  });
});

describe('layoutVariants: apply', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspacePreferenceCache();
    resetLayoutStoreCache();
    resetAllPreferences();
  });

  it('applies a payload by replacing the mode preference', () => {
    let prefs = getWorkspacePreferences();
    prefs = setPanelOverride(prefs, 'design', 'logo', { visible: true });
    const next = applyLayoutPayloadToPreferences(prefs, 'design', {
      panelOverrides: { history: { visible: true } },
    });
    expect(next.design.panelOverrides?.history?.visible).toBe(true);
    // Replace, not merge: the previous logo customization is gone.
    expect(next.design.panelOverrides?.logo).toBeUndefined();
    expect(next.design.customized).toBe(true);
  });

  it('applying the Default built-in records a reset event', () => {
    let prefs = setPanelOverride(getWorkspacePreferences(), 'design', 'layers', { visible: false });
    prefs = applyLayoutPayloadToPreferences(prefs, 'design', {});
    expect(prefs.design.customized).toBe(false);
    expect(prefs.design.clearedAt).toBeTypeOf('number');
    expect(getEffectiveWorkspaceConfig('design', prefs).panels.layers.visible).toBe(true);
  });

  it('applies the built-in Focus canvas template to every mode', () => {
    const focus = BUILT_IN_LAYOUT_VARIANTS.find(
      (variant) => variant.id === 'builtin-focus-canvas',
    )!;
    const prefs = applyLayoutPayloadToPreferences(
      getWorkspacePreferences(),
      'print',
      focus.payload,
    );
    const effective = getEffectiveWorkspaceConfig('print', prefs);
    expect(effective.panels.layers.visible).toBe(false);
    expect(effective.panels.inspector.visible).toBe(false);
    expect(effective.statusBar).toBe(false);
    expect(effective.tabStrip).toBe(false);
    expect(effective.floatingToolbar).toBe(true);
  });

  it('the Every panel template restores every panel', () => {
    const every = BUILT_IN_LAYOUT_VARIANTS.find((variant) => variant.id === 'builtin-every-panel')!;
    const prefs = applyLayoutPayloadToPreferences(
      getWorkspacePreferences(),
      'motion',
      every.payload,
    );
    const effective = getEffectiveWorkspaceConfig('motion', prefs);
    for (const visible of Object.values(effective.panels)) {
      expect(visible.visible).toBe(true);
    }
    expect(effective.statusBar).toBe(true);
  });
});

describe('layoutVariants: CRUD', () => {
  it('adds, renames, updates, duplicates, and deletes user variants', () => {
    let state = createEmptyLayoutStore();
    const added = addLayoutVariant(state, {
      name: '  My   Layout ',
      sourceMode: 'design',
      payload: { panelOverrides: { history: { visible: true } } },
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.variant.name).toBe('My Layout');
    state = added.state;

    const renamed = renameLayoutVariant(state, added.variant.id, 'Renamed');
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    state = renamed.state;
    expect(state.variants[0]!.name).toBe('Renamed');

    const updated = updateLayoutVariantPayload(state, added.variant.id, {
      panelOverrides: { codegen: { visible: true } },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    state = updated.state;
    expect(state.variants[0]!.payload.panelOverrides?.codegen?.visible).toBe(true);

    const duplicated = duplicateLayoutVariant(state, added.variant.id);
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    state = duplicated.state;
    expect(state.variants).toHaveLength(2);
    expect(state.variants[1]!.name).toBe('Renamed copy');

    state = deleteLayoutVariant(state, added.variant.id, added.variant.updatedAt + 1);
    expect(state.variants).toHaveLength(1);
    expect(state.tombstones[added.variant.id]).toBe(added.variant.updatedAt + 1);
  });

  it('rejects duplicate names case-insensitively', () => {
    const first = addLayoutVariant(createEmptyLayoutStore(), {
      name: 'Studio',
      sourceMode: 'design',
      payload: {},
    });
    if (!first.ok) throw new Error('setup failed');
    const dup = addLayoutVariant(first.state, {
      name: 'studio',
      sourceMode: 'design',
      payload: {},
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toBe('duplicate-name');
  });

  it('rejects empty names and protects built-ins', () => {
    expect(
      addLayoutVariant(createEmptyLayoutStore(), {
        name: '   ',
        sourceMode: 'design',
        payload: {},
      }),
    ).toMatchObject({ ok: false, reason: 'invalid-name' });
    const state = createEmptyLayoutStore();
    expect(renameLayoutVariant(state, 'builtin-default', 'Nope')).toMatchObject({
      ok: false,
      reason: 'built-in',
    });
    expect(deleteLayoutVariant(state, 'builtin-default')).toBe(state);
  });

  it('normalizes long and hostile names', () => {
    expect(normalizeLayoutName('a\u0000b\tc')).toBe('a b c');
    const long = normalizeLayoutName('x'.repeat(500));
    expect(long).toHaveLength(64);
    expect(normalizeLayoutName(42)).toBeNull();
  });
});

describe('layoutVariants: import/export and hostile payloads', () => {
  it('round-trips through export/import with a fresh id', () => {
    const variant = {
      id: 'lv-original',
      name: 'Portable',
      builtIn: false,
      createdAt: 1,
      updatedAt: 2,
      sourceMode: 'print' as const,
      payload: { panelOverrides: { pagenav: { visible: true } } },
    };
    const json = exportLayoutVariant(variant);
    const imported = importLayoutVariantFromJson(json);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.variant.name).toBe('Portable');
    expect(imported.variant.id).not.toBe('lv-original');
    expect(imported.variant.payload.panelOverrides?.pagenav?.visible).toBe(true);
    // Export contains no local ids or timestamps.
    expect(json).not.toContain('lv-original');
  });

  it('rejects oversized, malformed, and future-version payloads', () => {
    expect(importLayoutVariantFromJson('x'.repeat(70 * 1024))).toMatchObject({
      ok: false,
      reason: 'too-large',
    });
    expect(importLayoutVariantFromJson('{nope')).toMatchObject({
      ok: false,
      reason: 'invalid-json',
    });
    expect(importLayoutVariantFromJson(JSON.stringify({ kind: 'other' }))).toMatchObject({
      ok: false,
      reason: 'invalid-format',
    });
    expect(
      importLayoutVariantFromJson(
        JSON.stringify({ kind: 'varve-workspace-layout', schemaVersion: 99, payload: {} }),
      ),
    ).toMatchObject({ ok: false, reason: 'future-version' });
  });

  it('drops unknown capabilities and cannot hide essential recovery tools', () => {
    const payload = sanitizeLayoutPayload({
      panelOverrides: { notAPanel: { visible: true }, layers: { visible: false } },
      inspectorTabOverrides: { notATab: true, properties: false },
      statusSectionOverrides: { notASection: true, zoom: false },
      toolbarToolOverrides: { notATool: false, select: false, rect: false },
      panelWidths: { layers: 9_999, notAPanel: 200 },
      chromeOverrides: { statusBar: false, notAKey: true },
    });
    expect(payload.panelOverrides?.notAPanel).toBeUndefined();
    expect(payload.panelOverrides?.layers?.visible).toBe(false);
    expect(payload.inspectorTabOverrides).toEqual({ properties: false });
    expect(payload.statusSectionOverrides).toEqual({ zoom: false });
    expect(payload.toolbarToolOverrides).toEqual({ rect: false });
    expect(payload.panelWidths?.layers).toBe(1200);
    expect(payload.panelWidths?.notAPanel).toBeUndefined();
    expect(payload.chromeOverrides).toEqual({ statusBar: false });
  });

  it('ignores prototype-pollution keys', () => {
    const hostile = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"polluted":true},"payload":{"__proto__":{"polluted":true}}}',
    );
    const payload = sanitizeLayoutPayload(hostile);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(payload).toEqual({});
    const store = sanitizeLayoutStore(
      JSON.parse(
        '{"schemaVersion":1,"variants":[{"id":"lv-ok","name":"ok","payload":{"__proto__":{"x":1}}}]}',
      ),
    );
    expect(store.variants).toHaveLength(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('replaces or duplicates on import name collision', () => {
    const existing = addLayoutVariant(createEmptyLayoutStore(), {
      name: 'Shared',
      sourceMode: 'design',
      payload: {},
    });
    if (!existing.ok) throw new Error('setup failed');
    const imported = importLayoutVariantFromJson(
      JSON.stringify({
        kind: 'varve-workspace-layout',
        schemaVersion: 1,
        name: 'shared',
        payload: { panelOverrides: { history: { visible: true } } },
      }),
    );
    if (!imported.ok) throw new Error('import failed');

    const replaced = addImportedLayoutVariant(existing.state, imported.variant, 'replace');
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.state.variants).toHaveLength(1);
    expect(replaced.state.variants[0]!.payload.panelOverrides?.history?.visible).toBe(true);

    const duplicated = addImportedLayoutVariant(existing.state, imported.variant, 'duplicate');
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    expect(duplicated.state.variants).toHaveLength(2);
    expect(duplicated.state.variants[1]!.name).toContain('imported');
  });
});

describe('layoutVariants: persistence and merge', () => {
  beforeEach(() => {
    localStorage.clear();
    resetLayoutStoreCache();
  });

  function fakePlatform(initial?: WorkspaceLayoutStoreState) {
    const store = new Map<string, string>();
    if (initial) store.set('workspace-layouts', JSON.stringify(initial));
    return {
      store,
      getAppSetting: vi.fn(async (key: string) => store.get(key) ?? null),
      setAppSetting: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    } as unknown as Platform & { store: Map<string, string> };
  }

  it('persists through a save/load round trip', () => {
    const added = addLayoutVariant(createEmptyLayoutStore(), {
      name: 'Saved',
      sourceMode: 'design',
      payload: { panelOverrides: { history: { visible: true } } },
    });
    if (!added.ok) throw new Error('setup failed');
    setLayoutStore(added.state);
    resetLayoutStoreCache();
    expect(loadLayoutStore().variants[0]!.name).toBe('Saved');
  });

  it('a local tombstone defeats a stale durable variant', async () => {
    const added = addLayoutVariant(createEmptyLayoutStore(), {
      name: 'Doomed',
      sourceMode: 'design',
      payload: {},
    });
    if (!added.ok) throw new Error('setup failed');
    const deleted = deleteLayoutVariant(added.state, added.variant.id, added.variant.updatedAt + 1);
    setLayoutStore(deleted);
    const remote = fakePlatform(deleted);
    // Remote copy predates the deletion and still contains the variant.
    remote.store.set(
      'workspace-layouts',
      JSON.stringify({ ...deleted, tombstones: {}, variants: added.state.variants }),
    );
    await hydrateLayoutStoreFromPlatform(remote);
    expect(getLayoutStore().variants).toHaveLength(0);
  });

  it('keeps the newer variant revision from either side', () => {
    const localVariant = {
      id: 'lv-shared',
      name: 'Local',
      builtIn: false,
      createdAt: 1,
      updatedAt: 100,
      payload: {},
    };
    const remoteVariant = { ...localVariant, name: 'Remote', updatedAt: 200 };
    const merged = mergeLayoutStores(
      { ...createEmptyLayoutStore(), variants: [localVariant], revision: 2 },
      { ...createEmptyLayoutStore(), variants: [remoteVariant], revision: 1 },
    );
    expect(merged.variants[0]!.name).toBe('Remote');
  });

  it('rejects a future store schema without rewriting it', () => {
    localStorage.setItem(
      'varve-workspace-layouts',
      JSON.stringify({ schemaVersion: 99, variants: [{ id: 'lv-x', name: 'Future' }] }),
    );
    const store = resetStoreAndLoad();
    expect(store.variants).toHaveLength(0);
    expect(store.revision).toBe(0);
    expect(localStorage.getItem('varve-workspace-layouts')).toContain('99');
  });

  function resetStoreAndLoad() {
    resetLayoutStoreCache();
    return loadLayoutStore();
  }

  it('coalesces durable writes', async () => {
    const platform = fakePlatform();
    attachLayoutStorePlatform(platform);
    const added = addLayoutVariant(createEmptyLayoutStore(), {
      name: 'One',
      sourceMode: 'design',
      payload: {},
    });
    if (!added.ok) throw new Error('setup failed');
    setLayoutStore(added.state);
    const updated = updateLayoutVariantPayload(added.state, added.variant.id, {
      panelOverrides: { history: { visible: true } },
    });
    if (!updated.ok) throw new Error('update failed');
    setLayoutStore(updated.state);
    expect(platform.setAppSetting).not.toHaveBeenCalled();
    await flushLayoutStore();
    expect(platform.setAppSetting).toHaveBeenCalledTimes(1);
  });
});

describe('layoutVariants: reset snapshot', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspacePreferenceCache();
    resetLayoutStoreCache();
    resetAllPreferences();
  });

  it('restores the pre-reset arrangement with a fresh event time', () => {
    let prefs = setPanelOverride(getWorkspacePreferences(), 'design', 'layers', { visible: false });
    prefs = setPanelOverride(prefs, 'print', 'inspector', { visible: false });
    const state = captureResetSnapshot(
      createEmptyLayoutStore(),
      { kind: 'mode', mode: 'design' },
      prefs,
      1_000,
    );
    expect(state.resetSnapshot?.savedAt).toBe(1_000);

    // After reset, restore only the snapshot's scope.
    const cleared = resetAllPreferences(2_000);
    const restored = restoreResetSnapshotToPreferences(cleared, state.resetSnapshot!, 3_000);
    expect(getEffectiveWorkspaceConfig('design', restored).panels.layers.visible).toBe(false);
    expect(getEffectiveWorkspaceConfig('print', restored).panels.inspector.visible).toBe(true);
    expect(restored.design.lastCustomized).toBe(3_000);
  });

  it('captures all-mode scope', () => {
    const state = captureResetSnapshot(
      createEmptyLayoutStore(),
      { kind: 'all' },
      getWorkspacePreferences(),
      5_000,
    );
    expect(state.resetSnapshot?.scope.kind).toBe('all');
  });
});

describe('layoutVariants: payload equality', () => {
  it('is order-insensitive', () => {
    expect(
      layoutPayloadsEqual(
        { panelOverrides: { layers: { visible: true }, history: { visible: false } } },
        { panelOverrides: { history: { visible: false }, layers: { visible: true } } },
      ),
    ).toBe(true);
  });
});
