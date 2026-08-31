import {
  createComponent,
  createDocument,
  imageFill,
  makeFrameNode,
  makeRasterLayerNode,
  makeShapeNode,
  nextNodeId,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  layerAccessibleDescription,
  layerColorLabel,
  maskTypeLabel,
  resolveLayerPresentation,
} from './layerPresentation';

function shape(id: string, name = 'Shape') {
  return makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }, { name });
}

describe('resolveLayerPresentation', () => {
  it('distinguishes structural containers from vector shapes', () => {
    const frame = makeFrameNode('frame', { name: 'Frame', w: 100, h: 100, children: [] });
    const vector = shape('vector');

    expect(resolveLayerPresentation(frame)).toMatchObject({
      dataType: 'frame',
      category: 'frame',
      subtype: 'frame',
      label: 'Frame',
    });
    expect(resolveLayerPresentation(vector)).toMatchObject({
      dataType: 'shape',
      category: 'vector',
      subtype: 'rect',
      label: 'Vector rectangle',
    });
  });

  it('distinguishes image-filled shapes from vector shapes', () => {
    const image = {
      ...shape('image', 'Photo'),
      fills: [imageFill('data:image/png;base64,AAAA')],
    };

    expect(resolveLayerPresentation(image)).toMatchObject({
      dataType: 'image',
      category: 'raster',
      subtype: 'image-fill',
      label: 'Raster image',
    });
  });

  it('distinguishes a native pixel layer from an image-filled vector shape', () => {
    expect(
      resolveLayerPresentation(makeRasterLayerNode('pixels', { width: 20, height: 20 })),
    ).toMatchObject({
      dataType: 'rasterLayer',
      category: 'raster',
      subtype: 'raster-layer',
      label: 'Raster layer',
      icon: 'FileImage',
    });
  });

  it('distinguishes component definitions from instances using document ownership', () => {
    let doc = createDocument('components');
    const { id: rootId, doc: withRootId } = nextNodeId(doc);
    doc = withRootId;
    const root = makeFrameNode(rootId, { name: 'Button', w: 100, h: 40, children: [] });
    doc = { ...doc, nodes: { ...doc.nodes, [rootId]: root }, rootChildren: [rootId] };
    const componentResult = createComponent(doc, 'Button', rootId, []);
    const definitionDoc = componentResult.doc;
    const instance = makeFrameNode('instance', {
      name: 'Button Instance',
      w: 100,
      h: 40,
      children: [],
      componentId: componentResult.component.id,
    });

    expect(resolveLayerPresentation(root, definitionDoc)).toMatchObject({
      category: 'component',
      label: 'Component',
    });
    expect(resolveLayerPresentation(instance, definitionDoc)).toMatchObject({
      dataType: 'instance',
      category: 'instance',
      label: 'Component instance',
    });
  });
});

describe('Layers row presentation semantics', () => {
  it('describes color labels and all mask source forms', () => {
    expect(layerColorLabel('blue')).toBe('blue layer label');
    expect(maskTypeLabel({ type: 'alpha', visible: false, rasterMask: {} as never })).toBe(
      'raster alpha mask, disabled',
    );
    expect(maskTypeLabel({ type: 'clip', visible: true, vectorMask: {} as never })).toBe(
      'vector clipping mask',
    );
  });

  it('keeps type, mask role, label, and selection in one concise row name', () => {
    const node = shape('masked', 'Artwork');
    const presentation = resolveLayerPresentation(node);
    const label = layerAccessibleDescription(node, presentation, {
      maskRole: 'content',
    });

    expect(label).toContain('Artwork');
    expect(label).toContain('Vector rectangle');
    expect(label).toContain('clipped content');
    expect(label).not.toContain('selected');
  });
});
