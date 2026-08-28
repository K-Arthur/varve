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
} from '@varve/scene';
import { describe, expect, it } from 'vitest';

describe('solidFill', () => {
  it('creates a solid fill', () => {
    const fill = solidFill({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 });
    expect(fill.type).toBe('solid');
    expect(fill.color).toEqual({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 });
    expect(fill.opacity).toBe(1);
    expect(fill.blendMode).toBe('normal');
    expect(fill.visible).toBe(true);
  });

  it('accepts custom opacity, blendMode, and visibility', () => {
    const fill = solidFill(
      { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
      { opacity: 0.5, blendMode: 'multiply' as const, visible: false },
    );
    expect(fill.opacity).toBe(0.5);
    expect(fill.blendMode).toBe('multiply');
    expect(fill.visible).toBe(false);
  });
});

describe('gradientFill', () => {
  it('creates a linear gradient fill', () => {
    const fill = gradientFill('linear', [
      { position: 0, color: { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 } },
      { position: 1, color: { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 } },
    ]);
    expect(fill.type).toBe('gradient');
    expect(fill.gradient?.type).toBe('linear');
    expect(fill.gradient?.stops).toHaveLength(2);
  });

  it('accepts an explicit affine fill transform', () => {
    const transform = [120, 30, -10, 60, 12, 8] as const;
    const fill = gradientFill(
      'radial',
      [{ position: 0, color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 } }],
      { transform },
    );
    expect(fill.gradient?.transform).toEqual(transform);
    expect(fill.gradient?.rotation).toBeUndefined();
  });
});

describe('imageFill', () => {
  it('creates an image fill', () => {
    const fill = imageFill('https://example.com/img.png');
    expect(fill.type).toBe('image');
    expect(fill.image?.src).toBe('https://example.com/img.png');
    expect(fill.image?.fit).toBe('fill');
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

  it('accepts imageWidth and imageHeight overrides', () => {
    const fill = patternFill('tile:abc', { imageWidth: 64, imageHeight: 48 });
    expect(fill.pattern?.imageWidth).toBe(64);
    expect(fill.pattern?.imageHeight).toBe(48);
  });
});

describe('fillToColor', () => {
  it('extracts color from solid fill', () => {
    const fill = solidFill({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 });
    const c = fillToColor(fill);
    expect(c).toEqual({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 });
  });

  it('multiplies opacity into alpha for solids', () => {
    const fill = solidFill({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 }, { opacity: 0.5 });
    const c = fillToColor(fill);
    expect(c.a).toBe(128);
  });
});

describe('primaryColor', () => {
  it('returns the topmost visible solid fill color', () => {
    const fills = [
      solidFill({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 }),
      solidFill({ space: 'rgb' as const, r: 0, g: 255, b: 0, a: 255 }),
    ];
    const c = primaryColor(fills);
    expect(c).toEqual({ space: 'rgb' as const, r: 0, g: 255, b: 0, a: 255 });
  });

  it('skips invisible fills', () => {
    const fills = [
      solidFill({ space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 }, { visible: false }),
      solidFill({ space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 }),
    ];
    const c = primaryColor(fills);
    expect(c).toEqual({ space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 });
  });

  it('returns first stop for gradient fills', () => {
    const fills = [
      gradientFill('linear', [
        { position: 0, color: { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 } },
        { position: 1, color: { space: 'rgb' as const, r: 37, g: 99, b: 235, a: 255 } },
      ]),
    ];
    const c = primaryColor(fills);
    expect(c).toEqual({ space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 });
  });

  it('returns null when no visible fills', () => {
    const fills = [
      solidFill({ space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 }, { visible: false }),
    ];
    expect(primaryColor(fills)).toBeNull();
  });
});

describe('resolveNodeFills', () => {
  it('prefers fills array over legacy fill', () => {
    const fillsArr = [solidFill({ space: 'rgb' as const, r: 0, g: 255, b: 0, a: 255 })];
    const node = {
      fill: { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 },
      fills: fillsArr,
    };
    const resolved = resolveNodeFills(node);
    expect(resolved).toEqual(fillsArr);
  });

  it('falls back to legacy fill wrapped in array', () => {
    const node = {
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 },
    };
    const resolved = resolveNodeFills(node);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.type).toBe('solid');
    expect(resolved[0]?.color).toEqual({ space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 });
  });
});
