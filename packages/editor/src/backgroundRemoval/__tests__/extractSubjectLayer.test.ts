/**
 * Tests for Object Selection's "extract subject to a new layer" commit.
 *
 * The extraction must preserve the source pixel-for-pixel, add a copy
 * directly above it with the reviewed mask committed, and share nothing:
 * the copy starts without the source's own mask so the extracted subject's
 * provenance describes the extraction, not the source's history.
 */

import type { Document } from '@varve/scene';
import { addChild, addNode, createDocument, makeGroupNode, makeImageShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { commitRasterMask } from '../commitRasterMask';
import { extractSubjectToLayer } from '../extractSubjectLayer';

const PNG_WHITE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';

function makeDoc(): Document {
  const doc = createDocument('Extract test', true);
  const imgNode = makeImageShapeNode('img-1', {
    src: 'test-src',
    w: 1,
    h: 1,
    imageWidth: 1,
    imageHeight: 1,
  });
  return addNode(doc, imgNode);
}

const commitFields = {
  dataUrl: PNG_WHITE,
  width: 1,
  height: 1,
  method: 'ai-quality' as const,
  modelId: 'sam2-hiera-tiny',
  score: 0.91,
  scoreSource: 'predicted-iou' as const,
  generatedAt: 1_700_000_000_000,
  sourceLocator: 'test-src',
};

describe('extractSubjectToLayer', () => {
  it('inserts a masked copy directly above an untouched source at the root', () => {
    const doc = makeDoc();
    const result = extractSubjectToLayer(doc, 'img-1', commitFields);
    expect(result).not.toBeNull();
    if (!result) return;
    const { doc: next, newNodeId } = result;

    const source = next.nodes['img-1']!;
    const copy = next.nodes[newNodeId]!;
    expect(copy.kind).toBe('shape');
    expect(copy.name).toBe('Image subject');
    // The source gained nothing: same object, no mask committed to it.
    expect(source.mask?.rasterMask).toBeUndefined();
    // The copy holds the reviewed mask and shares the source's fill.
    expect(copy.mask?.rasterMask?.assetId).toBeDefined();
    expect(copy).not.toBe(source);

    // Root insertion order: directly above the source.
    const index = next.rootChildren.indexOf(newNodeId);
    expect(index).toBe(next.rootChildren.indexOf('img-1') + 1);
    // Fractional order keys stay ordered: the copy sorts between the source
    // and whatever sat above it, so later reorders keep working.
    expect(copy.order > source.order).toBe(true);
  });

  it('does not inherit the source raster mask or legacy background removal state', () => {
    const base = makeDoc();
    const withMask = commitRasterMask(base, 'img-1', {
      dataUrl: PNG_WHITE,
      width: 1,
      height: 1,
      method: 'quick',
      generatedAt: 1,
    });
    const result = extractSubjectToLayer(withMask, 'img-1', commitFields);
    expect(result).not.toBeNull();
    if (!result) return;
    const copy = result.doc.nodes[result.newNodeId]!;
    // One fresh asset whose provenance describes the extraction.
    expect(copy.mask?.rasterMask?.assetId).not.toBe(
      withMask.nodes['img-1']!.mask?.rasterMask?.assetId,
    );
    expect(copy.mask?.rasterMask?.provenance?.method).toBe('ai-quality');
    // The legacy field only exists on the shape variant.
    if ('backgroundRemoval' in copy) expect(copy.backgroundRemoval).toBeUndefined();
  });

  it('works inside a group, inserting above the source among its siblings', () => {
    const doc = makeDoc();
    const sibling = makeImageShapeNode('img-2', {
      src: 'other-src',
      w: 1,
      h: 1,
      imageWidth: 1,
      imageHeight: 1,
    });
    const withSibling = addNode(doc, sibling);
    // Adopt both images into a group through the scene's own insertion path
    // so the parent relationship is the one production uses.
    const group = makeGroupNode('grp-1', { name: 'group', children: [] });
    const withGroupSlot = {
      ...withSibling,
      nodes: { ...withSibling.nodes, 'grp-1': group },
    } as Document;
    const withChild1 = addChild(withGroupSlot, 'grp-1', withSibling.nodes['img-1']!);
    const withChild2 = addChild(withChild1, 'grp-1', withSibling.nodes['img-2']!);

    const result = extractSubjectToLayer(withChild2, 'img-1', commitFields);
    expect(result).not.toBeNull();
    if (!result) return;
    const parent = result.doc.nodes['grp-1'] as { children?: string[] } | undefined;
    expect(parent?.children).toBeDefined();
    if (!parent?.children) return;
    const index = parent.children.indexOf(result.newNodeId);
    expect(index).toBe(parent.children.indexOf('img-1') + 1);
    // The extraction only touched the group's children, not the sibling.
    expect(result.doc.nodes['img-2']).toBe(withChild2.nodes['img-2']);
  });

  it('returns null for an unknown source node', () => {
    const doc = makeDoc();
    expect(extractSubjectToLayer(doc, 'missing', commitFields)).toBeNull();
  });
});
