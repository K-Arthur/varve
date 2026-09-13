import { createAreaSelection } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import { selectionCoverageForDab, selectionCoverageForRasterNode } from './selectionCoverage';

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

describe('selectionCoverageForRasterNode', () => {
  it('maps a soft document selection into a bounded raster mask', () => {
    const selection = createAreaSelection({
      kind: 'rectangle',
      x: 1,
      y: 1,
      w: 2,
      h: 2,
      feather: 0.5,
      antialias: true,
    });
    const mask = selectionCoverageForRasterNode(selection!, { width: 8, height: 8 });

    expect(mask).toMatchObject({ x: 1, y: 1, width: 2, height: 2 });
    expect(mask?.data.every((value) => value > 0)).toBe(true);
    expect(mask?.data.some((value) => value < 255)).toBe(true);
  });

  it('maps transformed raster pixels and rejects singular transforms', () => {
    const selection = createAreaSelection({
      kind: 'rectangle',
      x: 10,
      y: 20,
      w: 2,
      h: 2,
      feather: 0,
      antialias: false,
    });
    const translated = selectionCoverageForRasterNode(
      selection!,
      { width: 8, height: 8 },
      [1, 0, 0, 1, 10, 20],
    );
    expect(translated).toMatchObject({ x: 0, y: 0, width: 2, height: 2 });
    expect([...translated!.data]).toEqual([255, 255, 255, 255]);
    expect(
      selectionCoverageForRasterNode(selection!, { width: 8, height: 8 }, [0, 0, 0, 0, 0, 0]),
    ).toBeNull();
  });
});
