/**
 * Table → engine compile: layout + appearance + wrapped text in one item.
 */
// @vitest-environment jsdom

import type { TableNode } from '@varve/scene';
import {
  makeTableNode,
  mergeCells,
  setAppearance,
  setCellText,
  setColumnSizing,
  setDensity,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  cellAtPoint,
  columnBoundaries,
  compileTableToEngineNode,
  getTableLayout,
} from '../tableCompile';

function table4x4(): TableNode {
  return makeTableNode('t1', { rows: 4, columns: 4, headerRows: 1, w: 480, h: 240 });
}

function withText(node: TableNode, texts: string[]): TableNode {
  let next = node;
  texts.forEach((text, i) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    const cellId = Object.keys(next.table.cells).find((id) => {
      const cell = next.table.cells[id];
      return (
        cell &&
        next.table.rowOrder.indexOf(cell.rowId) === row &&
        next.table.columnOrder.indexOf(cell.columnId) === col
      );
    });
    if (cellId) next = { ...next, table: setCellText(next.table, cellId, text) };
  });
  return next;
}

describe('compileTableToEngineNode', () => {
  it('produces one engine node with a compiled table shape', () => {
    const node = table4x4();
    const engineNode = compileTableToEngineNode(node, { width: 480, height: 240 });
    expect(engineNode.kind).toBe('table');
    const shape = engineNode.shape;
    expect(shape && 'kind' in shape && shape.kind).toBe('table');
    if (shape && shape.kind === 'table') {
      expect(shape.cells).toHaveLength(16);
      expect(shape.w).toBe(480);
      expect(shape.colPositions.length).toBe(4);
      expect(shape.rowPositions.length).toBe(4);
    }
  });

  it('header cells get header fills and bold weight; body cells body fills', () => {
    const node = withText(table4x4(), ['H1', 'H2', 'H3', 'H4', 'a', 'b', 'c', 'd']);
    const engineNode = compileTableToEngineNode(node, { width: 480, height: 240 });
    const shape = engineNode.shape;
    if (shape?.kind !== 'table') throw new Error('expected table shape');
    const headerCell = shape.cells[0]!;
    const bodyCell = shape.cells[4]!;
    expect(headerCell.fill).toEqual(node.table.appearance.headerFill);
    expect(bodyCell.fill).toEqual(node.table.appearance.bodyFill);
    expect(headerCell.text?.fontWeight).toBe(600);
    expect(bodyCell.text?.fontWeight).toBe(400);
  });

  it('zebra striping alternates body rows when enabled', () => {
    let node = withText(table4x4(), [
      'h',
      'h',
      'h',
      'h',
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
      'j',
      'k',
      'l',
    ]);
    node = { ...node, table: setAppearance(node.table, { zebra: true }) };
    const engineNode = compileTableToEngineNode(node, { width: 480, height: 240 });
    const shape = engineNode.shape;
    if (shape?.kind !== 'table') throw new Error('expected table shape');
    const row1Cell = shape.cells[4]!;
    const row2Cell = shape.cells[8]!;
    // First body row (row 1) is not striped; the next body row is.
    expect(row1Cell.fill).toEqual(node.table.appearance.bodyFill);
    expect(row2Cell.fill).toEqual(node.table.appearance.alternateFill);
  });

  it('wraps long text into lines at compile time', () => {
    let node = table4x4();
    node = {
      ...node,
      table: setColumnSizing(node.table, node.table.columnOrder[0]!, { kind: 'fixed', value: 80 }),
    };
    node = withText(node, [
      'short',
      'short',
      'short',
      'short',
      'this is a very long piece of text that must wrap across several lines',
      'x',
      'x',
      'x',
    ]);
    const engineNode = compileTableToEngineNode(node, { width: 480, height: 240 });
    const shape = engineNode.shape;
    if (shape?.kind !== 'table') throw new Error('expected table shape');
    const longCell = shape.cells[4]!;
    expect(longCell.text?.lines.length ?? 0).toBeGreaterThan(1);
    for (const line of longCell.text?.lines ?? []) {
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it('spanned cells produce one IR cell covering the range', () => {
    let node = table4x4();
    node = { ...node, table: mergeCells(node.table, 0, 0, 1, 2) };
    const engineNode = compileTableToEngineNode(node, { width: 480, height: 240 });
    const shape = engineNode.shape;
    if (shape?.kind !== 'table') throw new Error('expected table shape');
    expect(shape.cells).toHaveLength(15);
    const span = shape.cells[0]!;
    const next = shape.cells[1]!;
    expect(span.w).toBeCloseTo(next.x - span.x, 5);
  });

  it('density changes cell padding', () => {
    let node = withText(table4x4(), [
      'h',
      'h',
      'h',
      'h',
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
      'j',
      'k',
      'l',
    ]);
    node = { ...node, table: setDensity(node.table, 'compact') };
    const compact = compileTableToEngineNode(node, { width: 480, height: 240 });
    node = { ...node, table: setDensity(node.table, 'spacious') };
    const spacious = compileTableToEngineNode(node, { width: 480, height: 240 });
    const cShape = compact.shape;
    const sShape = spacious.shape;
    if (cShape?.kind !== 'table' || !sShape || sShape.kind !== 'table')
      throw new Error('expected table shapes');
    expect(cShape.cells[4]?.text?.padding).toBe(4);
    expect(sShape.cells[4]?.text?.padding).toBe(14);
  });

  it('layout cache invalidates when the node object changes', () => {
    const nodeA = table4x4();
    const nodeB = withText(nodeA, [
      'x',
      'y',
      'z',
      'w',
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
      'j',
      'k',
      'l',
    ]);
    const layoutA = getTableLayout(nodeA, nodeA.table, 480, 240);
    const layoutB = getTableLayout(nodeB, nodeB.table, 480, 240);
    // Same dimensions but different node identity → recomputed.
    expect(layoutB.rowHeights).not.toEqual(layoutA.rowHeights);
    // Cache hit for the same node identity.
    expect(getTableLayout(nodeB, nodeB.table, 480, 240)).toBe(layoutB);
    // Different width → recomputed.
    expect(getTableLayout(nodeB, nodeB.table, 300, 240)).not.toBe(layoutB);
  });
});

describe('cellAtPoint / columnBoundaries', () => {
  it('resolves local coordinates to cells and column boundaries', () => {
    const node = table4x4();
    const layout = getTableLayout(node, node.table, 480, 240);
    const first = cellAtPoint(layout, 0, 0);
    expect(first?.rowIdx).toBe(0);
    expect(first?.columnIdx).toBe(0);
    const boundaries = columnBoundaries(layout);
    expect(boundaries).toHaveLength(3);
    // Boundary between column 0 and 1 is the first column's right edge.
    expect(boundaries[0]).toBeCloseTo(layout.colWidths[0]!, 5);
  });
});
