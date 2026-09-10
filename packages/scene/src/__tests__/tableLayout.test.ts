/**
 * Table layout algorithm tests: tracks, spans, row-height synchronization,
 * responsive reflow, hidden columns, RTL-free deterministic geometry.
 */

import type { TableModel } from '@varve/scene';
import {
  createTableModel,
  insertColumn,
  mergeCells,
  removeColumns,
  setAppearance,
  setCellSceneContent,
  setCellText,
  setColumnHidden,
  setColumnSizing,
  setDensity,
  setFrozenRows,
  setHeaderRows,
  setRowSizing,
  tableContentNodeIds,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { computeTableLayout, TABLE_LAYOUT_MIN_TRACK, type TableLayoutResult } from '../tableLayout';

function model4x4(): TableModel {
  return createTableModel(4, 4, { headerRows: 1 });
}

function setTexts(model: TableModel, texts: string[]): TableModel {
  let next = model;
  texts.forEach((text, i) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    const cellId = Object.keys(next.cells).find((id) => {
      const cell = next.cells[id];
      return (
        cell &&
        next.rowOrder.indexOf(cell.rowId) === row &&
        next.columnOrder.indexOf(cell.columnId) === col
      );
    });
    if (cellId) next = setCellText(next, cellId, text);
  });
  return next;
}

function cellRect(layout: TableLayoutResult, row: number, col: number) {
  const cell = layout.cellLayouts.find((c) => c.rowIdx === row && c.columnIdx === col);
  if (!cell) throw new Error(`no cell at ${row},${col}`);
  return cell;
}

describe('fixed / fraction / content tracks', () => {
  it('fixed columns keep their width; fractions fill the remainder', () => {
    let model = model4x4();
    model = setColumnSizing(model, model.columnOrder[0]!, { kind: 'fixed', value: 100 });
    model = setColumnSizing(model, model.columnOrder[1]!, { kind: 'fixed', value: 80 });
    const layout = computeTableLayout(model, 480);
    expect(layout.colWidths[0]).toBe(100);
    expect(layout.colWidths[1]).toBe(80);
    // Two fraction columns share the remaining 300.
    expect(layout.colWidths[2]!).toBeCloseTo(150, 5);
    expect(layout.colWidths[3]!).toBeCloseTo(150, 5);
    expect(layout.totalW).toBeCloseTo(480, 5);
  });

  it('unequal fraction weights split proportionally', () => {
    let model = model4x4();
    model = setColumnSizing(model, model.columnOrder[0]!, { kind: 'fraction', value: 1 });
    model = setColumnSizing(model, model.columnOrder[1]!, { kind: 'fraction', value: 2 });
    model = setColumnSizing(model, model.columnOrder[2]!, { kind: 'fraction', value: 1 });
    model = setColumnSizing(model, model.columnOrder[3]!, { kind: 'fraction', value: 0 });
    const layout = computeTableLayout(model, 480);
    expect(layout.colWidths[0]!).toBeCloseTo(120, 5);
    expect(layout.colWidths[1]!).toBeCloseTo(240, 5);
    expect(layout.colWidths[2]!).toBeCloseTo(120, 5);
    expect(layout.colWidths[3]!).toBe(TABLE_LAYOUT_MIN_TRACK);
  });

  it('percentage columns resolve against the table width', () => {
    let model = model4x4();
    model = setColumnSizing(model, model.columnOrder[0]!, { kind: 'percentage', value: 25 });
    const layout = computeTableLayout(model, 400);
    expect(layout.colWidths[0]).toBeCloseTo(100, 5);
  });

  it('content columns size to their widest unspanned cell', () => {
    let model = model4x4();
    model = setColumnSizing(model, model.columnOrder[0]!, { kind: 'content' });
    model = setTexts(model, ['A', 'B', 'C', 'D', 'much longer text here']);
    const layout = computeTableLayout(model, 400);
    const contentColWidth = layout.colWidths[0]!;
    // "much longer text here" (~20 chars × 13px × 0.6 ≈ 156px + padding)
    expect(contentColWidth).toBeGreaterThan(100);
    expect(contentColWidth).toBeLessThan(400);
  });

  it('min/max width clamps are honored', () => {
    let model = model4x4();
    model = setColumnSizing(model, model.columnOrder[0]!, { kind: 'fixed', value: 500 });
    model.columns[model.columnOrder[0]!]!.maxWidth = 120;
    const layout = computeTableLayout(model, 400);
    expect(layout.colWidths[0]).toBe(120);
  });

  it('long unbreakable text is bounded by the track minimum', () => {
    let model = model4x4();
    model = setColumnSizing(model, model.columnOrder[0]!, { kind: 'fixed', value: 40 });
    model = setTexts(model, ['h', 'h', 'h', 'h', 'h', 'x'.repeat(500), 'h', 'h']);
    const layout = computeTableLayout(model, 400);
    // No crash, finite geometry, wrapped rows.
    expect(Number.isFinite(layout.totalH)).toBe(true);
    expect(layout.rowHeights[1]!).toBeGreaterThan(TABLE_LAYOUT_MIN_TRACK);
  });
});

