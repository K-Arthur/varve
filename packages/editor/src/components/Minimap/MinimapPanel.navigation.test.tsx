/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MinimapPanel } from './MinimapPanel';

const { fitAll, revealSelection, setPan } = vi.hoisted(() => ({
  fitAll: vi.fn(),
  revealSelection: vi.fn(),
  setPan: vi.fn(),
}));

vi.mock('../../context', () => ({
  useEditor: () => ({
    state: {
      document: {
        nodes: {
          n1: { id: 'n1', kind: 'shape', shape: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 } },
        },
        rootChildren: ['n1'],
        pages: [],
        activePageId: null,
      },
      selection: [],
      pan: { x: 0, y: 0 },
      zoom: 1,
      themeRevision: 0,
    },
    selectedNodes: () => [],
    fitAll,
    revealSelection,
    setPan,
  }),
}));

beforeEach(() => {
  fitAll.mockClear();
  revealSelection.mockClear();
  setPan.mockClear();
});

function renderMinimap() {
  const view = render(<MinimapPanel />);
  const canvas = view.container.querySelector(
    'canvas.minimap-panel__canvas',
  ) as HTMLCanvasElement | null;
  return { view, canvas };
}

describe('MinimapPanel — fit-all semantics', () => {
  it('double-click fits the whole document, not the selection', () => {
    const { canvas } = renderMinimap();
    expect(canvas).toBeTruthy();
    fireEvent.doubleClick(canvas!);
    expect(fitAll).toHaveBeenCalledTimes(1);
    expect(revealSelection).not.toHaveBeenCalled();
  });

  it('Enter fits the whole document', () => {
    const { canvas } = renderMinimap();
    fireEvent.keyDown(canvas!, { key: 'Enter' });
    expect(fitAll).toHaveBeenCalledTimes(1);
    expect(revealSelection).not.toHaveBeenCalled();
  });

  it('Space fits the whole document', () => {
    const { canvas } = renderMinimap();
    fireEvent.keyDown(canvas!, { key: ' ' });
    expect(fitAll).toHaveBeenCalledTimes(1);
  });

  it('Home fits the whole document', () => {
    const { canvas } = renderMinimap();
    fireEvent.keyDown(canvas!, { key: 'Home' });
    expect(fitAll).toHaveBeenCalledTimes(1);
  });

  it('arrow keys pan without touching the selection', () => {
    const { canvas } = renderMinimap();
    fireEvent.keyDown(canvas!, { key: 'ArrowLeft' });
    expect(setPan).toHaveBeenCalled();
    expect(revealSelection).not.toHaveBeenCalled();
  });

  it('aria-label describes the real interaction contract', () => {
    renderMinimap();
    const canvas = screen.getByRole('img', { name: /Document minimap/ });
    const label = canvas.getAttribute('aria-label') ?? '';
    expect(label).toContain('fit the whole document');
  });
});
