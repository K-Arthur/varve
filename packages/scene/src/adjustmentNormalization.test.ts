import { describe, expect, it } from 'vitest';
import { normalizeAdjustmentStack } from './adjustmentNormalization';
import { createDocument, makeAdjustmentNode } from './document';
import { DocumentCodec } from './documentCodec';

describe('adjustment normalization', () => {
  it('fills defaults, clamps unsafe values, and keeps a stable id', () => {
    const result = normalizeAdjustmentStack(
      [
        {
          kind: 'levels',
          visible: 'yes',
          opacity: Number.NaN,
          blendMode: 'not-a-blend-mode',
          inputShadows: -50,
          inputMidtones: Number.POSITIVE_INFINITY,
          inputHighlights: 999,
          outputShadows: 4,
          outputHighlights: 250,
          channel: 'not-a-channel',
        },
      ],
      'layer-1',
    );

    expect(result.dropped).toBe(0);
    expect(result.changed).toBe(true);
    expect(result.adjustments[0]).toMatchObject({
      id: 'adj-layer-1-1',
      kind: 'levels',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      inputShadows: 0,
      inputMidtones: 1,
      inputHighlights: 255,
      channel: 'rgb',
    });
  });

  it('normalizes curve coordinates and opacity stops without changing their schema', () => {
    const result = normalizeAdjustmentStack(
      [
        {
          id: 'curves-1',
          kind: 'curves',
          points: [
            { input: -1, output: 300 },
            { input: Number.NaN, output: 50 },
          ],
        },
        {
          id: 'map-1',
          kind: 'gradientMap',
          stops: [{ position: 4, color: [300, -1, 20, 999] }],
          opacityStops: [{ position: -2, opacity: 4 }],
        },
      ],
      'node-1',
    );

    expect(result.adjustments[0]).toMatchObject({
      points: [
        { input: 0, output: 255 },
        { input: 0, output: 50 },
      ],
    });
    const gradient = result.adjustments[1] as unknown as {
      stops: Array<{ color: number[] }>;
      opacityStops: Array<{ opacity: number }>;
    };
    expect(gradient.stops[0]?.color).toEqual([255, 0, 20, 255]);
    expect(gradient.opacityStops[0]).toMatchObject({ position: 0, opacity: 1 });
    expect(gradient.opacityStops[0]).not.toHaveProperty('color');
  });

  it('clamps Shadow / Highlight controls before they reach the renderer', () => {
    const result = normalizeAdjustmentStack(
      [
        {
          id: 'shadow-1',
          kind: 'shadowHighlight',
          shadows: 900,
          highlights: -20,
          tonalWidth: Number.NaN,
          midpoint: Number.POSITIVE_INFINITY,
        },
      ],
      'layer-1',
    );
    expect(result.adjustments[0]).toMatchObject({
      shadows: 100,
      highlights: 0,
      tonalWidth: 50,
      midpoint: 50,
    });
  });

  it('drops unknown entries and repairs adjustment stacks at the codec boundary', () => {
    const doc = createDocument('Malformed adjustments', true);
    const adjustmentNode = makeAdjustmentNode('layer-1', 'levels', {
      channel: 'rgb',
      inputBlack: 0,
      inputWhite: 255,
      gamma: 1,
      outputBlack: 0,
      outputWhite: 255,
    });
    const malformed = {
      ...adjustmentNode,
      adjustments: [{ kind: 'unknown-filter' }, { kind: 'brightness', value: 9999, opacity: 0.5 }],
    } as typeof adjustmentNode;
    const normalized = DocumentCodec.normalize({
      ...doc,
      rootChildren: ['layer-1'],
      nodes: { 'layer-1': malformed },
    }).document;

    const stack = (normalized.nodes['layer-1'] as typeof adjustmentNode).adjustments ?? [];
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({ kind: 'brightness', value: 100, opacity: 0.5 });
  });
});
