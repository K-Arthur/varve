import { createDefaultDocumentGrid } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { computeMajorStep } from '../gridTypes';

describe('createDefaultDocumentGrid', () => {
  it('returns a grid with sensible defaults', () => {
    const grid = createDefaultDocumentGrid();
    expect(grid.visible).toBe(false);
    expect(grid.spacingX).toBe(8);
    expect(grid.spacingY).toBe(8);
    expect(grid.subdivisions).toBe(4);
    expect(grid.offsetX).toBe(0);
    expect(grid.offsetY).toBe(0);
    expect(grid.opacity).toBeGreaterThan(0);
    expect(grid.opacity).toBeLessThanOrEqual(1);
    expect(grid.snapEnabled).toBe(true);
  });

  it('major step is spacing * subdivisions', () => {
    expect(computeMajorStep(8, 4)).toBe(32);
    expect(computeMajorStep(10, 5)).toBe(50);
    expect(computeMajorStep(1, 1)).toBe(1);
  });
});
