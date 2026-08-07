/**
 * Deterministic native-table layout algorithm (ADR-0016 D4).
 *
 * Two-pass, bounded, monotonic:
 * - Pass 1 resolves column tracks (fixed px, percentage of available width,
 *   content = max-content of unspanned cells, fraction fills the remainder),
 *   then expands columns so spanning cells fit (minmax semantics), clamped
 *   by min/max widths and a convergence cap.
 * - Pass 2 resolves row heights; content rows take the max wrapped text
 *   height over all unspanned cells in the row (row-height synchronization),
 *   then expands rows for row-spanning cells, clamped by min/max heights.
 *
 * Every pass only grows sizes, so the algorithm is monotonic — it cannot
 * oscillate — and the convergence cap bounds pathological cases.
 *
 * Hidden columns collapse out of the layout; spans are re-expressed over the
 * visible grid. RTL mirrors the resolved column positions.
 *
 * Research basis: CSS Table Layout Algorithm (auto table layout), Figma
 * table sizing semantics, spreadsheets' row-height synchronization.
 */

import { DEFAULT_ARTWORK_FONT_FAMILY, textWrap } from '@varve/shared';
import type {
  TableCellContent,
  TableCellStyle,
  TableColumnDefinition,
  TableDensity,
  TableModel,
  TableRowDefinition,
} from './table';
import { activeResponsiveRule, TABLE_DENSITY_PADDING } from './table';

export const TABLE_LAYOUT_MAX_SPAN_PASSES = 8;
export const TABLE_LAYOUT_MIN_TRACK = 8;
export const TABLE_CELL_FONT_SIZE = 13;
export const TABLE_HEADER_FONT_SIZE = 13;
export const TABLE_DEFAULT_LINE_HEIGHT = 1.35;
export const TABLE_MAX_TEXT_LENGTH = 100_000;

export type TableCellRole = 'column-header' | 'row-header' | 'data';

export interface TableCellLayout {
  id: string;
  rowIdx: number;
  columnIdx: number;
  rowSpan: number;
  columnSpan: number;
  x: number;
  y: number;
  w: number;
  h: number;
  role: TableCellRole;
  content: TableCellContent;
  style?: TableCellStyle;
  /** Header cells use header fills/text colors and bold weight. */
  isHeader: boolean;
  /** Zebra-striped body rows alternate this fill. */
  zebra: boolean;
}

export interface TableLayoutResult {
  cellLayouts: TableCellLayout[];
  /** Visible column count (hidden columns collapsed). */
  visibleColumns: number;
  visibleRows: number;
  colWidths: number[];
  rowHeights: number[];
  /** x offset of the left edge of each visible column. */
  colPositions: number[];
  /** y offset of the top edge of each visible row. */
  rowPositions: number[];
  totalW: number;
  totalH: number;
  hiddenColumnIds: string[];
  density: TableDensity;
  /** Pass count used; hits the cap in pathological cases (converged flag). */
  passes: number;
  converged: boolean;
}

interface EffectiveColumn {
  definition: TableColumnDefinition;
  visibleIndex: number;
}

function finite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

function clampTrack(value: number, min?: number, max?: number): number {
  let v = Math.max(TABLE_LAYOUT_MIN_TRACK, value);
  if (min !== undefined && Number.isFinite(min)) v = Math.max(v, min);
  if (max !== undefined && Number.isFinite(max)) v = Math.min(v, max);
  return Math.max(TABLE_LAYOUT_MIN_TRACK, v);
}

function wrappedHeight(text: string, availWidth: number, fontSize: number): number {
  if (!text) return fontSize * TABLE_DEFAULT_LINE_HEIGHT;
  const lines = textWrap(text, Math.max(TABLE_LAYOUT_MIN_TRACK, availWidth), {
    fontSize,
    fontFamily: DEFAULT_ARTWORK_FONT_FAMILY,
    fontWeight: 400,
    lineHeight: TABLE_DEFAULT_LINE_HEIGHT,
  });
  return lines.reduce(
    (sum, line) => sum + finite(line.height, fontSize * TABLE_DEFAULT_LINE_HEIGHT),
    0,
  );
}

/**
 * Options for deterministic table layout. `measureContent` lets the host
 * supply intrinsic sizes for rich scene-content cells (images, components);
 * when absent, scene cells contribute a conservative default so content
 * tracks never collapse.
 */
