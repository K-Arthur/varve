import { describe, expect, it } from 'vitest';
import type { LayoutGrid } from './gridTypes';
import { resolveLayoutGuideGeometry } from './layoutGuideGeometry';

function grid(patch: Partial<LayoutGrid> = {}): LayoutGrid {
  return {
    id: 'guide',
    type: 'layout',
    visible: true,
    snapEnabled: true,
    color: '#08a',
    opacity: 0.4,
    scope: 'frame',
    layoutMode: 'columns',
    columnCount: 3,
    gutter: 10,
    margin: [20, 30, 40, 50],
    alignment: 'stretch',
    ...patch,
  };
}

describe('resolveLayoutGuideGeometry', () => {
  it('resolves stretch columns inside named margins and returns regions', () => {
    const result = resolveLayoutGuideGeometry(grid({ count: 3, sizing: 'stretch' }), 500, 400);
    expect(result.valid).toBe(true);
    expect(result.usable).toEqual({ x: 50, y: 20, width: 420, height: 340 });
    expect(result.regions).toHaveLength(3);
    expect(result.segments.filter((segment) => segment.axis === 'vertical')).toHaveLength(6);
    expect(result.segments.every((segment) => segment.start.x >= 50)).toBe(true);
  });

  it('uses axis-correct row geometry and fixed alignment', () => {
    const result = resolveLayoutGuideGeometry(
      grid({
        layoutMode: 'rows',
        rowCount: 2,
        count: 2,
        sizing: 'fixed',
        trackSize: 80,
        rowHeight: 80,
        gutter: 12,
        alignment: 'end',
        offset: -4,
      }),
      500,
      400,
    );
    expect(result.valid).toBe(true);
    const rows = result.segments.filter((segment) => segment.axis === 'horizontal');
    expect(rows).toHaveLength(4);
    expect(rows.map((segment) => segment.start.y)).toEqual([184, 264, 276, 356]);
    expect(result.segments.every((segment) => segment.start.x >= 50)).toBe(true);
  });

  it('resolves a true square uniform lattice with independent offsets', () => {
    const result = resolveLayoutGuideGeometry(
      grid({
        layoutMode: 'uniform',
        cellSize: 100,
        offsetX: 15,
        offsetY: 25,
      }),
      260,
      240,
    );
    expect(result.valid).toBe(true);
    expect(result.regions).toEqual([]);
    expect(
      result.segments.filter((segment) => segment.axis === 'vertical').map((s) => s.start.x),
    ).toEqual([65, 165]);
    expect(
      result.segments.filter((segment) => segment.axis === 'horizontal').map((s) => s.start.y),
    ).toEqual([45, 145]);
  });

  it('rejects impossible fixed tracks without silently resizing them', () => {
    const result = resolveLayoutGuideGeometry(
      grid({ count: 4, sizing: 'fixed', trackSize: 200, gutter: 20 }),
      500,
      400,
    );
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe('overflow');
    expect(result.segments).toEqual([]);
  });

  it('accepts legacy tuple margins and legacy fixed fields', () => {
    const result = resolveLayoutGuideGeometry(
      grid({ columnCount: 2, columnWidth: 100, gutter: 20, margin: [10, 10, 10, 10] }),
      260,
      200,
    );
    expect(result.valid).toBe(true);
    expect(result.regions[0]).toMatchObject({ x: 10, width: 100 });
  });
});
