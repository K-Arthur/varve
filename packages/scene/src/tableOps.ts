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

import type { ManagedColor } from './colorManagement';
import {
  addCellAt,
  DEFAULT_TABLE_APPEARANCE,
  TABLE_DENSITY_PADDING,
  TABLE_SCHEMA_VERSION,
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

/**
 * Remap every id inside a table model to fresh ids (clipboard paste,
 * cross-document import). Row/column/cell identities are all re-keyed; the
 * cellIndex is rebuilt from the new coordinates. Content is data and needs
 * no remapping.
 */
export function remapTableModelIds(
  model: TableModel,
  startCounter: number,
): { model: TableModel; nextId: number } {
  let counter = startCounter;
  const nextId = (): number => counter++;

  const rowMap = new Map<TableRowId, TableRowId>();
  const columnMap = new Map<TableColumnId, TableColumnId>();
  const cellMap = new Map<string, string>();

  const rowOrder: TableRowId[] = [];
  const rows: typeof model.rows = {};
  for (const rowId of model.rowOrder) {
    const row = model.rows[rowId];
    if (!row) continue;
    const newId = `r${nextId()}`;
    rowMap.set(rowId, newId);
    rowOrder.push(newId);
    rows[newId] = { ...row, id: newId };
  }

  const columnOrder: TableColumnId[] = [];
  const columns: typeof model.columns = {};
  for (const columnId of model.columnOrder) {
    const column = model.columns[columnId];
    if (!column) continue;
    const newId = `c${nextId()}`;
    columnMap.set(columnId, newId);
    columnOrder.push(newId);
    columns[newId] = { ...column, id: newId };
  }

  const cells: typeof model.cells = {};
  for (const cell of Object.values(model.cells)) {
    const newRowId = rowMap.get(cell.rowId);
    const newColumnId = columnMap.get(cell.columnId);
    if (!newRowId || !newColumnId) continue;
    const newId = `cell${nextId()}`;
    cellMap.set(cell.id, newId);
    let content: TableCellContent = { kind: 'empty' };
    if (cell.content.kind === 'text') {
      content = { kind: 'text', text: cell.content.text };
    } else if (cell.content.kind === 'scene') {
      // Preserve rich scene content; the referenced node id is remapped by
      // the clone/copy caller (it owns the node-id map for the subtree).
      content = { kind: 'scene', nodeId: cell.content.nodeId };
    }
    cells[newId] = {
      ...cell,
      id: newId,
      rowId: newRowId,
      columnId: newColumnId,
      style: cell.style ? { ...cell.style } : undefined,
      content,
    };
  }

  const next = {
    ...model,
    nextId: counter,
    rowOrder,
    columnOrder,
    rows,
    columns,
    cells,
    cellIndex: {},
    responsive: {
      ...model.responsive,
      rules: model.responsive.rules.map((rule) => ({
        ...rule,
        condition: { ...rule.condition },
        hiddenColumnIds: rule.hiddenColumnIds?.map((id) => columnMap.get(id) ?? id),
        columnOverrides: rule.columnOverrides
          ? Object.fromEntries(
              Object.entries(rule.columnOverrides)
                .map(([id, override]) => {
                  const newId = columnMap.get(id);
                  return newId ? ([newId, override] as const) : null;
                })
                .filter(
                  (x): x is readonly [string, (typeof rule.columnOverrides)[string]] => x !== null,
                ),
            )
          : undefined,
      })),
    },
    appearance: { ...model.appearance },
  };
  return { model: rebuildCellIndex(next), nextId: counter };
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

  // New cells must not land inside coordinates already covered by spans
  // extending from rows above the insertion point.
  const coveredColumns = new Set<number>();
  for (const cell of Object.values(next.cells)) {
    const cellRowIdx = next.rowOrder.indexOf(cell.rowId);
    const cellColumnIdx = next.columnOrder.indexOf(cell.columnId);
    if (cellRowIdx < 0 || cellColumnIdx < 0) continue;
    if (cellRowIdx + cell.rowSpan > idx && cellRowIdx <= idx) {
      for (
        let c = cellColumnIdx;
        c < Math.min(next.columnOrder.length, cellColumnIdx + cell.columnSpan);
        c++
      ) {
        coveredColumns.add(c);
      }
    }
  }

  for (let r = idx; r < idx + count; r++) {
    for (let c = 0; c < next.columnOrder.length; c++) {
      if (coveredColumns.has(c)) continue;
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

  // New cells must not land inside coordinates already covered by spans
  // extending from columns left of the insertion point.
  const coveredRows = new Set<number>();
  for (const cell of Object.values(next.cells)) {
    const cellColumnIdx = next.columnOrder.indexOf(cell.columnId);
    if (cellColumnIdx < 0) continue;
    if (cellColumnIdx + cell.columnSpan > idx && cellColumnIdx <= idx) {
      for (let r = 0; r < next.rowOrder.length; r++) {
        const cellRowIdx = next.rowOrder.indexOf(cell.rowId);
        if (r >= cellRowIdx && r < cellRowIdx + cell.rowSpan) coveredRows.add(r);
      }
    }
  }

  for (let c = idx; c < idx + count; c++) {
    for (let r = 0; r < next.rowOrder.length; r++) {
      if (coveredRows.has(r)) continue;
      const cell = addCellAt(next, r, c, c < next.headerColumns ? 'row-header' : 'data');
      if (c < next.headerColumns) cell.role = 'row-header';
    }
  }
  return rebuildCellIndex(next);
}

/**
 * Remove rows by index. Cells whose top-left row is removed are deleted;
 * spans of surviving cells are re-expressed in the new index space (they
 * extend across surviving rows only, never across a gap).
 */
export function removeRows(model: TableModel, indices: readonly number[]): TableModel {
  const removeSet = new Set(indices.map((i) => Math.floor(i)));
  if (removeSet.size === 0) return model;
  const next = cloneModel(model);

  const survivingOldRows: Array<{ id: TableRowId; oldIndex: number }> = [];
  for (let i = 0; i < next.rowOrder.length; i++) {
    if (!removeSet.has(i)) survivingOldRows.push({ id: next.rowOrder[i]!, oldIndex: i });
  }
  const newRowPosition = new Map(survivingOldRows.map((r, idx) => [r.id, idx]));

  const removedRowIds = new Set(next.rowOrder.filter((_, i) => removeSet.has(i)));

  const cells: TableModel['cells'] = {};
  for (const [cellId, cell] of Object.entries(next.cells)) {
    if (removedRowIds.has(cell.rowId)) continue;
    const oldIdx = survivingOldRows.find((r) => r.id === cell.rowId)?.oldIndex;
    if (oldIdx === undefined) continue;
    // Count surviving rows within the old covered range.
    let covered = 0;
    for (const r of survivingOldRows) {
      if (r.oldIndex >= oldIdx && r.oldIndex < oldIdx + cell.rowSpan) covered++;
    }
    const newRowId = cell.rowId;
    const rowSpan = Math.max(1, covered);
    cells[cellId] = { ...cell, rowId: newRowId, rowSpan };
  }

  const newRowOrder = survivingOldRows.map((r) => r.id);
  const rows: typeof next.rows = {};
  for (const row of Object.values(next.rows)) {
    if (newRowPosition.has(row.id)) rows[row.id] = row;
  }

  next.rowOrder = newRowOrder;
  next.rows = rows;
  next.cells = cells;
  next.headerRows = Math.min(next.headerRows, next.rowOrder.length);
  next.frozenRows = Math.min(next.frozenRows, next.rowOrder.length);
  return rebuildCellIndex(next);
}

/**
 * Remove columns by index. Cells whose top-left column is removed are
 * deleted; spans of surviving cells are re-expressed in the new index space.
 */
export function removeColumns(model: TableModel, indices: readonly number[]): TableModel {
  const removeSet = new Set(indices.map((i) => Math.floor(i)));
  if (removeSet.size === 0) return model;
  const next = cloneModel(model);

  const survivingOldColumns: Array<{ id: TableColumnId; oldIndex: number }> = [];
  for (let i = 0; i < next.columnOrder.length; i++) {
    if (!removeSet.has(i)) survivingOldColumns.push({ id: next.columnOrder[i]!, oldIndex: i });
  }
  const newColumnPosition = new Map(survivingOldColumns.map((c, idx) => [c.id, idx]));

  const removedColumnIds = new Set(next.columnOrder.filter((_, i) => removeSet.has(i)));

  const cells: TableModel['cells'] = {};
  for (const [cellId, cell] of Object.entries(next.cells)) {
    if (removedColumnIds.has(cell.columnId)) continue;
    const oldIdx = survivingOldColumns.find((c) => c.id === cell.columnId)?.oldIndex;
    if (oldIdx === undefined) continue;
    let covered = 0;
    for (const c of survivingOldColumns) {
      if (c.oldIndex >= oldIdx && c.oldIndex < oldIdx + cell.columnSpan) covered++;
    }
    cells[cellId] = { ...cell, columnId: cell.columnId, columnSpan: Math.max(1, covered) };
  }

  const newColumnOrder = survivingOldColumns.map((c) => c.id);
  const columns: typeof next.columns = {};
  for (const column of Object.values(next.columns)) {
    if (newColumnPosition.has(column.id)) columns[column.id] = column;
  }

  next.columnOrder = newColumnOrder;
  next.columns = columns;
  next.cells = cells;
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

/** Attach a scene node as rich cell content (image, component, group…). */
export function setCellSceneContent(model: TableModel, cellId: string, nodeId: string): TableModel {
  return setCellContent(model, cellId, { kind: 'scene', nodeId });
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
 *
 * The merge is rejected (no mutation) when an existing cell straddles the
 * range boundary — a span may only absorb cells fully contained in it. This
 * preserves the non-overlapping rectangular span invariant.
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

  // Reject when an existing cell straddles the range boundary.
  for (const cell of Object.values(model.cells)) {
    const cellRowIdx = model.rowOrder.indexOf(cell.rowId);
    const cellColumnIdx = model.columnOrder.indexOf(cell.columnId);
    if (cellRowIdx < 0 || cellColumnIdx < 0) continue;
    const cellEndRow = cellRowIdx + cell.rowSpan;
    const cellEndCol = cellColumnIdx + cell.columnSpan;
    const fullyInside =
      cellRowIdx >= r && cellEndRow <= r + rs && cellColumnIdx >= c && cellEndCol <= c + cs;
    const fullyOutside =
      cellEndRow <= r || cellRowIdx >= r + rs || cellEndCol <= c || cellColumnIdx >= c + cs;
    if (!fullyInside && !fullyOutside) return model;
  }

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
  // Density is a first-class sizing control: it owns the default cell
  // padding so the layout engine can resolve it without extra state.
  return setAppearance(model, { density, cellPadding: TABLE_DENSITY_PADDING[density] });
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

/**
 * Defensive normalization for loaded/untrusted table data (codec path).
 *
 * Guarantees the invariants every reader depends on:
 * - rows/columns/cells exist and reference valid ids
 * - spans are >= 1 and within bounds
 * - no overlapping spans (first cell wins)
 * - cellIndex maps coordinates to existing cells
 * - nextId is ahead of every generated id
 * - headerRows/headerColumns/frozenRows/frozenColumns stay in bounds
 *
 * Returns the repaired model; never throws.
 */
export function normalizeTableModelDefensively(raw: unknown): {
  model: TableModel | undefined;
  issues: string[];
} {
  const issues: string[] = [];
  if (!raw || typeof raw !== 'object') return { model: undefined, issues };

  const source = raw as Record<string, unknown>;
  const rowOrder = Array.isArray(source.rowOrder)
    ? [...new Set(source.rowOrder.filter((x): x is string => typeof x === 'string'))]
    : [];
  const columnOrder = Array.isArray(source.columnOrder)
    ? [...new Set(source.columnOrder.filter((x): x is string => typeof x === 'string'))]
    : [];
  const rowsRaw =
    source.rows && typeof source.rows === 'object' ? (source.rows as Record<string, unknown>) : {};
  const columnsRaw =
    source.columns && typeof source.columns === 'object'
      ? (source.columns as Record<string, unknown>)
      : {};
  const cellsRaw =
    source.cells && typeof source.cells === 'object'
      ? (source.cells as Record<string, unknown>)
      : {};

  const rows: TableModel['rows'] = {};
  for (const id of rowOrder) {
    const r = rowsRaw[id];
    if (!r || typeof r !== 'object') {
      issues.push(`row ${id} missing definition`);
      rows[id] = { id, sizing: { kind: 'content' } };
      continue;
    }
    const rr = r as Record<string, unknown>;
    const sizing =
      rr.sizing && typeof rr.sizing === 'object'
        ? (rr.sizing as { kind?: string; value?: unknown })
        : undefined;
    if (!sizing || (sizing.kind !== 'fixed' && sizing.kind !== 'content')) {
      issues.push(`row ${id} invalid sizing`);
      rows[id] = { id, sizing: { kind: 'content' } };
      continue;
    }
    const row: TableRowDefinition = {
      id,
      sizing:
        sizing.kind === 'fixed' && typeof sizing.value === 'number' && Number.isFinite(sizing.value)
          ? { kind: 'fixed', value: sizing.value }
          : { kind: 'content' },
      hidden: rr.hidden === true ? true : undefined,
    };
    rows[id] = row;
  }

  const columns: TableModel['columns'] = {};
  for (const id of columnOrder) {
    const c = columnsRaw[id];
    if (!c || typeof c !== 'object') {
      issues.push(`column ${id} missing definition`);
      columns[id] = { id, sizing: { kind: 'fraction', value: 1 } };
      continue;
    }
    const cc = c as Record<string, unknown>;
    const sizing =
      cc.sizing && typeof cc.sizing === 'object'
        ? (cc.sizing as Record<string, unknown>)
        : undefined;
    const kind = sizing?.kind;
    let resolvedSizing: TableColumnSizing = { kind: 'fraction', value: 1 };
    if (kind === 'fixed' && typeof sizing?.value === 'number' && Number.isFinite(sizing.value)) {
      resolvedSizing = { kind: 'fixed', value: sizing.value };
    } else if (kind === 'content') {
      resolvedSizing = { kind: 'content' };
    } else if (
      kind === 'percentage' &&
      typeof sizing?.value === 'number' &&
      Number.isFinite(sizing.value)
    ) {
      resolvedSizing = { kind: 'percentage', value: sizing.value };
    } else if (
      kind === 'fraction' &&
      typeof sizing?.value === 'number' &&
      Number.isFinite(sizing.value)
    ) {
      resolvedSizing = { kind: 'fraction', value: sizing.value };
    } else {
      issues.push(`column ${id} invalid sizing`);
    }
    const column: TableColumnDefinition = {
      id,
      sizing: resolvedSizing,
      hidden: cc.hidden === true ? true : undefined,
    };
    if (typeof cc.minWidth === 'number' && Number.isFinite(cc.minWidth))
      column.minWidth = cc.minWidth;
    if (typeof cc.maxWidth === 'number' && Number.isFinite(cc.maxWidth))
      column.maxWidth = cc.maxWidth;
    columns[id] = column;
  }

  const rowIdxOf = new Map(rowOrder.map((id, i) => [id, i]));
  const columnIdxOf = new Map(columnOrder.map((id, i) => [id, i]));
  const cells: TableModel['cells'] = {};
  const covered = new Set<string>();
  let maxCounter = 0;
  const counterOf = (id: string): number => {
    const m = /^(\d+)$/.exec(id);
    return m ? Number(m[1]) : 0;
  };

  for (const [cellId, c] of Object.entries(cellsRaw)) {
    if (!c || typeof c !== 'object') {
      issues.push(`cell ${cellId} not an object`);
      continue;
    }
    const cc = c as Record<string, unknown>;
    const rowId = typeof cc.rowId === 'string' ? cc.rowId : '';
    const columnId = typeof cc.columnId === 'string' ? cc.columnId : '';
    const rowIdx = rowIdxOf.get(rowId);
    const columnIdx = columnIdxOf.get(columnId);
    if (rowIdx === undefined || columnIdx === undefined) {
      issues.push(`cell ${cellId} orphaned`);
      continue;
    }
    const rowSpan = Math.max(1, Math.floor(Number(cc.rowSpan) || 1));
    const columnSpan = Math.max(1, Math.floor(Number(cc.columnSpan) || 1));
    let overlap = false;
    for (let r = rowIdx; r < Math.min(rowOrder.length, rowIdx + rowSpan); r++) {
      for (
        let cIdx = columnIdx;
        cIdx < Math.min(columnOrder.length, columnIdx + columnSpan);
        cIdx++
      ) {
        const key = `${r},${cIdx}`;
        if (covered.has(key)) overlap = true;
        covered.add(key);
      }
    }
    if (overlap) {
      issues.push(`cell ${cellId} overlaps another cell`);
      continue;
    }
    const rawContent = cc.content as Record<string, unknown> | undefined;
    const content: TableCellContent =
      rawContent && typeof rawContent === 'object' && rawContent.kind === 'text'
        ? { kind: 'text', text: String(rawContent.text ?? '') }
        : rawContent && typeof rawContent === 'object' && rawContent.kind === 'scene'
          ? typeof rawContent.nodeId === 'string' && rawContent.nodeId.length > 0
            ? { kind: 'scene', nodeId: rawContent.nodeId }
            : { kind: 'empty' }
          : { kind: 'empty' };
    const style =
      cc.style && typeof cc.style === 'object' ? (cc.style as TableCellStyle) : undefined;
    const role =
      cc.role === 'column-header' || cc.role === 'row-header' || cc.role === 'data'
        ? cc.role
        : undefined;
    cells[cellId] = {
      id: cellId,
      rowId,
      columnId,
      rowSpan: Math.min(rowSpan, rowOrder.length - rowIdx),
      columnSpan: Math.min(columnSpan, columnOrder.length - columnIdx),
      content,
      style,
      role,
    };
    maxCounter = Math.max(maxCounter, counterOf(cellId), counterOf(rowId), counterOf(columnId));
  }

  const appearanceRaw =
    source.appearance && typeof source.appearance === 'object'
      ? (source.appearance as Record<string, unknown>)
      : {};
  const fin = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const col = (v: unknown, fallback: ManagedColor): ManagedColor =>
    v && typeof v === 'object' && 'space' in v ? (v as ManagedColor) : fallback;
  const appearance: TableAppearance = {
    headerFill: col(appearanceRaw.headerFill, DEFAULT_TABLE_APPEARANCE.headerFill),
    bodyFill: col(appearanceRaw.bodyFill, DEFAULT_TABLE_APPEARANCE.bodyFill),
    alternateFill: col(appearanceRaw.alternateFill, DEFAULT_TABLE_APPEARANCE.alternateFill),
    borderColor: col(appearanceRaw.borderColor, DEFAULT_TABLE_APPEARANCE.borderColor),
    dividerColor: col(appearanceRaw.dividerColor, DEFAULT_TABLE_APPEARANCE.dividerColor),
    headerText: col(appearanceRaw.headerText, DEFAULT_TABLE_APPEARANCE.headerText),
    bodyText: col(appearanceRaw.bodyText, DEFAULT_TABLE_APPEARANCE.bodyText),
    borderWidth: Math.max(0, fin(appearanceRaw.borderWidth, DEFAULT_TABLE_APPEARANCE.borderWidth)),
    dividerWidth: Math.max(
      0,
      fin(appearanceRaw.dividerWidth, DEFAULT_TABLE_APPEARANCE.dividerWidth),
    ),
    cornerRadius: Math.max(
      0,
      fin(appearanceRaw.cornerRadius, DEFAULT_TABLE_APPEARANCE.cornerRadius),
    ),
    cellPadding: Math.max(0, fin(appearanceRaw.cellPadding, DEFAULT_TABLE_APPEARANCE.cellPadding)),
    rowGap: Math.max(0, fin(appearanceRaw.rowGap, DEFAULT_TABLE_APPEARANCE.rowGap)),
    columnGap: Math.max(0, fin(appearanceRaw.columnGap, DEFAULT_TABLE_APPEARANCE.columnGap)),
    density:
      appearanceRaw.density === 'compact' || appearanceRaw.density === 'spacious'
        ? appearanceRaw.density
        : 'comfortable',
    zebra: appearanceRaw.zebra === true,
    borderCollapse: appearanceRaw.borderCollapse === 'separate' ? 'separate' : 'collapse',
  };

  const responsiveRaw =
    source.responsive && typeof source.responsive === 'object'
      ? (source.responsive as Record<string, unknown>)
      : {};
  const rules = Array.isArray(responsiveRaw.rules)
    ? responsiveRaw.rules
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r) => {
          const conditionRaw =
            r.condition && typeof r.condition === 'object'
              ? (r.condition as Record<string, unknown>)
              : {};
          const condition: TableResponsiveRule['condition'] = {};
          if (typeof conditionRaw.minWidth === 'number' && Number.isFinite(conditionRaw.minWidth)) {
            condition.minWidth = conditionRaw.minWidth;
          }
          if (typeof conditionRaw.maxWidth === 'number' && Number.isFinite(conditionRaw.maxWidth)) {
            condition.maxWidth = conditionRaw.maxWidth;
          }
          return {
            id: typeof r.id === 'string' ? r.id : `rule${maxCounter + 1}`,
            condition,
            hiddenColumnIds: Array.isArray(r.hiddenColumnIds)
              ? r.hiddenColumnIds.filter((x): x is string => typeof x === 'string')
              : undefined,
            density:
              r.density === 'compact' || r.density === 'spacious' || r.density === 'comfortable'
                ? (r.density as TableDensity)
                : undefined,
            columnOverrides:
              r.columnOverrides && typeof r.columnOverrides === 'object'
                ? (r.columnOverrides as TableResponsiveRule['columnOverrides'])
                : undefined,
          };
        })
    : [];

  const model: TableModel = {
    schemaVersion:
      typeof source.schemaVersion === 'number' ? source.schemaVersion : TABLE_SCHEMA_VERSION,
    nextId: Math.max(maxCounter + 1, typeof source.nextId === 'number' ? source.nextId : 1),
    rowOrder,
    columnOrder,
    rows,
    columns,
    cells,
    cellIndex: {},
    headerRows: Math.max(0, Math.min(rowOrder.length, Math.floor(Number(source.headerRows) || 0))),
    headerColumns: Math.max(
      0,
      Math.min(columnOrder.length, Math.floor(Number(source.headerColumns) || 0)),
    ),
    frozenRows: Math.max(0, Math.min(rowOrder.length, Math.floor(Number(source.frozenRows) || 0))),
    frozenColumns: Math.max(
      0,
      Math.min(columnOrder.length, Math.floor(Number(source.frozenColumns) || 0)),
    ),
    responsive: { overflowX: 'expand', overflowY: 'expand', rules },
    appearance,
  };
  return { model: rebuildCellIndex(model), issues };
}
