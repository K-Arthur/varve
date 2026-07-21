/**
 * Tests for non-destructive image crop commit math.
 */
import { createDocument, makeImageShapeNode, makeShapeNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { commitImageCrop, translateAffine, trimToSubject } from './imageCrop';

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

  it('shrinks rect and shifts transform', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', {
      src: 'data:image/png;base64,AA',
      w: 200,
      h: 100,
      transform: [1, 0, 0, 1, 50, 60],
    });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };
    const next = commitImageCrop(doc, 'i1', { x: 20, y: 10, w: 100, h: 50 });
    const n = next.nodes.i1!;
    expect(n.kind).toBe('shape');
    if (n.kind !== 'shape' || n.shape.kind !== 'rect') throw new Error('expected rect');
    expect(n.shape.w).toBe(100);
    expect(n.shape.h).toBe(50);
    expect(n.transform).toEqual([1, 0, 0, 1, 70, 70]);
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

  it('adjusts fill offset so mapped content stays put', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA', w: 100, h: 100 });
    // Force known fill offset
    const withOffset = {
      ...img,
      fills: img.fills!.map((f) =>
        f.type === 'image' && f.image
          ? { ...f, image: { ...f.image, x: 0, y: 0, fit: 'fill' as const } }
          : f,
      ),
    };
    doc = { ...doc, nodes: { ...doc.nodes, i1: withOffset }, rootChildren: ['i1'] };
    const next = commitImageCrop(doc, 'i1', { x: 25, y: 25, w: 50, h: 50 });
    const n = next.nodes.i1!;
    if (n.kind !== 'shape') throw new Error('shape');
    const image = n.fills?.[0]?.image;
    // x' = 0 + (100-50)/2 - 25 = 0
    expect(image?.x).toBeCloseTo(0);
    expect(image?.y).toBeCloseTo(0);
  });

  it('no-ops when crop is full frame', () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA', w: 80, h: 60 });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };
    expect(commitImageCrop(doc, 'i1', { x: 0, y: 0, w: 80, h: 60 })).toBe(doc);
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

describe('trimToSubject', () => {
  it('no-ops for non-image shapes', async () => {
    let doc = createDocument('t', true);
    const rect = makeShapeNode('r', { kind: 'rect', x: 0, y: 0, w: 100, h: 80 });
    doc = { ...doc, nodes: { ...doc.nodes, r: rect }, rootChildren: ['r'] };
    expect(await trimToSubject(doc, 'r')).toBe(doc);
  });

  it('crops to explicitBounds directly (DETR-style detection box), bypassing mask/alpha lookup', async () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA', w: 200, h: 100 });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };

    const next = await trimToSubject(doc, 'i1', 0, {
      explicitBounds: { x: 20, y: 10, w: 100, h: 50 },
    });
    const n = next.nodes.i1!;
    if (n.kind !== 'shape' || n.shape.kind !== 'rect') throw new Error('expected rect');
    expect(n.shape.w).toBe(100);
    expect(n.shape.h).toBe(50);
  });

  it('applies padding around explicitBounds before cropping', async () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA', w: 200, h: 100 });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };

    const next = await trimToSubject(doc, 'i1', 10, {
      explicitBounds: { x: 50, y: 30, w: 60, h: 30 },
    });
    const n = next.nodes.i1!;
    if (n.kind !== 'shape' || n.shape.kind !== 'rect') throw new Error('expected rect');
    // padded: x=40,y=20,w=80,h=50 — well within the 200x100 frame, no clamping needed
    expect(n.shape.w).toBe(80);
    expect(n.shape.h).toBe(50);
  });

  it('clamps bounds that would extend past the frame', async () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA', w: 100, h: 100 });
    doc = { ...doc, nodes: { ...doc.nodes, i1: img }, rootChildren: ['i1'] };

    // Padding pushes the box past the frame on every side.
    const next = await trimToSubject(doc, 'i1', 30, {
      explicitBounds: { x: 10, y: 10, w: 80, h: 80 },
    });
    const n = next.nodes.i1!;
    if (n.kind !== 'shape' || n.shape.kind !== 'rect') throw new Error('expected rect');
    expect(n.shape.w).toBeLessThanOrEqual(100);
    expect(n.shape.h).toBeLessThanOrEqual(100);
  });

  it('trims to a vector mask (geometry-based, no image decode needed)', async () => {
    let doc = createDocument('t', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA', w: 200, h: 100 });
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
    expect(n.shape.w).toBe(100);
    expect(n.shape.h).toBe(50);
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
