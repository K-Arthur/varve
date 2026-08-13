/**
 * Tests for non-destructive image crop commit math.
 *
 * Crop is stored on the image fill in source-pixel coordinates, NOT baked
 * into node geometry. Node bounds are preserved.
 */
import { createDocument, makeImageShapeNode, makeShapeNode, type ShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  commitImageCrop,
  commitImageCropExtended,
  commitSourceImageCrop,
  resetImageCrop,
  setImageFlip,
  setImageRotation,
  translateAffine,
  trimToSubject,
} from './imageCrop';

describe('translateAffine', () => {
  it('adds local translation through identity', () => {
    expect(translateAffine([1, 0, 0, 1, 10, 20], 5, 7)).toEqual([1, 0, 0, 1, 15, 27]);
  });

  it('respects scale/rotation components', () => {
    // 2x scale
    expect(translateAffine([2, 0, 0, 2, 0, 0], 3, 4)).toEqual([2, 0, 0, 2, 6, 8]);
  });
});

describe('commitImageCrop', () => {
  it('no-ops for non-image shapes', () => {
    let doc = createDocument('t', true);
    const rect = makeShapeNode('r', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 });
    doc = { ...doc, nodes: { ...doc.nodes, r: rect }, rootChildren: ['r'] };
    expect(commitImageCrop(doc, 'r', { x: 10, y: 10, w: 50, h: 40 })).toBe(doc);
  });

  it('stores crop on fill in source pixels — node bounds preserved', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', {
      src: 'data:image/png;base64,AA',
      w: 200,
      h: 100,
      imageWidth: 400,
      imageHeight: 200,
      transform: [1, 0, 0, 1, 50, 60],
    });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };
    const next = commitImageCrop(doc, 'i1', { x: 20, y: 10, w: 100, h: 50 });
    const n = next.nodes.i1!;
    expect(n.kind).toBe('shape');
    if (n.kind !== 'shape' || n.shape.kind !== 'rect') throw new Error('expected rect');
    // Node bounds preserved (crop is on the fill, not baked into geometry)
    expect(n.shape.w).toBe(200);
    expect(n.shape.h).toBe(100);
    expect(n.transform).toEqual([1, 0, 0, 1, 50, 60]);
    // Crop stored in source-pixel coordinates
    const crop = n.fills?.[0]?.image?.crop;
    expect(crop).toBeDefined();
    expect(crop!.x).toBeCloseTo((20 / 200) * 400);
    expect(crop!.y).toBeCloseTo((10 / 100) * 200);
    expect(crop!.w).toBeCloseTo((100 / 200) * 400);
    expect(crop!.h).toBeCloseTo((50 / 100) * 200);
  });

  it('maps the crop through fill cover placement instead of node proportions', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', {
      src: 'data:image/png;base64,AA',
      w: 100,
      h: 100,
      imageWidth: 400,
      imageHeight: 200,
    });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };

    const next = commitImageCrop(doc, 'i1', { x: 0, y: 0, w: 50, h: 100 });
    const crop = next.nodes.i1?.fills?.[0]?.image?.crop;
    expect(crop).toBeDefined();
    // Fill cover draws 200×100 at x=-50. The left half of the object
    // therefore corresponds to source pixels 100..200, not 0..200.
    expect(crop?.x).toBeCloseTo(100);
    expect(crop?.y).toBeCloseTo(0);
    expect(crop?.w).toBeCloseTo(100);
    expect(crop?.h).toBeCloseTo(200);
  });

  it('uses pending content pan and scale when committing a removed-background crop', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', {
      src: 'data:image/png;base64,SRC',
      w: 100,
      h: 100,
      imageWidth: 400,
      imageHeight: 200,
    });
    const withBackgroundRemoved = {
      ...img,
      backgroundRemoval: {
        method: 'quick' as const,
        maskDataUrl: 'data:image/png;base64,MASK',
        confidence: 1,
        appliedAt: 1,
      },
    };
    doc = {
      ...doc,
      nodes: { ...doc.nodes, i1: withBackgroundRemoved },
      rootChildren: ['i1'],
    };

    const next = commitImageCropExtended(doc, 'i1', {
      viewport: { x: 0, y: 0, w: 50, h: 100 },
      fillScale: 2,
      fillOffsetX: 10,
      fillOffsetY: 0,
      fillFit: 'fill',
    });
    const node = next.nodes.i1;
    const image = node?.fills?.[0]?.image;
    expect(image?.crop?.x).toBeCloseTo(140);
    expect(image?.crop?.w).toBeCloseTo(50);
    expect(image?.scale).toBe(2);
    expect(image?.x).toBe(10);
    expect((node as ShapeNode | undefined)?.backgroundRemoval?.maskDataUrl).toBe(
      'data:image/png;base64,MASK',
    );
  });

  it('preserves image src and backgroundRemoval', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,SRC', w: 100, h: 100 });
    const withBg = {
      ...img,
      backgroundRemoval: {
        method: 'quick' as const,
        maskDataUrl: 'data:image/png;base64,MASK',
        confidence: 1,
        appliedAt: 1,
      },
    };
    doc = { ...doc, nodes: { ...doc.nodes, i1: withBg }, rootChildren: ['i1'] };
    const next = commitImageCrop(doc, 'i1', { x: 10, y: 10, w: 50, h: 50 });
    const n = next.nodes.i1!;
    expect(n.kind).toBe('shape');
    if (n.kind !== 'shape') throw new Error('shape');
    expect(n.fills?.[0]?.image?.src).toBe('data:image/png;base64,SRC');
    expect(n.backgroundRemoval?.maskDataUrl).toBe('data:image/png;base64,MASK');
  });

  it('no-ops when crop is full frame (normalized to undefined)', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', {
      src: 'data:image/png;base64,AA',
      w: 80,
      h: 60,
      imageWidth: 80,
      imageHeight: 60,
    });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };
    const next = commitImageCrop(doc, 'i1', { x: 0, y: 0, w: 80, h: 60 });
    // Full-frame crop is normalized to undefined → no change
    const n = next.nodes.i1!;
    expect(n.fills?.[0]?.image?.crop).toBeUndefined();
  });

  it('removes an existing crop when re-edited back to the full frame', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', {
      src: 'data:image/png;base64,AA',
      w: 80,
      h: 60,
      imageWidth: 160,
      imageHeight: 120,
    });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };
    const cropped = commitImageCrop(doc, 'i1', { x: 10, y: 10, w: 40, h: 30 });
    expect(cropped.nodes.i1?.fills?.[0]?.image?.crop).toBeDefined();

    const uncropped = commitImageCrop(cropped, 'i1', { x: 0, y: 0, w: 80, h: 60 });
    expect(uncropped.nodes.i1?.fills?.[0]?.image?.crop).toBeUndefined();
  });

  it('preserves raster mask through crop', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', {
      src: 'data:image/png;base64,SRC',
      w: 100,
      h: 100,
    });
    const withMask = {
      ...img,
      mask: {
        type: 'alpha' as const,
        visible: true,
        rasterMask: {
          assetId: 'mask-i1',
          coordinateSpace: 'source-image-pixels' as const,
          sourceIdentity: {
            kind: 'source-metadata' as const,
            locator: 'data:image/png;base64,SRC',
            pixelWidth: 100,
            pixelHeight: 100,
            revision: 1,
          },
        },
      },
    };
    doc = {
      ...doc,
      nodes: { ...doc.nodes, i1: withMask },
      rootChildren: ['i1'],
      rasterMaskAssets: {
        'mask-i1': {
          id: 'mask-i1',
          mimeType: 'image/png' as const,
          dataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          width: 100,
          height: 100,
          byteLength: 68,
        },
      },
    };
    const next = commitImageCrop(doc, 'i1', { x: 20, y: 20, w: 60, h: 60 });
    expect(next.nodes.i1?.mask?.rasterMask?.assetId).toBe('mask-i1');
    expect(next.nodes.i1?.mask?.visible).toBe(true);
    expect(next.nodes.i1?.mask?.rasterMask?.sourceIdentity.revision).toBe(1);
    expect(next.rasterMaskAssets?.['mask-i1']).toBeDefined();
  });
});

