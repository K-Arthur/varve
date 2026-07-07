import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Shell } from './Shell';

vi.mock('./CanvasArea', () => ({
  CanvasArea: () => <div data-testid="canvas-area" />,
}));

vi.mock('./LayersPanel', () => ({
  LayersPanel: () => <div data-testid="layers-panel" />,
}));

vi.mock('./components/Inspector/PropertiesPanel', () => ({
  PropertiesPanel: () => <div data-testid="properties-panel" />,
}));

describe('Shell motion integration', () => {
  it('renders TimelinePanel when timelinePanelVisible is true', () => {
    // Not testing onboarding here — pre-seed as "complete" so the Welcome
    // dialog doesn't cover the timeline panel this test asserts on.
    localStorage.setItem('strata:onboarding', JSON.stringify({ onboardingComplete: true }));

    // Shell wraps its own internal EditorProvider (it isn't consumed from an
    // ambient one), so the only way to toggle timelinePanelVisible — which
    // now defaults to false — is through Shell's own UI: the same
    // Ctrl+Alt+T shortcut the View menu's "Timeline Panel" item uses.
    render(<Shell active />);
    fireEvent.keyDown(window, { key: 't', ctrlKey: true, altKey: true });

    expect(screen.getByText('No timeline selected')).toBeTruthy();
    expect(screen.getByTestId('timeline-create-empty')).toBeTruthy();
  });
});
