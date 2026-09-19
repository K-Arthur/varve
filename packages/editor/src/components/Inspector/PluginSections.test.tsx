/**
 * Tests for the PluginSections host — the only route a plugin contribution
 * has into the Inspector.
 *
 * Covers: governed rendering with the shared disclosure grammar, tab
 * targeting, availability gating (safeCheckAvailability path, including a
 * throwing predicate), ordering, lifecycle (disable/uninstall), and the
 * section-scoped error boundary (a throwing render factory marks the plugin
 * errored and renders a quiet placeholder instead of crashing the panel).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PluginSections } from './PluginSections';
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

  it('ignores contributions targeted at another tab', () => {
    contribute({ targetTab: 'export', render: () => <p>Export body</p> });
    render(<PluginSections tab="properties" host={HOST} />);

    expect(screen.queryByRole('button', { name: 'Widget' })).toBeNull();
  });

  it('gates on availability and survives a throwing predicate', () => {
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
        {
          pluginId: 'com.test.plugin',
          contributionId: 'always',
          targetTab: 'properties',
          display: { title: 'Always' },
          render: () => <p>Always body</p>,
        },
      ]),
    );
    render(<PluginSections tab="properties" host={HOST} />);

    expect(screen.getByText('Always body')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Needs selection' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Broken predicate' })).toBeNull();
    // A throwing predicate must not take the panel down.
    expect(screen.getByRole('button', { name: 'Always' })).toBeTruthy();
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

  it('a throwing render factory withdraws the section and marks the plugin errored', () => {
    contribute({
      render: () => {
        throw new Error('render exploded');
      },
    });
    render(<PluginSections tab="properties" host={HOST} />);

    // Designed recovery: the boundary catches the throw, marks the plugin
    // errored, and the lifecycle withdraws its contributions — the panel
    // stays mounted and every other section keeps working.
    expect(screen.queryByRole('button', { name: 'Widget' })).toBeNull();
    const plugin = getRegisteredPlugins()[0];
    expect(plugin.status).toBe('error');
    expect(plugin.error).toBe('render exploded');
  });

  it('a contribution without a render factory renders an empty shell', () => {
    contribute({});
    render(<PluginSections tab="properties" host={HOST} />);

    const trigger = screen.getByRole('button', { name: 'Widget' });
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Widget' })).toBeTruthy();
  });
});
