/**
 * Native responsive table document model.
 *
 * A table is a first-class semantic document capability, NOT a collection of
 * frames. Rows, columns, and cells carry stable ids; merged ranges refer to
 * stable identities; spans are validated against non-overlapping rectangular
 * invariants; structural edits are atomic immutable operations (tableOps.ts).
 *
 * Content is data-backed: plain text lives in lightweight cell records, so a
 * 10,000-cell table is one scene node, not ten thousand text nodes. Rich
 * scene-content slots are a documented follow-up (ADR-0016 D1).
 *
 * Research basis: CSS Tables Level 3, Figma table proposal, spreadsheets
 * (stable row/column identity, span invariants).
 */
import type { ManagedColor } from './colorManagement';

export type TableRowId = string;
export type TableColumnId = string;
export type TableCellId = string;

/** A table-model-internal monotonic id counter (remapped on clone/paste). */
export const TABLE_SCHEMA_VERSION = 1;

export interface TableModel {
  schemaVersion: number;
  /** Monotonic counter for row/column/cell id generation. */
  nextId: number;
  rowOrder: TableRowId[];
  columnOrder: TableColumnId[];
  rows: Record<TableRowId, TableRowDefinition>;
  columns: Record<TableColumnId, TableColumnDefinition>;
  cells: Record<TableCellId, TableCellDefinition>;
  /**
   * Logical coordinate index: "rowIdx,colIdx" (unspanned top-left) → cell id.
   * Every visible coordinate maps to exactly one owning cell.
   */
  cellIndex: Record<string, TableCellId>;
  /** Number of leading rows that are column headers (semantic roles). */
  headerRows: number;
  /** Number of leading columns that are row headers (semantic roles). */
  headerColumns: number;
  /** Frozen (kept visible) leading rows/columns. Independent of header roles. */
  frozenRows: number;
  frozenColumns: number;
  responsive: TableResponsiveConfiguration;
  appearance: TableAppearance;
}

export interface TableRowDefinition {
  id: TableRowId;
  sizing: TableRowSizing;
  /** Hidden rows are excluded from layout; cells in them are not rendered. */
  hidden?: boolean;
  /** Semantic section role for the row. */
  role?: 'header' | 'body' | 'footer';
  minHeight?: number;
  maxHeight?: number;
}

export type TableRowSizing = { kind: 'fixed'; value: number } | { kind: 'content' };

export interface TableColumnDefinition {
  id: TableColumnId;
  sizing: TableColumnSizing;
  hidden?: boolean;
  minWidth?: number;
  maxWidth?: number;
}

export type TableColumnSizing =
  | { kind: 'fixed'; value: number }
  | { kind: 'content' }
  | { kind: 'fraction'; value: number }
  | { kind: 'percentage'; value: number };

export interface TableCellDefinition {
  id: TableCellId;
  rowId: TableRowId;
  columnId: TableColumnId;
  /** 1-based span extents (1 = no span). */
  rowSpan: number;
  columnSpan: number;
  content: TableCellContent;
  style?: TableCellStyle;
  /** Semantic role; defaults are derived from row/column header positions. */
  role?: 'column-header' | 'row-header' | 'data';
  locked?: boolean;
}

export type TableCellContent =
  | { kind: 'text'; text: string }
  | { kind: 'empty' }
  | {
      /**
       * Rich scene content: a reference to a scene node (image, component
       * instance, group…) rendered inside the cell, clipped to its bounds.
       * The node lives in the document node graph (NOT in the table's cell
       * records) so it participates in rendering, hit testing, clipboard
       * closure, and asset pruning like any other node.
       */
      kind: 'scene';
      nodeId: string;
    };

export interface TableCellStyle {
  alignH?: 'left' | 'center' | 'right';
  alignV?: 'top' | 'middle' | 'bottom';
  padding?: number;
  fill?: ManagedColor;
  borderColor?: ManagedColor;
  /** Per-cell border stroke width; 0 disables the cell border. */
  borderWidth?: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
}

export type TableDensity = 'compact' | 'comfortable' | 'spacious';

