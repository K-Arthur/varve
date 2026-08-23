import { describe, expect, it } from 'vitest';
import { translate } from '@varve/shared';
import {
  areaSelectionBounds,
  areaSelectionCoverageAt,
  areaSelectionToPath,
  createAreaSelection,
  transformAreaSelection,
  type PathCommand,
} from './areaSelection';

const rectPath = (tx = 0, ty = 0): ReturnType<typeof createAreaSelection> =>
  createAreaSelection({
    kind: 'path',
    commands: [
      { type: 'move', x: 0, y: 0 },
      { type: 'line', x: 10, y: 0 },
      { type: 'line', x: 10, y: 10 },
      { type: 'line', x: 0, y: 10 },
      { type: 'close' },
    ],
    transform: [1, 0, 0, 1, tx, ty],
    feather: 0,
    antialias: false,
  });

describe('Phase 5 — Path → Selection', () => {
  it('evaluates a rectangular path as a filled region', () => {
    const sel = rectPath();
    expect(sel).not.toBeNull();
    expect(areaSelectionCoverageAt(sel!, { x: 5, y: 5 })).toBe(1);
    expect(areaSelectionCoverageAt(sel!, { x: 15, y: 5 })).toBe(0);
    expect(areaSelectionBounds(sel!.expression)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it('approximates a Bézier circle as a filled region', () => {
    const k = 0.5522847498 * 5;
    const sel = createAreaSelection({
      kind: 'path',
      commands: [
        { type: 'move', x: 10, y: 5 },
        { type: 'curve', cx1: 10, cy1: 5 - k, cx2: 5 + k, cy2: 0, x: 5, y: 0 },
        { type: 'curve', cx1: 5 - k, cy1: 0, cx2: 0, cy2: 5 - k, x: 0, y: 5 },
        { type: 'curve', cx1: 0, cy1: 5 + k, cx2: 5 - k, cy2: 10, x: 5, y: 10 },
        { type: 'curve', cx1: 5 + k, cy1: 10, cx2: 10, cy2: 5 + k, x: 10, y: 5 },
        { type: 'close' },
      ],
      transform: [1, 0, 0, 1, 0, 0],
      feather: 0,
      antialias: false,
    });
    expect(sel).not.toBeNull();
    expect(areaSelectionCoverageAt(sel!, { x: 5, y: 5 })).toBe(1); // centre
    expect(areaSelectionCoverageAt(sel!, { x: 5, y: 9.4 })).toBe(1); // well inside
    expect(areaSelectionCoverageAt(sel!, { x: 5, y: 11 })).toBe(0); // outside
    expect(areaSelectionCoverageAt(sel!, { x: 11, y: 5 })).toBe(0); // outside
  });

  it('composes a transform instead of re-flattening curves', () => {
    const sel = rectPath();
    const moved = transformAreaSelection(sel!, translate(5, 0));
    expect(areaSelectionCoverageAt(moved, { x: 12, y: 5 })).toBe(1); // now 5..15
    expect(areaSelectionCoverageAt(moved, { x: 2, y: 5 })).toBe(0); // original span left behind
  });

  it('rejects malformed paths', () => {
    expect(
      createAreaSelection({
        kind: 'path',
        commands: [{ type: 'move', x: 0, y: 0 }],
        transform: [1, 0, 0, 1, 0, 0],
        feather: 0,
        antialias: false,
      }),
    ).toBeNull();
    expect(
      createAreaSelection({
        kind: 'path',
        commands: [
          { type: 'move', x: NaN, y: 0 },
          { type: 'line', x: 1, y: 1 },
        ],
        transform: [1, 0, 0, 1, 0, 0],
        feather: 0,
        antialias: false,
      }),
    ).toBeNull();
  });
});

describe('Phase 5 — Selection → Path', () => {
  it('emits a 4-vertex polygon for a rectangle', () => {
    const sel = createAreaSelection({
      kind: 'rectangle',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      feather: 0,
      antialias: false,
    })!;
    const path = areaSelectionToPath(sel);
    expect(path[0]!.type).toBe('move');
    expect(path.filter((c) => c.type === 'line').length).toBe(3);
    expect(path[path.length - 1]!.type).toBe('close');
  });

  it('emits a 48-vertex polygon for an ellipse', () => {
    const sel = createAreaSelection({
      kind: 'ellipse',
      x: 0,
      y: 0,
      w: 20,
      h: 10,
      feather: 0,
      antialias: false,
    })!;
    const path = areaSelectionToPath(sel);
    expect(path.filter((c) => c.type === 'line').length).toBe(47);
    expect(path[path.length - 1]!.type).toBe('close');
  });

  it('emits the polygon vertices in order', () => {
    const sel = createAreaSelection({
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 },
      ],
      feather: 0,
      antialias: false,
    })!;
    const path = areaSelectionToPath(sel);
    expect(path[0]).toEqual({ type: 'move', x: 0, y: 0 });
    expect(path.filter((c) => c.type === 'line').length).toBe(2);
    expect(path[path.length - 1]!.type).toBe('close');
  });

  it('maps path commands into document space via transform', () => {
    const sel = rectPath(3, 0)!;
    const path = areaSelectionToPath(sel);
    const first = path[0] as PathCommand & { x: number; y: number };
    expect(first.x).toBe(3);
    expect(first.y).toBe(0);
  });

  it('round-trips a rectangular path through toPath and back', () => {
    const sel = rectPath()!;
    const path = areaSelectionToPath(sel);
    const back = createAreaSelection({
      kind: 'path',
      commands: path,
      transform: [1, 0, 0, 1, 0, 0],
      feather: 0,
      antialias: false,
    });
    expect(back).not.toBeNull();
    expect(areaSelectionCoverageAt(back!, { x: 5, y: 5 })).toBe(1);
    expect(areaSelectionCoverageAt(back!, { x: 15, y: 5 })).toBe(0);
  });

  it('traces a filled raster mask into a closed path that re-covers the interior', () => {
    const data = new Uint8Array(100).fill(255);
    const sel = createAreaSelection({
      kind: 'raster-mask',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      width: 10,
      height: 10,
      data,
      boundary: [],
      transform: [1, 0, 0, 1, 0, 0],
      inverseTransform: [1, 0, 0, 1, 0, 0],
      feather: 0,
      antialias: false,
    })!;
    const path = areaSelectionToPath(sel);
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]!.type).toBe('close');
    const back = createAreaSelection({
      kind: 'path',
      commands: path,
      transform: [1, 0, 0, 1, 0, 0],
      feather: 0,
      antialias: false,
    });
    expect(back).not.toBeNull();
    expect(areaSelectionCoverageAt(back!, { x: 5, y: 5 })).toBe(1); // centre
    expect(areaSelectionCoverageAt(back!, { x: 9.5, y: 9.5 })).toBeGreaterThan(0.5); // near corner
  });
});
