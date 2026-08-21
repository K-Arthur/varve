import { areaSelectionCoverageAt, createAreaSelection } from '@varve/engine';
import { addNode, createDocument, imageFill, makeFrameNode, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { areaSelectionFromMaskPixels, rasterizeAreaSelectionForNode } from './selectionMask';

function frameDocument() {
  let document = createDocument('selection-mask', true);
  document = addNode(
    document,
    makeFrameNode('frame', {
      w: 4,
      h: 4,
      children: [],
      transform: [1, 0, 0, 1, 10, 20],
    }),
  );
  return document;
}

function imageDocument() {
  let document = createDocument('selection-mask-image', true);
  const image = {
    ...makeShapeNode('image', { kind: 'rect', x: 0, y: 0, w: 4, h: 2 }),
    fills: [
      imageFill('data:image/png;base64,image', { fit: 'fit', imageWidth: 2, imageHeight: 2 }),
    ],
  };
  document = addNode(document, image);
  return document;
}

describe('selection mask bridge', () => {
  it('rasterizes a document selection in transformed frame-local pixels', () => {
    const selection = createAreaSelection({
      kind: 'rectangle',
      x: 11,
      y: 21,
      w: 2,
      h: 2,
      feather: 0,
      antialias: false,
    });
    if (!selection) throw new Error('selection should be valid');

    const raster = rasterizeAreaSelectionForNode(frameDocument(), 'frame', selection);
    expect(raster?.coordinateSpace).toBe('container-local-pixels');
    expect([...raster!.data]).toEqual([0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0]);
  });

  it('loads soft mask alpha into the analytical area-selection domain', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    rgba[3] = 255;
    rgba[(1 * 4 + 1) * 4 + 3] = 128;
    rgba[(2 * 4 + 2) * 4 + 3] = 64;
    const selection = areaSelectionFromMaskPixels(
      frameDocument(),
      'frame',
      {
        width: 4,
        height: 4,
        data: rgba,
      },
      'container-local-pixels',
    );
    expect(selection).not.toBeNull();
    if (!selection) throw new Error('expected a selection');
    if (
      selection.expression.kind !== 'shape' ||
      selection.expression.shape.kind !== 'raster-mask'
    ) {
      throw new Error('expected a raster-mask selection shape');
    }
    expect(selection.expression.shape.boundary.length).toBeGreaterThan(0);
    expect(areaSelectionCoverageAt(selection!, { x: 10, y: 20 })).toBe(1);
    expect(areaSelectionCoverageAt(selection!, { x: 11, y: 21 })).toBeCloseTo(0.5, 2);
    expect(areaSelectionCoverageAt(selection!, { x: 12, y: 22 })).toBeCloseTo(0.25, 2);
  });

  it('does not leak selection into contain-fit image margins', () => {
    const selection = createAreaSelection({
      kind: 'rectangle',
      x: 0,
      y: 0,
      w: 1,
      h: 2,
      feather: 0,
      antialias: false,
    });
    if (!selection) throw new Error('selection should be valid');
    const raster = rasterizeAreaSelectionForNode(imageDocument(), 'image', selection);
    expect(raster?.coordinateSpace).toBe('source-image-pixels');
    expect([...raster!.data]).toEqual([0, 0, 0, 0]);
  });
});
