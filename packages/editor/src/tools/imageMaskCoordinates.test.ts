/**
 * World-pointer to source-mask coordinate tests.
 *
 * Research basis: inverse scene-graph affine composition followed by the
 * renderer's canonical image-placement inverse.
 */
import { computeImagePlacement, sourcePixelToLocal } from '@varve/engine';
import {
  addChild,
  addNode,
  createDocument,
  imageFill,
  makeFrameNode,
  makePaint,
  makeShapeNode,
} from '@varve/scene';
import { applyAffine, tryInvertAffine } from '@varve/shared';
import { describe, expect, it, vi } from 'vitest';
import { nodeWorldTransform } from '../scene/world';
import { prepareImageMaskMapper, worldPointToImageMaskPixel } from './imageMaskCoordinates';

vi.mock('../scene/world', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scene/world')>();
  return { ...actual, nodeWorldTransform: vi.fn(actual.nodeWorldTransform) };
});

vi.mock('@varve/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/shared')>();
  return { ...actual, tryInvertAffine: vi.fn(actual.tryInvertAffine) };
});

function makeImageNode(transform: readonly [number, number, number, number, number, number]) {
  return {
    ...makeShapeNode(
      'image',
      { kind: 'rect', x: 20, y: 30, w: 800, h: 800 },
      {
        name: 'Image',
        transform,
      },
    ),
    fills: [imageFill('asset', { fit: 'fit', x: 8, y: -4 })],
  };
}

function sourcePointInWorld(
  doc: ReturnType<typeof createDocument>,
  sourcePoint: { x: number; y: number },
) {
  const placement = computeImagePlacement({
    fit: 'fit',
    sourceWidth: 4000,
    sourceHeight: 3000,
    bounds: { x: 20, y: 30, w: 800, h: 800 },
    x: 8,
    y: -4,
  });
  if (!placement) throw new Error('expected valid placement');
  const local = sourcePixelToLocal(placement, sourcePoint);
  if (!local) throw new Error('expected visible source point');
  const [x, y] = applyAffine(nodeWorldTransform(doc, 'image'), [local.x, local.y]);
  return { x, y };
}

function expectMapsThrough(
  transform: readonly [number, number, number, number, number, number],
  rotation = 0,
  parentTransform?: readonly [number, number, number, number, number, number],
): void {
  let doc = createDocument('coords', true);
  const image = { ...makeImageNode(transform), rotation };
  if (parentTransform) {
    const parent = makeFrameNode('parent', {
      name: 'Parent',
      w: 1600,
      h: 1200,
      transform: parentTransform,
    });
    doc = addNode(doc, parent);
    doc = addChild(doc, 'parent', image);
  } else {
    doc = addNode(doc, image);
  }
  const expected = { x: 2100.125, y: 1700.875 };
  const worldPoint = sourcePointInWorld(doc, expected);
  const actual = worldPointToImageMaskPixel({
    document: doc,
    node: doc.nodes.image!,
    sourceWidth: 4000,
    sourceHeight: 3000,
    worldPoint,
  });
  expect(actual?.x).toBeCloseTo(expected.x, 8);
  expect(actual?.y).toBeCloseTo(expected.y, 8);

  const mapper = prepareImageMaskMapper({
    document: doc,
    node: doc.nodes.image!,
    sourceWidth: 4000,
    sourceHeight: 3000,
  });
  const roundTrip = mapper?.mapSourcePixelToWorld(expected);
  expect(roundTrip?.x).toBeCloseTo(worldPoint.x, 8);
  expect(roundTrip?.y).toBeCloseTo(worldPoint.y, 8);
}

