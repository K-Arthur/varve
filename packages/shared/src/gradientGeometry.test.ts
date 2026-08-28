import { describe, expect, it } from 'vitest';
import type { Affine, Point, Rect } from './affine';
import { applyAffine, multiplyAffine, rotateDeg, scaleXY, translate } from './affine';
import {
  gradientTransformForBounds,
  linearGradientHandles,
  materializeLegacyGradientTransform,
  radialGradientHandles,
  transformLinkedGradient,
} from './gradientGeometry';

function expectPointClose(actual: Point, expected: Point, digits = 10): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
}

const bounds: Rect = { x: 10, y: 20, w: 200, h: 100 };

describe('gradient geometry contract', () => {
  it('derives linear handles directly from the explicit unit-fill affine', () => {
    const gradient = {
      transform: [120, 60, -30, 80, 25, 15] as Affine,
    };

    const handles = linearGradientHandles(gradient, bounds);

    expectPointClose(handles.start, [10, 55]);
    expectPointClose(handles.end, [130, 115]);
  });

  it('materializes legacy rotation without changing its rendered endpoints', () => {
    const rotation = 23;
    const explicit = materializeLegacyGradientTransform(bounds, rotation);
    const handles = linearGradientHandles({ transform: explicit }, bounds);
    const radius = Math.hypot(bounds.w, bounds.h) / 2;
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    const radians = (rotation * Math.PI) / 180;

    expectPointClose(handles.start, [
      cx - radius * Math.cos(radians),
      cy - radius * Math.sin(radians),
    ]);
    expectPointClose(handles.end, [
      cx + radius * Math.cos(radians),
      cy + radius * Math.sin(radians),
    ]);
  });

  it('retains both affine radial axes instead of collapsing to one radius', () => {
    const gradient = {
      transform: [160, 80, -20, 30, 40, 50] as Affine,
    };

    const handles = radialGradientHandles(gradient, bounds);

    expectPointClose(handles.center, [110, 105]);
    expectPointClose(handles.uAxisEnd, [190, 145]);
    expectPointClose(handles.vAxisEnd, [100, 120]);
  });

  it('proves baked and unbaked gradient world handles are equivalent', () => {
    const gradient = {
      transform: [120, 60, -30, 80, 25, 15] as Affine,
    };
    const parentWorld = multiplyAffine(translate(400, -75), rotateDeg(23));
    const nodeWithoutScale = multiplyAffine(translate(30, 40), rotateDeg(-17));
    const bake = scaleXY(1.75, 0.6);
    const liveWorld = multiplyAffine(parentWorld, multiplyAffine(nodeWithoutScale, bake));
    const bakedWorld = multiplyAffine(parentWorld, nodeWithoutScale);
    const bakedGradient = transformLinkedGradient(gradient, bounds, bake);

    for (const point of [
      [0, 0.5],
      [1, 0.5],
      [0.5, 0.5],
      [0.5, 1],
    ] as Point[]) {
      expectPointClose(
        applyAffine(liveWorld, applyAffine(gradient.transform, point)),
        applyAffine(bakedWorld, applyAffine(bakedGradient.transform, point)),
        12,
      );
    }
  });

  it('materializes and bakes a legacy gradient from its pre-bake bounds', () => {
    const bake = scaleXY(2, 0.5);
    const legacy = { rotation: 37 };
    const baked = transformLinkedGradient(legacy, bounds, bake);
    const legacyTransform = gradientTransformForBounds(legacy, bounds);

    for (const point of [
      [0, 0.5],
      [1, 0.5],
      [0.5, 1],
    ] as Point[]) {
      expectPointClose(
        applyAffine(baked.transform, point),
        applyAffine(bake, applyAffine(legacyTransform, point)),
      );
    }
  });
});