describe('spans', () => {
  it('a merged header spans its covered tracks', () => {
    const model = mergeCells(model4x4(), 0, 0, 1, 2);
    const layout = computeTableLayout(model, 480);
    const header = cellRect(layout, 0, 0);
    expect(header.columnSpan).toBe(2);
    expect(header.w).toBeCloseTo(layout.colWidths[0]! + layout.colWidths[1]!, 5);
    // The cell under the span is a separate unit cell.
    expect(cellRect(layout, 1, 0).id).not.toBe(header.id);
  });

  it('spanning content grows the covered content tracks', () => {
    let model = model4x4();
    model = setColumnSizing(model, model.columnOrder[0]!, { kind: 'content' });
    model = setColumnSizing(model, model.columnOrder[1]!, { kind: 'content' });
    model = mergeCells(model, 1, 0, 1, 2);
    model = setCellText(
      model,
      cellRect(computeTableLayout(model, 480), 1, 0).id,
      'wide spanning header text that needs both tracks',
    );
    const layout = computeTableLayout(model, 480);
    const spanCell = cellRect(layout, 1, 0);
    expect(spanCell.w).toBeGreaterThanOrEqual(60);
    // The sum of covered tracks fits the content.
    expect(layout.colWidths[0]! + layout.colWidths[1]!).toBeGreaterThanOrEqual(spanCell.w);
  });

  it('row spans share the synchronized row height', () => {
    let model = model4x4();
    model = mergeCells(model, 0, 3, 2, 1);
    model = setCellText(
      model,
      cellRect(computeTableLayout(model, 480), 0, 3).id,
      'tall cell\nsecond line\nthird line',
    );
    const layout = computeTableLayout(model, 480);
    const spanned = cellRect(layout, 0, 3);
    expect(spanned.rowSpan).toBe(2);
    // The two covered rows together fit the spanned content.
    expect(layout.rowHeights[0]! + layout.rowHeights[1]!).toBeGreaterThanOrEqual(spanned.h);
  });

  it('row-height synchronization: tall content grows the whole row', () => {
    let model = model4x4();
    model = setTexts(model, ['h', 'h', 'h', 'h', 'h', 'a\nb\nc\nd\ne', 'short', 'short']);
    const layout = computeTableLayout(model, 480);
    const row = layout.rowHeights[1]!;
    // All cells in row 1 resolve against the same height.
    for (const c of [0, 1, 2, 3]) {
      expect(cellRect(layout, 1, c).h).toBeCloseTo(row, 9);
    }
    expect(row).toBeGreaterThan(layout.rowHeights[0]!);
  });

  it('a merged cell after row deletion clamps cleanly', () => {
    let model = model4x4();
    model = mergeCells(model, 1, 0, 2, 1);
    model = removeColumns(model, [2]);
    model = setFrozenRows(model, 0);
    const layout = computeTableLayout(model, 360);
    expect(Number.isFinite(layout.totalW)).toBe(true);
    expect(Number.isFinite(layout.totalH)).toBe(true);
    for (const cell of layout.cellLayouts) {
      expect(cell.w).toBeGreaterThanOrEqual(0);
      expect(cell.h).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(cell.x + cell.y + cell.w + cell.h)).toBe(true);
    }
  });
});

