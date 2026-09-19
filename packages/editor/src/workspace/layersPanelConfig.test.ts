/**
 * Layers panel workspace projection — config contract.
 *
 * The projection is only useful if every workspace declares one and every
 * declaration stays inside the vocabulary the panel actually consumes. These
 * tests pin the built-in table from
 * `docs/design-system/layers-panel-spec.md` §2 so a new workspace mode, or a
 * new badge group, cannot ship as decorative configuration (workspace-system
 * invariant 9: every field must have a runtime consumer).
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_WORKSPACE_MODES,
  DEFAULT_LAYERS_PANEL_CONFIG,
  getWorkspaceConfig,
  resolveLayersPanelConfig,
} from './workspaceTypes';

const BADGE_GROUPS = [
  'component',
  'layout',
  'motion',
  'mask',
  'appearance',
  'media',
  'email',
  'print',
  'trace',
] as const;

const QUICK_FILTERS = [
  'animated',
  'mobile-hidden',
  'threaded-text',
  'export-regions',
  'masks',
  'components',
] as const;

describe('Layers panel workspace projection', () => {
  it('is declared by every built-in workspace', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      const config = getWorkspaceConfig(mode).layersPanel;
      expect(config, `${mode} must declare layersPanel`).toBeDefined();
      expect(config!.quickFilters.length).toBeGreaterThan(0);
      expect(config!.searchPlaceholder.length).toBeGreaterThan(0);
    }
  });

  it('stays inside the consumed vocabulary', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      const config = getWorkspaceConfig(mode).layersPanel!;
      for (const group of config.pinnedBadgeGroups) {
        expect(BADGE_GROUPS).toContain(group);
      }
      for (const preset of config.quickFilters) {
        expect(QUICK_FILTERS).toContain(preset);
      }
      for (const action of config.pinnedRowActions) {
        expect(action).toBe('solo');
      }
    }
  });

  it('pins at most three badge groups — the projection exists to reduce clutter', () => {
    for (const mode of ALL_WORKSPACE_MODES) {
      const config = getWorkspaceConfig(mode).layersPanel!;
      expect(config.pinnedBadgeGroups.length, `${mode} pins too many groups`).toBeLessThanOrEqual(
        3,
      );
    }
  });

  it('pins solo only where focus-mode auditioning is the core workflow', () => {
    const soloPinned = ALL_WORKSPACE_MODES.filter((mode) =>
      getWorkspaceConfig(mode).layersPanel!.pinnedRowActions.includes('solo'),
    );
    expect(soloPinned).toEqual(['image']);
  });

  it('maps each workspace to the projection table in the spec', () => {
    const expected: Record<string, { badges: string[]; quick: string[] }> = {
      design: { badges: ['component', 'layout', 'appearance'], quick: ['components'] },
      print: { badges: ['print', 'appearance'], quick: ['threaded-text', 'export-regions'] },
      drawing: { badges: ['mask', 'appearance'], quick: ['masks'] },
      image: { badges: ['mask', 'appearance', 'media'], quick: ['masks'] },
      codegen: { badges: ['component', 'layout'], quick: ['components'] },
      logo: { badges: ['component', 'appearance'], quick: ['components'] },
      motion: { badges: ['motion'], quick: ['animated'] },
      email: { badges: ['email', 'appearance'], quick: ['mobile-hidden'] },
    };
    for (const [mode, want] of Object.entries(expected)) {
      const config = getWorkspaceConfig(mode as (typeof ALL_WORKSPACE_MODES)[number]).layersPanel!;
      expect([...config.pinnedBadgeGroups].sort()).toEqual([...want.badges].sort());
      expect([...config.quickFilters].sort()).toEqual([...want.quick].sort());
    }
  });

  it('falls back to the Design default when a config declares none', () => {
    expect(resolveLayersPanelConfig(undefined)).toBe(DEFAULT_LAYERS_PANEL_CONFIG);
    expect(resolveLayersPanelConfig({})).toBe(DEFAULT_LAYERS_PANEL_CONFIG);
  });

  it('returns the declared projection when present', () => {
    const declared = {
      pinnedBadgeGroups: ['motion' as const],
      pinnedRowActions: [],
      quickFilters: ['animated' as const],
      searchPlaceholder: 'Filter animations…',
    };
    expect(resolveLayersPanelConfig({ layersPanel: declared })).toBe(declared);
  });
});
