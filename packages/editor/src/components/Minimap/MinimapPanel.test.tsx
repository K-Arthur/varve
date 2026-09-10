import { fireEvent, render } from '@testing-library/react';
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

  it('has accessible label on section', () => {
    const { container } = renderWithProvider();
    const panel = container.querySelector('section');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('aria-label')).toContain('Minimap');
  });

  it('canvas has tabIndex for keyboard focus', () => {
    const { container } = renderWithProvider();
    const canvas = container.querySelector('canvas');
    expect(canvas?.getAttribute('tabindex')).toBe('0');
  });

  it('canvas has role="img" with descriptive aria-label', () => {
    const { container } = renderWithProvider();
    const canvas = container.querySelector('canvas');
    expect(canvas?.getAttribute('role')).toBe('img');
    expect(canvas?.getAttribute('aria-label')).toContain('Document minimap');
  });

  it('shows object count in header', () => {
    const { container } = renderWithProvider();
    const title = container.querySelector('.minimap-panel__title');
    expect(title?.textContent).toContain('objects');
  });

  it('has a collapse button', () => {
    const { container } = renderWithProvider();
    const btn = container.querySelector('.minimap-panel__collapse-btn');
    expect(btn).toBeTruthy();
  });

  it('collapse button hides minimap', () => {
    const { container } = renderWithProvider();
    const btn = container.querySelector('.minimap-panel__collapse-btn') as HTMLButtonElement;
    fireEvent.click(btn);
    // After collapse, should show the expand button
    expect(container.querySelector('.minimap-panel--collapsed')).toBeTruthy();
  });

  it('collapsed state can be expanded', () => {
    const { container } = renderWithProvider();
    // Collapse first
    const collapseBtn = container.querySelector(
      '.minimap-panel__collapse-btn',
    ) as HTMLButtonElement;
    fireEvent.click(collapseBtn);
    expect(container.querySelector('.minimap-panel--collapsed')).toBeTruthy();

    // Click expand
    const expandBtn = container.querySelector('.minimap-panel--collapsed') as HTMLButtonElement;
    fireEvent.click(expandBtn);
    expect(container.querySelector('canvas.minimap-panel__canvas')).toBeTruthy();
  });

  it('canvas handles keyboard arrow keys without crashing', () => {
    const { container } = renderWithProvider();
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(() => {
      fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
      fireEvent.keyDown(canvas, { key: 'ArrowRight' });
      fireEvent.keyDown(canvas, { key: 'ArrowUp' });
      fireEvent.keyDown(canvas, { key: 'ArrowDown' });
    }).not.toThrow();
  });

  it('Enter key triggers fit-all without crashing', () => {
    const { container } = renderWithProvider();
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(() => {
      fireEvent.keyDown(canvas, { key: 'Enter' });
    }).not.toThrow();
  });

  it('Escape key collapses the minimap', () => {
    const { container } = renderWithProvider();
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(container.querySelector('.minimap-panel--collapsed')).toBeTruthy();
  });
});
