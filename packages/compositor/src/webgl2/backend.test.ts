import type { RenderItem } from '@varve/engine';
import { getImageCache, resetImageCache } from '@varve/engine';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompositorFrame } from '../types';
import { isWebGL2ItemEligible } from './backend';

afterEach(() => {
  resetImageCache();
});

function rect(overrides: Partial<RenderItem> = {}): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 30, g: 100, b: 210, a: 255 },
    primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
    ...overrides,
  };
}

const alignedFrame: CompositorFrame = {
  items: [],
  camera: { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 },
  viewport: { width: 256, height: 256 },
  docVersion: 1,
};

describe('WebGL2 compositor admission', () => {
  it('admits solid rectangles and leaves ellipse edge coverage on Canvas2D', () => {
    expect(isWebGL2ItemEligible(rect(), alignedFrame)).toBe(true);
    expect(
      isWebGL2ItemEligible(
        rect({
          transform: [0.8, 0.5, -0.2, 1.1, 20, -10],
          primitive: { kind: 'ellipse', cx: 30, cy: 40, rx: 20, ry: 35 },
        }),
        alignedFrame,
      ),
    ).toBe(false);
    expect(
      isWebGL2ItemEligible(
        rect({ primitive: { kind: 'circle', cx: 30, cy: 40, r: 20 } }),
        alignedFrame,
      ),
    ).toBe(false);
    expect(
      isWebGL2ItemEligible(rect(), {
        ...alignedFrame,
        camera: { ...alignedFrame.camera, pan: { x: 0.25, y: 0 } },
      }),
    ).toBe(false);
    expect(
      isWebGL2ItemEligible(rect(), {
        ...alignedFrame,
        camera: { ...alignedFrame.camera, rotation: 0.2 },
      }),
    ).toBe(false);
    expect(
      isWebGL2ItemEligible(rect({ transform: [0.8, 0.6, -0.6, 0.8, 100, 0] }), alignedFrame),
    ).toBe(false);
  });

  it('keeps image fills, effects, strokes and blend modes on Canvas2D', () => {
    expect(
      isWebGL2ItemEligible(
        rect({
          fills: [
            {
              type: 'image',
              src: 'asset-test',
              fit: 'fill',
              x: 0,
              y: 0,
              scale: 1,
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
          ],
          primitive: { kind: 'rect', x: 0, y: 0, w: 64, h: 32 },
        }),
        alignedFrame,
      ),
    ).toBe(false);
    expect(
      isWebGL2ItemEligible(
        rect({ strokes: [{} as NonNullable<RenderItem['strokes']>[number]] }),
        alignedFrame,
      ),
    ).toBe(false);
    expect(isWebGL2ItemEligible(rect({ blendMode: 'multiply' }), alignedFrame)).toBe(false);
    expect(
      isWebGL2ItemEligible(
        rect({ effects: [{} as NonNullable<RenderItem['effects']>[number]] }),
        alignedFrame,
      ),
    ).toBe(false);
  });

  it('admits only cached, uncropped stretch image fills on simple rectangles', () => {
    const src = 'webgl2-plain-image-test';
    getImageCache().setLoaded(src, { width: 64, height: 32 } as HTMLImageElement);
    const imageFill: Extract<NonNullable<RenderItem['fills']>[number], { type: 'image' }> = {
      type: 'image',
      src,
      fit: 'stretch',
      x: 0,
      y: 0,
      scale: 1,
      imageWidth: 64,
      imageHeight: 32,
      opacity: 1,
      blendMode: 'normal',
      visible: true,
    };
    const plainImage = rect({
      fill: undefined,
      fills: [imageFill],
      primitive: { kind: 'rect', x: 0, y: 0, w: 64, h: 32 },
    });
    expect(isWebGL2ItemEligible(plainImage, alignedFrame)).toBe(true);
    expect(
      isWebGL2ItemEligible(
        {
          ...plainImage,
          fills: [{ ...imageFill, crop: { x: 0, y: 0, w: 32, h: 32 } }],
        },
        alignedFrame,
      ),
    ).toBe(false);
    expect(
      isWebGL2ItemEligible(
        {
          ...plainImage,
          primitive: { kind: 'ellipse', cx: 50, cy: 40, rx: 50, ry: 40 },
        },
        alignedFrame,
      ),
    ).toBe(false);
  });

  it('fails closed for rounded and singular geometry', () => {
    expect(
      isWebGL2ItemEligible(
        rect({ primitive: { kind: 'rect', x: 0, y: 0, w: 100, h: 80, cornerRadius: 8 } }),
        alignedFrame,
      ),
    ).toBe(false);
    expect(isWebGL2ItemEligible(rect({ transform: [1, 0, 2, 0, 0, 0] }), alignedFrame)).toBe(false);
    expect(
      isWebGL2ItemEligible(rect({ transform: [1, 0.00001, 1000, 0, 0, 0] }), alignedFrame),
    ).toBe(false);
    expect(
      isWebGL2ItemEligible(rect({ transform: [1, 0, 0, 1, Number.NaN, 0] }), alignedFrame),
    ).toBe(false);
    expect(isWebGL2ItemEligible(rect({ opacity: Number.NaN }), alignedFrame)).toBe(false);
  });
});
