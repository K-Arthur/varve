/** @vitest-environment jsdom */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getActionRegistry, resetActionRegistryForTesting } from '../actions/ActionRegistry';
import { SettingsProvider, useSettings } from '../components/Settings/SettingsContext';
import { registerLayoutPreferenceCommands } from './layoutPreferenceCommands';
import { LAYOUT_PREFERENCE_REQUEST_EVENT } from './layoutPresentation';

afterEach(() => {
  cleanup();
  resetActionRegistryForTesting();
});

describe('tablet layout View commands', () => {
  it('registers and dispatches the persisted preference choices', () => {
    registerLayoutPreferenceCommands();
    const received: unknown[] = [];
    window.addEventListener(LAYOUT_PREFERENCE_REQUEST_EVENT, (event) => {
      received.push((event as CustomEvent).detail.preference);
    });

    expect(getActionRegistry().dispatch('layoutPreference:tablet')).toBe(true);
    expect(received).toEqual(['tablet']);
    expect(getActionRegistry().get('layoutPreference:tablet')?.label).toBe(
      'Tablet workspace layout',
    );
  });

  it('routes a View command through the settings provider and persists it', () => {
    function CurrentPreference() {
      const { settings } = useSettings();
      return <output>{settings.appearance.layoutPreference}</output>;
    }
    render(
      <SettingsProvider>
        <CurrentPreference />
      </SettingsProvider>,
    );
    act(() => registerLayoutPreferenceCommands());
    act(() => getActionRegistry().dispatch('layoutPreference:desktop'));

    expect(document.querySelector('output')).toHaveTextContent('desktop');
    expect(localStorage.getItem('varve-editor-settings')).toContain('"layoutPreference":"desktop"');
  });
});
