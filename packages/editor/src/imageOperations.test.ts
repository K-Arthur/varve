import {
  createDocument,
  createEmbeddedAsset,
  makeImageShapeNode,
  type ShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  insertDerivedImageShape,
  insertTraceGroup,
  replaceImageShapeContent,
  restoreImageShapeContent,
  selectedImageShape,
} from './imageOperations';

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

describe('replaceImageShapeContent', () => {
  it('keeps the image node and its presentation properties in place', () => {
    const doc = imageDoc();
    const source = doc.nodes.img1!;
    const next = replaceImageShapeContent(doc, 'img1', {
      dataUrl: 'data:image/png;base64,BBBB',
      assetId: 'asset-output',
      width: 20,
      height: 10,
      generativeEditId: 'edit-1',
    });
    const updated = next.nodes.img1;
    expect(updated?.id).toBe('img1');
    expect(updated?.transform).toEqual(source.transform);
    expect(updated?.name).toBe(source.name);
    if (updated?.kind !== 'shape') throw new Error('expected shape');
    expect(updated.generativeEditId).toBe('edit-1');
    expect(updated.fills?.[0]).toMatchObject({
      type: 'image',
      image: { src: 'data:image/png;base64,BBBB', assetId: 'asset-output' },
    });
  });

  it('expands the image frame while preserving the old pixels world position', () => {
    const doc = imageDoc();
    const next = replaceImageShapeContent(doc, 'img1', {
      dataUrl: 'data:image/png;base64,EXPANDED',
      assetId: 'asset-expanded',
      width: 32,
      height: 24,
      outputFrame: {
        sourceOffsetX: 6,
        sourceOffsetY: 4,
        sourceWidth: 20,
        sourceHeight: 10,
      },
    });
    const updated = next.nodes.img1;
    if (updated?.kind !== 'shape') throw new Error('expected shape');
    expect(updated.shape).toMatchObject({ kind: 'rect', w: 32, h: 24 });
    expect(updated.transform).toEqual([1, 0, 0, 1, -1, 3]);
  });

  it('stores a bounded generative patch above the immutable source fill', () => {
    const doc = imageDoc();
    const next = replaceImageShapeContent(doc, 'img1', {
      dataUrl: 'data:image/png;base64,AAAA',
      assetId: 'asset-source',
      width: 20,
      height: 10,
      generativeEditId: 'edit-patch',
      patch: {
        dataUrl: 'data:image/png;base64,PATCH',
        assetId: 'asset-patch',
        width: 2,
        height: 1,
        x: 4,
        y: 2,
        frameWidth: 4,
        frameHeight: 2,
        editId: 'edit-patch',
        variationId: 'variation-1',
      },
    });
    const updated = next.nodes.img1;
    if (updated?.kind !== 'shape') throw new Error('expected shape');
    expect(updated.generativeEditId).toBe('edit-patch');
    expect(updated.fills).toHaveLength(2);
    expect(updated.fills?.[0]?.image).toMatchObject({
      src: 'data:image/png;base64,AAAA',
    });
    expect(updated.fills?.[0]?.image?.assetId).toBeUndefined();
    expect(updated.fills?.[1]).toMatchObject({
      type: 'image',
      image: {
        assetId: 'asset-patch',
        fit: 'crop',
        x: 4,
        y: 2,
        imageWidth: 2,
        imageHeight: 1,
        scale: 2,
        generativeEditOverlay: { editId: 'edit-patch', variationId: 'variation-1' },
      },
    });
    expect(updated.fills?.[1]?.image?.generativeEditOverlay?.sourceFrame).toEqual({
      x: 4,
      y: 2,
      width: 4,
      height: 2,
    });
  });

  it('maps a bounded source patch through a resized image placement', () => {
    const sourceDoc = imageDoc();
    const resized = {
      ...sourceDoc,
      nodes: {
        ...sourceDoc.nodes,
        img1: {
          ...sourceDoc.nodes.img1!,
          shape: { kind: 'rect' as const, x: 0, y: 0, w: 40, h: 20 },
        },
      },
    };
    const next = replaceImageShapeContent(resized, 'img1', {
      dataUrl: 'data:image/png;base64,AAAA',
      assetId: 'asset-source',
      width: 20,
      height: 10,
      patch: {
        dataUrl: 'data:image/png;base64,PATCH',
        assetId: 'asset-patch',
        width: 4,
        height: 3,
        x: 5,
        y: 2,
        frameWidth: 4,
        frameHeight: 3,
        editId: 'edit-resized',
        variationId: 'variation-1',
      },
    });
    const image = (next.nodes.img1 as ShapeNode).fills?.[1]?.image;
    expect(image).toMatchObject({ x: 10, y: 4, scale: 2 });
    expect(image?.generativeEditOverlay?.sourceFrame).toEqual({
      x: 5,
      y: 2,
      width: 4,
      height: 3,
    });
  });

  it('rejects a patch when image placement would distort it non-uniformly', () => {
    const sourceDoc = imageDoc();
    const stretched = {
      ...sourceDoc,
      nodes: {
        ...sourceDoc.nodes,
        img1: {
          ...sourceDoc.nodes.img1!,
          shape: { kind: 'rect' as const, x: 0, y: 0, w: 40, h: 30 },
          fills: sourceDoc.nodes.img1!.fills?.map((fill) =>
            fill.type === 'image' && fill.image
              ? { ...fill, image: { ...fill.image, fit: 'stretch' as const } }
              : fill,
          ),
        },
      },
    };
    expect(() =>
      replaceImageShapeContent(stretched, 'img1', {
        dataUrl: 'data:image/png;base64,AAAA',
        assetId: 'asset-source',
        width: 20,
        height: 10,
        patch: {
          dataUrl: 'data:image/png;base64,PATCH',
          assetId: 'asset-patch',
          width: 4,
          height: 3,
          x: 5,
          y: 2,
          frameWidth: 4,
          frameHeight: 3,
          editId: 'edit-stretched',
          variationId: 'variation-1',
        },
      }),
    ).toThrow(/non-uniformly/);
  });

  it('retains earlier bounded patches when a later edit is accepted', () => {
    const first = replaceImageShapeContent(imageDoc(), 'img1', {
      dataUrl: 'data:image/png;base64,AAAA',
      assetId: 'asset-source',
      width: 20,
      height: 10,
      generativeEditId: 'edit-1',
      patch: {
        dataUrl: 'data:image/png;base64,FIRST',
        assetId: 'asset-first',
        width: 4,
        height: 2,
        x: 2,
        y: 3,
        editId: 'edit-1',
        variationId: 'variation-1',
      },
    });
    const second = replaceImageShapeContent(first, 'img1', {
      dataUrl: 'data:image/png;base64,AAAA',
      assetId: 'asset-source',
      width: 20,
      height: 10,
      generativeEditId: 'edit-2',
      patch: {
        dataUrl: 'data:image/png;base64,SECOND',
        assetId: 'asset-second',
        width: 6,
        height: 3,
        x: 10,
        y: 4,
        editId: 'edit-2',
        variationId: 'variation-2',
      },
    });
    const updated = second.nodes.img1;
    if (updated?.kind !== 'shape') throw new Error('expected shape');
    expect(updated.fills).toHaveLength(3);
    expect(updated.fills?.[1]?.image?.generativeEditOverlay).toMatchObject({
      editId: 'edit-1',
      variationId: 'variation-1',
    });
    expect(updated.fills?.[2]?.image?.generativeEditOverlay).toMatchObject({
      editId: 'edit-2',
      variationId: 'variation-2',
    });
  });

  it('restores the source and removes bounded generative overlays', () => {
    const source = createEmbeddedAsset({
      dataUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/png',
      naturalWidth: 20,
      naturalHeight: 10,
    });
    const patched = replaceImageShapeContent(imageDoc(), 'img1', {
      dataUrl: source.dataUrl,
      assetId: source.id,
      width: 20,
      height: 10,
      generativeEditId: 'edit-patch',
      patch: {
        dataUrl: 'data:image/png;base64,PATCH',
        assetId: 'asset-patch',
        width: 2,
        height: 1,
        x: 4,
        y: 2,
        editId: 'edit-patch',
        variationId: 'variation-1',
      },
    });
    const restored = restoreImageShapeContent(patched, 'img1', { sourceAsset: source });
    const image = restored.nodes.img1;
    if (image?.kind !== 'shape') throw new Error('expected shape');
    expect(image.generativeEditId).toBeUndefined();
    expect(image.fills).toHaveLength(1);
    expect(image.fills?.[0]?.image).toMatchObject({
      src: source.dataUrl,
      assetId: source.id,
      imageWidth: 20,
      imageHeight: 10,
    });
  });

  it('restores source pixels and bounds after an expanded edit', () => {
    const doc = imageDoc();
    const source = createEmbeddedAsset({
      dataUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/png',
      naturalWidth: 20,
      naturalHeight: 10,
    });
    const expanded = replaceImageShapeContent(doc, 'img1', {
      dataUrl: 'data:image/png;base64,EXPANDED',
      assetId: 'asset-expanded',
      width: 32,
      height: 24,
      outputFrame: {
        sourceOffsetX: 6,
        sourceOffsetY: 4,
        sourceWidth: 20,
        sourceHeight: 10,
      },
    });
    const restored = restoreImageShapeContent(expanded, 'img1', {
      sourceAsset: source,
      outputFrame: {
        x: -6,
        y: -4,
        width: 32,
        height: 24,
        sourceWidth: 20,
        sourceHeight: 10,
      },
    });
    const image = restored.nodes.img1;
    if (image?.kind !== 'shape') throw new Error('expected shape');
    expect(image.shape).toMatchObject({ kind: 'rect', w: 20, h: 10 });
    expect(image.transform).toEqual([1, 0, 0, 1, 5, 7]);
    expect(image.generativeEditId).toBeUndefined();
    expect(image.fills?.[0]).toMatchObject({
      type: 'image',
      image: { assetId: source.id, src: source.dataUrl, imageWidth: 20, imageHeight: 10 },
    });
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
    const derivedFill = (result.doc.nodes[result.nodeId] as import('@varve/scene').ShapeNode).fills;
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
