import { createAreaSelection } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { selectionCoverageForDab } from './selectionCoverage';

describe('selectionCoverageForDab', () => {
  it('maps document selection coverage into an identity raster layer', () => {
    const selection = createAreaSelection({
      kind: 'rectangle',
      x: 1,
      y: 1,
      w: 2,
      h: 2,
      feather: 0,
      antialias: false,
    });
    const mask = selectionCoverageForDab(
      { areaSelection: selection, getWorldTransform: () => [1, 0, 0, 1, 0, 0] as any },
      'raster',
      { x: 2, y: 2, radius: 2 },
    );

    expect(mask).toMatchObject({ x: 0, y: 0, width: 4, height: 4 });
    expect([...mask!.data]).toEqual([0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0]);
  });

  it('maps transformed layer pixels back into document selection space', () => {
    const selection = createAreaSelection({
      kind: 'rectangle',
      x: 10,
      y: 20,
      w: 2,
      h: 2,
      feather: 0,
      antialias: false,
    });
    const mask = selectionCoverageForDab(
      { areaSelection: selection, getWorldTransform: () => [1, 0, 0, 1, 10, 20] as any },
      'raster',
      { x: 1, y: 1, radius: 2 },
    );

    expect([...mask!.data]).toContain(255);
    expect(mask!.data[5]).toBe(255);
  });
});
