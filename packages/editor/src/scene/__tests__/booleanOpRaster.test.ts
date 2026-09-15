/**
 * Integration tests for raster-derived boolean operations.
 * Tests the full pipeline: extract alpha contours from ImageData, convert
 * to ShapeNode[], then feed into the existing boolean engine.
 */

import {
  type AlphaContour,
  alphaContoursToShapeNodes,
  type ContourShapeNodeData,
  extractAlphaContours,
} from '@varve/engine';
import type { BlendMode, Effect, Fill, ManagedColor, ShapeNode, Stroke } from '@varve/scene';
import { booleanOp, preloadClipper } from '@varve/scene';
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(async () => {
  await preloadClipper();
});

/** Convert the loosely-typed contour output into a real, typed ShapeNode.
 *  ContourShapeNodeData types fill/fills/strokes/effects as Record<string,
 *  unknown> bags (to avoid @varve/engine depending on @varve/scene), but
 *  the runtime values are always valid ManagedColor/Fill/Stroke/Effect data
 *  produced from the sourceNode passed into alphaContoursToShapeNodes. */
function toShapeNode(c: ContourShapeNodeData): ShapeNode {
  return {
    id: c.id,
    name: c.name,
    kind: 'shape',
    order: c.order,
    visible: c.visible,
    locked: c.locked,
    opacity: c.opacity,
    blendMode: c.blendMode as BlendMode,
    rotation: c.rotation,
    transform: c.transform,
    shape: c.shape,
    fill: c.fill as unknown as ManagedColor,
    fills: c.fills as unknown as Fill[],
    strokes: c.strokes as unknown as Stroke[],
    effects: c.effects as unknown as Effect[],
    shapeless: c.shapeless,
  };
}

/** Narrow a boolean-op result's shape to its `path` variant. Callers assert
 *  `result.shape.kind === 'path'` first; these helpers do the corresponding
 *  compile-time narrowing since `expect().toBe()` doesn't narrow types. */
function pathClosed(node: ShapeNode): boolean {
  return node.shape.kind === 'path' ? node.shape.closed : false;
}
function pathPointCount(node: ShapeNode): number {
  return node.shape.kind === 'path' ? node.shape.points.length : 0;
}

function makeImageData(width: number, height: number, alpha: number[]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 60;
    data[i * 4 + 1] = 120;
    data[i * 4 + 2] = 180;
    data[i * 4 + 3] = alpha[i] ?? 0;
  }
  return new ImageData(data, width, height);
}

function fillRectAlpha(
  alpha: number[],
  w: number,
  h: number,
  x: number,
  y: number,
  rw: number,
  rh: number,
  value: number,
): void {
  for (let py = y; py < y + rh; py++) {
    for (let px = x; px < x + rw; px++) {
      if (py >= 0 && py < h && px >= 0 && px < w) {
        alpha[py * w + px] = value;
      }
    }
  }
}

function makeVectorRect(x: number, y: number, w: number, h: number, id: string): ShapeNode {
  return {
    id,
    name: 'Vector Rect',
    kind: 'shape',
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0] as const,
    shape: { kind: 'rect', x, y, w, h },
    fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
    fills: [
      {
        type: 'solid' as const,
        color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
        opacity: 1,
        blendMode: 'normal' as const,
        visible: true,
      },
    ],
    strokes: [],
    effects: [],
  };
}

const sourceNode: ShapeNode = {
  id: 'raster-1',
  name: 'Raster Image',
  kind: 'shape',
  order: 'a0',
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'normal',
  rotation: 0,
  transform: [1, 0, 0, 1, 0, 0] as const,
  shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
  fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
  fills: [
    {
      type: 'solid' as const,
      color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
      opacity: 1,
      blendMode: 'normal' as const,
      visible: true,
    },
  ],
  strokes: [],
  effects: [],
};

/** `alphaContoursToShapeNodes` accepts a structurally-typed sourceNode whose
 *  fill/fills/strokes/effects are Record<string, unknown> bags (see
 *  `toShapeNode` above for why). Re-shape `sourceNode` field-by-field rather
 *  than passing the strongly-typed ShapeNode straight through. */
const sourceNodeForContour = {
  ...sourceNode,
  fill: { ...sourceNode.fill },
  fills: sourceNode.fills?.map((f) => ({ ...f, color: f.color ? { ...f.color } : undefined })),
  strokes: sourceNode.strokes.map((s) => ({ ...s })),
  effects: sourceNode.effects.map((e) => ({ ...e })),
};

