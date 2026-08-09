/**
 * Canonical resource handles in scene-to-engine conversion: assets emit
 * their short content-addressed handle as the render identity instead of
 * materializing data URLs into the IR, while legacy fills keep raw srcs.
 */
import type { SceneNode } from '@varve/engine';
import {
  imageResourceRegistrySize,
  resetImageResourceRegistry,
  resolveImageResourceHandle,
} from '@varve/engine';
import { addNode, createDocument, makeShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { flattenSceneToEngine, sceneNodeToEngineNode } from './sceneToEngine';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function assetDocument() {
  let doc = createDocument('handles', true);
  const assetId = 'asset-aaaaaaaaaaaaaaaa';
  const hash = 'aaaaaaaaaaaaaaaa';
  doc = addNode(doc, makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }));
  const node = doc.nodes['n1']!;
  node.fills = [
    {
      type: 'image',
      image: {
        src: PNG_DATA_URL,
        assetId,
        fit: 'fill',
        x: 0,
        y: 0,
        scale: 1,
        imageWidth: 1,
        imageHeight: 1,
      },
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    },
  ];
  return {
    doc: {
      ...doc,
      assets: {
        [assetId]: {
          id: assetId,
          storage: 'embedded' as const,
          mimeType: 'image/png',
          dataUrl: PNG_DATA_URL,
          naturalWidth: 1,
          naturalHeight: 1,
          byteLength: 100,
          hash,
        },
      },
    },
    assetId,
  };
}

afterEach(() => resetImageResourceRegistry());

describe('sceneToEngine resource handles', () => {
  it('replaces the data URL with the short handle when the fill references an asset', () => {
    const { doc, assetId } = assetDocument();
    const engineNode = sceneNodeToEngineNode(doc.nodes['n1']!, {}, doc);
    const fill = engineNode.fills?.find((f) => f.type === 'image');
    expect(fill?.image?.src).toBe(assetId);
    expect(fill?.image?.assetId).toBe(assetId);
    // The registry maps the handle to the loadable payload without the IR
    // ever carrying it.
    expect(resolveImageResourceHandle(assetId)).toBe(PNG_DATA_URL);
  });

  it('registers the mapping idempotently and keeps one entry per asset', () => {
    const { doc, assetId } = assetDocument();
    flattenSceneToEngine(doc, ['n1']);
    flattenSceneToEngine(doc, ['n1']);
    expect(imageResourceRegistrySize()).toBe(1);
    expect(resolveImageResourceHandle(assetId)).toBe(PNG_DATA_URL);
  });

  it('leaves legacy fills without an assetId untouched', () => {
    const doc = addNode(
      createDocument('legacy', true),
      makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
    );
    const node = doc.nodes['n1']!;
    node.fills = [
      {
        type: 'image',
        image: { src: PNG_DATA_URL, fit: 'fill', x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ];
    const engineNode = sceneNodeToEngineNode(node, {}, doc);
    const fill = engineNode.fills?.find((f) => f.type === 'image');
    expect(fill?.image?.src).toBe(PNG_DATA_URL);
    expect(fill?.image?.assetId).toBeUndefined();
    expect(imageResourceRegistrySize()).toBe(0);
  });

  it('resolves shared paints through the same handle path', () => {
    const { doc, assetId } = assetDocument();
    const node = doc.nodes['n1']!;
    node.paintRefs = ['p1'];
    const paint = {
      id: 'p1',
      name: 'paint',
      fill: {
        type: 'image',
        image: { src: PNG_DATA_URL, assetId, fit: 'fill', x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    } as unknown as import('@varve/scene').Paint;
    const engineNode = sceneNodeToEngineNode(node, {}, { ...doc, paints: { p1: paint } });
    const fill = engineNode.fills?.find((f) => f.type === 'image');
    expect(fill?.image?.src).toBe(assetId);
  });

  it('leaves IR-level image identity short and serializable (payload stays out)', () => {
    const { doc, assetId } = assetDocument();
    const { nodes } = flattenSceneToEngine(doc, ['n1']);
    const serialized = JSON.stringify(nodes as unknown as SceneNode[]);
    expect(serialized).toContain(assetId);
    expect(serialized).not.toContain(PNG_DATA_URL);
    expect(serialized.length).toBeLessThan(600);
  });
});
