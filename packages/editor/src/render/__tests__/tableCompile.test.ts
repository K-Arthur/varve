/**
 * Table → engine compile: layout + appearance + wrapped text in one item.
 */
// @vitest-environment jsdom

import type { TableNode } from '@varve/scene';
import {
  makeImageNode,
  makeTableNode,
  mergeCells,
  setAppearance,
  setCellSceneContent,
  setCellStyle,
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

  it('emits a per-cell border when the style sets border color or width', () => {
    let node = table4x4();
    const cellId = Object.keys(node.table.cells)[0]!;
    node = {
      ...node,
      table: setCellStyle(node.table, cellId, {
        borderColor: { space: 'rgb', r: 214, g: 69, b: 69, a: 255 },
        borderWidth: 3,
      }),
    };
    const engineNode = compileTableToEngineNode(node, { width: 480, height: 240 });
    const shape = engineNode.shape;
    if (shape?.kind !== 'table') throw new Error('expected table shape');
    const styled = shape.cells.find((c) => c.columnIdx === 0 && c.rowIdx === 0);
    expect(styled?.border).toBeDefined();
    expect(styled?.border?.width).toBe(3);
    expect(styled?.border?.color).toEqual({
      space: 'rgb',
      r: 214,
      g: 69,
      b: 69,
      a: 255,
    });
    // Cells without a style border carry no border override.
    const plain = shape.cells.find((c) => c.columnIdx === 1 && c.rowIdx === 0);
    expect(plain?.border).toBeUndefined();
  });

  it('compiles rich scene content into the cell when document nodes are given', () => {
    let node = table4x4();
    const cellId = Object.keys(node.table.cells)[0]!;
    node = { ...node, table: setCellSceneContent(node.table, cellId, 'img-1') };
    const imageNode = makeImageNode('img-1', {
      w: 200,
      h: 120,
      src: 'data:image/png;base64,AAAA',
    });
    const nodes = { 'img-1': imageNode };
    const engineNode = compileTableToEngineNode(node, {
      width: 480,
      height: 240,
      nodes,
      toEngineNode: (n) =>
        ({
          id: n.id,
          name: n.name ?? '',
          kind: 'image',
          fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
          transform: [1, 0, 0, 1, 0, 0],
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
          strokes: [],
          effects: [],
          shape: {
            kind: 'image',
            src: (n as { src?: string }).src ?? '',
            x: 0,
            y: 0,
            w: 200,
            h: 120,
          },
        }) as never,
    });
    const shape = engineNode.shape;
    if (shape?.kind !== 'table') throw new Error('expected table shape');
    const cell = shape.cells.find((c) => c.columnIdx === 0 && c.rowIdx === 0);
    expect(cell?.content).toBeDefined();
    expect(cell?.content?.id).toBe('img-1');
    // Content is anchored at the padded cell origin (cell-local space).
    expect(cell?.content?.transform[4]).toBe(8);
    expect(cell?.content?.transform[5]).toBe(8);
  });

  it('renders scene-content cells as empty when document nodes are absent', () => {
    let node = table4x4();
    const cellId = Object.keys(node.table.cells)[0]!;
    node = { ...node, table: setCellSceneContent(node.table, cellId, 'img-1') };
    const engineNode = compileTableToEngineNode(node, { width: 480, height: 240 });
    const shape = engineNode.shape;
    if (shape?.kind !== 'table') throw new Error('expected table shape');
    const cell = shape.cells.find((c) => c.columnIdx === 0 && c.rowIdx === 0);
    expect(cell?.content).toBeUndefined();
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
    // Same dimensions but different node identity → recomputed (new layout
    // object; the deterministic values may still be equal).
    expect(layoutB).not.toBe(layoutA);
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
