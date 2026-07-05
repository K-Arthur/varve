import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider } from '../../context';
import { MinimapPanel } from './MinimapPanel';

function renderWithProvider() {
  return render(
    <EditorProvider>
      <MinimapPanel />
    </EditorProvider>,
  );
}

describe('MinimapPanel', () => {
  it('renders without crashing', () => {
    const { container } = renderWithProvider();
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  it('has a canvas element with the correct class', () => {
    const { container } = renderWithProvider();
    const canvas = container.querySelector('canvas.minimap-panel__canvas');
    expect(canvas).toBeTruthy();
  });

  it('renders inside a minimap-panel container', () => {
    const { container } = renderWithProvider();
    const panel = container.querySelector('.minimap-panel');
    expect(panel).toBeTruthy();
  });
});