describe('scene content cells', () => {
  function contentModelWithScene(): TableModel {
    let model = model4x4();
    model = setColumnSizing(model, model.columnOrder[0]!, { kind: 'content' });
    const firstCell = Object.keys(model.cells)[0]!;
    model = setCellSceneContent(model, firstCell, 'img-1');
    return model;
  }

  it('content tracks measure the referenced node via measureContent', () => {
    const model = contentModelWithScene();
    const layout = computeTableLayout(model, 480, {
      measureContent: (id) => (id === 'img-1' ? { w: 260, h: 180 } : undefined),
    });
    const cell = cellRect(layout, 0, 0);
    expect(cell.w).toBeGreaterThanOrEqual(260);
    expect(cell.h).toBeGreaterThanOrEqual(180);
  });

  it('falls back to a conservative default without a measurer', () => {
    const model = contentModelWithScene();
    const layout = computeTableLayout(model, 480);
    const cell = cellRect(layout, 0, 0);
    // Default 120x32 + padding; never collapses to the track minimum alone.
    expect(cell.w).toBeGreaterThan(120);
    expect(cell.h).toBeGreaterThan(32);
  });

  it('unknown content node ids do not throw', () => {
    let model = model4x4();
    model = setColumnSizing(model, model.columnOrder[0]!, { kind: 'content' });
    const firstCell = Object.keys(model.cells)[0]!;
    model = setCellSceneContent(model, firstCell, 'missing-node');
    expect(() => computeTableLayout(model, 480)).not.toThrow();
  });

  it('tableContentNodeIds collects scene references', () => {
    let model = model4x4();
    const cells = Object.keys(model.cells);
    model = setCellSceneContent(model, cells[0]!, 'a');
    model = setCellSceneContent(model, cells[5]!, 'b');
    const ids = tableContentNodeIds(model);
    expect(ids.sort()).toEqual(['a', 'b']);
  });
});

describe('responsive behavior', () => {
  it('hidden columns collapse out of the layout', () => {
    let model = model4x4();
    model = setColumnHidden(model, model.columnOrder[2]!, true);
    const layout = computeTableLayout(model, 480);
    expect(layout.visibleColumns).toBe(3);
    expect(layout.hiddenColumnIds).toEqual([model.columnOrder[2]]);
    expect(layout.colWidths).toHaveLength(3);
  });

  it('responsive rules hide columns below a width', () => {
    let model = model4x4();
    model = setColumnSizing(model, model.columnOrder[0]!, { kind: 'fixed', value: 100 });
    model = setColumnSizing(model, model.columnOrder[1]!, { kind: 'fixed', value: 100 });
    model = setColumnSizing(model, model.columnOrder[2]!, { kind: 'fixed', value: 100 });
    model = setColumnSizing(model, model.columnOrder[3]!, { kind: 'fixed', value: 100 });
    model = {
      ...model,
      responsive: {
        ...model.responsive,
        rules: [
          {
            id: 'narrow',
            condition: { maxWidth: 250 },
            hiddenColumnIds: [model.columnOrder[3]!],
            density: 'compact',
          },
        ],
      },
    };
    const wide = computeTableLayout(model, 500);
    expect(wide.visibleColumns).toBe(4);
    const narrow = computeTableLayout(model, 240);
    expect(narrow.visibleColumns).toBe(3);
    expect(narrow.density).toBe('compact');
  });

  it('reflow at a different width is deterministic and preserves cell identity', () => {
    const model = model4x4();
    const wide = computeTableLayout(model, 600);
    const narrow = computeTableLayout(model, 300);
    expect(wide.cellLayouts.map((c) => c.id)).toEqual(narrow.cellLayouts.map((c) => c.id));
    expect(wide.totalW).toBe(600);
    expect(narrow.totalW).toBe(300);
  });
});

