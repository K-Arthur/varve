import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditorProvider } from './context';
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
    render(
      <EditorProvider>
        <Shell active />
      </EditorProvider>,
    );
    expect(screen.getByText('No timeline selected')).toBeTruthy();
  });
});
