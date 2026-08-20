import { createDocument, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  marqueeGeometryHit,
  marqueeRectContainsRect,
  marqueeRectsIntersect,
  normalizeMarqueeRect,
} from './marqueeGeometry';

describe('marquee geometry', () => {
  it('normalizes reverse drags without rounding world coordinates', () => {
    expect(normalizeMarqueeRect({ x: 10.25, y: 30.5 }, { x: -2.75, y: 4.5 })).toEqual({
      x: -2.75,
      y: 4.5,
      w: 13,
      h: 26,
    });
  });

  it('treats boundary contact as intersection but keeps negative sizes invalid', () => {
    expect(marqueeRectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 10, w: 5, h: 5 })).toBe(
      true,
    );
    expect(marqueeRectsIntersect({ x: 0, y: 0, w: -1, h: 10 }, { x: 0, y: 0, w: 5, h: 5 })).toBe(
      false,
    );
  });

  it('uses closed containment and handles fractional edges', () => {
    expect(
      marqueeRectContainsRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 0.25, y: 0.5, w: 9.75, h: 9.5 }),
    ).toBe(true);
    expect(
      marqueeRectContainsRect(
        { x: 0, y: 0, w: 10, h: 10 },
        { x: -Number.EPSILON, y: 0, w: 10, h: 10 },
      ),
    ).toBe(false);
  });

  it('rejects corrupt coordinates before geometry can leak NaN', () => {
    expect(normalizeMarqueeRect({ x: Number.NaN, y: 0 }, { x: 1, y: 1 })).toBeNull();
    expect(
      marqueeRectsIntersect(
        { x: Number.POSITIVE_INFINITY, y: 0, w: 1, h: 1 },
        { x: 0, y: 0, w: 1, h: 1 },
      ),
    ).toBe(false);
  });

  it('rejects a marquee that touches only the AABB corner of a rotated rectangle', () => {
    const base = createDocument('rotated');
    const doc = {
      ...base,
      nodes: {
        ...base.nodes,
        rotated: makeShapeNode(
          'rotated',
          {
            kind: 'rect',
            x: 0,
            y: 0,
            w: 10,
            h: 2,
          },
          { transform: [Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, 0, 0] },
        ),
      },
    };
    expect(marqueeGeometryHit(doc, 'rotated', { x: 5.8, y: 0, w: 1, h: 1 }, false)).toBe(false);
    expect(marqueeGeometryHit(doc, 'rotated', { x: 5.8, y: 6.5, w: 1, h: 1 }, false)).toBe(true);
  });
});
