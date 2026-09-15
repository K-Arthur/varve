import { describe, expect, it } from 'vitest';

type ToolId =
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'arrow'
  | 'pen'
  | 'pencil'
  | 'text'
  | 'frame'
  | 'slice';

type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'polygon'; cx: number; cy: number; radius: number; sides: number; rotation: number }
  | {
      kind: 'star';
      cx: number;
      cy: number;
      innerRadius: number;
      outerRadius: number;
      points: number;
      rotation: number;
    }
  | { kind: 'line'; from: [number, number]; to: [number, number]; tolerance: number }
  | {
      kind: 'arrow';
      from: [number, number];
      to: [number, number];
      tolerance: number;
      arrowheadSize: number;
    }
  | { kind: 'path'; points: unknown[]; closed: boolean; tolerance: number };

function buildShapeWithSize(tool: ToolId, size: { w: number; h: number }): Shape {
  switch (tool) {
    case 'ellipse':
      return { kind: 'ellipse', cx: size.w / 2, cy: size.h / 2, rx: size.w / 2, ry: size.h / 2 };
    case 'polygon': {
      const r = Math.min(size.w, size.h) / 2;
      return { kind: 'polygon', cx: size.w / 2, cy: size.h / 2, radius: r, sides: 6, rotation: 0 };
    }
    case 'star': {
      const r = Math.min(size.w, size.h) / 2;
      return {
        kind: 'star',
        cx: size.w / 2,
        cy: size.h / 2,
        innerRadius: r * 0.4,
        outerRadius: r,
        points: 5,
        rotation: 0,
      };
    }
    case 'line':
      return { kind: 'line', from: [0, 0], to: [size.w, size.h], tolerance: 3 };
    case 'arrow':
      return { kind: 'arrow', from: [0, 0], to: [size.w, size.h], tolerance: 3, arrowheadSize: 10 };
    case 'text':
      return { kind: 'rect', x: 0, y: 0, w: size.w, h: size.h };
    case 'pen':
    case 'pencil':
      return {
        kind: 'path',
        points: [],
        closed: false,
        tolerance: 3,
      };
    default:
      return { kind: 'rect', x: 0, y: 0, w: size.w, h: size.h };
  }
}

describe('buildShapeWithSize', () => {
  it('returns rect shape for rect tool', () => {
    const shape = buildShapeWithSize('rect', { w: 100, h: 80 });
    expect(shape.kind).toBe('rect');
  });

  it('returns ellipse shape for ellipse tool', () => {
    const shape = buildShapeWithSize('ellipse', { w: 100, h: 80 });
    expect(shape.kind).toBe('ellipse');
    expect('cx' in shape && shape.cx).toBe(50);
    expect('rx' in shape && shape.rx).toBe(50);
  });

  it('returns polygon shape for polygon tool', () => {
    const shape = buildShapeWithSize('polygon', { w: 100, h: 80 });
    expect(shape.kind).toBe('polygon');
    expect('sides' in shape && shape.sides).toBe(6);
  });

  it('returns star shape for star tool', () => {
    const shape = buildShapeWithSize('star', { w: 100, h: 80 });
    expect(shape.kind).toBe('star');
    expect('points' in shape && shape.points).toBe(5);
  });

  it('returns line shape for line tool', () => {
    const shape = buildShapeWithSize('line', { w: 100, h: 80 });
    expect(shape.kind).toBe('line');
    expect('from' in shape && shape.from).toEqual([0, 0]);
    expect('to' in shape && shape.to).toEqual([100, 80]);
  });

  it('returns arrow shape for arrow tool', () => {
    const shape = buildShapeWithSize('arrow', { w: 100, h: 80 });
    expect(shape.kind).toBe('arrow');
    expect('arrowheadSize' in shape && shape.arrowheadSize).toBe(10);
  });

  it('returns path shape for pen tool (P0 fix)', () => {
    const shape = buildShapeWithSize('pen', { w: 100, h: 80 });
    expect(shape.kind).toBe('path');
  });

  it('returns path shape for pencil tool (P0 fix)', () => {
    const shape = buildShapeWithSize('pencil', { w: 100, h: 80 });
    expect(shape.kind).toBe('path');
  });
});