export interface TableAppearance {
  headerFill: ManagedColor;
  bodyFill: ManagedColor;
  /** Zebra-stripe fill; only used when `zebra` is true. */
  alternateFill: ManagedColor;
  /** Outer border color. */
  borderColor: ManagedColor;
  /** Inner divider color. */
  dividerColor: ManagedColor;
  headerText: ManagedColor;
  bodyText: ManagedColor;
  borderWidth: number;
  dividerWidth: number;
  cornerRadius: number;
  cellPadding: number;
  rowGap: number;
  columnGap: number;
  density: TableDensity;
  zebra: boolean;
  /** 'collapse' draws dividers at shared edges; 'separate' centers them on gaps. */
  borderCollapse: 'collapse' | 'separate';
}

export interface TableResponsiveConfiguration {
  overflowX: 'expand' | 'clip' | 'scroll';
  overflowY: 'expand' | 'clip' | 'scroll';
  rules: TableResponsiveRule[];
}

export interface TableResponsiveRule {
  id: string;
  condition: {
    minWidth?: number;
    maxWidth?: number;
  };
  hiddenColumnIds?: TableColumnId[];
  density?: TableDensity;
  columnOverrides?: Record<
    TableColumnId,
    Partial<Pick<TableColumnDefinition, 'sizing' | 'minWidth' | 'maxWidth'>>
  >;
}

export function isTableResponsiveRuleActive(rule: TableResponsiveRule, width: number): boolean {
  if (rule.condition.minWidth !== undefined && width < rule.condition.minWidth) return false;
  if (rule.condition.maxWidth !== undefined && width > rule.condition.maxWidth) return false;
  return true;
}

/** Pick the active responsive rule for a width (first matching in order). */
export function activeResponsiveRule(
  rules: TableResponsiveRule[] | undefined,
  width: number,
): TableResponsiveRule | undefined {
  if (!rules) return undefined;
  for (const rule of rules) {
    if (isTableResponsiveRuleActive(rule, width)) return rule;
  }
  return undefined;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export const DEFAULT_TABLE_APPEARANCE: TableAppearance = {
  headerFill: { space: 'rgb', r: 240, g: 243, b: 247, a: 255 },
  bodyFill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
  alternateFill: { space: 'rgb', r: 247, g: 249, b: 252, a: 255 },
  borderColor: { space: 'rgb', r: 41, g: 45, b: 54, a: 255 },
  dividerColor: { space: 'rgb', r: 205, g: 211, b: 222, a: 255 },
  headerText: { space: 'rgb', r: 41, g: 45, b: 54, a: 255 },
  bodyText: { space: 'rgb', r: 41, g: 45, b: 54, a: 255 },
  borderWidth: 1,
  dividerWidth: 1,
  cornerRadius: 4,
  cellPadding: 8,
  rowGap: 0,
  columnGap: 0,
  density: 'comfortable',
  zebra: false,
  borderCollapse: 'collapse',
};

export const TABLE_DENSITY_PADDING: Record<TableDensity, number> = {
  compact: 4,
  comfortable: 8,
  spacious: 14,
};

export function emptyTableModel(): TableModel {
  return {
    schemaVersion: TABLE_SCHEMA_VERSION,
    nextId: 1,
    rowOrder: [],
    columnOrder: [],
    rows: {},
    columns: {},
    cells: {},
    cellIndex: {},
    headerRows: 0,
    headerColumns: 0,
    frozenRows: 0,
    frozenColumns: 0,
    responsive: { overflowX: 'expand', overflowY: 'expand', rules: [] },
    appearance: { ...DEFAULT_TABLE_APPEARANCE },
  };
}

function nextIdFor(model: { nextId: number }): { id: number; nextId: number } {
  return { id: model.nextId, nextId: model.nextId + 1 };
}

/**
 * Create a table model with `rowCount × columnCount` empty cells.
 * `headerRows`/`headerColumns` mark semantic header regions.
 */
export function createTableModel(
  rowCount: number,
  columnCount: number,
  options: {
    headerRows?: number;
    headerColumns?: number;
    frozenRows?: number;
    frozenColumns?: number;
    columnSizing?: TableColumnDefinition['sizing'];
    rowSizing?: TableRowDefinition['sizing'];
    appearance?: Partial<TableAppearance>;
  } = {},
): TableModel {
  const rows = Math.max(0, Math.floor(rowCount));
  const cols = Math.max(0, Math.floor(columnCount));
  const headerRows = Math.min(rows, Math.max(0, Math.floor(options.headerRows ?? 0)));
  const headerColumns = Math.min(cols, Math.max(0, Math.floor(options.headerColumns ?? 0)));

  const model = emptyTableModel();
  model.headerRows = headerRows;
  model.headerColumns = headerColumns;
  model.frozenRows = Math.min(rows, Math.max(0, Math.floor(options.frozenRows ?? 0)));
  model.frozenColumns = Math.min(cols, Math.max(0, Math.floor(options.frozenColumns ?? 0)));
  if (options.appearance) model.appearance = { ...model.appearance, ...options.appearance };

  const rowSizing = options.rowSizing ?? { kind: 'content' };
  const columnSizing = options.columnSizing ?? { kind: 'fraction', value: 1 };

  for (let r = 0; r < rows; r++) {
    const { id, nextId } = nextIdFor(model);
    model.nextId = nextId;
    const rowId = `r${id}`;
    model.rowOrder.push(rowId);
    model.rows[rowId] = { id: rowId, sizing: rowSizing };
  }
  for (let c = 0; c < cols; c++) {
    const { id, nextId } = nextIdFor(model);
    model.nextId = nextId;
    const columnId = `c${id}`;
    model.columnOrder.push(columnId);
    model.columns[columnId] = { id: columnId, sizing: columnSizing };
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      addCellAt(model, r, c, r < headerRows || c < headerColumns ? 'column-header' : 'data');
    }
  }
  return model;
}