describe('booleanOp with raster-derived contours', () => {
  it('union of raster shape + vector rect', () => {
    const w = 50;
    const h = 50;
    const alpha = new Array(w * h).fill(0);
    fillRectAlpha(alpha, w, h, 5, 5, 30, 30, 255);
    const imgData = makeImageData(w, h, alpha);
    const contours = extractAlphaContours(imgData, { alphaThreshold: 1, minArea: 4 });
    expect(contours.length).toBeGreaterThanOrEqual(1);

    const rasterNodes = alphaContoursToShapeNodes(contours, 'raster-1', sourceNodeForContour).map(
      toShapeNode,
    );
    const vectorRect = makeVectorRect(0, 0, 50, 50, 'vector-1');
    const allNodes = [...rasterNodes, vectorRect];

    const result = booleanOp('union', allNodes);
    expect(result.shape.kind).toBe('path');
    expect(pathClosed(result)).toBe(true);
    // Union should produce a polygon that covers the combined area
    // The vector rect (0,0,50,50) plus the image rect (5,5,30,30) should
    // produce a union that at least covers the vector rect
    expect(pathPointCount(result)).toBeGreaterThan(3);
  });

  it('subtract vector rect from raster shape', () => {
    const w = 50;
    const h = 50;
    const alpha = new Array(w * h).fill(0);
    fillRectAlpha(alpha, w, h, 5, 5, 30, 30, 255);
    const imgData = makeImageData(w, h, alpha);
    const contours = extractAlphaContours(imgData, { alphaThreshold: 1, minArea: 4 });
    expect(contours.length).toBeGreaterThanOrEqual(1);

    const rasterNodes = alphaContoursToShapeNodes(contours, 'raster-1', sourceNodeForContour).map(
      toShapeNode,
    );
    const subtractRect = makeVectorRect(15, 15, 10, 10, 'vector-1');

    const result = booleanOp('subtract', [...rasterNodes, subtractRect]);
    expect(result.shape.kind).toBe('path');
    expect(pathClosed(result)).toBe(true);
    // Subtract should produce a contour with area smaller than the original
    expect(pathPointCount(result)).toBeGreaterThan(3);
  });

  it('intersect raster shape + vector rect (partial overlap)', () => {
    const w = 50;
    const h = 50;
    const alpha = new Array(w * h).fill(0);
    fillRectAlpha(alpha, w, h, 5, 5, 30, 30, 255);
    const imgData = makeImageData(w, h, alpha);
    const contours = extractAlphaContours(imgData, { alphaThreshold: 1, minArea: 4 });
    expect(contours.length).toBeGreaterThanOrEqual(1);

    const rasterNodes = alphaContoursToShapeNodes(contours, 'raster-1', sourceNodeForContour).map(
      toShapeNode,
    );
    // Intersect with a rect that partially overlaps the raster shape
    const overlapRect = makeVectorRect(15, 15, 30, 30, 'vector-1');

    const result = booleanOp('intersect', [...rasterNodes, overlapRect]);
    expect(result.shape.kind).toBe('path');
    expect(pathClosed(result)).toBe(true);
    expect(pathPointCount(result)).toBeGreaterThan(3);
  });

  it('exclude raster shape + vector rect', () => {
    const w = 50;
    const h = 50;
    const alpha = new Array(w * h).fill(0);
    fillRectAlpha(alpha, w, h, 5, 5, 30, 30, 255);
    const imgData = makeImageData(w, h, alpha);
    const contours = extractAlphaContours(imgData, { alphaThreshold: 1, minArea: 4 });
    expect(contours.length).toBeGreaterThanOrEqual(1);

    const rasterNodes = alphaContoursToShapeNodes(contours, 'raster-1', sourceNodeForContour).map(
      toShapeNode,
    );
    const excludeRect = makeVectorRect(0, 0, 50, 50, 'vector-1');

    const result = booleanOp('exclude', [...rasterNodes, excludeRect]);
    expect(result.shape.kind).toBe('path');
    expect(pathClosed(result)).toBe(true);
    // Exclude should produce a non-empty result
    expect(pathPointCount(result)).toBeGreaterThan(3);
  });

  it('non-overlapping raster + vector: union returns combined, intersect returns empty', () => {
    const w = 30;
    const h = 30;
    const alpha = new Array(w * h).fill(0);
    // Raster shape at (5,5)
    fillRectAlpha(alpha, w, h, 5, 5, 10, 10, 255);
    const imgData = makeImageData(w, h, alpha);
    const contours = extractAlphaContours(imgData, { alphaThreshold: 1, minArea: 4 });
    expect(contours.length).toBeGreaterThanOrEqual(1);

    const rasterNodes = alphaContoursToShapeNodes(contours, 'raster-1', sourceNodeForContour).map(
      toShapeNode,
    );
    // Vector rect far away — no overlap
    const farRect = makeVectorRect(100, 100, 20, 20, 'vector-1');

    // Union of non-overlapping shapes should return both (combined)
    const unionResult = booleanOp('union', [...rasterNodes, farRect]);
    expect(unionResult.shape.kind).toBe('path');

    // Intersect of non-overlapping shapes is an empty path result.
    const intersectResult = booleanOp('intersect', [...rasterNodes, farRect]);
    expect(intersectResult.shape.kind).toBe('path');
    expect(pathPointCount(intersectResult)).toBe(0);
  });
});

describe('alphaContoursToShapeNodes + booleanOp pipeline', () => {
  it('handles empty contour array gracefully', () => {
    const empty: AlphaContour[] = [];
    const nodes = alphaContoursToShapeNodes(empty, 'empty', sourceNodeForContour);
    expect(nodes).toHaveLength(0);
  });

  it('handles single-point contour array gracefully', () => {
    const contours: AlphaContour[] = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
        ],
        area: 12.5,
        bounds: { x: 0, y: 0, w: 5, h: 5 },
      },
    ];
    const nodes = alphaContoursToShapeNodes(contours, 'test', sourceNodeForContour);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.shape.kind).toBe('path');
  });
});
