/**
 * Native raster-mask render adapter compatibility.
 *
 * Research basis: local-first documents must render the same alpha matte after
 * persistence as before save, while legacy inline masks remain readable.
 */
import {
  addNode,
  addRasterMaskAsset,
  colorConfigWithDefaults,
  createDocument,
  DocumentCodec,
  makeFrameNode,
  makeShapeNode,
  makeSmartFilter,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { flattenSceneToEngine, sceneNodeToEngineNode } from './sceneToEngine';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function imageNode(id: string) {
  const node = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 20, h: 20 });
  node.fills = [
    {
      type: 'image',
      image: { src: 'image', fit: 'fill', x: 0, y: 0, scale: 1 },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    },
  ];
  return node;
}

describe('scene raster masks', () => {
  it('propagates object-local filters into the shared engine IR', () => {
    const node = {
      ...makeShapeNode('filtered', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
      smartFilters: [makeSmartFilter('invert', 'invert')],
    };
    const converted = sceneNodeToEngineNode(node, {}, createDocument('Object Filter'));
    expect(converted.filters).toEqual([
      expect.objectContaining({ kind: 'invert', value: 100, opacity: 1 }),
    ]);
  });

  it('renders a native raster alpha mask after save and reload', () => {
    const image = imageNode('image');
    let doc = addNode(createDocument('Native mask', true), image);
    doc = addRasterMaskAsset(doc, image.id, {
      id: 'mask',
      mimeType: 'image/png',
      dataUrl: PNG_DATA_URL,
      width: 1,
      height: 1,
      byteLength: 68,
    });
    const decoded = DocumentCodec.decode(DocumentCodec.encode(doc));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const flattened = flattenSceneToEngine(decoded.document, [image.id]);
    expect(flattened.nodes[0]?.alphaMask).toBe(PNG_DATA_URL);
    expect(
      sceneNodeToEngineNode(
        decoded.document.nodes[image.id]!,
        {
          showOriginalBackgroundNodeId: image.id,
        },
        decoded.document,
      ).alphaMask,
    ).toBeUndefined();
  });

  it('falls back to the legacy inline background-removal mask', () => {
    const image = imageNode('legacy');
    image.backgroundRemoval = {
      maskDataUrl: 'data:image/png;base64,legacy',
      method: 'quick',
      confidence: 0.5,
      appliedAt: 1,
    };
    expect(sceneNodeToEngineNode(image).alphaMask).toBe(image.backgroundRemoval.maskDataUrl);
  });

  it('propagates frame-level raster masks onto the engine node for the export barrier', () => {
    let doc = addNode(
      createDocument('Frame mask', true),
      makeFrameNode('frame', { name: 'Frame', w: 100, h: 80 }),
    );
    doc = addRasterMaskAsset(
      doc,
      'frame',
      {
        id: 'mask',
        mimeType: 'image/png',
        dataUrl: PNG_DATA_URL,
        width: 1,
        height: 1,
        byteLength: 68,
      },
      undefined,
      { coordinateSpace: 'container-local-pixels' },
    );
    const flattened = flattenSceneToEngine(doc, ['frame']);
    expect(flattened.nodes[0]?.alphaMask).toBe(PNG_DATA_URL);
    // Frame masks are applied by the structural replay; the engine node only
    // carries the identity so resource preflight can see it. The rect
    // path's alphaMask must never leak through showOriginalBackgroundNodeId.
    expect(
      sceneNodeToEngineNode(doc.nodes.frame!, { showOriginalBackgroundNodeId: 'frame' }, doc)
        .alphaMask,
    ).toBeUndefined();
  });
});

describe('scene gradient interpolation resolution', () => {
  function gradientNode(interpolation: Record<string, unknown> = {}) {
    const node = makeShapeNode('gradient', {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 20,
      h: 20,
    });
    node.fills = [
      {
        type: 'gradient',
        gradient: {
          type: 'linear',
          stops: [
            { position: 0, color: { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 } },
            { position: 1, color: { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 } },
          ],
          ...interpolation,
        },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ];
    return node;
  }

  it('keeps old gradients on their historical encoded-sRGB path', () => {
    const node = gradientNode();
    const converted = sceneNodeToEngineNode(node, {}, createDocument('Legacy'));
    expect(converted.fills?.[0]?.gradient?.interpolationSpace).toBe('srgb');
  });

  it('resolves document-inherited gradients before they reach the engine', () => {
    const node = gradientNode({ interpolationSource: 'document' });
    const base = createDocument('Inherited');
    const doc = {
      ...base,
      colorConfig: {
        ...colorConfigWithDefaults(base.colorConfig),
        defaultGradientInterpolation: 'oklch' as const,
      },
    };
    const converted = sceneNodeToEngineNode(node, {}, doc);
    expect(converted.fills?.[0]?.gradient?.interpolationSpace).toBe('oklch');
  });

  it('preserves a per-gradient override over the document default', () => {
    const node = gradientNode({ interpolationSpace: 'linear-srgb' });
    const converted = sceneNodeToEngineNode(node, {}, createDocument('Pinned'));
    expect(converted.fills?.[0]?.gradient?.interpolationSpace).toBe('linear-srgb');
  });
});
