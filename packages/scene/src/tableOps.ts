/**
 * Immutable structural table operations.
 *
 * Every op returns a new TableModel with stable row/column/cell identities,
 * a consistent `cellIndex`, and validated non-overlapping span invariants.
 * Deletion semantics are deterministic: a cell whose top-left coordinate is
 * deleted is removed with its row/column; a span reaching into a deleted
 * region is clamped (never left dangling). Moving rows/columns moves their
 * cells with them (identity preserved).
 */
import {
  addCellAt,
  type TableAppearance,
  type TableCellContent,
  type TableCellDefinition,
  type TableCellStyle,
  type TableColumnDefinition,
  type TableColumnId,
  type TableColumnSizing,
  type TableDensity,
  type TableModel,
  type TableResponsiveRule,
  type TableRowDefinition,
  type TableRowId,
  type TableRowSizing,
} from './table';

function withNextId(model: TableModel): { id: number; nextId: number } {
  return { id: model.nextId, nextId: model.nextId + 1 };
}

function cloneModel(model: TableModel): TableModel {
  return {
    ...model,
    rowOrder: [...model.rowOrder],
    columnOrder: [...model.columnOrder],
    rows: { ...model.rows },
    columns: { ...model.columns },
    cells: { ...model.cells },
    cellIndex: { ...model.cellIndex },
    responsive: {
      ...model.responsive,
      rules: model.responsive.rules.map((rule) => ({
        ...rule,
        condition: { ...rule.condition },
        hiddenColumnIds: rule.hiddenColumnIds ? [...rule.hiddenColumnIds] : undefined,
        columnOverrides: rule.columnOverrides ? { ...rule.columnOverrides } : undefined,
      })),
    },
    appearance: { ...model.appearance },
  };
}

/** Rebuild the cellIndex for a model whose cells/orders changed. */
export function rebuildCellIndex(model: TableModel): TableModel {
  const cellIndex: Record<string, string> = {};
  for (const cell of Object.values(model.cells)) {
    const rowIdx = model.rowOrder.indexOf(cell.rowId);
    const columnIdx = model.columnOrder.indexOf(cell.columnId);
    if (rowIdx < 0 || columnIdx < 0) continue;
    cellIndex[`${rowIdx},${columnIdx}`] = cell.id;
  }
  return { ...model, cellIndex };
}

/** Empty cell factory keyed by row/column ids. */
export function makeCell(
  model: TableModel,
  rowId: TableRowId,
  columnId: TableColumnId,
  content: TableCellContent = { kind: 'empty' },
  role?: TableCellDefinition['role'],
): { cell: TableCellDefinition; nextId: number } {
  const { id, nextId } = withNextId(model);
  return {
    cell: {
      id: `cell${id}`,
      rowId,
      columnId,
      rowSpan: 1,
      columnSpan: 1,
      content,
      role,
    },
    nextId,
  };
}

export function insertRow(
  model: TableModel,
  atIndex: number,
  count = 1,
  options: { role?: TableRowDefinition['role']; sizing?: TableRowSizing } = {},
): TableModel {
  if (count <= 0) return model;
  const next = cloneModel(model);
  const idx = Math.max(0, Math.min(next.rowOrder.length, atIndex));
  const sizing = options.sizing ?? { kind: 'content' };
  const role = options.role;

  const created: TableRowDefinition[] = [];
  for (let i = 0; i < count; i++) {
    const { id, nextId } = withNextId(next);
    next.nextId = nextId;
    const rowId = `r${id}`;
    created.push({ id: rowId, sizing, role });
  }

  next.rowOrder.splice(idx, 0, ...created.map((r) => r.id));
  for (const row of created) next.rows[row.id] = row;

  // Rows inserted into the header region are headers by default.
  if (idx < next.headerRows)
    next.headerRows = Math.min(next.rowOrder.length, next.headerRows + count);

  for (let r = idx; r < idx + count; r++) {
    for (let c = 0; c < next.columnOrder.length; c++) {
      const cell = addCellAt(next, r, c, r < next.headerRows ? 'column-header' : 'data');
      if (r < next.headerRows && role !== 'footer') cell.role = 'column-header';
    }
  }
  return rebuildCellIndex(next);
}

