import { describe, expect, it } from 'vitest';
import {
  type Camera,
  createWorldRectViewportTest,
  isWorldRectInViewport,
  worldToScreen,
  worldToScreenProjector,
} from './viewport';

const cameras: Camera[] = [
  { zoom: 1, pan: { x: 0, y: 0 } },
  { zoom: 0.001, pan: { x: 416, y: 361 } },
  { zoom: 3.7, pan: { x: -1200.5, y: 88.25 }, rotation: 0.6 },
  { zoom: 64, pan: { x: 12, y: -7 }, rotation: -2.1 },
];
const viewports = [
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
];
const points: Array<[number, number]> = [
  [0, 0],
  [123.4, -987.6],
  [2_000_000, -1_500_000],
  [Number.NaN, 5],
  [Number.POSITIVE_INFINITY, 1],
];

describe('worldToScreenProjector', () => {
  it('matches per-point worldToScreen exactly', () => {
    for (const cam of cameras) {
      for (const viewport of viewports) {
        const project = worldToScreenProjector(cam, viewport, [0, 0]);
        for (const [x, y] of points) {
          expect(project(x, y)).toEqual(worldToScreen(cam, x, y, viewport, [0, 0]));
        }
      }
    }
  });
});

describe('createWorldRectViewportTest', () => {
  function referenceInViewport(
    cam: Camera,
    viewport: { width: number; height: number },
    rect: { x: number; y: number; w: number; h: number },
  ): boolean {
    const corners: Array<[number, number]> = [
      [rect.x, rect.y],
      [rect.x + rect.w, rect.y],
      [rect.x, rect.y + rect.h],
      [rect.x + rect.w, rect.y + rect.h],
    ];
    const projected = corners.map(([x, y]) => worldToScreen(cam, x, y, viewport, [0, 0]));
    const xs = projected.map(([x]) => x);
    const ys = projected.map(([, y]) => y);
    if (Math.max(...xs) < 0 || Math.max(...ys) < 0) return false;
    if (Math.min(...xs) > viewport.width || Math.min(...ys) > viewport.height) return false;
    return true;
  }

  it('agrees with the per-corner definition for visible, clipped, and distant rects', () => {
    const rects = [
      { x: 0, y: 0, w: 48, h: 48 },
      { x: -5000, y: -5000, w: 10, h: 10 },
      { x: 2_000_000, y: 1_500_000, w: 48, h: 48 },
      { x: -100, y: 200, w: 10_000, h: 3 },
    ];
    for (const cam of cameras) {
      for (const viewport of viewports) {
        const test = createWorldRectViewportTest(cam, viewport);
        for (const rect of rects) {
          const expected = referenceInViewport(cam, viewport, rect);
          expect(test(rect)).toBe(expected);
          expect(isWorldRectInViewport(cam, viewport, rect)).toBe(expected);
        }
      }
    }
  });
});
