// @vitest-environment jsdom

import { getImageCache, resetImageCache } from '@varve/engine';
import { addNode, createDocument, type Mask, makeImageShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { applyAdjustmentSpatialMask, requiresLeafMaskReplay } from './maskReplay';

afterEach(() => resetImageCache());

function hardClipVectorMask(): Mask {
  return {
    type: 'clip',
    visible: true,
    transform: [1, 0, 0, 1, 3, 5],
    vectorMask: {
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 20, y: 0, handleIn: null, handleOut: null },
        { x: 20, y: 20, handleIn: null, handleOut: null },
      ],
      closed: true,
      fillRule: 'nonzero',
    },
  };
}

describe('applyAdjustmentSpatialMask', () => {
  it('projects document mask geometry into the cropped adjustment surface', () => {
    const translations: Array<[number, number]> = [];
    const transforms: Array<[number, number, number, number, number, number]> = [];
    const backdropCtx = {
      globalCompositeOperation: 'source-over',
      save: () => undefined,
      restore: () => undefined,
      setTransform: () => undefined,
      translate: (x: number, y: number) => translations.push([x, y]),
      transform: (a: number, b: number, c: number, d: number, e: number, f: number) =>
        transforms.push([a, b, c, d, e, f]),
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      bezierCurveTo: () => undefined,
      closePath: () => undefined,
      fill: () => undefined,
      fillStyle: '',
    };

    applyAdjustmentSpatialMask({
      backdropCtx: backdropCtx as unknown as CanvasRenderingContext2D,
      mask: hardClipVectorMask(),
      doc: { nodes: {} } as import('@varve/scene').Document,
      camera: { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 } as DOMMatrix,
      regionX: 37,
      regionY: 53,
      replayNode: () => undefined,
      getWorldTransform: () => [1, 0, 0, 1, 0, 0],
    });

    expect(translations).toContainEqual([-37, -53]);
    expect(transforms).toEqual([
      [2, 0, 0, 2, 10, 20],
      [1, 0, 0, 1, 3, 5],
    ]);
  });

  it('uses the image fill crop when projecting a source-bound depth mask', () => {
    let doc = createDocument('Cropped depth mask');
    const source = makeImageShapeNode('source', {
      src: 'image-src',
      w: 100,
      h: 100,
      imageWidth: 200,
      imageHeight: 100,
      imageFit: 'stretch',
    });
    const imageFill = source.fills?.[0];
    if (imageFill?.type !== 'image' || !imageFill.image) throw new Error('image fill missing');
    imageFill.image.crop = { x: 50, y: 0, w: 100, h: 100 };
    doc = addNode(doc, source);
    doc = {
      ...doc,
      rasterMaskAssets: {
        'depth-mask': {
          id: 'depth-mask',
          mimeType: 'image/png',
          dataUrl: 'mask-src',
          width: 200,
          height: 100,
          byteLength: 1,
        },
      },
    };
    getImageCache().setLoaded('mask-src', {
      naturalWidth: 200,
      naturalHeight: 100,
      toString: () => 'mask-src',
    } as unknown as HTMLImageElement);

    const draws: number[][] = [];
    const backdropCtx = {
      globalCompositeOperation: 'source-over',
      save: () => undefined,
      restore: () => undefined,
      setTransform: () => undefined,
      translate: () => undefined,
      transform: () => undefined,
      rotate: () => undefined,
      scale: () => undefined,
      drawImage: (_image: CanvasImageSource, ...args: number[]) => draws.push(args),
    };
    const mask: Mask = {
      type: 'clip',
      visible: true,
      rasterMask: {
        assetId: 'depth-mask',
        coordinateSpace: 'source-image-pixels',
        sourceIdentity: { kind: 'source-metadata', locator: 'asset:source', revision: 1 },
        depthRecipe: {
          schemaVersion: 1,
          depthMapId: 'depth-map',
          sourceBinding: {
            nodeId: source.id,
            coordinateSpace: 'source-image-pixels',
            processingRevision: 1,
          },
          sourceIdentity: { kind: 'source-metadata', locator: 'asset:source', revision: 1 },
          range: { near: 0, far: 1, nearTransition: 0, farTransition: 0 },
          invert: false,
          combine: 'replace',
          algorithmVersion: 1,
        },
      },
    };

    applyAdjustmentSpatialMask({
      backdropCtx: backdropCtx as unknown as CanvasRenderingContext2D,
      mask,
      doc,
      camera: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } as DOMMatrix,
      regionX: 0,
      regionY: 0,
      replayNode: () => undefined,
      getWorldTransform: () => [1, 0, 0, 1, 0, 0],
    });

    expect(draws).toEqual([[50, 0, 100, 100, 25, 0, 50, 100]]);
  });
});

describe('requiresLeafMaskReplay', () => {
  it('keeps the source-image alpha-mask fast path out of structural replay', () => {
    expect(
      requiresLeafMaskReplay({
        type: 'alpha',
        visible: true,
        rasterMask: {
          assetId: 'source-mask',
          coordinateSpace: 'source-image-pixels',
          sourceIdentity: { kind: 'source-metadata', locator: 'image', revision: 1 },
        },
      }),
    ).toBe(false);
  });

  it('uses structural replay for vector and node-local pixel coverage', () => {
    expect(requiresLeafMaskReplay(hardClipVectorMask())).toBe(true);
    expect(
      requiresLeafMaskReplay({
        type: 'alpha',
        visible: true,
        rasterMask: {
          assetId: 'pixel-mask',
          coordinateSpace: 'node-local-pixels',
          sourceIdentity: { kind: 'source-metadata', locator: 'node-local:vector', revision: 1 },
        },
      }),
    ).toBe(true);
  });
});
