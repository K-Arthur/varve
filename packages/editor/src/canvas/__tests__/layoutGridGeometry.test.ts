import type { LayoutGrid } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { resolveLayoutGuideGeometry } from '../layoutGridGeometry';

function makeGrid(overrides?: Partial<LayoutGrid>): LayoutGrid {
  return {
    id: 'layout-test',
    type: 'layout',
    visible: true,
    snapEnabled: true,
    color: '#999',
    opacity: 0.3,
    scope: 'frame',
    frameId: 'frame-1',
    layoutMode: 'columns',
    columnCount: 3,
    gutter: 20,
    margin: [20, 20, 20, 20],
    alignment: 'stretch',
    ...overrides,
  };
}

describe('resolveLayoutGuideGeometry', () => {
  it('resolves stretch columns to track boundaries', () => {
    const result = resolveLayoutGuideGeometry(makeGrid(), 600, 400);

    expect(result.valid).toBe(true);
    expect(result.vertical).toEqual([
      20, 193.33333333333334, 213.33333333333334, 386.6666666666667, 406.6666666666667, 580,
    ]);
    expect(result.horizontal).toEqual([]);
  });

  it('resolves uniform guides independently on both axes', () => {
    const result = resolveLayoutGuideGeometry(
      makeGrid({ layoutMode: 'uniform', rowCount: 2, rowHeight: 100 }),
      600,
      400,
    );

    expect(result.valid).toBe(true);
    expect(result.vertical.length).toBe(6);
    expect(result.horizontal).toEqual([20, 120, 140, 240]);
  });

  it('rejects fixed tracks that cannot fit', () => {
    const result = resolveLayoutGuideGeometry(
      makeGrid({ columnCount: 4, columnWidth: 200, gutter: 20 }),
      600,
      400,
    );

    expect(result.valid).toBe(false);
    expect(result.vertical).toEqual([]);
  });
});
