import type { RenderItem } from '@varve/engine';
import {
  clearProofConverters,
  type ProofTransformConfig,
  registerProfileProofConverter,
  registerProfileProofConverterNormalized,
} from '@varve/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyProofToIr, applyProofToItem } from './proofing';

const config: ProofTransformConfig = {
  profileId: 'fogra39',
  renderingIntent: 'relative',
  blackPointCompensation: true,
  simulatePaperColor: false,
  simulateBlackInk: false,
};

function rgbItem(overrides: Partial<RenderItem> = {}): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
    primitive: { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    ...overrides,
  };
}

beforeEach(clearProofConverters);

describe('applyProofToItem', () => {
  it('returns the item unchanged when proofing is unavailable', () => {
    const item = rgbItem();
    expect(applyProofToItem(item, config)).toBe(item);
  });

  it('proofs fills, strokes, effects, gradient stops, and text run colors', () => {
    registerProfileProofConverter('fogra39', (rgba) => [
      rgba[0],
      Math.round(rgba[1] * 0.5),
      rgba[2],
      rgba[3],
    ]);
    const item = rgbItem({
      strokes: [{ color: { space: 'rgb', r: 0, g: 255, b: 0, a: 255 } } as never],
      effects: [
        { type: 'dropShadow', color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } } as never,
      ],
      fills: [
        {
          type: 'solid',
          color: { space: 'rgb', r: 10, g: 20, b: 30, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
        {
          type: 'gradient',
          gradientType: 'linear',
          stops: [{ position: 0, color: { space: 'rgb', r: 1, g: 2, b: 3, a: 255 } }],
          rotation: 0,
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
      primitive: {
        kind: 'text',
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        text: 'hi',
        fontSize: 12,
        fontFamily: 'sans',
        fontWeight: 400,
        fontStyle: 'normal',
        textAlign: 'left',
        textAlignVertical: 'top',
        letterSpacing: 0,
        lineHeight: 1.2,
        paragraphSpacing: 0,
        textCase: 'none',
        textDecoration: 'none',
        textOverflow: 'clip',
        listStyle: 'none',
        richText: {
          paragraphs: [
            {
              runs: [{ text: 'hi', format: { color: { space: 'rgb', r: 5, g: 6, b: 7, a: 255 } } }],
            },
          ],
        },
      },
    });
    const out = applyProofToItem(item, config);
    expect(out.fill).toEqual({ space: 'rgb', r: 255, g: 0, b: 0, a: 255 });
    const stroke = out.strokes?.[0];
    expect(stroke && 'color' in stroke ? stroke.color : null).toEqual({
      space: 'rgb',
      r: 0,
      g: 128,
      b: 0,
      a: 255,
    });
    const effect = out.effects?.[0];
    expect(effect && 'color' in effect ? effect.color : null).toEqual({
      space: 'rgb',
      r: 0,
      g: 0,
      b: 255,
      a: 255,
    });
    const solid = out.fills?.[0];
    expect(solid && solid.type === 'solid' ? solid.color : null).toEqual({
      space: 'rgb',
      r: 10,
      g: 10,
      b: 30,
      a: 255,
    });
    const gradient = out.fills?.[1];
    if (gradient && gradient.type === 'gradient') {
      expect(gradient.stops[0]?.color).toEqual({ space: 'rgb', r: 1, g: 1, b: 3, a: 255 });
    }
    if (out.primitive.kind === 'text' && out.primitive.richText) {
      const runColor = out.primitive.richText.paragraphs[0]?.runs[0]?.format?.color;
      expect(runColor).toEqual({ space: 'rgb', r: 5, g: 3, b: 7, a: 255 });
    }
    clearProofConverters();
  });

  it('never mutates the source item', () => {
    registerProfileProofConverter('fogra39', (rgba) => [...rgba]);
    const item = rgbItem({
      fills: [
        {
          type: 'solid',
          color: { space: 'rgb', r: 1, g: 2, b: 3, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
    });
    applyProofToItem(item, config);
    expect(item.fill).toEqual({ space: 'rgb', r: 255, g: 0, b: 0, a: 255 });
    clearProofConverters();
  });

  it('prefers the normalized provider for high-precision colors', () => {
    registerProfileProofConverterNormalized('fogra39', ([r, g, b, a]) => [r + 0.01, g, b, a]);
    const item = rgbItem({
      fill: { space: 'rgb', bitDepth: 'float32', r: 0.1234, g: 0.5, b: 0.75, a: 1 },
    });
    const out = applyProofToItem(item, config);
    expect(out.fill).toEqual({
      space: 'rgb',
      bitDepth: 'float32',
      r: 0.1334,
      g: 0.5,
      b: 0.75,
      a: 1,
    });
    expect(item.fill).toEqual({
      space: 'rgb',
      bitDepth: 'float32',
      r: 0.1234,
      g: 0.5,
      b: 0.75,
      a: 1,
    });
    clearProofConverters();
  });
});

describe('applyProofToIr', () => {
  it('returns the same array identity when nothing changed', () => {
    const ir = [rgbItem()];
    expect(applyProofToIr(ir, config)).toBe(ir);
  });

  it('returns a new array with proofed items when a converter is registered', () => {
    registerProfileProofConverter('fogra39', (rgba) => [...rgba]);
    const ir = [rgbItem()];
    const out = applyProofToIr(ir, config);
    expect(out).not.toBe(ir);
    expect(out[0]).not.toBe(ir[0]);
    clearProofConverters();
  });
});