describe('commitSourceImageCrop', () => {
  it('stores a source-space suggestion without changing node geometry', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', {
      src: 'data:image/png;base64,SRC',
      w: 200,
      h: 100,
      imageWidth: 400,
      imageHeight: 200,
    });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };
    const next = commitSourceImageCrop(doc, 'i1', { x: 40, y: 20, w: 240, h: 160 });
    const node = next.nodes.i1 as ShapeNode;
    expect(node.shape.kind).toBe('rect');
    if (node.shape.kind !== 'rect') throw new Error('expected rect');
    expect(node.shape.w).toBe(200);
    expect(node.shape.h).toBe(100);
    expect(node.fills?.[0]?.image?.crop).toEqual({ x: 40, y: 20, w: 240, h: 160 });
    expect(node.fills?.[0]?.image?.src).toBe('data:image/png;base64,SRC');
  });

  it('normalizes a full-source suggestion back to the ordinary no-crop state', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', {
      src: 'data:image/png;base64,SRC',
      w: 100,
      h: 100,
      imageWidth: 100,
      imageHeight: 100,
    });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };
    const cropped = commitSourceImageCrop(doc, 'i1', { x: 10, y: 10, w: 50, h: 50 });
    const restored = commitSourceImageCrop(cropped, 'i1', { x: 0, y: 0, w: 100, h: 100 });
    expect(restored.nodes.i1?.fills?.[0]?.image?.crop).toBeUndefined();
  });
});

