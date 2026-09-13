// @vitest-environment jsdom

import { computeImagePlacement } from '@varve/engine';
import type { Mask } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  applyAdjustmentSpatialMask,
  drawSourceBoundRasterMask,
  requiresLeafMaskReplay,
} from './maskReplay';

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
    const draws: number[][] = [];
    const context = {
      save: () => undefined,
      restore: () => undefined,
      translate: () => undefined,
      rotate: () => undefined,
      scale: () => undefined,
      drawImage: (_image: CanvasImageSource, ...args: number[]) => draws.push(args),
    };

    const placement = computeImagePlacement({
      fit: 'stretch',
      sourceWidth: 200,
      sourceHeight: 100,
      sourceCrop: { x: 50, y: 0, w: 100, h: 100 },
      bounds: { x: 0, y: 0, w: 100, h: 100 },
    });
    drawSourceBoundRasterMask(
      context as unknown as CanvasRenderingContext2D,
      { toString: () => 'mask-src' } as unknown as CanvasImageSource,
      placement,
    );

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
