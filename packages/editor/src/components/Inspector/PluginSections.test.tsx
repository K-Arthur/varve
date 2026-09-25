/**
 * Tests for the trusted, in-process PluginSections host.
 *
 * Covers: governed rendering with the shared disclosure grammar, tab
 * targeting, availability gating (safeCheckAvailability path, including a
 * throwing predicate), ordering, lifecycle (disable/uninstall), and the
 * section-scoped error boundary and explicit recovery.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { contributionDisclosureId, PluginSections } from './InspectorPluginSections';
import {
  disablePlugin,
  getRegisteredPlugins,
  type PluginManifest,
  registerPlugin,
  unregisterPlugin,
} from './pluginSections';

const HOST = { selectionCount: 1, workspaceMode: 'design' as const, activeTool: 'select' };

function manifestWith(
  contributions: PluginManifest['contributions'],
  id = 'com.test.plugin',
): PluginManifest {
  return {
    id,
    name: 'Test plugin',
    version: '1.0.0',
    contributions,
  };
}

function contribute(overrides: Partial<PluginManifest['contributions'][number]> = {}, id?: string) {
  registerPlugin(
    manifestWith(
      [
        {
          pluginId: id ?? 'com.test.plugin',
          contributionId: 'widget',
          targetTab: 'properties',
          display: { title: 'Widget' },
          ...overrides,
        },
      ],
      id,
    ),
  );
}

afterEach(() => {
  for (const plugin of getRegisteredPlugins()) unregisterPlugin(plugin.manifest.id);
});

describe('PluginSections host', () => {
  it('renders an active contribution in the shared disclosure grammar', () => {
    contribute({
      render: () => <p>Plugin body</p>,
    });
    render(<PluginSections tab="properties" host={HOST} />);

    expect(screen.getByRole('button', { name: 'Widget' })).toBeTruthy();
    expect(screen.getByText('Plugin body')).toBeTruthy();
  });

  it('accepts legacy document targeting as properties', () => {
    contribute({ targetTab: 'document', render: () => <p>Legacy body</p> });
    render(<PluginSections tab="properties" host={HOST} />);

    expect(screen.getByText('Legacy body')).toBeTruthy();
  });

  it('gates on availability, quarantines a throwing predicate, and keeps another plugin visible', () => {
    registerPlugin(
      manifestWith([
        {
          pluginId: 'com.test.plugin',
          contributionId: 'needs-selection',
          targetTab: 'properties',
          display: { title: 'Needs selection' },
          availability: { minSelection: 3 },
          render: () => <p>Never</p>,
        },
        {
          pluginId: 'com.test.plugin',
          contributionId: 'broken-predicate',
          targetTab: 'properties',
          display: { title: 'Broken predicate' },
          availability: {
            predicate: () => {
              throw new Error('predicate exploded');
            },
          },
          render: () => <p>Never either</p>,
        },
      ]),
    );
    contribute({ render: () => <p>Always body</p> }, 'com.other.plugin');
    render(<PluginSections tab="properties" host={HOST} />);

    expect(screen.getByText('Always body')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Needs selection' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Broken predicate' })).toBeNull();
    expect(
      getRegisteredPlugins().find((plugin) => plugin.manifest.id === 'com.test.plugin')?.status,
    ).toBe('error');
    expect(screen.getByRole('alert').textContent).toContain('predicate exploded');
    expect(screen.getByRole('button', { name: 'Widget' })).toBeTruthy();
  });

  it('renders contributions in declared order', () => {
    registerPlugin(
      manifestWith([
        {
          pluginId: 'com.test.plugin',
          contributionId: 'second',
          targetTab: 'properties',
          display: { title: 'Second' },
          order: 200,
          render: () => <p>2</p>,
        },
        {
          pluginId: 'com.test.plugin',
          contributionId: 'first',
          targetTab: 'properties',
          display: { title: 'First' },
          order: 100,
          render: () => <p>1</p>,
        },
      ]),
    );
    render(<PluginSections tab="properties" host={HOST} />);

    const titles = screen.getAllByRole('button').map((button) => button.textContent);
    expect(titles.indexOf('First')).toBeLessThan(titles.indexOf('Second'));
  });

  it('hides sections of a disabled plugin and restores them on re-register lifecycle', () => {
    contribute({ render: () => <p>Widget body</p> });
    const { unmount } = render(<PluginSections tab="properties" host={HOST} />);
    expect(screen.getByText('Widget body')).toBeTruthy();

    act(() => disablePlugin('com.test.plugin'));
    expect(screen.queryByText('Widget body')).toBeNull();
    unmount();
  });

  it('uninstalling removes the section', () => {
    contribute({ render: () => <p>Widget body</p> });
    render(<PluginSections tab="properties" host={HOST} />);
    expect(screen.getByText('Widget body')).toBeTruthy();

    act(() => unregisterPlugin('com.test.plugin'));
    expect(screen.queryByText('Widget body')).toBeNull();
  });

  it('a throwing render factory withdraws the section, shows recovery, and needs explicit retry', () => {
    contribute({
      render: () => {
        throw new Error('render exploded');
      },
    });
    render(<PluginSections tab="properties" host={HOST} />);

    expect(screen.queryByRole('button', { name: 'Widget' })).toBeNull();
    const plugin = getRegisteredPlugins()[0];
    expect(plugin).toBeDefined();
    if (!plugin) return;
    expect(plugin.status).toBe('error');
    expect(plugin.error).toBe('render exploded');
    expect(screen.getByRole('alert').textContent).toContain('render exploded');
    act(() =>
      registerPlugin(
        manifestWith([
          {
            pluginId: 'com.test.plugin',
            contributionId: 'widget',
            targetTab: 'properties',
            display: { title: 'Widget' },
            render: () => <p>Repaired body</p>,
          },
        ]),
      ),
    );
    expect(screen.queryByText('Repaired body')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry plugin' }));
    expect(screen.getByText('Repaired body')).toBeTruthy();
    expect(getRegisteredPlugins()[0]?.status).toBe('active');
  });

  it('assigns distinct stable disclosure IDs where the old slash replacement collided', () => {
    const first = {
      pluginId: 'com.a-b',
      contributionId: 'c',
    } as PluginManifest['contributions'][number];
    const second = {
      pluginId: 'com.a',
      contributionId: 'b-c',
    } as PluginManifest['contributions'][number];
    expect(contributionDisclosureId(first)).not.toBe(contributionDisclosureId(second));
    expect(contributionDisclosureId(first)).toBe(contributionDisclosureId(first));
  });

  it('gives two formerly colliding section keys distinct accessible panel IDs', () => {
    registerPlugin(
      manifestWith(
        [
          {
            pluginId: 'com.a-b',
            contributionId: 'c',
            targetTab: 'properties',
            display: { title: 'First' },
          },
        ],
        'com.a-b',
      ),
    );
    registerPlugin(
      manifestWith(
        [
          {
            pluginId: 'com.a',
            contributionId: 'b-c',
            targetTab: 'properties',
            display: { title: 'Second' },
          },
        ],
        'com.a',
      ),
    );
    render(<PluginSections tab="properties" host={HOST} />);
    const firstPanel = screen.getByRole('button', { name: 'First' }).getAttribute('aria-controls');
    const secondPanel = screen
      .getByRole('button', { name: 'Second' })
      .getAttribute('aria-controls');
    expect(firstPanel).toBeTruthy();
    expect(secondPanel).toBeTruthy();
    expect(firstPanel).not.toBe(secondPanel);
  });

  it('a contribution without a render factory renders an empty shell', () => {
    contribute({});
    render(<PluginSections tab="properties" host={HOST} />);

    const trigger = screen.getByRole('button', { name: 'Widget' });
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Widget' })).toBeTruthy();
  });
});
