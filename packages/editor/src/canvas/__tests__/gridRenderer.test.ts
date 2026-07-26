import { describe, expect, it } from 'vitest';
import { computeGridLines } from '../gridRenderer';
import type { DocumentGrid } from '../gridTypes';

function makeGrid(overrides?: Partial<DocumentGrid>): DocumentGrid {
  return {
    visible: true,
    spacingX: 8,
    spacingY: 8,
    subdivisions: 4,
    offsetX: 0,
    offsetY: 0,
    color: '#ccc',
    opacity: 0.4,
    snapEnabled: true,
    ...overrides,
  };
}

describe('computeGridLines', () => {
  it('returns empty arrays when grid is not visible', () => {
    const grid = makeGrid({ visible: false });
    const result = computeGridLines(grid, 1, 0, 0, 800, 600);
    expect(result.major).toHaveLength(0);
    expect(result.minor).toHaveLength(0);
  });

  it('returns major and minor lines for visible grid', () => {
    const grid = makeGrid();
    const result = computeGridLines(grid, 1, 0, 0, 800, 600);
    expect(result.major.length).toBeGreaterThan(0);
    expect(result.minor.length).toBeGreaterThan(0);
  });

  it('major lines are at subdivision intervals', () => {
    const grid = makeGrid({ spacingX: 10, spacingY: 10, subdivisions: 5 });
    const result = computeGridLines(grid, 1, 0, 0, 200, 200);
    for (const line of result.major) {
      const isHorizontal = line.y1 === line.y2;
      const isVertical = line.x1 === line.x2;
      expect(isHorizontal || isVertical).toBe(true);
      if (isHorizontal) {
        expect(line.y1 % 50).toBeCloseTo(0, 0);
      }
      if (isVertical) {
        expect(line.x1 % 50).toBeCloseTo(0, 0);
      }
    }
  });

  it('minor lines are at subdivider intervals, not at major positions', () => {
    const grid = makeGrid({ spacingX: 10, spacingY: 10, subdivisions: 5 });
    const result = computeGridLines(grid, 1, 0, 0, 200, 200);
    for (const line of result.minor) {
      const isHorizontal = line.y1 === line.y2;
      const isVertical = line.x1 === line.x2;
      expect(isHorizontal || isVertical).toBe(true);
      if (isHorizontal) {
        const vy = Math.round(line.y1);
        expect(vy % 50).not.toBeCloseTo(0, 0);
      }
      if (isVertical) {
        const vx = Math.round(line.x1);
        expect(vx % 50).not.toBeCloseTo(0, 0);
      }
    }
  });

  it('no minor lines when subdivisions is 1', () => {
    const grid = makeGrid({ subdivisions: 1 });
    const result = computeGridLines(grid, 1, 0, 0, 800, 600);
    expect(result.minor).toHaveLength(0);
    expect(result.major.length).toBeGreaterThan(0);
  });

  it('lines shift with grid offsetY', () => {
    const gridA = makeGrid({
      spacingX: 100,
      spacingY: 100,
      subdivisions: 1,
      offsetX: 0,
      offsetY: 0,
    });
    const gridB = makeGrid({
      spacingX: 100,
      spacingY: 100,
      subdivisions: 1,
      offsetX: 0,
      offsetY: 50,
    });
    const resultA = computeGridLines(gridA, 1, 0, 0, 400, 400);
    const resultB = computeGridLines(gridB, 1, 0, 0, 400, 400);
    const hA = new Set(resultA.major.filter((l) => l.y1 === l.y2).map((l) => Math.round(l.y1)));
    const hB = new Set(resultB.major.filter((l) => l.y1 === l.y2).map((l) => Math.round(l.y1)));
    expect(hA).not.toEqual(hB);
  });

  it('lines shift with pan', () => {
    const grid = makeGrid({ spacingX: 100, spacingY: 100, subdivisions: 1 });
    const resultA = computeGridLines(grid, 1, 0, 0, 400, 400);
    const resultB = computeGridLines(grid, 1, 50, 50, 400, 400);
    expect(resultA.major).not.toEqual(resultB.major);
  });

  it('adapts line density at extreme zoom levels', () => {
    const grid = makeGrid({ spacingX: 8, spacingY: 8, subdivisions: 4 });
    const resultMid = computeGridLines(grid, 1, 0, 0, 800, 600);
    const resultZoomedIn = computeGridLines(grid, 10, 0, 0, 800, 600);
    expect(resultZoomedIn.major.length).toBeGreaterThan(0);
    expect(resultMid.major.length).toBeGreaterThan(0);
    const totalLines = (lines: { major: unknown[]; minor: unknown[] }) =>
      lines.major.length + lines.minor.length;
    expect(totalLines(resultMid)).toBeLessThan(500);
  });

  it('handles different X and Y spacing', () => {
    const grid = makeGrid({ spacingX: 50, spacingY: 100, subdivisions: 1 });
    const result = computeGridLines(grid, 1, 0, 0, 400, 400);
    const horizontals = result.major.filter((l) => l.y1 === l.y2);
    const verticals = result.major.filter((l) => l.x1 === l.x2);
    expect(horizontals.length).toBeGreaterThan(0);
    expect(verticals.length).toBeGreaterThan(0);
  });
});
