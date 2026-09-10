// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider } from '../../context';
import {
  getPanelWidths,
  getWorkspacePreferences,
  resetWorkspacePreferenceCache,
  savePanelWidths,
  updateWorkspacePreferences,
} from '../../workspace/workspaceStore';
import { PanelWidthDragEdge } from './PanelWidthDragEdge';

vi.setConfig({ testTimeout: 30000 });

// RTL's cleanup() removes only its own render container — containers this
// file appends manually leak across tests unless removed here, and a leaked
// first match would make the component write its width to an orphaned node.
const manualContainers: HTMLElement[] = [];

beforeEach(() => {
  localStorage.clear();
  resetWorkspacePreferenceCache();
});

afterEach(() => {
  for (const el of manualContainers.splice(0)) el.remove();
  localStorage.clear();
  resetWorkspacePreferenceCache();
});

function mountWithContainer() {
  // The edge writes its width to the Shell-owned [data-panel="library"]
  // container (CSS custom properties inherit downward from it).
  const container = document.createElement('div');
  container.setAttribute('data-panel', 'library');
  document.body.appendChild(container);
  manualContainers.push(container);
  render(
    <EditorProvider>
      <PanelWidthDragEdge />
    </EditorProvider>,
  );
  return { container };
}

describe('PanelWidthDragEdge', () => {
  it('is a keyboard-accessible separator with value bounds', () => {
    const { container } = mountWithContainer();
    const handle = screen.getByRole('separator', { name: 'Resize resources panel' });
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('aria-valuemin', '240');
    expect(handle).toHaveAttribute('aria-valuemax', '600');
    expect(container.style.getPropertyValue('--library-panel-width')).toBe('');
  });

  it('arrow keys resize the panel and persist per workspace mode', () => {
    const { container } = mountWithContainer();
    const handle = screen.getByRole('separator', { name: 'Resize resources panel' });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    // 300 default + 16 = 316.
    expect(container.style.getPropertyValue('--library-panel-width')).toBe('316px');
    expect(getPanelWidths(getWorkspacePreferences(), 'design').library).toBe(316);

    fireEvent.keyDown(handle, { key: 'Home' });
    expect(container.style.getPropertyValue('--library-panel-width')).toBe('240px');

    fireEvent.keyDown(handle, { key: 'End' });
    expect(container.style.getPropertyValue('--library-panel-width')).toBe('600px');
  });

  it('clamps keyboard resizes to the panel limits', () => {
    const { container } = mountWithContainer();
    const handle = screen.getByRole('separator', { name: 'Resize resources panel' });

    for (let i = 0; i < 40; i++) fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(container.style.getPropertyValue('--library-panel-width')).toBe('600px');

    for (let i = 0; i < 40; i++) fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(container.style.getPropertyValue('--library-panel-width')).toBe('240px');
  });

  it('restores the active mode saved width on mount', () => {
    updateWorkspacePreferences((p) => savePanelWidths(p, 'design', { library: 420 }));

    const { container } = mountWithContainer();
    expect(container.style.getPropertyValue('--library-panel-width')).toBe('420px');
  });

  it('double-click resets to the default and clears the saved width', () => {
    updateWorkspacePreferences((p) => savePanelWidths(p, 'design', { library: 500 }));

    const { container } = mountWithContainer();
    expect(container.style.getPropertyValue('--library-panel-width')).toBe('500px');

    fireEvent.doubleClick(screen.getByRole('separator', { name: 'Resize resources panel' }));
    expect(container.style.getPropertyValue('--library-panel-width')).toBe('');
    expect(getPanelWidths(getWorkspacePreferences(), 'design').library).toBeUndefined();
  });
});
