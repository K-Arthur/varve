import { computeImagePlacement } from '@varve/engine';
import { applyAffine } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { visibleImageSourceMapping } from './imagePlacement';

describe('visibleImageSourceMapping', () => {
  it('maps cropped source pixels through the node world transform', () => {
    const placement = computeImagePlacement({
      fit: 'fill',
      sourceWidth: 100,
      sourceHeight: 80,
      bounds: { x: 0, y: 0, w: 200, h: 160 },
      sourceCrop: { x: 10, y: 20, w: 60, h: 40 },
    })!;
    const mapping = visibleImageSourceMapping(placement, [1, 0, 0, 1, 400, 300])!;
    expect(mapping.visibleSourceRect).toEqual({ x: 10, y: 20, w: 60, h: 40 });
    expect(applyAffine(mapping.sourceToDocument, [10.5, 20.5])).toEqual([421, 341]);
  });

  it('refuses tiled sources because they have no single affine target mapping', () => {
    const placement = computeImagePlacement({
      fit: 'tile',
      sourceWidth: 10,
      sourceHeight: 10,
      bounds: { x: 0, y: 0, w: 100, h: 100 },
    })!;
    expect(visibleImageSourceMapping(placement, [1, 0, 0, 1, 0, 0])).toBeNull();
  });
});
