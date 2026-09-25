// @ts-nocheck
/**
 * Tests for the plugin section contribution API.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { PluginManifest, PluginSectionContribution } from '../pluginSections';
import {
  disablePlugin,
  enablePlugin,
  getActiveContributions,
  getContributionsForTab,
  getRegisteredPlugins,
  hideContribution,
  isContributionAvailable,
  markPluginError,
  onContributionsChange,
  qualifyContribution,
  registerPlugin,
  retryPlugin,
  showContribution,
  unregisterPlugin,
} from '../pluginSections';

function makeContribution(
  overrides: Partial<PluginSectionContribution> = {},
): PluginSectionContribution {
  return {
    pluginId: 'test-plugin',
    contributionId: 'test-section',
    targetTab: 'properties',
    display: { title: 'Test Section' },
    ...overrides,
  };
}

function makeManifest(
  contributions: PluginSectionContribution[] = [makeContribution()],
): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    contributions,
  };
}

describe('Plugin Section API', () => {
  beforeEach(() => {
    // Clean up all plugins
    for (const p of getRegisteredPlugins()) {
      unregisterPlugin(p.manifest.id);
    }
  });

  describe('Registration', () => {
    it('registerPlugin adds a plugin', () => {
      registerPlugin(makeManifest());
      const plugins = getRegisteredPlugins();
      expect(plugins.length).toBe(1);
      expect(plugins[0].manifest.id).toBe('test-plugin');
      expect(plugins[0].status).toBe('active');
    });

    it('registerPlugin is idempotent', () => {
      registerPlugin(makeManifest());
      registerPlugin(makeManifest());
      expect(getRegisteredPlugins().length).toBe(1);
    });

    it('unregisterPlugin removes a plugin', () => {
      registerPlugin(makeManifest());
      unregisterPlugin('test-plugin');
      expect(getRegisteredPlugins().length).toBe(0);
    });

    it('disablePlugin sets status to disabled', () => {
      registerPlugin(makeManifest());
      disablePlugin('test-plugin');
      expect(getRegisteredPlugins()[0].status).toBe('disabled');
    });

    it('enablePlugin restores active status', () => {
      registerPlugin(makeManifest());
      disablePlugin('test-plugin');
      enablePlugin('test-plugin');
      expect(getRegisteredPlugins()[0].status).toBe('active');
    });

    it('markPluginError sets status to error', () => {
      registerPlugin(makeManifest());
      markPluginError('test-plugin', 'Render failed');
      const p = getRegisteredPlugins()[0];
      expect(p.status).toBe('error');
      expect(p.error).toBe('Render failed');
    });

    it('keeps an error quarantined across registration and ordinary enable', () => {
      registerPlugin(makeManifest());
      markPluginError('test-plugin', 'Render failed');
      registerPlugin(makeManifest());
      enablePlugin('test-plugin');
      expect(getRegisteredPlugins()[0].status).toBe('error');
      expect(getRegisteredPlugins()[0].error).toBe('Render failed');
      retryPlugin('test-plugin');
      expect(getRegisteredPlugins()[0].status).toBe('active');
      expect(getRegisteredPlugins()[0].error).toBeUndefined();
    });

    it('does not turn a disabled plugin into an error from a stale render', () => {
      registerPlugin(makeManifest());
      disablePlugin('test-plugin');
      markPluginError('test-plugin', 'Late render failure');
      expect(getRegisteredPlugins()[0].status).toBe('disabled');
    });

    it('rejects malformed manifests without replacing the working registration', () => {
      registerPlugin(makeManifest());
      const invalid = [
        { ...makeManifest(), id: 'test/plugin' },
        { ...makeManifest(), version: '1.0' },
        makeManifest([makeContribution({ pluginId: 'another-plugin' })]),
        makeManifest([makeContribution(), makeContribution()]),
        makeManifest([makeContribution({ contributionId: 'bad/id' })]),
        makeManifest([makeContribution({ targetTab: 'export' })]),
        makeManifest([makeContribution({ order: Number.NaN })]),
        makeManifest([makeContribution({ order: 0.5 })]),
      ];
      for (const manifest of invalid) expect(() => registerPlugin(manifest)).toThrow();
      expect(getRegisteredPlugins()[0].manifest.version).toBe('1.0.0');
      expect(getActiveContributions()).toHaveLength(1);
    });

    it('copies input and output data so callers cannot change registration', () => {
      const input = makeManifest();
      registerPlugin(input);
      input.contributions[0].display.title = 'Changed at source';
      const state = getRegisteredPlugins()[0];
      state.manifest.contributions[0].display.title = 'Changed in snapshot';
      state.hiddenContributions = ['test-plugin/test-section'];
      const contribution = getActiveContributions()[0];
      contribution.display.title = 'Changed in contribution';
      expect(getRegisteredPlugins()[0].manifest.contributions[0].display.title).toBe(
        'Test Section',
      );
      expect(getActiveContributions()[0].display.title).toBe('Test Section');
    });

    it('drops hidden state for contributions removed on re-registration', () => {
      registerPlugin(makeManifest());
      hideContribution('test-plugin', 'test-section');
      registerPlugin(makeManifest([]));
      expect(getRegisteredPlugins()[0].hiddenContributions).toEqual([]);
    });
  });

  describe('Contributions', () => {
    it('getActiveContributions returns active plugin contributions', () => {
      registerPlugin(makeManifest());
      const contribs = getActiveContributions();
      expect(contribs.length).toBe(1);
      expect(contribs[0].pluginId).toBe('test-plugin');
    });

    it('disabled plugins have no active contributions', () => {
      registerPlugin(makeManifest());
      disablePlugin('test-plugin');
      expect(getActiveContributions().length).toBe(0);
    });

    it('errored plugins have no active contributions', () => {
      registerPlugin(makeManifest());
      markPluginError('test-plugin', 'error');
      expect(getActiveContributions().length).toBe(0);
    });

    it('getContributionsForTab filters by target tab', () => {
      const contrib1 = makeContribution({ targetTab: 'properties' });
      const contrib2 = makeContribution({
        contributionId: 'legacy-section',
        targetTab: 'document',
      });
      registerPlugin(makeManifest([contrib1, contrib2]));
      expect(getContributionsForTab('properties').length).toBe(2);
      expect(getContributionsForTab('document').length).toBe(2);
      expect(getContributionsForTab('audit').length).toBe(0);
    });
  });

  describe('Availability', () => {
    it('isContributionAvailable returns true with no constraints', () => {
      const contrib = makeContribution();
      expect(
        isContributionAvailable(contrib, {
          selectionCount: 0,
          workspaceMode: 'design',
          activeTool: 'select',
        }),
      ).toBe(true);
    });

    it('isContributionAvailable respects mode constraint', () => {
      const contrib = makeContribution({
        availability: { modes: ['print', 'design'] },
      });
      expect(
        isContributionAvailable(contrib, {
          selectionCount: 0,
          workspaceMode: 'print',
          activeTool: 'select',
        }),
      ).toBe(true);
      expect(
        isContributionAvailable(contrib, {
          selectionCount: 0,
          workspaceMode: 'drawing',
          activeTool: 'select',
        }),
      ).toBe(false);
    });

    it('empty modes means all modes', () => {
      expect(
        isContributionAvailable(makeContribution({ availability: { modes: [] } }), {
          selectionCount: 0,
          workspaceMode: 'design',
          activeTool: 'select',
        }),
      ).toBe(true);
    });

    it('isContributionAvailable respects minSelection', () => {
      const contrib = makeContribution({
        availability: { minSelection: 2 },
      });
      expect(
        isContributionAvailable(contrib, {
          selectionCount: 1,
          workspaceMode: 'design',
          activeTool: 'select',
        }),
      ).toBe(false);
      expect(
        isContributionAvailable(contrib, {
          selectionCount: 2,
          workspaceMode: 'design',
          activeTool: 'select',
        }),
      ).toBe(true);
    });

    it('isContributionAvailable respects tool constraint', () => {
      const contrib = makeContribution({
        availability: { tools: ['paint', 'pencil'] },
      });
      expect(
        isContributionAvailable(contrib, {
          selectionCount: 0,
          workspaceMode: 'design',
          activeTool: 'paint',
        }),
      ).toBe(true);
      expect(
        isContributionAvailable(contrib, {
          selectionCount: 0,
          workspaceMode: 'design',
          activeTool: 'select',
        }),
      ).toBe(false);
    });

    it('isContributionAvailable respects custom predicate', () => {
      const contrib = makeContribution({
        availability: {
          predicate: (ctx) => ctx.selectionCount > 0 && ctx.workspaceMode === 'design',
        },
      });
      expect(
        isContributionAvailable(contrib, {
          selectionCount: 1,
          workspaceMode: 'design',
          activeTool: 'select',
        }),
      ).toBe(true);
      expect(
        isContributionAvailable(contrib, {
          selectionCount: 0,
          workspaceMode: 'design',
          activeTool: 'select',
        }),
      ).toBe(false);
    });
  });

  describe('Hide/Show', () => {
    it('hideContribution removes from active list', () => {
      registerPlugin(makeManifest());
      hideContribution('test-plugin', 'test-section');
      expect(getActiveContributions().length).toBe(0);
    });

    it('showContribution restores to active list', () => {
      registerPlugin(makeManifest());
      hideContribution('test-plugin', 'test-section');
      showContribution('test-plugin', 'test-section');
      expect(getActiveContributions().length).toBe(1);
    });

    it('hideContribution for unknown plugin is a no-op', () => {
      hideContribution('nonexistent', 'section');
      // Should not throw
    });

    it('does not hide a contribution whose owner disallows hiding', () => {
      registerPlugin(makeManifest([makeContribution({ canHide: false })]));
      hideContribution('test-plugin', 'test-section');
      expect(getActiveContributions()).toHaveLength(1);
    });
  });

  describe('Namespacing', () => {
    it('qualifyContribution returns pluginId/contributionId', () => {
      const contrib = makeContribution({
        pluginId: 'com.example',
        contributionId: 'analyzer',
      });
      expect(qualifyContribution(contrib)).toBe('com.example/analyzer');
    });

    it('multiple plugins can have same contributionId', () => {
      const contrib1 = makeContribution({ pluginId: 'plugin-a', contributionId: 'shared' });
      const contrib2 = makeContribution({ pluginId: 'plugin-b', contributionId: 'shared' });
      registerPlugin({ id: 'plugin-a', name: 'A', version: '1.0.0', contributions: [contrib1] });
      registerPlugin({ id: 'plugin-b', name: 'B', version: '1.0.0', contributions: [contrib2] });
      expect(getActiveContributions().length).toBe(2);
    });
  });

  describe('Subscriptions', () => {
    it('onContributionsChange fires on registration', () => {
      let called = false;
      const unsub = onContributionsChange(() => {
        called = true;
      });
      registerPlugin(makeManifest());
      expect(called).toBe(true);
      unsub();
    });

    it('unsubscribe stops notifications', () => {
      let count = 0;
      const unsub = onContributionsChange(() => {
        count++;
      });
      registerPlugin(makeManifest());
      unsub();
      unregisterPlugin('test-plugin');
      expect(count).toBe(1); // Only from registration
    });
  });
});