describe('trimToSubject', () => {
  it('no-ops for non-image shapes', async () => {
    let doc = createDocument('t', true);
    const rect = makeShapeNode('r', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 });
    doc = { ...doc, nodes: { ...doc.nodes, r: rect }, rootChildren: ['r'] };
    expect(await trimToSubject(doc, 'r')).toBe(doc);
  });

  it('crops to explicitBounds — stores crop on fill, preserves node bounds', async () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', {
      src: 'data:image/png;base64,AA',
      w: 200,
      h: 100,
      imageWidth: 200,
      imageHeight: 100,
    });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };

    const next = await trimToSubject(doc, 'i1', 0, {
      explicitBounds: { x: 20, y: 10, w: 100, h: 50 },
    });
    const n = next.nodes.i1!;
    if (n.kind !== 'shape' || n.shape.kind !== 'rect') throw new Error('expected rect');
    // Node bounds preserved
    expect(n.shape.w).toBe(200);
    expect(n.shape.h).toBe(100);
    // Crop stored on fill
    const crop = n.fills?.[0]?.image?.crop;
    expect(crop).toBeDefined();
    expect(crop!.x).toBeCloseTo(20);
    expect(crop!.y).toBeCloseTo(10);
    expect(crop!.w).toBeCloseTo(100);
    expect(crop!.h).toBeCloseTo(50);
  });

  it('applies padding around explicitBounds before cropping', async () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', {
      src: 'data:image/png;base64,AA',
      w: 200,
      h: 100,
      imageWidth: 200,
      imageHeight: 100,
    });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };

    const next = await trimToSubject(doc, 'i1', 10, {
      explicitBounds: { x: 50, y: 30, w: 60, h: 30 },
    });
    const n = next.nodes.i1!;
    if (n.kind !== 'shape' || n.shape.kind !== 'rect') throw new Error('expected rect');
    // Node bounds preserved; crop stored on fill
    expect(n.shape.w).toBe(200);
    expect(n.shape.h).toBe(100);
    const crop = n.fills?.[0]?.image?.crop;
    // padded: x=40,y=20,w=80,h=50
    expect(crop!.x).toBeCloseTo(40);
    expect(crop!.y).toBeCloseTo(20);
    expect(crop!.w).toBeCloseTo(80);
    expect(crop!.h).toBeCloseTo(50);
  });

  it('clamps crop that would extend past the source bounds', async () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', {
      src: 'data:image/png;base64,AA',
      w: 100,
      h: 100,
      imageWidth: 100,
      imageHeight: 100,
    });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };

    // Padding pushes the box past the frame on every side → clamped to source
    const next = await trimToSubject(doc, 'i1', 30, {
      explicitBounds: { x: 10, y: 10, w: 80, h: 80 },
    });
    const n = next.nodes.i1!;
    if (n.kind !== 'shape' || n.shape.kind !== 'rect') throw new Error('expected rect');
    // Node bounds preserved
    expect(n.shape.w).toBe(100);
    expect(n.shape.h).toBe(100);
    // Crop clamped to source dimensions (full image → normalized to undefined)
    const crop = n.fills?.[0]?.image?.crop;
    expect(crop).toBeUndefined();
  });

  it('trims to a vector mask (geometry-based, no image decode needed)', async () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', {
      src: 'data:image/png;base64,AA',
      w: 200,
      h: 100,
      imageWidth: 200,
      imageHeight: 100,
    });
    const withMask = {
      ...img,
      mask: {
        type: 'clip' as const,
        visible: true,
        vectorMask: {
          points: [
            { x: 20, y: 10, handleIn: null, handleOut: null },
            { x: 120, y: 10, handleIn: null, handleOut: null },
            { x: 120, y: 60, handleIn: null, handleOut: null },
            { x: 20, y: 60, handleIn: null, handleOut: null },
          ],
          closed: true,
          fillRule: 'nonzero' as const,
        },
      },
    };
    doc = { ...doc, nodes: { ...doc.nodes, i1: withMask }, rootChildren: ['i1'] };

    const next = await trimToSubject(doc, 'i1');
    const n = next.nodes.i1!;
    if (n.kind !== 'shape' || n.shape.kind !== 'rect') throw new Error('expected rect');
    // Node bounds preserved; crop stored on fill
    expect(n.shape.w).toBe(200);
    expect(n.shape.h).toBe(100);
    const crop = n.fills?.[0]?.image?.crop;
    expect(crop).toBeDefined();
    expect(crop!.x).toBeCloseTo(20);
    expect(crop!.y).toBeCloseTo(10);
    expect(crop!.w).toBeCloseTo(100);
    expect(crop!.h).toBeCloseTo(50);
  });

  it('falls back to resetToSourceBounds when no mask or explicit bounds are available', async () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA', w: 200, h: 100 });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };

    const next = await trimToSubject(doc, 'i1');
    // No mask present: computeVisibleContentBounds resolves 'source-alpha'
    // (the node's own shape bounds), which is a same-size no-op crop —
    // trimToSubject should fall through to resetToSourceBounds instead.
    const n = next.nodes.i1!;
    if (n.kind !== 'shape' || n.shape.kind !== 'rect') throw new Error('expected rect');
    const fill = n.fills?.find((f) => f.type === 'image')?.image;
    expect(fill?.x).toBe(0);
    expect(fill?.y).toBe(0);
    expect(fill?.scale).toBe(1);
  });
});

