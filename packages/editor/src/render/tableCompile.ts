/**
 * Table → engine compile (ADR-0016 D3).
 *
 * Runs the deterministic layout (computeTableLayout), resolves appearance
 * paints (header/body/alternate fills, border/divider colors, text colors —
 * already variable-resolved by applyBindingsToNode), wraps cell text, and
 * produces the single compiled `table` engine shape that replay paints.
 *
 * Layout results are memoized per (node object, width, height) in a
 * WeakMap: immutable documents keep unchanged nodes identity-stable, so a
 * cell-text edit invalidates only the affected table's cache entry while
 * unrelated edits hit the cache.
 */
import type { SceneNode as EngineNode, TableCellIR, TableShape } from '@varve/engine';
import type { ManagedColor, TableCellDefinition, TableCellStyle, TableModel } from '@varve/scene';
import {
  computeTableLayout,
  TABLE_CELL_FONT_SIZE,
  TABLE_DEFAULT_LINE_HEIGHT,
  type TableCellLayout,
  type TableLayoutResult,
} from '@varve/scene';
import { DEFAULT_ARTWORK_FONT_FAMILY, textWrap } from '@varve/shared';

const layoutCache = new WeakMap<object, { w: number; h: number; result: TableLayoutResult }>();

export function getTableLayout(
  node: object,
  table: TableModel,
  w: number,
  h: number,
): TableLayoutResult {
  const cached = layoutCache.get(node);
  if (cached && cached.w === w && cached.h === h) return cached.result;
  const result = computeTableLayout(table, w);
  layoutCache.set(node, { w, h, result });
  return result;
}

interface CompileOptions {
  width: number;
  height: number;
}

function cellTextColor(header: boolean, table: TableModel): ManagedColor {
  return header ? table.appearance.headerText : table.appearance.bodyText;
}

function cellFill(cell: TableCellLayout, table: TableModel): ManagedColor {
  if (cell.style?.fill) return cell.style.fill;
  if (cell.isHeader) return table.appearance.headerFill;
  if (cell.zebra && table.appearance.zebra) return table.appearance.alternateFill;
  return table.appearance.bodyFill;
}

function wrapCellText(
  text: string,
  width: number,
  style: TableCellStyle | undefined,
  header: boolean,
): string[] {
  if (!text) return [];
  const fontSize = TABLE_CELL_FONT_SIZE;
  return textWrap(text, Math.max(8, width), {
    fontSize,
    fontFamily: DEFAULT_ARTWORK_FONT_FAMILY,
    fontWeight: style?.fontWeight ?? (header ? 600 : 400),
    fontStyle: style?.fontStyle ?? 'normal',
    lineHeight: TABLE_DEFAULT_LINE_HEIGHT,
  }).map((line) => line.text);
}

function compileCell(
  cell: TableCellLayout,
  table: TableModel,
  padding: number,
  width: number,
): TableCellIR {
  const content = cell.content.kind === 'text' ? cell.content.text : '';
  const style = cell.style;
  const alignH = style?.alignH ?? (cell.isHeader ? 'center' : 'left');
  const alignV = style?.alignV ?? 'middle';
  const lines = wrapCellText(content, width - padding * 2, style, cell.isHeader);
  const ir: TableCellIR = {
    x: cell.x,
    y: cell.y,
    w: cell.w,
    h: cell.h,
    fill: cellFill(cell, table),
    rowIdx: cell.rowIdx,
    columnIdx: cell.columnIdx,
    rowSpan: cell.rowSpan,
    columnSpan: cell.columnSpan,
  };
  if (lines.length > 0) {
    ir.text = {
      lines,
      fontSize: TABLE_CELL_FONT_SIZE,
      fontFamily: DEFAULT_ARTWORK_FONT_FAMILY,
      fontWeight: style?.fontWeight ?? (cell.isHeader ? 600 : 400),
      fontStyle: style?.fontStyle ?? 'normal',
      color: cellTextColor(cell.isHeader, table),
      alignH,
      alignV,
      padding,
    };
  }
  return ir;
}

/** Compile a TableNode (bindings already applied) into an engine node. */
export function compileTableToEngineNode(
  node: import('@varve/scene').TableNode,
  options: CompileOptions,
): EngineNode {
  const table = node.table;
  const layout = getTableLayout(node, table, options.width, options.height);
  const padding =
    table.appearance.cellPadding ??
    (layout.density === 'compact' ? 4 : layout.density === 'spacious' ? 14 : 8);

  const cells: TableCellIR[] = layout.cellLayouts.map((cell) =>
    compileCell(cell, table, padding, cell.w),
  );

  const shape: TableShape = {
    kind: 'table',
    x: 0,
    y: 0,
    w: options.width,
    h: options.height,
    cornerRadius: table.appearance.cornerRadius,
    borderColor: table.appearance.borderColor,
    borderWidth: table.appearance.borderWidth,
    dividerColor: table.appearance.dividerColor,
    dividerWidth: table.appearance.dividerWidth,
    colPositions: layout.colPositions,
    rowPositions: layout.rowPositions,
    cells,
  };

  return {
    id: node.id,
    name: node.name,
    kind: 'table',
    fill: node.fill,
    transform: node.transform,
    opacity: node.opacity ?? 1,
    blendMode: node.blendMode ?? 'normal',
    rotation: node.rotation ?? 0,
    strokes: node.strokes ?? [],
    effects: node.effects ?? [],
    shape,
  };
}

/** Helper for editor tooling: resolve the cell at a local coordinate. */
export function cellAtPoint(
  layout: TableLayoutResult,
  localX: number,
  localY: number,
): { cell: TableCellLayout; rowIdx: number; columnIdx: number } | null {
  if (!Number.isFinite(localX) || !Number.isFinite(localY)) return null;
  for (const cell of layout.cellLayouts) {
    if (
      localX >= cell.x &&
      localX <= cell.x + cell.w &&
      localY >= cell.y &&
      localY <= cell.y + cell.h
    ) {
      return { cell, rowIdx: cell.rowIdx, columnIdx: cell.columnIdx };
    }
  }
  return null;
}

/** Column boundary handles for resize interactions (local x offsets). */
export function columnBoundaries(layout: TableLayoutResult): number[] {
  const out: number[] = [];
  for (let i = 1; i < layout.colPositions.length; i++) {
    out.push(layout.colPositions[i] ?? 0);
  }
  return out;
}

export type { TableCellDefinition };
