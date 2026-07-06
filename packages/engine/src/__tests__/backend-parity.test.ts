/**
 * Backend IR parity — stub engine produces consistent structural output.
 */
import { describe, expect, it } from 'vitest';
import { createEngine } from '../engine';
import type { SceneNode } from '../types';

const TEXT_NODE: SceneNode = {
  id: 't1',
  name: 'Title',
  kind: 'text',
  text: 'Hello',
  fontSize: 16,
  fontFamily: 'Inter',
  transform: [1, 0, 0, 1, 0, 0],
  shape: {
    kind: 'text',
    text: 'Hello',
    fontSize: 16,
    fontFamily: 'Inter',
    fontWeight: 400,
    fontStyle: 'normal',
    textAlign: 'left',
    x: 0,
    y: 0,
    w: 80,
    h: 20,
  } as unknown as SceneNode['shape'],
};

const ADJUSTMENT_AS_FILTER: SceneNode = {
  id: 'a1',
  name: 'Exposure',
  transform: [1, 0, 0, 1, 0, 0],
  shape: { kind: 'rect', x: 0, y: 0, w: 0, h: 0 },
  opacity: 0,
  filters: [
    { kind: 'exposure', value: 0.5, offset: 0, gammaCorrection: 1, opacity: 1, blendMode: 'normal' },
  ],
};

describe('backend IR parity (stub)', () => {
  it('text node with shape wrapper builds text primitive', async () => {
    const eng = await createEngine('stub');
    const ir = await eng.buildIr({ nodes: [TEXT_NODE] });
    expect(ir[0]?.primitive.kind).toBe('text');
    if (ir[0]?.primitive.kind === 'text') {
      expect(ir[0].primitive.text).toBe('Hello');
    }
  });

  it('adjustment-style filter node passes filters through IR', async () => {
    const eng = await createEngine('stub');
    const ir = await eng.buildIr({ nodes: [ADJUSTMENT_AS_FILTER] });
    expect(ir[0]?.filters?.[0]?.kind).toBe('exposure');
  });

  it('path shape node builds path primitive', async () => {
    const eng = await createEngine('stub');
    const ir = await eng.buildIr({
      nodes: [
        {
          id: 'p1',
          name: 'Path',
          transform: [1, 0, 0, 1, 0, 0],
          shape: {
            kind: 'path',
            points: [
              { x: 0, y: 0, handleIn: null, handleOut: null },
              { x: 100, y: 0, handleIn: null, handleOut: null },
            ],
            closed: false,
            tolerance: 4,
          },
        },
      ],
    });
    expect(ir[0]?.primitive.kind).toBe('path');
  });
});