export function insertColumn(
  model: TableModel,
  atIndex: number,
  count = 1,
  options: { sizing?: TableColumnSizing } = {},
): TableModel {
  if (count <= 0) return model;
  const next = cloneModel(model);
  const idx = Math.max(0, Math.min(next.columnOrder.length, atIndex));
  const sizing = options.sizing ?? { kind: 'fraction', value: 1 };

  const created: TableColumnDefinition[] = [];
  for (let i = 0; i < count; i++) {
    const { id, nextId } = withNextId(next);
    next.nextId = nextId;
    const columnId = `c${id}`;
    created.push({ id: columnId, sizing });
  }

  next.columnOrder.splice(idx, 0, ...created.map((c) => c.id));
  for (const column of created) next.columns[column.id] = column;

  if (idx < next.headerColumns) {
    next.headerColumns = Math.min(next.columnOrder.length, next.headerColumns + count);
  }

  for (let c = idx; c < idx + count; c++) {
    for (let r = 0; r < next.rowOrder.length; r++) {
      const cell = addCellAt(next, r, c, c < next.headerColumns ? 'row-header' : 'data');
      if (c < next.headerColumns) cell.role = 'row-header';
    }
  }
  return rebuildCellIndex(next);
}

/** Remove rows by index; spans into the removed range are clamped. */
export function removeRows(model: TableModel, indices: readonly number[]): TableModel {
  const removeSet = new Set(indices.map((i) => Math.floor(i)));
  if (removeSet.size === 0) return model;
  const next = cloneModel(model);

  // Clamp spans that reach into removed rows from above (top-left survives).
  for (const cell of Object.values(next.cells)) {
    const rowIdx = next.rowOrder.indexOf(cell.rowId);
    if (rowIdx < 0) continue;
    if (removeSet.has(rowIdx)) continue;
    let reach = rowIdx + cell.rowSpan;
    for (let r = rowIdx + 1; r < next.rowOrder.length; r++) {
      if (removeSet.has(r)) {
        reach = Math.min(reach, r);
        break;
      }
    }
    if (reach <= rowIdx + 1) continue;
    if (reach < rowIdx + cell.rowSpan) cell.rowSpan = Math.max(1, reach - rowIdx);
  }

  // Delete cells whose top-left row is removed.
  const removedRows = next.rowOrder.filter((_, i) => removeSet.has(i));
  const removedRowSet = new Set(removedRows);
  for (const [cellId, cell] of Object.entries(next.cells)) {
    if (removedRowSet.has(cell.rowId)) delete next.cells[cellId];
  }

  const newOrder = next.rowOrder.filter((_, i) => !removeSet.has(i));
  next.rowOrder = newOrder;
  for (const id of removedRowSet) delete next.rows[id];
  next.headerRows = Math.min(next.headerRows, next.rowOrder.length);
  next.frozenRows = Math.min(next.frozenRows, next.rowOrder.length);
  return rebuildCellIndex(next);
}

/** Remove columns by index; spans into the removed range are clamped. */
export function removeColumns(model: TableModel, indices: readonly number[]): TableModel {
  const removeSet = new Set(indices.map((i) => Math.floor(i)));
  if (removeSet.size === 0) return model;
  const next = cloneModel(model);

  for (const cell of Object.values(next.cells)) {
    const columnIdx = next.columnOrder.indexOf(cell.columnId);
    if (columnIdx < 0) continue;
    if (removeSet.has(columnIdx)) continue;
    let reach = columnIdx + cell.columnSpan;
    for (let c = columnIdx + 1; c < next.columnOrder.length; c++) {
      if (removeSet.has(c)) {
        reach = Math.min(reach, c);
        break;
      }
    }
    if (reach <= columnIdx + 1) continue;
    if (reach < columnIdx + cell.columnSpan) cell.columnSpan = Math.max(1, reach - columnIdx);
  }

  const removedColumns = next.columnOrder.filter((_, i) => removeSet.has(i));
  const removedColumnSet = new Set(removedColumns);
  for (const [cellId, cell] of Object.entries(next.cells)) {
    if (removedColumnSet.has(cell.columnId)) delete next.cells[cellId];
  }

  next.columnOrder = next.columnOrder.filter((_, i) => !removeSet.has(i));
  for (const id of removedColumnSet) delete next.columns[id];
  next.headerColumns = Math.min(next.headerColumns, next.columnOrder.length);
  next.frozenColumns = Math.min(next.frozenColumns, next.columnOrder.length);
  return rebuildCellIndex(next);
}

/** Move a row to a new index (cells travel with it; identity preserved). */
export function moveRow(model: TableModel, fromIndex: number, toIndex: number): TableModel {
  const next = cloneModel(model);
  const from = Math.floor(fromIndex);
  const to = Math.floor(toIndex);
  if (from < 0 || from >= next.rowOrder.length || from === to) return model;
  const [rowId] = next.rowOrder.splice(from, 1);
  if (!rowId) return model;
  next.rowOrder.splice(Math.max(0, Math.min(next.rowOrder.length, to)), 0, rowId);
  return rebuildCellIndex(next);
}

