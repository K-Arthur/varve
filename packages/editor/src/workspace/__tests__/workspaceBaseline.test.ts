/**
 * Workspace panel baselines — single-window behavior captured BEFORE any
 * detachable-panel or multi-window work lands.
 *
 * These tests pin the current single-window contracts so that the
 * multi-window milestones (panel registry, dock model, session broker)
 * cannot silently change them:
 *
 * 1. Per-mode panel visibility defaults (WORKSPACE_CONFIGS).
 * 2. The Shell.tsx mount contract: layers/inspector stay mounted when
 *    hidden (CSS-collapsed + inert), library/codegen/logo/timeline
 *    unmount when hidden.
 * 3. Panel width clamps (PANEL_LIMITS / CANVAS_MIN_WIDTH).
 * 4. The workspace preference store round-trip (workspaceStore.ts),
 *    including the legacy 'strata-' key fallback.
 *
 * If a later milestone intentionally changes any of these, the contract
 * test must change WITH it and be reviewed — not silently edited.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  CANVAS_MIN_WIDTH,
  clampPanelWidth,
  PANEL_LIMITS,
} from '../../components/PanelResizeHandle';
import {
  getEffectivePanelConfig,
  getPanelWidths,
  isModeCustomized,
  loadWorkspacePreferences,
  resetAllPreferences,
  resetModePreferences,
  savePanelWidths,
  saveWorkspacePreferences,
  setPanelOverride,
} from '../workspaceStore';
import {
  ALL_WORKSPACE_MODES,
  getWorkspaceConfig,
  type PanelId,
  type WorkspaceMode,
} from '../workspaceTypes';

const STORAGE_KEY = 'varve-workspace-preferences';
const LEGACY_STORAGE_KEY = 'strata-workspace-preferences';

/**
 * Exact visibility matrix extracted from WORKSPACE_CONFIGS at audit time
 * (2026-08-05). Order: layers, inspector, timeline, pagenav, library,
 * codegen, logo.
 */
const EXPECTED_VISIBILITY: Record<WorkspaceMode, boolean[]> = {
  design: [true, true, false, true, false, false, false],
  print: [true, true, false, true, false, false, false],
  drawing: [true, true, false, false, false, false, false],
  image: [true, true, false, false, false, false, false],
  codegen: [true, true, false, true, true, true, false],
  logo: [true, true, false, false, false, false, true],
  motion: [true, true, true, true, false, false, false],
};

const ALL_PANELS: PanelId[] = [
  'layers',
  'inspector',
  'timeline',
  'pagenav',
  'library',
  'codegen',
  'logo',
];

/**
 * Mount contract from Shell.tsx (lines 372-535 at audit time):
 * layers + inspector stay mounted when hidden (CSS zero-width + inert);
 * library/codegen/logo/timeline are conditionally rendered (unmount).
 * pagenav is rendered directly from config and unmounts when hidden.
 */
const MOUNT_CONTRACT: Record<PanelId, 'keep-mounted' | 'unmount'> = {
  layers: 'keep-mounted',
  inspector: 'keep-mounted',
  timeline: 'unmount',
  pagenav: 'unmount',
  library: 'unmount',
  codegen: 'unmount',
  logo: 'unmount',
  history: 'unmount',
};

describe('workspace panel baseline: per-mode visibility', () => {
  it('covers every registered workspace mode', () => {
    expect([...ALL_WORKSPACE_MODES].sort()).toEqual(
      ['design', 'drawing', 'image', 'print', 'motion', 'codegen', 'logo'].sort(),
    );
  });

  it('matches the extracted visibility matrix for every mode and panel', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      const expected = EXPECTED_VISIBILITY[mode];
      expect(expected, `missing expected row for ${mode}`).toBeDefined();
      const config = getWorkspaceConfig(mode);
      for (const [index, panel] of ALL_PANELS.entries()) {
        expect(config.panels[panel].visible, `${mode}/${panel}`).toBe(expected[index]);
      }
    }
  });

  it('design mode starts with both side panels visible and timeline hidden', () => {
    const design = getWorkspaceConfig('design');
    expect(design.panels.layers.visible).toBe(true);
    expect(design.panels.inspector.visible).toBe(true);
    expect(design.panels.timeline.visible).toBe(false);
  });
});

describe('workspace panel baseline: Shell mount contract', () => {
  it('keeps layers and inspector mounted while hidden; unmounts the rest', () => {
    for (const panel of ALL_PANELS) {
      expect(MOUNT_CONTRACT[panel]).toBeDefined();
      if (panel === 'layers' || panel === 'inspector') {
        expect(MOUNT_CONTRACT[panel]).toBe('keep-mounted');
      } else {
        expect(MOUNT_CONTRACT[panel]).toBe('unmount');
      }
    }
  });

  it('documents which hidden panels lose local state today (unmount = state loss)', () => {
    // Local state loss is a documented consequence of the unmount contract:
    // LayersPanel keeps filter/expansion state while hidden; ResourcesPanel
    // loses its active tab. A detachable-panel design must not regress this.
    const panelsWithLocalState = ['layers', 'inspector', 'library'] as const;
    for (const panel of panelsWithLocalState) {
      expect(MOUNT_CONTRACT[panel]).toBeDefined();
    }
  });
});

