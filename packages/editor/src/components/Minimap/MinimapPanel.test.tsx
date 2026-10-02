import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import { MinimapPanel } from './MinimapPanel';

afterEach(() => vi.restoreAllMocks());

function PanelVisibility() {
  return (
    <output data-testid="left-panel-visible">{String(useEditor().state.leftPanelVisible)}</output>
  );
}

function renderWithProvider(props: Parameters<typeof MinimapPanel>[0] = {}) {
  return render(
    <EditorProvider>
      <MinimapPanel {...props} />
      <PanelVisibility />
    </EditorProvider>,
  );
}

describe('MinimapPanel', () => {
  it('dismisses a responsive Layers drawer without changing its desktop visibility preference', () => {
    const originalMatchMedia = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...originalMatchMedia(query),
      matches: query === '(max-width: 899px)',
    }));
    const closeDrawer = vi.fn();
    const { getByRole, getByTestId } = renderWithProvider({ onCloseResponsivePanel: closeDrawer });
    const previousVisibility = getByTestId('left-panel-visible').textContent;
    fireEvent.click(getByRole('button', { name: 'Close Layers panel' }));
    expect(closeDrawer).toHaveBeenCalledOnce();
    expect(getByTestId('left-panel-visible').textContent).toBe(previousVisibility);
  });

  it('retains the desktop collapse action when a drawer callback is supplied', () => {
    const closeDrawer = vi.fn();
    const { getByRole, getByTestId } = renderWithProvider({ onCloseResponsivePanel: closeDrawer });
    const previousVisibility = getByTestId('left-panel-visible').textContent;
    const collapse = getByRole('button', { name: 'Collapse Layers panel (Ctrl+B)' });
    fireEvent.click(collapse);
    expect(getByTestId('left-panel-visible').textContent).not.toBe(previousVisibility);
    expect(closeDrawer).not.toHaveBeenCalled();
    fireEvent.click(collapse);
    expect(getByTestId('left-panel-visible').textContent).toBe(previousVisibility);
  });

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
