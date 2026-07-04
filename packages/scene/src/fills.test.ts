/**
 * Tests for the fill system — imageFill, patternFill, gradientFill helpers
 * and Fill type operations.
 */

import {
  fillToColor,
  gradientFill,
  imageFill,
  patternFill,
  primaryColor,
  resolveNodeFills,
  solidFill,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';

describe('fill constructors', () => {
  describe('solidFill', () => {
    it('creates a solid fill with default opacity and blend mode', () => {
      const fill = solidFill({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 });
      expect(fill.type).toBe('solid');
      expect(fill.color).toEqual({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 });
      expect(fill.opacity).toBe(1);
      expect(fill.blendMode).toBe('normal');
      expect(fill.visible).toBe(true);
    });

    it('accepts custom opacity and blend mode', () => {
      const fill = solidFill(
        { space: 'rgb' as const, r: 0, g: 255, b: 0, a: 128 },
        { opacity: 0.5, blendMode: 'multiply' },
      );
      expect(fill.opacity).toBe(0.5);
      expect(fill.blendMode).toBe('multiply');
    });
  });

  describe('gradientFill', () => {
    it('creates a linear gradient with stops', () => {
      const fill = gradientFill('linear', [
        { position: 0, color: { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 } },
        { position: 1, color: { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 } },
      ]);
      expect(fill.type).toBe('gradient');
      expect(fill.gradient?.type).toBe('linear');
      expect(fill.gradient?.stops).toHaveLength(2);
      expect(fill.gradient?.stops[0]?.position).toBe(0);
      expect(fill.gradient?.stops[1]?.position).toBe(1);
    });

    it('creates a radial gradient with rotation', () => {
      const fill = gradientFill(
        'radial',
        [
          { position: 0, color: { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 } },
          { position: 1, color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 } },
        ],
        { rotation: 45 },
      );
      expect(fill.gradient?.type).toBe('radial');
      expect(fill.gradient?.rotation).toBe(45);
    });

    it('does not set rotation by default (undefined)', () => {
      const fill = gradientFill('linear', [
        { position: 0, color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 } },
        { position: 1, color: { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 } },
      ]);
      expect(fill.gradient?.rotation).toBeUndefined();
    });
  });

  describe('imageFill', () => {
    it('creates an image fill with default fit', () => {
      const fill = imageFill('https://example.com/img.png');
      expect(fill.type).toBe('image');
      expect(fill.image?.src).toBe('https://example.com/img.png');
      expect(fill.image?.fit).toBe('fill');
      expect(fill.image?.x).toBe(0);
      expect(fill.image?.y).toBe(0);
      expect(fill.image?.scale).toBe(1);
    });

    it('accepts custom fit and position', () => {
      const fill = imageFill('asset:123', { fit: 'tile', x: 10, y: 20, scale: 2 });
      expect(fill.image?.fit).toBe('tile');
      expect(fill.image?.x).toBe(10);
      expect(fill.image?.y).toBe(20);
      expect(fill.image?.scale).toBe(2);
    });
  });

  describe('patternFill', () => {
    it('creates a pattern fill with defaults', () => {
      const fill = patternFill('tile:abc');
      expect(fill.type).toBe('pattern');
      expect(fill.pattern?.tileSrc).toBe('tile:abc');
      expect(fill.pattern?.spacing).toBe(0);
      expect(fill.pattern?.rotation).toBe(0);
    });

    it('accepts custom spacing and rotation', () => {
      const fill = patternFill('tile:xyz', { spacing: 8, rotation: 90 });
      expect(fill.pattern?.spacing).toBe(8);
      expect(fill.pattern?.rotation).toBe(90);
    });
  });

  describe('fillToColor', () => {
    it('extracts color from solid fill', () => {
      const fill = solidFill({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 });
      const c = fillToColor(fill);
      expect(c).toEqual({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 });
    });

    it('multiplies opacity into alpha for solids', () => {
      const fill = solidFill(
        { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 },
        { opacity: 0.5 },
      );
      const c = fillToColor(fill);
      expect('a' in c ? c.a : 0).toBe(128);
    });

    it('returns first stop color for gradient fill', () => {
      const fill = gradientFill('linear', [
        { position: 0, color: { space: 'rgb' as const, r: 100, g: 200, b: 50, a: 255 } },
        { position: 1, color: { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 } },
      ]);
      const c = fillToColor(fill);
      expect(c).toEqual({ space: 'rgb' as const, r: 100, g: 200, b: 50, a: 255 });
    });

    it('returns transparent for image fill', () => {
      const fill = imageFill('data:image/png;base64,abc');
      const c = fillToColor(fill);
      expect(c).toEqual({ space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 });
    });
  });

  describe('primaryColor', () => {
    it('returns topmost visible solid fill color', () => {
      const fills = [
        solidFill({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 }),
        solidFill({ space: 'rgb' as const, r: 0, g: 255, b: 0, a: 255 }),
      ];
      const c = primaryColor(fills);
      expect(c).toEqual({ space: 'rgb' as const, r: 0, g: 255, b: 0, a: 255 });
    });

    it('skips invisible fills', () => {
      const fills = [
        solidFill({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 }),
        solidFill({ space: 'rgb' as const, r: 0, g: 255, b: 0, a: 255 }, { visible: false }),
        solidFill({ space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 }),
      ];
      const c = primaryColor(fills);
      expect(c).toEqual({ space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 });
    });

    it('returns null for empty array', () => {
      expect(primaryColor([])).toBeNull();
    });

    it('returns first stop color for gradient as topmost', () => {
      const fills = [
        gradientFill('linear', [
          { position: 0, color: { space: 'rgb' as const, r: 100, g: 50, b: 200, a: 255 } },
          { position: 1, color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 } },
        ]),
      ];
      const c = primaryColor(fills);
      expect(c).toEqual({ space: 'rgb' as const, r: 100, g: 50, b: 200, a: 255 });
    });
  });

  describe('resolveNodeFills', () => {
    it('returns fills array when present', () => {
      const node = {
        fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
        fills: [solidFill({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 })],
      };
      const result = resolveNodeFills(node);
      expect(result).toHaveLength(1);
      expect(result[0]?.color).toEqual({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 });
    });

    it('wraps legacy fill when fills is absent', () => {
      const node = {
        fill: { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 },
      };
      const result = resolveNodeFills(node);
      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe('solid');
      if (result[0]?.type === 'solid') {
        expect(result[0]?.color).toEqual({ space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 });
      }
    });

    it('wraps legacy fill when fills is empty array', () => {
      const node = {
        fill: { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 },
        fills: [],
      };
      const result = resolveNodeFills(node);
      expect(result).toHaveLength(1);
      expect(result[0]?.color).toEqual({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 });
    });
  });

  describe('angular/diamond gradient constructors', () => {
    it('creates angular gradient fill', () => {
      const fill = gradientFill('angular', [
        { position: 0, color: { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 } },
        { position: 0.5, color: { space: 'rgb' as const, r: 0, g: 255, b: 0, a: 255 } },
        { position: 1, color: { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 } },
      ]);
      expect(fill.gradient?.type).toBe('angular');
      expect(fill.gradient?.stops).toHaveLength(3);
    });

    it('creates diamond gradient fill', () => {
      const fill = gradientFill('diamond', [
        { position: 0, color: { space: 'rgb' as const, r: 255, g: 255, b: 0, a: 255 } },
        { position: 1, color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 } },
      ]);
      expect(fill.gradient?.type).toBe('diamond');
    });
  });
});
