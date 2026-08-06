// @vitest-environment node
/**
 * Table layout performance bench (ADR-0016 §33).
 *
 * Run: pnpm bench:table-layout
 */
import { describe, expect, it } from 'vitest';
import { createTableModel } from '../table';
import { computeTableLayout } from '../tableLayout';

describe('table layout bench', () => {
  it('layout 10k-cell model stays bounded', () => {
    const model = createTableModel(100, 100, { headerRows: 1 });
    const t0 = performance.now();
    const layout = computeTableLayout(model, 1000);
    const ms = performance.now() - t0;
    console.log(
      `table-bench layout 10k cells ${ms.toFixed(1)}ms passes=${layout.passes} cells=${layout.cellLayouts.length}`,
    );
    expect(layout.passes).toBeLessThanOrEqual(8);
    expect(layout.cellLayouts).toHaveLength(10_000);
    expect(ms).toBeLessThan(1000);
  }, 60_000);

  it('layout 1k-cell model with long text stays bounded', () => {
    const model = createTableModel(32, 32, { headerRows: 1 });
    const cell = model.cells[model.cellIndex['1,1']!]!;
    model.cells[cell.id] = {
      ...cell,
      content: { kind: 'text', text: 'a '.repeat(200) },
    };
    const t0 = performance.now();
    const layout = computeTableLayout(model, 800);
    const ms = performance.now() - t0;
    console.log(`table-bench layout 1k cells long-text ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(500);
  }, 60_000);
});