export function addCellAt(
  model: TableModel,
  rowIdx: number,
  columnIdx: number,
  role?: TableCellDefinition['role'],
): TableCellDefinition {
  const rowId = model.rowOrder[rowIdx];
  const columnId = model.columnOrder[columnIdx];
  if (!rowId || !columnId) throw new Error('table cell coordinate out of bounds');
  const { id, nextId } = nextIdFor(model);
  model.nextId = nextId;
  const cellId = `cell${id}`;
  const cell: TableCellDefinition = {
    id: cellId,
    rowId,
    columnId,
    rowSpan: 1,
    columnSpan: 1,
    content: { kind: 'empty' },
    role,
  };
  model.cells[cellId] = cell;
  model.cellIndex[`${rowIdx},${columnIdx}`] = cellId;
  return cell;
}

// ── Coordinate lookup ───────────────────────────────────────────────────────

export function cellAt(
  model: TableModel,
  rowIdx: number,
  columnIdx: number,
): TableCellDefinition | undefined {
  const cellId = model.cellIndex[`${rowIdx},${columnIdx}`];
  return cellId ? model.cells[cellId] : undefined;
}

/** Row index of the owning row (first unspanned row for spanned cells). */
export function rowIndexOf(model: TableModel, rowId: TableRowId): number {
  return model.rowOrder.indexOf(rowId);
}

export function columnIndexOf(model: TableModel, columnId: TableColumnId): number {
  return model.columnOrder.indexOf(columnId);
}

// ── Occupancy grid ──────────────────────────────────────────────────────────

/**
 * Build the occupancy grid: grid[row][col] = cell id of the owning cell.
 * Cells with spans occupy every covered coordinate; the top-left coordinate
 * owns the cell id in `cellIndex`.
 */
export function occupancyGrid(model: TableModel): (string | null)[][] {
  const rows = model.rowOrder.length;
  const cols = model.columnOrder.length;
  const grid: (string | null)[][] = Array.from({ length: rows }, () =>
    Array<string | null>(cols).fill(null),
  );
  for (const cell of Object.values(model.cells)) {
    const rowIdx = rowIndexOf(model, cell.rowId);
    const columnIdx = columnIndexOf(model, cell.columnId);
    if (rowIdx < 0 || columnIdx < 0) continue;
    for (let r = rowIdx; r < Math.min(rows, rowIdx + Math.max(1, cell.rowSpan)); r++) {
      for (let c = columnIdx; c < Math.min(cols, columnIdx + Math.max(1, cell.columnSpan)); c++) {
        if (grid[r]?.[c] === null) grid[r]![c] = cell.id;
      }
    }
  }
  return grid;
}

