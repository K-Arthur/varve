/**
 * Tests for the enhanced flattening analysis v2.1.
 */

import { createDocument, makeFrameNode, makeShapeNode, makeTextNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { canEmitAsHtml, getRenderCapability } from '../flattening';

describe('flattening v2.1 — getRenderCapability', () => {
  it('returns full for simple rect', () => {
    const doc = createDocument('Test');
    const rect = makeShapeNode('r1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const cleanRect = { ...rect, fills: [], strokes: [], effects: [] };

    const result = getRenderCapability(cleanRect, doc);
    expect(result.capability).toBe('full');
    expect(result.reasons).toHaveLength(0);
  });

  it('returns raster-required for adjustment layers', () => {
    const doc = createDocument('Test');
    const adj = {
      id: 'adj1',
      kind: 'adjustment' as const,
      name: 'Curves',
      adjustmentType: 'curves' as const,
      order: 'a0',
      rotation: 0,
      clipping: false,
      params: {
        channel: 'rgb' as const,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
      adjustments: [
        {
          kind: 'curves' as const,
          id: 'a1',
          channel: 'rgb' as const,
          points: [
            { input: 0, output: 0 },
            { input: 1, output: 1 },
          ],
          visible: true,
          opacity: 1,
          blendMode: 'normal' as const,
        },
      ],
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
      transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
      fills: [],
      strokes: [],
      effects: [],
    };

    const result = getRenderCapability(adj, doc);
    expect(result.capability).toBe('raster-required');
    expect(result.reasons).toContain('adjustment-layer');
  });

  it('returns partial for frames (containers)', () => {
    const doc = createDocument('Test');
    const frame = makeFrameNode('f1', { name: 'Frame', w: 200, h: 200 });

    const result = getRenderCapability(frame, doc);
    expect(result.capability).toBe('full');
  });
});

describe('flattening v2.1 — canEmitAsHtml', () => {
  it('returns native for simple text', () => {
    const doc = createDocument('Test');
    const text = makeTextNode('t1', 'Hello', { fontSize: 16 });

    const result = canEmitAsHtml(text, doc);
    expect(result.canEmit).toBe(true);
    expect(result.emitAs).toBe('native');
  });

  it('returns image for adjustment layers', () => {
    const doc = createDocument('Test');
    const adj = {
      id: 'adj1',
      kind: 'adjustment' as const,
      name: 'Curves',
      adjustmentType: 'curves' as const,
      order: 'a0',
      rotation: 0,
      clipping: false,
      params: {
        channel: 'rgb' as const,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
      adjustments: [
        {
          kind: 'curves' as const,
          id: 'a1',
          channel: 'rgb' as const,
          points: [
            { input: 0, output: 0 },
            { input: 1, output: 1 },
          ],
          visible: true,
          opacity: 1,
          blendMode: 'normal' as const,
        },
      ],
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
      transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
      fills: [],
      strokes: [],
      effects: [],
    };

    const result = canEmitAsHtml(adj, doc);
    expect(result.canEmit).toBe(false);
    expect(result.emitAs).toBe('image');
  });
});
