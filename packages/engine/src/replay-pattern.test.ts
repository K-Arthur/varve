// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { getImageCache, resetImageCache } from './imageCache';
import type { ReplayTarget } from './replay';
import { replayIr } from './replay';
import type { RenderItem } from './types';

function mockImage(width: number, height: number): HTMLImageElement {
  return { naturalWidth: width, naturalHeight: height } as unknown as HTMLImageElement;
}

function patternItem(spacing: number, rotation: number): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    fills: [
      {
        type: 'pattern',
        tileSrc: 'tile.png',
        spacing,
        rotation,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
    primitive: { kind: 'rect', x: 30, y: 40, w: 20, h: 10 },
  };
}

function target(overrides: Partial<ReplayTarget> = {}): ReplayTarget {
  return {
    save: () => undefined,
    restore: () => undefined,
    transform: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    beginPath: () => undefined,
    rect: () => undefined,
    ellipse: () => undefined,
    arc: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    bezierCurveTo: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    closePath: () => undefined,
    clip: () => undefined,
    fillText: () => undefined,
    setLineDash: () => undefined,
    font: '10px sans-serif',
    textBaseline: 'alphabetic',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    textAlign: 'left',
    lineJoin: 'miter',
    strokeStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    lineDashOffset: 0,
    ...overrides,
  };
}

beforeEach(() => resetImageCache());

describe('pattern replay hardening', () => {
  it.each([
    { name: 'zero repeat increment', width: 8, height: 8, spacing: -8 },
    { name: 'zero natural dimensions', width: 0, height: 0, spacing: 0 },
  ])('falls back safely for $name', ({ width, height, spacing }) => {
    getImageCache().setLoaded('tile.png', mockImage(width, height));
    let drawCount = 0;
    const fallbackRects: number[][] = [];
    const replayTarget = target({
      drawImage: () => {
        drawCount++;
        if (drawCount > 5) throw new Error('pattern loop did not advance');
      },
      fillRect: (...args) => fallbackRects.push(args),
    });

    expect(() => replayIr(replayTarget, [patternItem(spacing, 0)])).not.toThrow();
    expect(drawCount).toBe(0);
    expect(fallbackRects).toContainEqual([30, 40, 20, 10]);
  });

  it('rotates a zero-spacing pattern around the primitive center when supported', () => {
    getImageCache().setLoaded('tile.png', mockImage(8, 8));
    const transforms: DOMMatrix2DInit[] = [];
    const replayTarget = target({
      createPattern: () =>
        ({
          setTransform: (transform: DOMMatrix2DInit) => transforms.push(transform),
        }) as CanvasPattern,
    });

    replayIr(replayTarget, [patternItem(0, 90)]);

    expect(transforms).toHaveLength(1);
    expect(transforms[0]).toMatchObject({ b: 1, c: -1, e: 45, f: 35 });
    expect(transforms[0]?.a).toBeCloseTo(0);
    expect(transforms[0]?.d).toBeCloseTo(0);
  });

  it('rotates spaced manual tiles when CanvasPattern cannot encode their gaps', () => {
    getImageCache().setLoaded('tile.png', mockImage(8, 8));
    const transforms: number[][] = [];
    let drawCount = 0;
    let saveCount = 0;
    let restoreCount = 0;
    const replayTarget = target({
      save: () => saveCount++,
      restore: () => restoreCount++,
      transform: (...args) => transforms.push(args),
      drawImage: () => drawCount++,
    });

    replayIr(replayTarget, [patternItem(2, 90)]);

    expect(transforms).toHaveLength(2);
    expect(transforms[1]?.slice(0, 4)).toEqual([
      expect.closeTo(0),
      expect.closeTo(1),
      expect.closeTo(-1),
      expect.closeTo(0),
    ]);
    expect(drawCount).toBeGreaterThan(0);
    expect(saveCount).toBe(2);
    expect(restoreCount).toBe(2);
  });
});