describe('resetImageCrop', () => {
  it('removes crop and resets fill transforms', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', {
      src: 'data:image/png;base64,AA',
      w: 200,
      h: 100,
      imageWidth: 400,
      imageHeight: 200,
    });
    // Apply a crop first
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };
    let next = commitImageCrop(doc, 'i1', { x: 20, y: 10, w: 100, h: 50 });
    // Now reset
    next = resetImageCrop(next, 'i1');
    const n = next.nodes.i1!;
    const fill = n.fills?.[0]?.image;
    expect(fill?.crop).toBeUndefined();
    expect(fill?.x).toBe(0);
    expect(fill?.y).toBe(0);
    expect(fill?.scale).toBe(1);
    expect(fill?.fit).toBe('fill');
  });

  it('no-ops when no crop or transforms exist', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA', w: 100, h: 100 });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };
    expect(resetImageCrop(doc, 'i1')).toBe(doc);
  });
});

describe('setImageRotation', () => {
  it('stores rotation on the fill', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA', w: 100, h: 100 });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };
    const next = setImageRotation(doc, 'i1', 90);
    const fill = next.nodes.i1?.fills?.[0]?.image;
    expect(fill?.rotation).toBe(90);
  });

  it('normalizes negative rotation', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA', w: 100, h: 100 });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };
    const next = setImageRotation(doc, 'i1', -90);
    const fill = next.nodes.i1?.fills?.[0]?.image;
    expect(fill?.rotation).toBe(270);
  });

  it('removes rotation when set to 0', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA', w: 100, h: 100 });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };
    let next = setImageRotation(doc, 'i1', 90);
    next = setImageRotation(next, 'i1', 0);
    const fill = next.nodes.i1?.fills?.[0]?.image;
    expect(fill?.rotation).toBeUndefined();
  });
});

