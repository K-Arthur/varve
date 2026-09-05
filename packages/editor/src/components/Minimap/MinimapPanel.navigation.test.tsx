/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MinimapPanel } from './MinimapPanel';

const { fitAll, panBy, revealSelection, setPan } = vi.hoisted(() => ({
  fitAll: vi.fn(),
  panBy: vi.fn(),
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
      cameraRotation: 0,
      minimapVisible: true,
      themeRevision: 0,
    },
    selectedNodes: () => [],
    fitAll,
    panBy,
    revealSelection,
    setPan,
  }),
}));

beforeEach(() => {
  fitAll.mockClear();
  panBy.mockClear();
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
    expect(panBy).toHaveBeenCalledWith(50, 0);
    expect(revealSelection).not.toHaveBeenCalled();
  });

  it('uses the supplied canvas owner and keeps a captured drag alive', async () => {
    const owner = document.createElement('div');
    Object.defineProperties(owner, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
    });
    const canvasOwnerRef = { current: owner };
    const view = render(<MinimapPanel canvasOwnerRef={canvasOwnerRef} />);
    const canvas = view.container.querySelector('canvas.minimap-panel__canvas');
    expect(canvas).toBeTruthy();
    canvas!.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 160, height: 120 }) as DOMRect;

    await waitFor(() => expect(canvas!.getBoundingClientRect().width).toBe(160));
    fireEvent.pointerDown(canvas!, {
      button: 0,
      pointerId: 11,
      clientX: 120,
      clientY: 70,
    });
    fireEvent.pointerMove(canvas!, { pointerId: 11, clientX: 140, clientY: 80 });
    expect(setPan).toHaveBeenCalledTimes(2);

    fireEvent.pointerUp(canvas!, { pointerId: 11 });
    fireEvent.pointerMove(canvas!, { pointerId: 11, clientX: 150, clientY: 90 });
    expect(setPan).toHaveBeenCalledTimes(2);
  });

  it('aria-label describes the real interaction contract', () => {
    renderMinimap();
    const canvas = screen.getByRole('img', { name: /Document minimap/ });
    const label = canvas.getAttribute('aria-label') ?? '';
    expect(label).toContain('fit the whole document');
  });
});
