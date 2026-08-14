import { createDocument, makeImageShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { insertDerivedImageShape, insertTraceGroup, selectedImageShape } from './imageOperations';

function imageDoc() {
  let doc = createDocument('Images', true);
  const node = makeImageShapeNode('img1', {
    name: 'Logo',
    src: 'data:image/png;base64,AAAA',
    w: 20,
    h: 10,
    transform: [1, 0, 0, 1, 5, 7],
  });
  doc = { ...doc, rootChildren: ['img1'], nodes: { img1: node }, nextId: 2 };
  return doc;
}

describe('selectedImageShape', () => {
  it('returns the first selected image-filled shape', () => {
    const doc = imageDoc();

    expect(selectedImageShape(doc, ['missing', 'img1'])?.id).toBe('img1');
  });
});

describe('insertDerivedImageShape mask handling', () => {
  /**
   * A background-removal mask is composited at render time, so a derived layer
   * that inherits it gets the cutout applied to pixels that may already contain
   * it. Upscaling both bakes the cutout in and changes the layer's size, so the
   * inherited mask lands misaligned and uncovers the removed background over
   * part of the image. Same-size derivations do not bake and must keep it.
   */
  function maskedDoc() {
    const doc = imageDoc();
    const img = doc.nodes.img1 as unknown as Record<string, unknown>;
    img.mask = { type: 'alpha', rasterMask: { assetId: 'mask-img1' } };
    return doc;
  }

  it('drops the inherited mask when the caller baked the cutout in', () => {
    const result = insertDerivedImageShape(maskedDoc(), 'img1', {
      dataUrl: 'data:image/png;base64,BBBB',
      width: 40,
      height: 20,
      suffix: '2x',
      maskBakedIn: true,
    });
    const derived = result.doc.nodes[result.nodeId] as unknown as { mask?: unknown };
    expect(derived.mask).toBeUndefined();
  });

  it('keeps the mask for same-size derivations that did not bake', () => {
    const result = insertDerivedImageShape(maskedDoc(), 'img1', {
      dataUrl: 'data:image/png;base64,BBBB',
      width: 20,
      height: 10,
      suffix: 'denoised',
    });
    const derived = result.doc.nodes[result.nodeId] as unknown as { mask?: unknown };
    expect(derived.mask).toBeDefined();
  });
});

describe('insertDerivedImageShape', () => {
  it('inserts an upscaled copy without mutating the source image shape', () => {
    const doc = imageDoc();

    const result = insertDerivedImageShape(doc, 'img1', {
      dataUrl: 'data:image/png;base64,BBBB',
      width: 40,
      height: 20,
      suffix: '2x',
    });

    const source = result.doc.nodes.img1;
    const derived = result.doc.nodes[result.nodeId];
    expect(source?.name).toBe('Logo');
    expect(derived?.name).toBe('Logo 2x');
    expect(derived?.kind).toBe('shape');
    if (derived?.kind !== 'shape') throw new Error('expected shape');
    expect(derived.shape).toMatchObject({ kind: 'rect', w: 40, h: 20 });
    expect(derived.transform[4]).toBe(29);
    expect(derived.transform[5]).toBe(7);
  });

  it('never swaps the source fill when creating the derived layer', () => {
    const doc = imageDoc();
    const sourceBefore = doc.nodes.img1;
    const result = insertDerivedImageShape(doc, 'img1', {
      dataUrl: 'data:image/png;base64,BBBB',
      width: 40,
      height: 20,
      suffix: '2x',
    });
    // The source node must still reference its original pixels, not the
    // enhanced dataUrl ("New layer" mutating the original was a real bug
    // class found in the legacy applyEnhancement path and removed).
    expect(result.doc.nodes.img1).toBe(sourceBefore);
    const sourceFill = (result.doc.nodes.img1 as import('@varve/scene').ShapeNode).fills;
    const src = sourceFill?.[0];
    expect(src?.type === 'image' ? (src.image as { src?: string }).src : null).toBe(
      'data:image/png;base64,AAAA',
    );
    const derivedFill = (result.doc.nodes[result.nodeId] as import('@varve/scene').ShapeNode)
      .fills;
    const dsrc = derivedFill?.[0];
    expect(dsrc?.type === 'image' ? (dsrc.image as { src?: string }).src : null).toBe(
      'data:image/png;base64,BBBB',
    );
  });

  it('places a scaled derived image beyond the source world bounds', () => {
    const doc = imageDoc();
    const rotated = {
      ...doc,
      nodes: {
        ...doc.nodes,
        img1: { ...doc.nodes.img1!, transform: [2, 0, 0, 1, 5, 7] as const },
      },
    };

    const result = insertDerivedImageShape(rotated, 'img1', {
      dataUrl: 'data:image/png;base64,BBBB',
      width: 40,
      height: 20,
      suffix: '2x',
    });
    const derived = result.doc.nodes[result.nodeId];
    if (derived?.kind !== 'shape') throw new Error('expected shape');

    expect(derived.transform[4]).toBe(49);
    expect(derived.transform[5]).toBe(7);
  });
});

describe('insertTraceGroup', () => {
  it('inserts traced paths in a group next to the original image', () => {
    const doc = imageDoc();

    const result = insertTraceGroup(doc, 'img1', {
      width: 20,
      height: 10,
      paths: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 10 },
            { x: 0, y: 10 },
          ],
        },
      ],
    });

    const group = result.doc.nodes[result.nodeId];
    expect(group?.kind).toBe('group');
    if (group?.kind !== 'group') throw new Error('expected group');
    expect(group.name).toBe('Logo trace');
    expect(group.children).toHaveLength(1);
    const child = result.doc.nodes[group.children[0] as string];
    expect(child?.kind).toBe('shape');
    if (child?.kind !== 'shape') throw new Error('expected shape child');
    expect(child.shape.kind).toBe('path');
    expect(result.doc.rootChildren).toEqual(['img1', result.nodeId]);
  });
});
