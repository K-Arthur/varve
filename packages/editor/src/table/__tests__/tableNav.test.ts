/**
 * Table cell keyboard navigation (pure, unit-tested).
 */

import { createTableModel, mergeCells, setColumnHidden } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  cellCoordinateOf,
  cellsInRange,
  moveCursor,
  tabCursor,
  visibleGridSize,
} from '../tableNav';

const model = createTableModel(4, 4, { headerRows: 1 });

describe('moveCursor', () => {
  it('moves in all four directions with clamping at the edges', () => {
    expect(moveCursor(model, { row: 1, col: 1 }, 'up')).toEqual({ row: 0, col: 1 });
    expect(moveCursor(model, { row: 1, col: 1 }, 'down')).toEqual({ row: 2, col: 1 });
    expect(moveCursor(model, { row: 1, col: 1 }, 'left')).toEqual({ row: 1, col: 0 });
    expect(moveCursor(model, { row: 1, col: 1 }, 'right')).toEqual({ row: 1, col: 2 });
    expect(moveCursor(model, { row: 0, col: 0 }, 'up')).toEqual({ row: 0, col: 0 });
    expect(moveCursor(model, { row: 3, col: 3 }, 'right')).toEqual({ row: 3, col: 3 });
    expect(moveCursor(model, { row: 3, col: 3 }, 'down')).toEqual({ row: 3, col: 3 });
  });

  it('skips hidden columns when computing the visible grid', () => {
    const withHidden = setColumnHidden(model, model.columnOrder[2]!, true);
    const { cols } = visibleGridSize(withHidden);
    expect(cols).toBe(3);
    // Right from col 1 lands on visible col 2 (the old column 3).
    expect(moveCursor(withHidden, { row: 0, col: 1 }, 'right')).toEqual({ row: 0, col: 2 });
  });
});

describe('tabCursor', () => {
  it('moves row-major and wraps', () => {
    expect(tabCursor(model, { row: 0, col: 0 }, false)).toEqual({ row: 0, col: 1 });
    expect(tabCursor(model, { row: 0, col: 3 }, false)).toEqual({ row: 1, col: 0 });
    expect(tabCursor(model, { row: 3, col: 3 }, false)).toEqual({ row: 0, col: 0 });
    expect(tabCursor(model, { row: 0, col: 0 }, true)).toEqual({ row: 3, col: 3 });
    expect(tabCursor(model, { row: 1, col: 0 }, true)).toEqual({ row: 0, col: 3 });
  });
});

describe('cellsInRange', () => {
  it('returns the owning cells of a rectangular range', () => {
    const cells = cellsInRange(model, { row: 0, col: 0 }, { row: 1, col: 1 });
    expect(cells).toHaveLength(4);
  });

  it('handles spans: covered coordinates resolve to the owning cell', () => {
    const merged = mergeCells(model, 0, 0, 2, 2);
    const cells = cellsInRange(merged, { row: 0, col: 0 }, { row: 1, col: 1 });
    expect(cells).toHaveLength(1);
    const owner = merged.cells[merged.cellIndex['0,0']!]!;
    expect(cells[0]).toBe(owner.id);
  });
});

describe('cellCoordinateOf', () => {
  it('finds the top-left coordinate of a cell id', () => {
    const id = model.cellIndex['2,3']!;
    expect(cellCoordinateOf(model, id)).toEqual({ row: 2, col: 3 });
    expect(cellCoordinateOf(model, 'missing')).toBeNull();
  });
});