export function moveColumn(model: TableModel, fromIndex: number, toIndex: number): TableModel {
  const next = cloneModel(model);
  const from = Math.floor(fromIndex);
  const to = Math.floor(toIndex);
  if (from < 0 || from >= next.columnOrder.length || from === to) return model;
  const [columnId] = next.columnOrder.splice(from, 1);
  if (!columnId) return model;
  next.columnOrder.splice(Math.max(0, Math.min(next.columnOrder.length, to)), 0, columnId);
  return rebuildCellIndex(next);
}

export function setCellContent(
  model: TableModel,
  cellId: string,
  content: TableCellContent,
): TableModel {
  const cell = model.cells[cellId];
  if (!cell) return model;
  return { ...model, cells: { ...model.cells, [cellId]: { ...cell, content } } };
}

export function setCellText(model: TableModel, cellId: string, text: string): TableModel {
  return setCellContent(model, cellId, { kind: 'text', text });
}

export function setCellStyle(
  model: TableModel,
  cellId: string,
  partial: Partial<TableCellStyle>,
): TableModel {
  const cell = model.cells[cellId];
  if (!cell) return model;
  return {
    ...model,
    cells: { ...model.cells, [cellId]: { ...cell, style: { ...cell.style, ...partial } } },
  };
}

export function setCellRole(
  model: TableModel,
  cellId: string,
  role: TableCellDefinition['role'],
): TableModel {
  const cell = model.cells[cellId];
  if (!cell) return model;
  return { ...model, cells: { ...model.cells, [cellId]: { ...cell, role } } };
}

/**
 * Merge a rectangular range of coordinates into one spanned cell.
 * Covered cells are removed; their text is joined with newlines in the
 * merged cell. The range must be in-bounds and non-empty.
 */
export function mergeCells(
  model: TableModel,
  rowIdx: number,
  columnIdx: number,
  rowSpan: number,
  columnSpan: number,
): TableModel {
  const r = Math.floor(rowIdx);
  const c = Math.floor(columnIdx);
  const rs = Math.max(1, Math.floor(rowSpan));
  const cs = Math.max(1, Math.floor(columnSpan));
  if (r < 0 || c < 0 || r + rs > model.rowOrder.length || c + cs > model.columnOrder.length) {
    return model;
  }
  if (rs === 1 && cs === 1) return model;

  const next = cloneModel(model);
  const covered: TableCellDefinition[] = [];
  for (let row = r; row < r + rs; row++) {
    for (let col = c; col < c + cs; col++) {
      const cell = cellByCoordinate(next, row, col);
      if (cell && !covered.some((x) => x.id === cell.id)) covered.push(cell);
    }
  }
  const owner = cellByCoordinate(next, r, c);
  if (!owner) return model;

  const texts = covered
    .map((x) => (x.content.kind === 'text' ? x.content.text : ''))
    .filter((t) => t.length > 0);
  const mergedText = texts.join('\n');

  for (const cell of covered) {
    if (cell.id !== owner.id) delete next.cells[cell.id];
  }
  next.cells[owner.id] = {
    ...owner,
    rowSpan: rs,
    columnSpan: cs,
    content: mergedText.length > 0 ? { kind: 'text', text: mergedText } : { kind: 'empty' },
  };
  return rebuildCellIndex(next);
}

function cellByCoordinate(
  model: TableModel,
  rowIdx: number,
  columnIdx: number,
): TableCellDefinition | undefined {
  const cellId = model.cellIndex[`${rowIdx},${columnIdx}`];
  return cellId ? model.cells[cellId] : undefined;
}

/**
 * Split a spanned cell back into unit cells. Text is distributed
 * row-major across the covered area (first line to the top-left cell).
 */
export function splitCell(model: TableModel, cellId: string): TableModel {
  const cell = model.cells[cellId];
  if (!cell || (cell.rowSpan <= 1 && cell.columnSpan <= 1)) return model;

  const next = cloneModel(model);
  const owner = next.cells[cellId];
  if (!owner) return model;
  const rowIdx = next.rowOrder.indexOf(owner.rowId);
  const columnIdx = next.columnOrder.indexOf(owner.columnId);
  if (rowIdx < 0 || columnIdx < 0) return model;

  const lines = owner.content.kind === 'text' ? owner.content.text.split('\n') : [];
  delete next.cells[cellId];

  let line = 0;
  for (let r = rowIdx; r < rowIdx + owner.rowSpan; r++) {
    for (let c = columnIdx; c < columnIdx + owner.columnSpan; c++) {
      const rowId = next.rowOrder[r];
      const columnId = next.columnOrder[c];
      if (!rowId || !columnId) continue;
      const text = lines[line++];
      const { cell: newCell, nextId } = makeCell(
        next,
        rowId,
        columnId,
        text !== undefined ? { kind: 'text', text } : { kind: 'empty' },
        owner.role,
      );
      next.nextId = nextId;
      newCell.style = owner.style ? { ...owner.style } : undefined;
      next.cells[newCell.id] = newCell;
      next.cellIndex[`${r},${c}`] = newCell.id;
    }
  }
  return rebuildCellIndex(next);
}

