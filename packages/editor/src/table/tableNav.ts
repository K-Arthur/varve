/**
 * Table cell keyboard navigation (pure, unit-tested).
 *
 * Navigation operates on the top-left coordinate space of the visible grid;
 * selecting a coordinate covered by a span selects the owning cell.
 */
import type { TableModel } from '@varve/scene';

export type TableNavDirection = 'up' | 'down' | 'left' | 'right';

export interface CellNavState {
  row: number;
  col: number;
}

export function cellIdAt(table: TableModel, row: number, col: number): string | null {
  return table.cellIndex[`${row},${col}`] ?? null;
}

/** Row/col of the owning cell's top-left for a cell id. */
export function cellCoordinateOf(table: TableModel, cellId: string): CellNavState | null {
  for (const [key, id] of Object.entries(table.cellIndex)) {
    if (id !== cellId) continue;
    const m = /^(\d+),(\d+)$/.exec(key);
    if (!m) continue;
    return { row: Number(m[1]), col: Number(m[2]) };
  }
  return null;
}

/** Visible rows/columns (hidden excluded). */
export function visibleGridSize(table: TableModel): { rows: number; cols: number } {
  const rows = table.rowOrder.filter((id) => table.rows[id]?.hidden !== true).length;
  const cols = table.columnOrder.filter((id) => table.columns[id]?.hidden !== true).length;
  return { rows, cols };
}

/**
 * Move the selection cursor one step; `extend` keeps the anchor and expands
 * the range (returns the same cursor for range computation by the caller).
 */
export function moveCursor(
  table: TableModel,
  cursor: CellNavState,
  dir: TableNavDirection,
): CellNavState {
  const { rows, cols } = visibleGridSize(table);
  let { row, col } = cursor;
  switch (dir) {
    case 'up':
      row = Math.max(0, row - 1);
      break;
    case 'down':
      row = Math.min(rows - 1, row + 1);
      break;
    case 'left':
      col = Math.max(0, col - 1);
      break;
    case 'right':
      col = Math.min(cols - 1, col + 1);
      break;
  }
  return { row, col };
}

/** Row-major next cell (Tab), or previous (Shift+Tab). */
export function tabCursor(table: TableModel, cursor: CellNavState, reverse: boolean): CellNavState {
  const { rows, cols } = visibleGridSize(table);
  if (rows === 0 || cols === 0) return cursor;
  if (reverse) {
    const flat = cursor.row * cols + cursor.col - 1;
    if (flat < 0) return { row: rows - 1, col: cols - 1 };
    return { row: Math.floor(flat / cols), col: flat % cols };
  }
  const flat = cursor.row * cols + cursor.col + 1;
  if (flat >= rows * cols) return { row: 0, col: 0 };
  return { row: Math.floor(flat / cols), col: flat % cols };
}

/** All cell ids covered by a rectangular range (via the occupancy grid). */
export function cellsInRange(table: TableModel, from: CellNavState, to: CellNavState): string[] {
  const { rows, cols } = visibleGridSize(table);
  const r1 = Math.max(0, Math.min(from.row, to.row));
  const r2 = Math.min(rows - 1, Math.max(from.row, to.row));
  const c1 = Math.max(0, Math.min(from.col, to.col));
  const c2 = Math.min(cols - 1, Math.max(from.col, to.col));
  const seen = new Set<string>();
  const out: string[] = [];
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const cellId = cellIdAt(table, r, c);
      if (cellId && !seen.has(cellId)) {
        seen.add(cellId);
        out.push(cellId);
      }
    }
  }
  return out;
}