export interface TableLayoutOptions {
  measureContent?: (nodeId: string) => { w: number; h: number } | undefined;
}

/** Conservative intrinsic size used when no measurer is supplied. */
const SCENE_CONTENT_DEFAULT = { w: 120, h: 32 };

/**
 * Compute the deterministic layout for a table model at the given width.
 * `width` is the layout target (table node width). When `width` is not
 * finite, fraction tracks fall back to content sizing.
 */
export function computeTableLayout(
  table: TableModel,
  width: number,
  options: TableLayoutOptions = {},
): TableLayoutResult {
  const availW = finite(width, 0);
  const rule = activeResponsiveRule(table.responsive.rules, availW);
  const density = rule?.density ?? table.appearance.density;
  const padding = table.appearance.cellPadding ?? TABLE_DENSITY_PADDING[density];
  const columnGap = table.appearance.columnGap;
  const rowGap = table.appearance.rowGap;
  const cellPadding = Math.max(0, padding);

  // Effective column definitions (responsive rules may hide or override).
  const effectiveColumns: EffectiveColumn[] = [];
  const hiddenColumnIds: string[] = [];
  for (let c = 0; c < table.columnOrder.length; c++) {
    const columnId = table.columnOrder[c]!;
    const definition = table.columns[columnId];
    if (!definition) continue;
    if (definition.hidden === true || rule?.hiddenColumnIds?.includes(columnId)) {
      hiddenColumnIds.push(columnId);
      continue;
    }
    const overrides = rule?.columnOverrides?.[columnId];
    effectiveColumns.push({
      definition: { ...definition, ...(overrides ?? {}) },
      visibleIndex: c,
    });
  }

  const visibleColumnCount = effectiveColumns.length;
  const visibleRows = table.rowOrder.filter((rowId) => table.rows[rowId]?.hidden !== true).length;

  // Map each cell to its visible top-left + visible span extents.
  interface PlacedCell {
    id: string;
    rowIdx: number; // index in visible row list
    columnIdx: number; // index in effective columns
    rowSpan: number;
    columnSpan: number;
    isHeader: boolean;
    role: TableCellRole;
    content: TableCellContent;
    style?: TableCellStyle;
    zebra: boolean;
  }

  const visibleRowIds = table.rowOrder.filter((rowId) => table.rows[rowId]?.hidden !== true);
  const visibleColIds = effectiveColumns.map((c) => c.definition.id);
  const rowPositionOf = new Map(visibleRowIds.map((id, i) => [id, i]));
  const colPositionOf = new Map(visibleColIds.map((id, i) => [id, i]));

  const placed: PlacedCell[] = [];
  for (const cell of Object.values(table.cells)) {
    const rowPos = rowPositionOf.get(cell.rowId);
    const colPos = colPositionOf.get(cell.columnId);
    if (rowPos === undefined || colPos === undefined) continue;
    // Span re-expression over the visible grid: count visible columns/rows
    // within the original span extents.
    let visibleSpanCols = 0;
    for (let c = colPos; c < visibleColumnCount; c++) {
      const colId = visibleColIds[c];
      if (!colId) break;
      const origIdx = table.columnOrder.indexOf(colId);
      if (origIdx < 0) break;
      if (origIdx >= table.columnOrder.indexOf(cell.columnId) + cell.columnSpan) break;
      visibleSpanCols++;
    }
    let visibleSpanRows = 0;
    for (let r = rowPos; r < visibleRowIds.length; r++) {
      const rowId = visibleRowIds[r];
      if (!rowId) break;
      const origIdx = table.rowOrder.indexOf(rowId);
      if (origIdx < 0) break;
      if (origIdx >= table.rowOrder.indexOf(cell.rowId) + cell.rowSpan) break;
      visibleSpanRows++;
    }
    const defaultRole =
      rowPos < table.headerRows && colPos >= table.headerColumns
        ? 'column-header'
        : colPos < table.headerColumns && rowPos >= table.headerRows
          ? 'row-header'
          : rowPos < table.headerRows && colPos < table.headerColumns
            ? 'column-header'
            : 'data';
    const role = cell.role ?? defaultRole;
    placed.push({
      id: cell.id,
      rowIdx: rowPos,
      columnIdx: colPos,
      rowSpan: Math.max(1, visibleSpanRows),
      columnSpan: Math.max(1, visibleSpanCols),
      isHeader:
        role === 'column-header' ||
        role === 'row-header' ||
        rowPos < table.headerRows ||
        colPos < table.headerColumns,
      role,
      content: cell.content,
      style: cell.style,
      zebra: rowPos >= table.headerRows && (rowPos - table.headerRows) % 2 === 1,
    });
  }

  // ── Pass 1: column widths ─────────────────────────────────────────────────
  const fontSize = TABLE_CELL_FONT_SIZE;
  const sceneSize = (cell: PlacedCell): { w: number; h: number } => {
    if (cell.content.kind !== 'scene') return { w: 0, h: 0 };
    const measured = options.measureContent?.(cell.content.nodeId);
    if (measured && Number.isFinite(measured.w) && Number.isFinite(measured.h)) {
      return { w: Math.max(TABLE_LAYOUT_MIN_TRACK, measured.w), h: Math.max(0, measured.h) };
    }
    return SCENE_CONTENT_DEFAULT;
  };
  const measureCellWidth = (cell: PlacedCell): number => {
    if (cell.content.kind === 'scene') return sceneSize(cell).w + cellPadding * 2;
    if (cell.content.kind !== 'text') return 0;
    const text = cell.content.text;
    if (text.length > TABLE_MAX_TEXT_LENGTH) return TABLE_LAYOUT_MIN_TRACK;
    const weight = cell.style?.fontWeight ?? (cell.isHeader ? 600 : 400);
    const wrapped = textWrap(text, Number.POSITIVE_INFINITY, {
      fontSize,
      fontFamily: DEFAULT_ARTWORK_FONT_FAMILY,
      fontWeight: weight,
      lineHeight: TABLE_DEFAULT_LINE_HEIGHT,
    });
    const maxLine = wrapped.reduce((m, l) => Math.max(m, finite(l.width, 0)), 0);
    return maxLine + cellPadding * 2;
  };

  const colWidths = new Array<number>(visibleColumnCount).fill(0);
  const fractionColumns: number[] = [];
  let fixedTotal = 0;
  const gapTotal = Math.max(0, visibleColumnCount - 1) * Math.max(0, columnGap);

  for (let c = 0; c < visibleColumnCount; c++) {
    const { definition } = effectiveColumns[c]!;
    const sizing = definition.sizing;
    switch (sizing.kind) {
      case 'fixed':
        colWidths[c] = clampTrack(sizing.value, definition.minWidth, definition.maxWidth);
        fixedTotal += colWidths[c]!;
        break;
      case 'percentage': {
        const base = availW > 0 ? (sizing.value / 100) * availW : 0;
        colWidths[c] = clampTrack(base, definition.minWidth, definition.maxWidth);
        fixedTotal += colWidths[c]!;
        break;
      }
      case 'content': {
        let maxContent = TABLE_LAYOUT_MIN_TRACK;
        for (const cell of placed) {
          if (cell.columnIdx === c && cell.columnSpan === 1) {
            maxContent = Math.max(maxContent, measureCellWidth(cell));
          }
        }
        colWidths[c] = clampTrack(maxContent, definition.minWidth, definition.maxWidth);
        fixedTotal += colWidths[c]!;
        break;
      }
      case 'fraction':
        fractionColumns.push(c);
        break;
    }
  }

  // Fraction columns fill the remainder.
  const remaining = Math.max(0, availW - fixedTotal - gapTotal);
  const fractionSum = fractionColumns.reduce((sum, c) => {
    const sizing = effectiveColumns[c]!.definition.sizing;
    return sizing.kind === 'fraction' ? sum + Math.max(0, sizing.value) : sum;
  }, 0);
  if (fractionSum > 0 && availW > 0) {
    const perFr = remaining / fractionSum;
    let flexTotal = 0;
    for (const c of fractionColumns) {
      const sizing = effectiveColumns[c]!.definition.sizing;
      const value = sizing.kind === 'fraction' ? Math.max(0, sizing.value) : 0;
      colWidths[c] = clampTrack(
        perFr * value,
        effectiveColumns[c]!.definition.minWidth,
        effectiveColumns[c]!.definition.maxWidth,
      );
      flexTotal += colWidths[c]!;
    }
    fixedTotal += flexTotal;
  } else {
    for (const c of fractionColumns) {
      colWidths[c] = TABLE_LAYOUT_MIN_TRACK;
      fixedTotal += colWidths[c]!;
    }
  }

  // Span expansion pass: spanning cells must fit within their covered tracks.
  let passes = 0;
  let converged = true;
  for (let pass = 0; pass < TABLE_LAYOUT_MAX_SPAN_PASSES; pass++) {
    passes = pass + 1;
    let changed = false;
    for (const cell of placed) {
      if (cell.columnSpan <= 1) continue;
      const needed = measureCellWidth(cell);
      const covered = cell.columnSpan * Math.max(0, columnGap);
      let coveredWidth = 0;
      for (let c = cell.columnIdx; c < cell.columnIdx + cell.columnSpan; c++) {
        coveredWidth += colWidths[c] ?? 0;
      }
      let deficit = needed - (coveredWidth + covered);
      if (deficit > 0) {
        // Grow the last expandable (content/fraction) track in the span.
        let grown = false;
        for (let c = cell.columnIdx + cell.columnSpan - 1; c >= cell.columnIdx; c--) {
          const definition = effectiveColumns[c]?.definition;
          const sizing = definition?.sizing;
          if (!definition) continue;
          const isExpandable = sizing?.kind === 'content' || sizing?.kind === 'fraction';
          if (!isExpandable) continue;
          const max = definition.maxWidth;
          const headroom =
            max !== undefined && Number.isFinite(max)
              ? Math.max(0, max - (colWidths[c] ?? 0))
              : deficit;
          const grow = Math.min(deficit, headroom);
          if (grow > 0) {
            colWidths[c] = (colWidths[c] ?? 0) + grow;
            fixedTotal += grow;
            deficit -= grow;
            grown = true;
            if (deficit <= 0) break;
          }
        }
        if (deficit > 0 && !grown) {
          // No expandable track: accept the overflow (converged=false marks
          // that the cell overflows its span — rendered with clipping).
          converged = false;
        }
        changed = changed || grown;
      }
    }
    if (!changed) break;
  }

  // ── Positions (LTR) ───────────────────────────────────────────────────────
  const colPositions = new Array<number>(visibleColumnCount).fill(0);
  {
    let x = 0;
    for (let c = 0; c < visibleColumnCount; c++) {
      colPositions[c] = x;
      x += (colWidths[c] ?? 0) + Math.max(0, columnGap);
    }
  }

  // ── Pass 2: row heights ───────────────────────────────────────────────────
  const rowHeights = new Array<number>(visibleRows).fill(TABLE_LAYOUT_MIN_TRACK);
  const rowDefs = visibleRowIds
    .map((id) => table.rows[id])
    .filter((r): r is TableRowDefinition => Boolean(r));
  const contentRows: number[] = [];
  for (let r = 0; r < visibleRows; r++) {
    const rowDef = rowDefs[r];
    const sizing = rowDef?.sizing ?? { kind: 'content' };
    if (sizing.kind === 'fixed') {
      rowHeights[r] = clampTrack(sizing.value, rowDef?.minHeight, rowDef?.maxHeight);
    } else {
      contentRows.push(r);
    }
  }

  const measureCellHeight = (cell: PlacedCell, atWidth: number): number => {
    if (cell.content.kind === 'scene') {
      return sceneSize(cell).h + cellPadding * 2;
    }
    if (cell.content.kind !== 'text') return 0;
    const text = cell.content.text;
    if (text.length > TABLE_MAX_TEXT_LENGTH) return fontSize * TABLE_DEFAULT_LINE_HEIGHT;
    return (
      wrappedHeight(text, Math.max(TABLE_LAYOUT_MIN_TRACK, atWidth - cellPadding * 2), fontSize) +
      cellPadding * 2
    );
  };

  // Content rows always keep a comfortable floor (padding + one text line),
  // so empty tables still look like tables instead of collapsing to strips.
  const contentFloor = Math.max(
    TABLE_LAYOUT_MIN_TRACK,
    cellPadding * 2 + fontSize * TABLE_DEFAULT_LINE_HEIGHT,
  );
  for (const r of contentRows) {
    let maxContent = TABLE_LAYOUT_MIN_TRACK;
    for (const cell of placed) {
      if (cell.rowIdx === r && cell.rowSpan === 1) {
        let width = 0;
        for (let c = cell.columnIdx; c < cell.columnIdx + cell.columnSpan; c++)
          width += colWidths[c] ?? 0;
        maxContent = Math.max(maxContent, measureCellHeight(cell, width));
      }
    }
    rowHeights[r] = clampTrack(
      Math.max(contentFloor, maxContent),
      rowDefs[r]?.minHeight,
      rowDefs[r]?.maxHeight,
    );
  }

  // Row-span expansion pass (monotonic, capped).
  for (let pass = 0; pass < TABLE_LAYOUT_MAX_SPAN_PASSES; pass++) {
    passes = Math.max(passes, pass + 1);
    let changed = false;
    for (const cell of placed) {
      if (cell.rowSpan <= 1) continue;
      let width = 0;
      for (let c = cell.columnIdx; c < cell.columnIdx + cell.columnSpan; c++)
        width += colWidths[c] ?? 0;
      const needed = measureCellHeight(cell, width);
      const coveredGap = cell.rowSpan * Math.max(0, rowGap);
      let coveredHeight = 0;
      for (let r = cell.rowIdx; r < cell.rowIdx + cell.rowSpan; r++)
        coveredHeight += rowHeights[r] ?? 0;
      let deficit = needed - (coveredHeight + coveredGap);
      if (deficit > 0) {
        // Grow the last content row in the span.
        let grown = false;
        for (let r = cell.rowIdx + cell.rowSpan - 1; r >= cell.rowIdx; r--) {
          const rowDef = rowDefs[r];
          const sizing = rowDef?.sizing;
          if (sizing?.kind !== 'content') continue;
          const max = rowDef?.maxHeight;
          const headroom =
            max !== undefined && Number.isFinite(max)
              ? Math.max(0, max - (rowHeights[r] ?? 0))
              : deficit;
          const grow = Math.min(deficit, headroom);
          if (grow > 0) {
            rowHeights[r] = (rowHeights[r] ?? 0) + grow;
            deficit -= grow;
            grown = true;
            if (deficit <= 0) break;
          }
        }
        if (deficit > 0 && !grown) converged = false;
        changed = changed || grown;
      }
    }
    if (!changed) break;
  }

  const rowPositions = new Array<number>(visibleRows).fill(0);
  {
    let y = 0;
    for (let r = 0; r < visibleRows; r++) {
      rowPositions[r] = y;
      y += (rowHeights[r] ?? 0) + Math.max(0, rowGap);
    }
  }

  // ── Cell layouts ──────────────────────────────────────────────────────────
  const cellLayouts: TableCellLayout[] = placed.map((cell) => ({
    id: cell.id,
    rowIdx: cell.rowIdx,
    columnIdx: cell.columnIdx,
    rowSpan: cell.rowSpan,
    columnSpan: cell.columnSpan,
    x: colPositions[cell.columnIdx] ?? 0,
    y: rowPositions[cell.rowIdx] ?? 0,
    w: coveredWidthAt(colWidths, colPositions, cell.columnIdx, cell.columnSpan),
    h: coveredHeightAt(rowHeights, rowPositions, cell.rowIdx, cell.rowSpan),
    role: cell.role,
    content: cell.content,
    style: cell.style,
    isHeader: cell.isHeader,
    zebra: cell.zebra,
  }));

  const lastColX =
    visibleColumnCount > 0
      ? (colPositions[visibleColumnCount - 1] ?? 0) + (colWidths[visibleColumnCount - 1] ?? 0)
      : 0;
  const lastRowY =
    visibleRows > 0 ? (rowPositions[visibleRows - 1] ?? 0) + (rowHeights[visibleRows - 1] ?? 0) : 0;
  const totalW = Math.max(0, lastColX);
  const totalH = Math.max(0, lastRowY);

  return {
    cellLayouts,
    visibleColumns: visibleColumnCount,
    visibleRows,
    colWidths,
    rowHeights,
    colPositions,
    rowPositions,
    totalW,
    totalH,
    hiddenColumnIds,
    density,
    passes,
    converged,
  };
}

function coveredWidthAt(
  colWidths: number[],
  colPositions: number[],
  start: number,
  span: number,
): number {
  const endX = (colPositions[start + span - 1] ?? 0) + (colWidths[start + span - 1] ?? 0);
  const startX = colPositions[start] ?? 0;
  return Math.max(0, endX - startX);
}

function coveredHeightAt(
  rowHeights: number[],
  rowPositions: number[],
  start: number,
  span: number,
): number {
  const endY = (rowPositions[start + span - 1] ?? 0) + (rowHeights[start + span - 1] ?? 0);
  const startY = rowPositions[start] ?? 0;
  return Math.max(0, endY - startY);
}
