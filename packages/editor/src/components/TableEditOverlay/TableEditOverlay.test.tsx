// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { makeTableNode } from '@varve/scene';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TableEditOverlay } from './TableEditOverlay';

const setTableEdit = vi.fn();
let editorValue: unknown;

vi.mock('../../context', () => ({ useEditor: () => editorValue }));

describe('TableEditOverlay keyboard', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    setTableEdit.mockClear();
  });

  it('moves the cell cursor even when an earlier listener re-renders mid-dispatch', () => {
    const table = makeTableNode('t', { rows: 2, columns: 2 });
    const firstCell = table.table.cellIndex['0,0']!;
    const editorFor = () => ({
      state: {
        document: { nodes: { t: table } },
        tableEdit: {
          tableId: 't',
          cellIds: [firstCell],
          activeCellId: firstCell,
          editingCellId: null,
          anchorCellId: firstCell,
        },
      },
      setTableEdit,
      getWorldTransform: () => [1, 0, 0, 1, 0, 0],
      announce: vi.fn(),
      tableOp: vi.fn(),
    });
    const overlay = () => (
      <TableEditOverlay
        zoom={1}
        pan={{ x: 0, y: 0 }}
        cameraRotation={0}
        worldToScreen={(x, y) => [x, y]}
      />
    );

    let rerender: ((ui: React.ReactElement) => void) | null = null;
    // Registered first in the same phase, like the editor's global shortcut
    // capture: a state update re-renders the overlay while the key is still
    // dispatching, which used to re-subscribe (and so drop) its listener.
    const earlier = () =>
      flushSync(() => {
        editorValue = editorFor();
        rerender?.(overlay());
      });
    window.addEventListener('keydown', earlier, true);
    cleanups.push(() => window.removeEventListener('keydown', earlier, true));

    editorValue = editorFor();
    const view = render(overlay());
    rerender = view.rerender;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));

    expect(setTableEdit).toHaveBeenCalledTimes(1);
    expect(setTableEdit.mock.calls[0]![0].activeCellId).not.toBe(firstCell);
  });
});