describe('worldPointToImageMaskPixel', () => {
  it('resolves an image fill through paintRefs like scene rendering', () => {
    let doc = createDocument('coords', true);
    const node = {
      ...makeShapeNode('image', { kind: 'rect', x: 0, y: 0, w: 800, h: 800 }),
      paintRefs: ['shared-image'],
    };
    doc = addNode(doc, node);
    doc = {
      ...doc,
      paints: {
        'shared-image': makePaint(
          'shared-image',
          'Shared image',
          imageFill('asset', { fit: 'stretch' }),
        ),
      },
    };
    expect(
      worldPointToImageMaskPixel({
        document: doc,
        node: doc.nodes.image!,
        sourceWidth: 4000,
        sourceHeight: 3000,
        worldPoint: { x: 400, y: 400 },
      }),
    ).toEqual({ x: 2000, y: 1500 });
  });

  it('maps through nested parent transforms', () => {
    expectMapsThrough([1, 0, 0, 1, 40, 70], 0, [1.2, 0.3, -0.2, 0.8, 100, -50]);
  });

  it('maps through a 90-degree node rotation', () => {
    expectMapsThrough([1, 0, 0, 1, 100, 200], 90);
  });

  it('maps through nonuniform scale', () => {
    expectMapsThrough([2.5, 0, 0, 0.25, -30, 90]);
  });

  it.each([
    ['horizontal', [-1, 0, 0, 1, 900, 0] as const],
    ['vertical', [1, 0, 0, -1, 0, 900] as const],
  ])('maps through a %s affine flip', (_label, transform) => {
    expectMapsThrough(transform);
  });

  it('returns null for a singular world transform', () => {
    let doc = createDocument('coords', true);
    const image = makeImageNode([0, 0, 0, 1, 0, 0]);
    doc = addNode(doc, image);
    expect(
      worldPointToImageMaskPixel({
        document: doc,
        node: image,
        sourceWidth: 4000,
        sourceHeight: 3000,
        worldPoint: { x: 20, y: 30 },
      }),
    ).toBeNull();
  });

  it('returns null outside the fitted image and outside node bounds', () => {
    let doc = createDocument('coords', true);
    const fitNode = makeImageNode([1, 0, 0, 1, 0, 0]);
    doc = addNode(doc, fitNode);
    expect(
      worldPointToImageMaskPixel({
        document: doc,
        node: fitNode,
        sourceWidth: 4000,
        sourceHeight: 3000,
        worldPoint: { x: 400, y: 50 },
      }),
    ).toBeNull();

    const fillNode = {
      ...fitNode,
      fills: [imageFill('asset', { fit: 'fill' })],
    };
    doc = { ...doc, nodes: { ...doc.nodes, image: fillNode } };
    expect(
      worldPointToImageMaskPixel({
        document: doc,
        node: fillNode,
        sourceWidth: 4000,
        sourceHeight: 3000,
        worldPoint: { x: 10, y: 400 },
      }),
    ).toBeNull();
  });
});

describe('prepareImageMaskMapper', () => {
  it('prepares world inversion once for repeated samples', () => {
    let doc = createDocument('coords', true);
    const image = makeImageNode([1, 0, 0, 1, 20, 30]);
    doc = addNode(doc, image);
    const transformSpy = vi.mocked(nodeWorldTransform);
    const inversionSpy = vi.mocked(tryInvertAffine);
    transformSpy.mockClear();
    inversionSpy.mockClear();

    const mapper = prepareImageMaskMapper({
      document: doc,
      node: doc.nodes.image!,
      sourceWidth: 4000,
      sourceHeight: 3000,
    });
    expect(mapper).not.toBeNull();
    mapper?.mapWorldPoint({ x: 400, y: 400 });
    mapper?.mapWorldPoint({ x: 500, y: 500 });
    mapper?.mapWorldPoint({ x: 600, y: 600 });
    expect(transformSpy).toHaveBeenCalledTimes(1);
    expect(inversionSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects detached, replaced, and deleted nodes', () => {
    let doc = createDocument('coords', true);
    const image = makeImageNode([1, 0, 0, 1, 0, 0]);
    doc = addNode(doc, image);
    const options = { document: doc, sourceWidth: 4000, sourceHeight: 3000 };
    expect(prepareImageMaskMapper({ ...options, node: { ...image } })).toBeNull();
    const deletedDoc = { ...doc, nodes: {} };
    expect(prepareImageMaskMapper({ ...options, document: deletedDoc, node: image })).toBeNull();
  });
});