export function setColumnSizing(
  model: TableModel,
  columnId: TableColumnId,
  sizing: TableColumnSizing,
): TableModel {
  const column = model.columns[columnId];
  if (!column) return model;
  return { ...model, columns: { ...model.columns, [columnId]: { ...column, sizing } } };
}

export function setColumnHidden(
  model: TableModel,
  columnId: TableColumnId,
  hidden: boolean,
): TableModel {
  const column = model.columns[columnId];
  if (!column || column.hidden === hidden) return model;
  return { ...model, columns: { ...model.columns, [columnId]: { ...column, hidden } } };
}

export function setRowSizing(
  model: TableModel,
  rowId: TableRowId,
  sizing: TableRowSizing,
): TableModel {
  const row = model.rows[rowId];
  if (!row) return model;
  return { ...model, rows: { ...model.rows, [rowId]: { ...row, sizing } } };
}

export function setRowHidden(model: TableModel, rowId: TableRowId, hidden: boolean): TableModel {
  const row = model.rows[rowId];
  if (!row || row.hidden === hidden) return model;
  return { ...model, rows: { ...model.rows, [rowId]: { ...row, hidden } } };
}

export function setHeaderRows(model: TableModel, count: number): TableModel {
  const next = {
    ...model,
    headerRows: Math.max(0, Math.min(model.rowOrder.length, Math.floor(count))),
  };
  return syncDefaultRoles(next);
}

export function setHeaderColumns(model: TableModel, count: number): TableModel {
  const next = {
    ...model,
    headerColumns: Math.max(0, Math.min(model.columnOrder.length, Math.floor(count))),
  };
  return syncDefaultRoles(next);
}

export function setFrozenRows(model: TableModel, count: number): TableModel {
  return {
    ...model,
    frozenRows: Math.max(0, Math.min(model.rowOrder.length, Math.floor(count))),
  };
}

export function setFrozenColumns(model: TableModel, count: number): TableModel {
  return {
    ...model,
    frozenColumns: Math.max(0, Math.min(model.columnOrder.length, Math.floor(count))),
  };
}

/**
 * Sync default cell roles with the header region: coordinates inside
 * headerRows×headerColumns get header roles unless explicitly overridden.
 */
export function syncDefaultRoles(model: TableModel): TableModel {
  const cells: typeof model.cells = { ...model.cells };
  let changed = false;
  for (const [cellId, cell] of Object.entries(cells)) {
    const rowIdx = model.rowOrder.indexOf(cell.rowId);
    const columnIdx = model.columnOrder.indexOf(cell.columnId);
    if (rowIdx < 0 || columnIdx < 0) continue;
    const defaultRole =
      rowIdx < model.headerRows || columnIdx < model.headerColumns
        ? rowIdx < model.headerRows
          ? 'column-header'
          : 'row-header'
        : 'data';
    if (cell.role !== defaultRole) {
      cells[cellId] = { ...cell, role: defaultRole };
      changed = true;
    }
  }
  return changed ? { ...model, cells } : model;
}

export function setAppearance(model: TableModel, partial: Partial<TableAppearance>): TableModel {
  return { ...model, appearance: { ...model.appearance, ...partial } };
}

export function setDensity(model: TableModel, density: TableDensity): TableModel {
  return setAppearance(model, { density });
}

export function setZebra(model: TableModel, zebra: boolean): TableModel {
  return setAppearance(model, { zebra });
}

export function addResponsiveRule(model: TableModel, rule: TableResponsiveRule): TableModel {
  return {
    ...model,
    responsive: { ...model.responsive, rules: [...model.responsive.rules, rule] },
  };
}

export function removeResponsiveRule(model: TableModel, ruleId: string): TableModel {
  return {
    ...model,
    responsive: {
      ...model.responsive,
      rules: model.responsive.rules.filter((r) => r.id !== ruleId),
    },
  };
}