describe('non-rect shape cropping', () => {
  it('crops ellipse shape with image fill', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', {
      src: 'data:image/png;base64,AA',
      w: 200,
      h: 100,
      imageWidth: 400,
      imageHeight: 200,
    });
    // Convert to ellipse shape
    const ellipseNode = {
      ...img,
      shape: { kind: 'ellipse' as const, cx: 100, cy: 50, rx: 100, ry: 50 },
    };
    doc = { ...doc, nodes: { ...doc.nodes, i1: ellipseNode }, rootChildren: ['i1'] };
    const next = commitImageCrop(doc, 'i1', { x: 20, y: 10, w: 100, h: 50 });
    const n = next.nodes.i1!;
    if (n.kind !== 'shape') throw new Error('expected shape');
    expect(n.shape.kind).toBe('ellipse');
    // Crop stored in source-pixel coordinates
    const crop = n.fills?.[0]?.image?.crop;
    expect(crop).toBeDefined();
    expect(crop!.x).toBeCloseTo((20 / 200) * 400);
    expect(crop!.y).toBeCloseTo((10 / 100) * 200);
  });

  it('crops circle shape with image fill', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', {
      src: 'data:image/png;base64,AA',
      w: 100,
      h: 100,
      imageWidth: 100,
      imageHeight: 100,
    });
    const circleNode = {
      ...img,
      shape: { kind: 'circle' as const, cx: 50, cy: 50, r: 50 },
    };
    doc = { ...doc, nodes: { ...doc.nodes, i1: circleNode }, rootChildren: ['i1'] };
    const next = commitImageCrop(doc, 'i1', { x: 10, y: 10, w: 80, h: 80 });
    const n = next.nodes.i1!;
    if (n.kind !== 'shape') throw new Error('expected shape');
    expect(n.shape.kind).toBe('circle');
    const crop = n.fills?.[0]?.image?.crop;
    expect(crop).toBeDefined();
    expect(crop!.x).toBeCloseTo(10);
    expect(crop!.y).toBeCloseTo(10);
  });

  it('preserves backgroundRemoval through crop', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', {
      src: 'data:image/png;base64,AA',
      w: 100,
      h: 100,
      imageWidth: 100,
      imageHeight: 100,
    });
    const withBgRemoval = {
      ...img,
      backgroundRemoval: {
        method: 'quick' as const,
        maskDataUrl: 'data:image/png;base64,MASK',
        confidence: 0.95,
        appliedAt: Date.now(),
      },
    };
    doc = { ...doc, nodes: { ...doc.nodes, i1: withBgRemoval }, rootChildren: ['i1'] };
    const next = commitImageCrop(doc, 'i1', { x: 10, y: 10, w: 50, h: 50 });
    const n = next.nodes.i1! as ShapeNode;
    expect(n.backgroundRemoval).toBeDefined();
    expect(n.backgroundRemoval!.method).toBe('quick');
    expect(n.backgroundRemoval!.maskDataUrl).toBe('data:image/png;base64,MASK');
  });
});

describe('setImageFlip', () => {
  it('toggles horizontal flip', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA', w: 100, h: 100 });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };
    let next = setImageFlip(doc, 'i1', 'horizontal');
    expect(next.nodes.i1?.fills?.[0]?.image?.flipH).toBe(true);
    next = setImageFlip(next, 'i1', 'horizontal');
    expect(next.nodes.i1?.fills?.[0]?.image?.flipH).toBe(false);
  });

  it('toggles vertical flip', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA', w: 100, h: 100 });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };
    const next = setImageFlip(doc, 'i1', 'vertical');
    expect(next.nodes.i1?.fills?.[0]?.image?.flipV).toBe(true);
  });
});
