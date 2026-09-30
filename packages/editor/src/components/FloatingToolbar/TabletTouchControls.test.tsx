// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorProvider } from '../../context';
import { interactionSession } from '../../tools/InteractionContext';
import { SettingsProvider } from '../Settings/SettingsContext';
import { TabletTouchControls } from './TabletTouchControls';

function renderControls() {
  return render(
    <EditorProvider>
      <SettingsProvider>
        <TabletTouchControls />
      </SettingsProvider>
    </EditorProvider>,
  );
}

beforeEach(() => {
  // Drive the real gate. The tablet control now renders only when the editor
  // is in tablet layout, and `SettingsProvider` resolves that from the
  // `appearance.layoutPreference` setting — writing `data-layout-mode`
  // directly was overwritten by the provider on mount, which would have let
  // this test pass against a control the product no longer renders.
  localStorage.setItem(
    'varve-editor-settings',
    JSON.stringify({ appearance: { layoutPreference: 'tablet' } }),
  );
  interactionSession.setLatchedModifier('constrain', false);
  interactionSession.setLatchedModifier('fromCenter', false);
  interactionSession.setLatchedModifier('bypassSnap', false);
  interactionSession.armDeepSelect(false);
});

afterEach(() => {
  cleanup();
  localStorage.removeItem('varve-editor-settings');
  delete document.documentElement.dataset.layoutMode;
  interactionSession.setLatchedModifier('constrain', false);
  interactionSession.setLatchedModifier('fromCenter', false);
  interactionSession.setLatchedModifier('bypassSnap', false);
  interactionSession.armDeepSelect(false);
});

describe('TabletTouchControls', () => {
  it('exposes latched modifiers and keyboardless deep selection in an accessible popover', async () => {
    renderControls();
    // `data-layout-mode` is published by `SettingsProvider`'s mount effect, so
    // the trigger appears one microtask after first render — exactly as in the
    // browser, where the shell cannot know the resolved mode before its effects
    // run. Query by waiting rather than asserting the pre-effect frame.
    const trigger = await screen.findByRole('button', { name: 'Tablet editing controls' });
    fireEvent.click(trigger);

    expect(await screen.findByRole('dialog', { name: 'Tablet editing controls' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Constrain movement' }));
    fireEvent.click(screen.getByRole('button', { name: 'From centre' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bypass snapping' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deep select next tap' }));

    expect(interactionSession.getControlSnapshot()).toMatchObject({
      constrain: true,
      fromCenter: true,
      bypassSnap: true,
      deepSelectArmed: true,
    });
  });

  it('keeps a compact gesture guide in the same popover', async () => {
    renderControls();
    const trigger = await screen.findByRole('button', { name: 'Tablet editing controls' });
    fireEvent.click(trigger);

    expect(await screen.findByRole('dialog', { name: 'Tablet editing controls' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Gestures' })).toBeInTheDocument();
    expect(screen.getByText(/two fingers/i)).toBeInTheDocument();
    expect(screen.getByText(/pan and zoom the canvas/i)).toBeInTheDocument();
    // The guide names gestures but must not become the only path: the
    // corresponding control for each mode stays in the panel.
    expect(screen.getByRole('button', { name: 'Constrain movement' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deep select next tap' })).toBeInTheDocument();
  });
});
