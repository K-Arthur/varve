// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../Shell';

vi.mock('../CanvasArea', () => ({
  CanvasArea: () => <div data-testid="canvas-area" className="editor-canvas" />,
}));

vi.mock('../LayersPanel', () => ({
  LayersPanel: () => (
    <div data-testid="layers-panel" className="editor__layers-panel" data-panel="layers" />
  ),
}));

vi.mock('../components/Inspector/PropertiesPanel', () => ({
  PropertiesPanel: () => (
    <div
      data-testid="properties-panel"
      className="editor__inspector-panel"
      data-panel="inspector"
    />
  ),
}));

describe('Shell help integration', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      'strata:onboarding',
      JSON.stringify({ onboardingComplete: true, onboardingVersion: 1 }),
    );
  });

  it('F1 opens contextual help panel with complementary role', async () => {
    render(<Shell active />);

    fireEvent.keyDown(window, { key: 'F1' });

    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: 'Help' })).toBeTruthy();
    });
  });

  it('Ctrl+Shift+F1 opens full help center dialog', async () => {
    render(<Shell active />);

    fireEvent.keyDown(window, { key: 'F1', ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Help' })).toBeTruthy();
    });
  });

  it('Shift+F1 toggles What Is This hint', async () => {
    render(<Shell active />);

    await act(async () => {
      fireEvent.keyDown(window, { key: 'F1', shiftKey: true });
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/what is this mode/i)).toBeTruthy();
    });
  });
});
