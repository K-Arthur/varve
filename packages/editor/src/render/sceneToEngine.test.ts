/**
 * Native raster-mask render adapter compatibility.
 *
 * Research basis: local-first documents must render the same alpha matte after
 * persistence as before save, while legacy inline masks remain readable.
 */
import {
  addNode,
  addRasterMaskAsset,
  createDocument,
  DocumentCodec,
  makeFrameNode,
  makeShapeNode,
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
