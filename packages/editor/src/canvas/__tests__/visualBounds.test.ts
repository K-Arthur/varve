import {
  createDocument,
  type Document,
  makePathNode,
  makeShapeNode,
  makeTextNode,
  type Stroke,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  type Appearance,
  appearancePaddingLocal,
  appearancePaddingWorld,
  expandRect,
  nodeVisualWorldBounds,
} from '../visualBounds';

const STROKE = (overrides: Partial<Stroke> = {}): Stroke => ({
  color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
  weight: 10,
  align: 'center',
  dashPattern: [],
  dashOffset: 0,
  cap: 'round',
  join: 'miter',
  miterLimit: 4,
  visible: true,
  ...overrides,
});

describe('appearancePaddingLocal', () => {
  it('returns zero for a bare node without strokes or effects', () => {
    expect(appearancePaddingLocal({ transform: [1, 0, 0, 1, 0, 0] })).toBe(0);
  });

  it('expands center-aligned strokes by half the weight', () => {
    expect(appearancePaddingLocal({ transform: [1, 0, 0, 1, 0, 0], strokes: [STROKE()] })).toBe(5);
  });

  it('expands outside strokes by the full weight and inside strokes by zero', () => {
    expect(
      appearancePaddingLocal({
        transform: [1, 0, 0, 1, 0, 0],
        strokes: [STROKE({ align: 'outside' })],
      }),
    ).toBe(10);
    expect(
      appearancePaddingLocal({
        transform: [1, 0, 0, 1, 0, 0],
        strokes: [STROKE({ align: 'inside' })],
      }),
    ).toBe(0);
  });

  it('uses the widest per-side weight', () => {
    expect(
      appearancePaddingLocal({
        transform: [1, 0, 0, 1, 0, 0],
        strokes: [STROKE({ perSideWeights: [1, 2, 30, 4] })],
      }),
    ).toBe(15);
  });

  it('bounds rect miter spikes by one stroke weight (90-degree corners)', () => {
    const padding = appearancePaddingLocal({
      transform: [1, 0, 0, 1, 0, 0],
      kind: 'shape',
      shape: { kind: 'rect' },
      strokes: [STROKE()],
    });
    // weight/2 base + ~0.41 weight miter → conservative bound of 1 weight.
    expect(padding).toBe(10);
  });

  it('uses the full miter cap for path shapes with acute joins', () => {
    const padding = appearancePaddingLocal({
      transform: [1, 0, 0, 1, 0, 0],
      kind: 'shape',
      shape: { kind: 'path' },
      strokes: [STROKE()],
    });
    // weight × (miterLimit − 0.5) = 10 × 3.5.
    expect(padding).toBe(35);
  });

  it('honours a larger miterLimit', () => {
    const padding = appearancePaddingLocal({
      transform: [1, 0, 0, 1, 0, 0],
      kind: 'shape',
      shape: { kind: 'path' },
      strokes: [STROKE({ miterLimit: 8 })],
    });
    expect(padding).toBe(75);
  });

  it('skips miter expansion for round and bevel joins', () => {
    for (const join of ['round', 'bevel'] as const) {
      const padding = appearancePaddingLocal({
        transform: [1, 0, 0, 1, 0, 0],
        kind: 'shape',
        shape: { kind: 'path' },
        strokes: [STROKE({ join })],
      });
      expect(padding, join).toBe(5);
    }
  });

  it('skips miter expansion for rounded rects', () => {
    const padding = appearancePaddingLocal({
      transform: [1, 0, 0, 1, 0, 0],
      kind: 'shape',
      shape: { kind: 'rect' },
      cornerRadius: 8,
      strokes: [STROKE()],
    });
    expect(padding).toBe(5);
  });

  it('adds arrowhead padding for line shapes with arrow strokes', () => {
    const padding = appearancePaddingLocal({
      transform: [1, 0, 0, 1, 0, 0],
      kind: 'shape',
      shape: { kind: 'line' },
      strokes: [STROKE({ arrowEnd: 'arrow' })],
    });
    // max(weight*3, 4) = 30.
    expect(padding).toBe(30);
  });

  it('caps arrow-primitive arrowheads at six times the weight', () => {
    const padding = appearancePaddingLocal({
      transform: [1, 0, 0, 1, 0, 0],
      kind: 'shape',
      shape: { kind: 'arrow' },
      strokes: [STROKE()],
    });
    expect(padding).toBe(60);
  });

  it('does not add arrowhead padding for closed shapes', () => {
    const padding = appearancePaddingLocal({
      transform: [1, 0, 0, 1, 0, 0],
      kind: 'shape',
      shape: { kind: 'rect' },
      strokes: [STROKE({ arrowEnd: 'arrow' })],
    });
    expect(padding).toBe(10);
  });

  it('adds a font-size-proportional glyph margin for text', () => {
    const padding = appearancePaddingLocal({
      transform: [1, 0, 0, 1, 0, 0],
      kind: 'text',
      fontSize: 100,
      letterSpacing: 4,
    });
    expect(padding).toBe(24);
  });

  it('expands for drop shadow offsets plus the blur kernel', () => {
    const padding = appearancePaddingLocal({
      transform: [1, 0, 0, 1, 0, 0],
      effects: [
        {
          type: 'dropShadow',
          x: 12,
          y: -8,
          blur: 10,
          spread: 2,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
    });
    expect(padding).toBe(12 + 30 + 2);
  });

  it('ignores invisible effects', () => {
    const padding = appearancePaddingLocal({
      transform: [1, 0, 0, 1, 0, 0],
      effects: [
        {
          type: 'dropShadow',
          x: 100,
          y: 0,
          blur: 100,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: false,
        },
      ],
    });
    expect(padding).toBe(0);
  });
});

describe('appearancePaddingWorld', () => {
  it('scales local padding by the maximum axis scale', () => {
    const appearance: Appearance = {
      transform: [2, 0, 0, 3, 0, 0],
      kind: 'shape',
      shape: { kind: 'rect' },
      strokes: [STROKE()],
    };
    expect(appearancePaddingLocal(appearance)).toBe(10);
    expect(appearancePaddingWorld(appearance, [2, 0, 0, 3, 0, 0])).toBe(30);
  });

  it('never scales below 1× under rotation', () => {
    expect(appearancePaddingWorld({ transform: [1, 0, 0, 1, 0, 0] }, [0, 1, -1, 0, 0, 0])).toBe(0);
  });
});

describe('expandRect', () => {
  it('expands outward in all directions', () => {
    expect(expandRect({ x: 10, y: 20, w: 100, h: 50 }, 5)).toEqual({
      x: 5,
      y: 15,
      w: 110,
      h: 60,
    });
  });

  it('sanitizes non-finite padding', () => {
    expect(expandRect({ x: 0, y: 0, w: 10, h: 10 }, Number.NaN)).toEqual({
      x: 0,
      y: 0,
      w: 10,
      h: 10,
    });
  });
});

describe('nodeVisualWorldBounds', () => {
  function buildDocument(): Document {
    const document = createDocument('bounds', true);
    const nodes = [
      makeShapeNode(
        'rect-1',
        { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
        {
          strokes: [STROKE({ weight: 20 })],
        },
      ),
      makePathNode('path-1', {
        closed: true,
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: null },
          { x: 100, y: 0, handleIn: null, handleOut: null },
          { x: 50, y: 80, handleIn: null, handleOut: null },
        ],
        strokes: [STROKE({ weight: 20 })],
      }),
      makeTextNode('text-1', 'Strata', { fontSize: 64, w: 200, h: 40 }),
    ];
    return {
      ...document,
      nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
      rootChildren: nodes.map((node) => node.id),
    };
  }

  it('includes stroke, miter and glyph expansion in world bounds', () => {
    const document = buildDocument();
    const rect = nodeVisualWorldBounds(document, 'rect-1');
    // weight 20, rect miter bound 20 → padding 20 each side.
    expect(rect).toEqual({ x: -20, y: -20, w: 140, h: 140 });

    const path = nodeVisualWorldBounds(document, 'path-1');
    // weight 20 × (4 − 0.5) = 70.
    expect(path).not.toBeNull();
    expect(path!.x).toBe(-70);
    expect(path!.y).toBe(-70);

    const text = nodeVisualWorldBounds(document, 'text-1');
    // fontSize 64 × 0.2 = 12.8.
    expect(text).not.toBeNull();
    expect(text!.x).toBeCloseTo(-12.8, 5);
    expect(text!.w).toBeCloseTo(200 + 25.6, 5);
  });
});
