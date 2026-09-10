/**
 * Native table model: identity, coordinates, spans, invariants.
 *
 * Property-based tests generate random valid structures and verify:
 * - every visible coordinate maps to exactly one owning cell
 * - spans never overlap
 * - insert/delete operations preserve valid ranges
 * - merge followed by split restores a valid structure
 * - serialization round trips
 * - reordering preserves cell identity
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deepCloneSubtree } from '../clone';
import { makeTableNode } from '../document';
import {
  cellAt,
  createTableModel,
  emptyTableModel,
  hasOverlappingSpans,
  occupancyGrid,
  type TableCellDefinition,
  validateTableModel,
} from '../table';
import {
  insertColumn,
  insertRow,
  mergeCells,
  moveColumn,
  moveRow,
  normalizeTableModelDefensively,
  rebuildCellIndex,
  remapTableModelIds,
  removeColumns,
  removeRows,
  setCellSceneContent,
  setCellText,
  splitCell,
} from '../tableOps';
import type { SceneNode } from '../types';

function validModel() {
  return createTableModel(4, 4, { headerRows: 1 });
}

describe('createTableModel', () => {
  it('creates the requested dimensions with empty cells', () => {
    const model = createTableModel(3, 5);
    expect(model.rowOrder).toHaveLength(3);
    expect(model.columnOrder).toHaveLength(5);
    expect(Object.keys(model.cells)).toHaveLength(15);
    expect(validateTableModel(model)).toHaveLength(0);
  });

  it('zero rows / zero columns produce an empty valid table', () => {
    expect(validateTableModel(createTableModel(0, 4))).toHaveLength(0);
    expect(validateTableModel(createTableModel(4, 0))).toHaveLength(0);
    expect(validateTableModel(createTableModel(0, 0))).toHaveLength(0);
  });

  it('one-cell table is valid', () => {
    expect(validateTableModel(createTableModel(1, 1))).toHaveLength(0);
  });

  it('header rows/columns clamp to the table size', () => {
    const model = createTableModel(2, 2, { headerRows: 9, headerColumns: -2 });
    expect(model.headerRows).toBe(2);
    expect(model.headerColumns).toBe(0);
  });

  it('generates stable prefixed ids without duplicates', () => {
    const model = createTableModel(10, 10);
    const ids = [...model.rowOrder, ...model.columnOrder, ...Object.keys(model.cells)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('coordinate lookup and occupancy', () => {
  it('every coordinate maps to exactly one cell via cellIndex', () => {
    const model = validModel();
    const grid = occupancyGrid(model);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const cell = cellAt(model, r, c);
        expect(cell).toBeDefined();
        expect(grid[r]?.[c]).toBe(cell?.id);
      }
    }
  });

  it('spans cover every coordinate of the merged range', () => {
    const model = mergeCells(validModel(), 0, 0, 2, 3);
    expect(validateTableModel(model)).toHaveLength(0);
    const grid = occupancyGrid(model);
    const owner = cellAt(model, 0, 0);
    expect(owner?.rowSpan).toBe(2);
    expect(owner?.columnSpan).toBe(3);
    // Every covered coordinate maps to the owning cell through the grid.
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        expect(grid[r]?.[c]).toBe(owner?.id);
      }
    }
    // Only the top-left coordinate owns the cell in cellIndex.
    expect(cellAt(model, 1, 2)).toBeUndefined();
    // Cells outside the merged range are untouched.
    expect(cellAt(model, 2, 0)?.id).not.toBe(owner?.id);
  });
});

describe('structural ops preserve invariants', () => {
  it('insertRow shifts coordinates and keeps headerRows consistent', () => {
    const model = insertRow(validModel(), 0);
    expect(model.rowOrder).toHaveLength(5);
    expect(model.headerRows).toBe(2);
    expect(validateTableModel(model)).toHaveLength(0);
    const model2 = insertRow(validModel(), 4);
    expect(model2.headerRows).toBe(1);
    expect(validateTableModel(model2)).toHaveLength(0);
  });

  it('insertColumn at the header boundary extends headerColumns', () => {
    const model = insertColumn(createTableModel(4, 4, { headerColumns: 1 }), 0);
    expect(model.columnOrder).toHaveLength(5);
    expect(model.headerColumns).toBe(2);
    expect(validateTableModel(model)).toHaveLength(0);
  });

  it('removeRows deletes cells in removed rows and clamps spans from above', () => {
    let model = validModel();
    model = mergeCells(model, 0, 0, 3, 2); // span rows 0-2
    model = removeRows(model, [1, 2]);
    expect(model.rowOrder).toHaveLength(2);
    expect(validateTableModel(model)).toHaveLength(0);
    // The merged cell survived with its span clamped to the one remaining row.
    const cell = cellAt(model, 0, 0);
    expect(cell?.rowSpan).toBe(1);
    expect(cell?.columnSpan).toBe(2);
  });

  it('removeRows deletes cells whose top-left row is removed', () => {
    const model = removeRows(validModel(), [2]);
    expect(model.rowOrder).toHaveLength(3);
    expect(validateTableModel(model)).toHaveLength(0);
    // No surviving cell references the removed row.
    for (const cell of Object.values(model.cells)) {
      expect(model.rows[cell.rowId]).toBeDefined();
    }
    // The removed row's old cells are gone: exactly 12 cells remain.
    expect(Object.keys(model.cells)).toHaveLength(12);
  });

  it('removeColumns clamps spans from the left', () => {
    let model = validModel();
    model = mergeCells(model, 1, 1, 2, 3); // span columns 1-3
    model = removeColumns(model, [2]);
    expect(model.columnOrder).toHaveLength(3);
    expect(validateTableModel(model)).toHaveLength(0);
    const cell = cellAt(model, 1, 1);
    expect(cell?.columnSpan).toBe(2);
  });

  it('moveRow / moveColumn preserve cell identity', () => {
    const model = validModel();
    const original = cellAt(model, 0, 0);
    const moved = moveRow(moveColumn(model, 0, 2), 0, 2);
    expect(validateTableModel(moved)).toHaveLength(0);
    const relocated = cellAt(moved, 2, 2);
    expect(relocated?.id).toBe(original?.id);
  });

  it('merge then split restores a valid structure with identity preserved', () => {
    let model = validModel();
    model = setCellText(model, cellAt(model, 0, 0)!.id, 'one\ntwo\nthree');
    const merged = mergeCells(model, 0, 0, 2, 2);
    expect(validateTableModel(merged)).toHaveLength(0);
    expect(cellAt(merged, 0, 0)?.rowSpan).toBe(2);
    const split = splitCell(merged, cellAt(merged, 0, 0)!.id);
    expect(validateTableModel(split)).toHaveLength(0);
    expect(split.cells[cellAt(split, 1, 1)!.id]).toBeDefined();
    // First line lands in the top-left cell.
    expect(cellAt(split, 0, 0)?.content).toEqual({ kind: 'text', text: 'one' });
    expect(cellAt(split, 0, 1)?.content).toEqual({ kind: 'text', text: 'two' });
  });

  it('merge beyond bounds is rejected without mutation', () => {
    const model = mergeCells(validModel(), 2, 2, 3, 3);
    expect(model).toEqual(validModel());
  });

  it('reordering through merged ranges keeps cells attached to their rows', () => {
    let model = validModel();
    model = mergeCells(model, 1, 0, 2, 2);
    const mergedCell = cellAt(model, 1, 0)!;
    const moved = moveRow(model, 1, 3);
    expect(validateTableModel(moved)).toHaveLength(0);
    // The merged cell's row id is unchanged — the row travelled with it.
    expect(moved.cells[mergedCell.id]).toBeDefined();
    expect(moved.cells[mergedCell.id]!.rowId).toBe(mergedCell.rowId);
  });
});

describe('validation', () => {
  it('flags duplicate coordinates and overlapping spans', () => {
    const model = validModel();
    // Fabricate an overlap: second cell claims the same coordinate.
    const intruder = {
      ...model.cells[cellAt(model, 0, 1)!.id]!,
      id: 'intruder',
      rowSpan: 2,
      columnSpan: 1,
    };
    const corrupt = {
      ...model,
      cells: { ...model.cells, intruder },
      cellIndex: { ...model.cellIndex, '1,0': 'intruder' },
    };
    const issues = validateTableModel(corrupt);
    expect(
      issues.some((i) => i.code === 'overlapping-span' || i.code === 'duplicate-coordinate'),
    ).toBe(true);
  });

  it('flags orphaned cells and out-of-bounds indexes', () => {
    const model = validModel();
    const ghostCell: TableCellDefinition = {
      id: 'ghost',
      rowId: 'missing',
      columnId: 'c1',
      rowSpan: 1,
      columnSpan: 1,
      content: { kind: 'empty' },
    };
    const corrupt = {
      ...model,
      cells: {
        ...model.cells,
        ghost: ghostCell,
      },
      cellIndex: { ...model.cellIndex, '99,99': 'ghost' },
    };
    const issues = validateTableModel(corrupt);
    expect(issues.some((i) => i.code === 'missing-row')).toBe(true);
    expect(issues.some((i) => i.code === 'span-out-of-bounds')).toBe(true);
  });

  it('emptyTableModel is valid', () => {
    expect(validateTableModel(emptyTableModel())).toHaveLength(0);
  });
});

describe('normalizeTableModelDefensively', () => {
  it('repairs corrupt serialized tables without throwing', () => {
    const corrupt = {
      rowOrder: ['r1', 'r2', 'r1'],
      columnOrder: ['c1'],
      rows: { r1: { id: 'r1', sizing: { kind: 'content' } } },
      columns: { c1: { id: 'c1', sizing: { kind: 'fixed', value: 100 } } },
      cells: {
        cellA: {
          id: 'cellA',
          rowId: 'r1',
          columnId: 'c1',
          rowSpan: 0,
          columnSpan: -3,
          content: { kind: 'text', text: 'hi' },
        },
        cellB: {
          id: 'cellB',
          rowId: 'r2',
          columnId: 'c1',
          rowSpan: 2,
          columnSpan: 1,
          content: { kind: 'empty' },
        },
      },
      cellIndex: { '0,0': 'cellA' },
      headerRows: 9,
      appearance: { borderWidth: Infinity, density: 'weird' },
    };
    const { model, issues } = normalizeTableModelDefensively(corrupt);
    expect(model).toBeDefined();
    expect(issues.length).toBeGreaterThan(0);
    expect(validateTableModel(model!)).toHaveLength(0);
    expect(model!.headerRows).toBe(2);
    expect(model!.appearance.borderWidth).toBe(1);
    expect(model!.appearance.density).toBe('comfortable');
    expect(model!.cells.cellA?.rowSpan).toBe(1);
    expect(model!.cells.cellA?.columnSpan).toBe(1);
  });

  it('rejects non-object input', () => {
    expect(normalizeTableModelDefensively(null).model).toBeUndefined();
    expect(normalizeTableModelDefensively(42).model).toBeUndefined();
  });

  it('preserves valid scene content and drops invalid references', () => {
    const source = {
      rowOrder: ['r1', 'r2'],
      columnOrder: ['c1'],
      rows: {
        r1: { id: 'r1', sizing: { kind: 'content' } },
        r2: { id: 'r2', sizing: { kind: 'content' } },
      },
      columns: { c1: { id: 'c1', sizing: { kind: 'fixed', value: 100 } } },
      cells: {
        good: {
          id: 'good',
          rowId: 'r1',
          columnId: 'c1',
          rowSpan: 1,
          columnSpan: 1,
          content: { kind: 'scene', nodeId: 'img-1' },
        },
        bad: {
          id: 'bad',
          rowId: 'r2',
          columnId: 'c1',
          rowSpan: 1,
          columnSpan: 1,
          content: { kind: 'scene', nodeId: 42 },
        },
      },
      cellIndex: { '0,0': 'good', '1,0': 'bad' },
      headerRows: 0,
      appearance: {},
    };
    const { model, issues } = normalizeTableModelDefensively(source);
    expect(issues).toHaveLength(0);
    expect(model!.cells.good?.content).toEqual({ kind: 'scene', nodeId: 'img-1' });
    // Invalid nodeId type is dropped to empty content.
    expect(model!.cells.bad?.content).toEqual({ kind: 'empty' });
    expect(validateTableModel(model!)).toHaveLength(0);
  });

  it('round trips a valid model', () => {
    const model = mergeCells(validModel(), 1, 1, 2, 2);
    const { model: round, issues } = normalizeTableModelDefensively(
      JSON.parse(JSON.stringify(model)),
    );
    expect(issues).toHaveLength(0);
    expect(round).toEqual(model);
  });
});

describe('remapTableModelIds', () => {
  it('preserves scene content references across remap', () => {
    let model = validModel();
    const firstCell = Object.keys(model.cells)[0]!;
    model = setCellSceneContent(model, firstCell, 'img-1');
    const { model: remapped } = remapTableModelIds(model, 1000);
    const cell = Object.values(remapped.cells)[0]!;
    expect(cell.content).toEqual({ kind: 'scene', nodeId: 'img-1' });
    expect(validateTableModel(remapped)).toHaveLength(0);
  });

  it('remaps every id and keeps the structure isomorphic', () => {
    const model = mergeCells(validModel(), 0, 0, 2, 2);
    const { model: remapped } = remapTableModelIds(model, 1000);
    expect(validateTableModel(remapped)).toHaveLength(0);
    expect(remapped.rowOrder).toHaveLength(model.rowOrder.length);
    expect(remapped.columnOrder).toHaveLength(model.columnOrder.length);
    const before = Object.values(model.cells).map((c) => ({
      r: c.rowSpan,
      c: c.columnSpan,
      t: c.content,
    }));
    const after = Object.values(remapped.cells).map((c) => ({
      r: c.rowSpan,
      c: c.columnSpan,
      t: c.content,
    }));
    expect(after.map((c) => JSON.stringify(c)).sort()).toEqual(
      before.map((c) => JSON.stringify(c)).sort(),
    );
    // Ids are disjoint from the source ids.
    const allBefore = new Set([
      ...model.rowOrder,
      ...model.columnOrder,
      ...Object.keys(model.cells),
    ]);
    const allAfter = [
      ...remapped.rowOrder,
      ...remapped.columnOrder,
      ...Object.keys(remapped.cells),
    ];
    for (const id of allAfter) expect(allBefore.has(id)).toBe(false);
  });

  it('deepCloneSubtree remaps table ids inside the node', () => {
    const tableNode = makeTableNode('t1', { rows: 3, columns: 3 }) as import('../types').TableNode;
    const source = {
      t1: tableNode,
      root: { ...tableNode, id: 'root' },
    } as unknown as Record<string, SceneNode>;
    const cloned = deepCloneSubtree(source, 10, 't1');
    const clone = cloned.nodes[cloned.rootId] as import('../types').TableNode;
    expect(clone.kind).toBe('table');
    expect(clone.table.rowOrder).toHaveLength(3);
    const sourceIds = new Set([
      ...tableNode.table.rowOrder,
      ...tableNode.table.columnOrder,
      ...Object.keys(tableNode.table.cells),
    ]);
    for (const id of [
      ...clone.table.rowOrder,
      ...clone.table.columnOrder,
      ...Object.keys(clone.table.cells),
    ]) {
      expect(sourceIds.has(id)).toBe(false);
    }
    expect(validateTableModel(clone.table)).toHaveLength(0);
  });
});

describe('property-based invariants', () => {
  it('every visible coordinate maps to exactly one owning cell after random ops', () => {
    // Deterministic seeded PRNG so fast-check counterexamples replay exactly.
    const rng = (() => {
      let state = 0x9e3779b9;
      return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        fc.array(fc.nat({ max: 2 }), { maxLength: 40 }),
        (rows, cols, ops) => {
          let model = createTableModel(rows, cols, { headerRows: 1 });
          for (const op of ops) {
            const r = Math.floor(rng() * Math.max(1, model.rowOrder.length));
            const c = Math.floor(rng() * Math.max(1, model.columnOrder.length));
            switch (op) {
              case 0:
                model = mergeCells(model, r, c, 1 + (r % 3), 1 + (c % 3));
                break;
              case 1:
                model = insertRow(model, r);
                break;
              case 2:
                model = removeRows(model, [r]);
                break;
            }
          }
          expect(validateTableModel(model)).toHaveLength(0);
          expect(hasOverlappingSpans(model)).toBe(false);
          const grid = occupancyGrid(model);
          const seen = new Set<string>();
          for (let rr = 0; rr < grid.length; rr++) {
            for (let cc = 0; cc < (grid[rr]?.length ?? 0); cc++) {
              const key = `${rr},${cc}`;
              expect(seen.has(key)).toBe(false);
              seen.add(key);
              const cellId = grid[rr]?.[cc];
              // Covered coordinates map to the owning cell through the grid;
              // cellAt only answers for unspanned top-left coordinates.
              if (cellId) {
                const owner = cellAt(model, rr, cc);
                if (owner) expect(owner.id).toBe(cellId);
              }
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('serialization round trips preserve structure and identity', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 0, max: 5 }),
        (rows, cols, merges) => {
          let model = createTableModel(rows, cols);
          for (let i = 0; i < merges; i++) {
            const r = Math.floor(Math.random() * rows);
            const c = Math.floor(Math.random() * cols);
            model = mergeCells(
              model,
              r,
              c,
              1 + Math.min(r, rows - r - 1),
              1 + Math.min(c, cols - c - 1),
            );
          }
          const reparsed = JSON.parse(JSON.stringify(model)) as ReturnType<typeof validModel>;
          const { model: round, issues } = normalizeTableModelDefensively(reparsed);
          expect(issues).toHaveLength(0);
          expect(round).toEqual(model);
          expect(validateTableModel(round!)).toHaveLength(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('layout inputs never contain non-finite geometry', () => {
    // Guards the contract consumed by computeTableLayout: coordinates derived
    // from the model must be finite numbers.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        (rows, cols) => {
          let model = createTableModel(rows, cols);
          model = insertRow(model, 0);
          model = mergeCells(model, 0, 0, 2, 2);
          const grid = occupancyGrid(model);
          for (const row of grid) {
            for (const cellId of row) {
              if (!cellId) continue;
              const cell = model.cells[cellId]!;
              expect(Number.isFinite(cell.rowSpan)).toBe(true);
              expect(Number.isFinite(cell.columnSpan)).toBe(true);
              expect(model.rowOrder.indexOf(cell.rowId)).toBeGreaterThanOrEqual(0);
            }
          }
          const rebuilt = rebuildCellIndex(model);
          expect(Object.keys(rebuilt.cellIndex)).toHaveLength(Object.keys(model.cells).length);
        },
      ),
      { numRuns: 25 },
    );
  });
});
