import type { Effect, ShapeNode } from '@strata/scene';
import { makeShapeNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { buildEffectSpec } from '../ir-builders';

function nodeWithEffects(effects: Effect[]): ShapeNode {
  return makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Box', effects });
}

describe('buildEffectSpec', () => {
  it('maps scene dropShadow x/y/blur to codegen offsetX/offsetY/radius', () => {
    const spec = buildEffectSpec(
      nodeWithEffects([
        {
          type: 'dropShadow',
          x: 6,
          y: -3,
          blur: 12,
          spread: 2,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 128 },
          opacity: 0.5,
          blendMode: 'normal',
          visible: true,
        },
      ]),
    );

    expect(spec).toHaveLength(1);
    const shadow = spec[0];
    expect(shadow?.type).toBe('drop-shadow');
    if (shadow?.type === 'drop-shadow') {
      expect(shadow.offsetX).toBe(6);
      expect(shadow.offsetY).toBe(-3);
      expect(shadow.radius).toBe(12);
      expect(shadow.spread).toBe(2);
      expect(shadow.inset).toBe(false);
    }
  });

  it('maps innerShadow to an inset spec with offset/blur', () => {
    const spec = buildEffectSpec(
      nodeWithEffects([
        {
          type: 'innerShadow',
          x: 2,
          y: 4,
          blur: 8,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ]),
    );

    const shadow = spec[0];
    expect(shadow?.type).toBe('inner-shadow');
    if (shadow?.type === 'inner-shadow') {
      expect(shadow.offsetX).toBe(2);
      expect(shadow.offsetY).toBe(4);
      expect(shadow.radius).toBe(8);
      expect(shadow.inset).toBe(true);
    }
  });

  it('skips invisible effects', () => {
    const spec = buildEffectSpec(
      nodeWithEffects([
        {
          type: 'dropShadow',
          x: 0,
          y: 0,
          blur: 8,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: false,
        },
      ]),
    );
    expect(spec).toHaveLength(0);
  });
});