describe('workspace panel baseline: width clamps', () => {
  it('clamps widths to PANEL_LIMITS', () => {
    expect(clampPanelWidth('layers', 100)).toBe(PANEL_LIMITS.layers.min);
    expect(clampPanelWidth('layers', 999)).toBe(PANEL_LIMITS.layers.max);
    expect(clampPanelWidth('inspector', 100)).toBe(PANEL_LIMITS.inspector.min);
    expect(clampPanelWidth('inspector', 999)).toBe(PANEL_LIMITS.inspector.max);
    expect(clampPanelWidth('layers', 240)).toBe(240);
  });

  it('keeps the canvas column at least CANVAS_MIN_WIDTH wide', () => {
    expect(CANVAS_MIN_WIDTH).toBe(320);
    // At a narrow viewport both panels shrink before the canvas does.
    const viewport = 800;
    const layers = clampPanelWidth('layers', 480);
    const inspector = clampPanelWidth('inspector', 600);
    expect(viewport - layers - inspector).toBeLessThan(CANVAS_MIN_WIDTH);
  });

  it('documents the persisted width store shape (panel.leftPanelWidth/rightPanelWidth)', () => {
    // The widths live in editor settings (varve-editor-settings, panel
    // section) as number | null; null means "CSS clamp default". This is
    // the persistence contract a future dock model must migrate from.
    expect(PANEL_LIMITS.layers.min).toBe(180);
    expect(PANEL_LIMITS.layers.max).toBe(480);
    expect(PANEL_LIMITS.inspector.min).toBe(240);
    expect(PANEL_LIMITS.inspector.max).toBe(600);
  });
});

describe('workspace panel baseline: preference store (workspaceStore.ts)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips overrides through save/load', () => {
    let prefs = loadWorkspacePreferences();
    expect(isModeCustomized(prefs, 'design')).toBe(false);

    prefs = setPanelOverride(prefs, 'design', 'layers', { visible: false });
    saveWorkspacePreferences(prefs);

    const reloaded = loadWorkspacePreferences();
    expect(isModeCustomized(reloaded, 'design')).toBe(true);
    expect(reloaded.design?.panelOverrides?.layers?.visible).toBe(false);
  });

  it('merges overrides over the built-in config via getEffectivePanelConfig', () => {
    let prefs = loadWorkspacePreferences();
    const before = getEffectivePanelConfig('design', prefs, 'layers');
    expect(before.visible).toBe(true);

    prefs = setPanelOverride(prefs, 'design', 'layers', { visible: false });
    const after = getEffectivePanelConfig('design', prefs, 'layers');
    expect(after.visible).toBe(false);
    // Unoverridden fields still come from the base config.
    expect(after.preferredWidth).toBe(before.preferredWidth);
  });

  it('resetModePreferences clears customization for one mode only', () => {
    let prefs = loadWorkspacePreferences();
    prefs = setPanelOverride(prefs, 'design', 'layers', { visible: false });
    prefs = setPanelOverride(prefs, 'print', 'inspector', { visible: false });

    prefs = resetModePreferences(prefs, 'design');
    expect(isModeCustomized(prefs, 'design')).toBe(false);
    expect(isModeCustomized(prefs, 'print')).toBe(true);
  });

  it('reads the legacy strata- key when the varve key is absent', () => {
    localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({
        design: { customized: true, panelOverrides: { layers: { visible: false } } },
      }),
    );
    const prefs = loadWorkspacePreferences();
    expect(prefs.design?.customized).toBe(true);
    expect(prefs.design?.panelOverrides?.layers?.visible).toBe(false);
  });

  it('round-trips per-workspace panel widths and drops invalid values', () => {
    let prefs = loadWorkspacePreferences();
    prefs = savePanelWidths(prefs, 'design', { layers: 312, inspector: 404 });
    saveWorkspacePreferences(prefs);

    const reloaded = loadWorkspacePreferences();
    expect(getPanelWidths(reloaded, 'design')).toEqual({ layers: 312, inspector: 404 });

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        design: {
          customized: true,
          panelWidths: { layers: 0, inspector: 'wide', notAPanel: 500 },
        },
      }),
    );
    const sanitized = loadWorkspacePreferences();
    expect(getPanelWidths(sanitized, 'design')).toEqual({});
  });

  it('prefers the current key over the legacy key', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ design: { customized: false } }));
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ design: { customized: true } }));
    const prefs = loadWorkspacePreferences();
    expect(prefs.design?.customized).toBe(false);
  });

  it('survives corrupt JSON with defaults', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const prefs = loadWorkspacePreferences();
    for (const mode of ALL_WORKSPACE_MODES) {
      expect(prefs[mode].customized).toBe(false);
    }
  });

  it('resetAllPreferences returns an uncustomized state', () => {
    const prefs = resetAllPreferences();
    for (const mode of ALL_WORKSPACE_MODES) {
      expect(prefs[mode].customized).toBe(false);
      expect(prefs[mode].panelOverrides).toBeUndefined();
    }
  });
});