/** True when no visible coordinate is covered by more than one cell. */
export function hasOverlappingSpans(model: TableModel): boolean {
  const seen = new Set<string>();
  for (const cell of Object.values(model.cells)) {
    const rowIdx = rowIndexOf(model, cell.rowId);
    const columnIdx = columnIndexOf(model, cell.columnId);
    if (rowIdx < 0 || columnIdx < 0) continue;
    for (let r = rowIdx; r < rowIdx + Math.max(1, cell.rowSpan); r++) {
      for (let c = columnIdx; c < columnIdx + Math.max(1, cell.columnSpan); c++) {
        if (r >= model.rowOrder.length || c >= model.columnOrder.length) continue;
        const key = `${r},${c}`;
        if (seen.has(key)) return true;
        seen.add(key);
      }
    }
  }
  return false;
}

/**
 * Scene node ids referenced by rich cell content (kind 'scene').
 * Used by clone/remap and asset pruning so referenced nodes are copied
 * with the table and never orphaned.
 */
export function tableContentNodeIds(model: TableModel): string[] {
  const ids = new Set<string>();
  for (const cell of Object.values(model.cells)) {
    if (cell.content.kind === 'scene') ids.add(cell.content.nodeId);
  }
  return [...ids];
}

// ── Validation ──────────────────────────────────────────────────────────────

export interface TableModelIssue {
  code:
    | 'duplicate-row-id'
    | 'duplicate-column-id'
    | 'duplicate-cell-id'
    | 'missing-row'
    | 'missing-column'
    | 'orphan-cell'
    | 'span-out-of-bounds'
    | 'overlapping-span'
    | 'duplicate-coordinate'
    | 'negative-span';
  message: string;
  ref?: string;
}

export function validateTableModel(model: TableModel | undefined): TableModelIssue[] {
  const issues: TableModelIssue[] = [];
  if (!model) return issues;

  const rowIds = new Set<string>();
  for (const id of model.rowOrder) {
    if (rowIds.has(id))
      issues.push({ code: 'duplicate-row-id', message: `row ${id} duplicated`, ref: id });
    rowIds.add(id);
  }
  const columnIds = new Set<string>();
  for (const id of model.columnOrder) {
    if (columnIds.has(id))
      issues.push({ code: 'duplicate-column-id', message: `column ${id} duplicated`, ref: id });
    columnIds.add(id);
  }

  for (const cell of Object.values(model.cells)) {
    if (!model.rows[cell.rowId])
      issues.push({
        code: 'missing-row',
        message: `cell ${cell.id} references missing row`,
        ref: cell.id,
      });
    if (!model.columns[cell.columnId])
      issues.push({
        code: 'missing-column',
        message: `cell ${cell.id} references missing column`,
        ref: cell.id,
      });
    if (cell.rowSpan < 1 || cell.columnSpan < 1) {
      issues.push({
        code: 'negative-span',
        message: `cell ${cell.id} has invalid span`,
        ref: cell.id,
      });
    }
  }

  // Overlap detection: any coordinate covered by more than one cell's span.
  const spanCovered = new Set<string>();
  for (const cell of Object.values(model.cells)) {
    const rowIdx = rowIndexOf(model, cell.rowId);
    const columnIdx = columnIndexOf(model, cell.columnId);
    if (rowIdx < 0 || columnIdx < 0) continue;
    for (
      let r = rowIdx;
      r < Math.min(model.rowOrder.length, rowIdx + Math.max(1, cell.rowSpan));
      r++
    ) {
      for (
        let c = columnIdx;
        c < Math.min(model.columnOrder.length, columnIdx + Math.max(1, cell.columnSpan));
        c++
      ) {
        const key = `${r},${c}`;
        if (spanCovered.has(key)) {
          issues.push({
            code: 'overlapping-span',
            message: `span overlap at ${key}`,
            ref: cell.id,
          });
        }
        spanCovered.add(key);
      }
    }
  }

  for (const [key, cellId] of Object.entries(model.cellIndex)) {
    if (!model.cells[cellId]) {
      issues.push({
        code: 'orphan-cell',
        message: `cellIndex ${key} → missing cell ${cellId}`,
        ref: cellId,
      });
    } else {
      const m = /^(\d+),(\d+)$/.exec(key);
      if (!m) continue;
      const r = Number(m[1]);
      const c = Number(m[2]);
      if (r >= model.rowOrder.length || c >= model.columnOrder.length) {
        issues.push({
          code: 'span-out-of-bounds',
          message: `cellIndex key ${key} out of bounds`,
          ref: cellId,
        });
      }
    }
  }
  return issues;
}

export function isTableModelValid(model: TableModel | undefined): boolean {
  return validateTableModel(model).length === 0;
}
