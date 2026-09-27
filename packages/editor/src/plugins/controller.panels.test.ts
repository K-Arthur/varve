/**
 * Package-record owned Inspector panel preferences.
 *
 * Hiding/showing a contributed panel is a user-local display preference:
 * it must persist with the installation, never touch a document or undo
 * history, mirror exactly into the trusted section registry, and come back
 * after a fresh session re-registers the contribution.
 */
import 'fake-indexeddb/auto';
import { zipSync } from 'fflate';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  getActiveContributions,
  getRegisteredPlugins,
} from '../components/Inspector/pluginSections';
import { pluginController } from './controller';
import type { PluginPackageManifest } from './package';
import { getStoredPlugin, getStoredPluginState, putStoredPlugin } from './store';

const encoder = new TextEncoder();
const WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const PLUGIN_ID = 'com.example.panels';

const MANIFEST: PluginPackageManifest = {
  schemaVersion: 1,
  id: PLUGIN_ID,
  name: 'Panel Preference Sample',
  publisher: 'Example Studio',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'module.wasm',
  permissions: { required: ['selection.read'], optional: [] },
  commands: [{ id: 'analyze', title: 'Analyze selection', kind: 'analysis' }],
  inspector: [
    { id: 'readiness', title: 'Selection readiness', command: 'analyze', tab: 'properties' },
  ],
};

const ARCHIVE = zipSync(
  {
    'manifest.json': encoder.encode(JSON.stringify(MANIFEST)),
    'module.wasm': WASM,
  },
  { level: 0 },
);

async function sha256Hex(bytes: ArrayLike<number>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function contributionsFor(id: string) {
  return getActiveContributions().filter((contrib) => contrib.pluginId === id);
}

describe('plugin panel preferences', () => {
  beforeAll(async () => {
    const previous = await getStoredPluginState(PLUGIN_ID);
    await putStoredPlugin(
      {
        archive: Uint8Array.from(ARCHIVE),
        // Structured clone re-wraps buffers; the controller re-parses the
        // archive anyway, so seed the parsed-shaped fields with real values.
        manifest: { ...MANIFEST },
        wasm: WASM,
        sha256: await sha256Hex(Uint8Array.from(ARCHIVE)),
        grants: ['selection.read'],
        installedAt: Date.now(),
        enabled: true,
        source: 'local-file',
      },
      previous.revision,
    );
    pluginController.setSectionRenderer(() => null);
    await pluginController.initialize();
  });

  it('registers a ready plugin with its command and section', async () => {
    const snapshot = pluginController.getSnapshot();
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.plugins).toHaveLength(1);
    expect(snapshot.plugins[0]?.id).toBe(PLUGIN_ID);
    expect(snapshot.plugins[0]?.status).toBe('ready');
    expect(snapshot.plugins[0]?.hiddenPanels).toEqual([]);
    expect(contributionsFor(PLUGIN_ID).map((contrib) => contrib.contributionId)).toEqual([
      'readiness',
    ]);
    const { getActionRegistry } = await import('../actions/ActionRegistry');
    expect(getActionRegistry().has(`plugin:${PLUGIN_ID}:analyze`)).toBe(true);
  });

  it('pauses runtime surfaces in safe mode without changing the saved enabled choice', async () => {
    pluginController.setSafeModeDisabled(true);
    expect(pluginController.getSnapshot().safeModeDisabled).toBe(true);
    expect(pluginController.getSnapshot().plugins[0]?.status).toBe('safe-mode');
    expect(pluginController.getSnapshot().plugins[0]?.enabled).toBe(true);
    expect((await getStoredPlugin(PLUGIN_ID))?.enabled).toBe(true);
    const { getActionRegistry } = await import('../actions/ActionRegistry');
    expect(getActionRegistry().has(`plugin:${PLUGIN_ID}:analyze`)).toBe(false);
    expect(contributionsFor(PLUGIN_ID)).toEqual([]);
    await expect(pluginController.run(PLUGIN_ID, 'analyze')).rejects.toThrow(
      'Plugins are disabled in safe mode',
    );

    pluginController.setSafeModeDisabled(false);
    expect(pluginController.getSnapshot().plugins[0]?.status).toBe('ready');
    expect(getActionRegistry().has(`plugin:${PLUGIN_ID}:analyze`)).toBe(true);
  });

  it('hides a panel into the record and out of the active registry', async () => {
    await pluginController.setPanelHidden(PLUGIN_ID, 'readiness', true);
    expect(pluginController.getSnapshot().plugins[0]?.hiddenPanels).toEqual(['readiness']);
    expect(contributionsFor(PLUGIN_ID)).toEqual([]);
    const stored = await getStoredPlugin(PLUGIN_ID);
    expect(stored?.hiddenPanels).toEqual(['readiness']);
    // Display preference only: registration survives, only activity changes.
    expect(getRegisteredPlugins().find((state) => state.manifest.id === PLUGIN_ID)?.status).toBe(
      'active',
    );
  });

  it('rejects a panel the plugin does not contribute', async () => {
    await expect(pluginController.setPanelHidden(PLUGIN_ID, 'not-real', true)).rejects.toThrow(
      'does not contribute that Inspector panel',
    );
    expect(pluginController.getSnapshot().plugins[0]?.hiddenPanels).toEqual(['readiness']);
  });

  it('shows the panel again through the same route', async () => {
    await pluginController.setPanelHidden(PLUGIN_ID, 'readiness', false);
    expect(pluginController.getSnapshot().plugins[0]?.hiddenPanels).toEqual([]);
    expect(contributionsFor(PLUGIN_ID).map((contrib) => contrib.contributionId)).toEqual([
      'readiness',
    ]);
    expect((await getStoredPlugin(PLUGIN_ID))?.hiddenPanels).toBeUndefined();
  });

  it('restores the hidden preference in a fresh session', async () => {
    await pluginController.setPanelHidden(PLUGIN_ID, 'readiness', true);

    // Simulate an application restart: fresh module graph, same local store.
    vi.resetModules();
    const [{ pluginController: fresh }, sections] = await Promise.all([
      import('./controller'),
      import('../components/Inspector/pluginSections'),
    ]);
    fresh.setSectionRenderer(() => null);
    await fresh.initialize();

    expect(fresh.getSnapshot().plugins[0]?.hiddenPanels).toEqual(['readiness']);
    expect(
      sections
        .getActiveContributions()
        .some(
          (contrib) => contrib.pluginId === PLUGIN_ID && contrib.contributionId === 'readiness',
        ),
    ).toBe(false);
    expect(
      sections.getRegisteredPlugins().find((state) => state.manifest.id === PLUGIN_ID)?.status,
    ).toBe('active');

    // Leave the shared registry clean for any other importers in this worker.
    sections.unregisterPlugin(PLUGIN_ID);
  });
});