describe('geometry safety', () => {
  it('never emits non-finite geometry', () => {
    const layouts = [
      computeTableLayout(model4x4(), 480),
      computeTableLayout(model4x4(), 0),
      computeTableLayout(model4x4(), -100),
      computeTableLayout(model4x4(), NaN),
      computeTableLayout(model4x4(), Infinity),
      computeTableLayout(createTableModel(0, 0), 480),
      computeTableLayout(createTableModel(10, 3), 100),
    ];
    for (const layout of layouts) {
      expect(Number.isFinite(layout.totalW)).toBe(true);
      expect(Number.isFinite(layout.totalH)).toBe(true);
      for (const w of layout.colWidths) expect(Number.isFinite(w)).toBe(true);
      for (const h of layout.rowHeights) expect(Number.isFinite(h)).toBe(true);
      for (const cell of layout.cellLayouts) {
        expect(Number.isFinite(cell.x + cell.y + cell.w + cell.h)).toBe(true);
      }
    }
  });

  it('empty table produces an empty layout', () => {
    const layout = computeTableLayout(createTableModel(0, 0), 480);
    expect(layout.cellLayouts).toHaveLength(0);
    expect(layout.totalW).toBe(0);
    expect(layout.totalH).toBe(0);
  });

  it('spacious density increases row heights', () => {
    let model = model4x4();
    model = setTexts(model, [
      'row1',
      'row2',
      'row3',
      'row4',
      'row5',
      'row6',
      'row7',
      'row8',
      'row9',
      'row10',
      'row11',
      'row12',
      'row13',
      'row14',
      'row15',
      'row16',
    ]);
    model = setDensity(model, 'spacious');
    const spacious = computeTableLayout(model, 480);
    model = setDensity(model, 'compact');
    const compact = computeTableLayout(model, 480);
    expect(spacious.rowHeights[1]!).toBeGreaterThan(compact.rowHeights[1]!);
  });

  it('gaps separate tracks without breaking alignment', () => {
    let model = model4x4();
    model = setAppearance(model, { columnGap: 8, rowGap: 8 });
    const layout = computeTableLayout(model, 480);
    for (const cell of layout.cellLayouts) {
      expect(cell.x + cell.w).toBeLessThanOrEqual(layout.totalW + 0.001);
      expect(cell.y + cell.h).toBeLessThanOrEqual(layout.totalH + 0.001);
    }
  });

  it('fixed row heights are honored; content rows sync', () => {
    let model = model4x4();
    model = setRowSizing(model, model.rowOrder[0]!, { kind: 'fixed', value: 60 });
    model = setHeaderRows(model, 0);
    const layout = computeTableLayout(model, 480);
    expect(layout.rowHeights[0]).toBe(60);
  });
});

describe('regression: ops composition stays valid', () => {
  it('insertColumn after merges does not break the occupancy', () => {
    let model = model4x4();
    model = mergeCells(model, 0, 0, 2, 2);
    model = insertColumn(model, 0);
    const layout = computeTableLayout(model, 480);
    // Every visible coordinate of the grid is covered exactly once.
    const seen = new Set<string>();
    for (const cell of layout.cellLayouts) {
      for (let r = cell.rowIdx; r < cell.rowIdx + cell.rowSpan; r++) {
        for (let c = cell.columnIdx; c < cell.columnIdx + cell.columnSpan; c++) {
          const key = `${r},${c}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
    }
    expect(seen.size).toBe(5 * 4);
  });
});
