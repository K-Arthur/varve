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
      const contrib2 = makeContribution({ contributionId: 'export-section', targetTab: 'export' });
      registerPlugin(makeManifest([contrib1, contrib2]));
      expect(getContributionsForTab('properties').length).toBe(1);
      expect(getContributionsForTab('export').length).toBe(1);
      expect(getContributionsForTab('spec').length).toBe(0);
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
      registerPlugin(makeManifest([contrib1]));
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
