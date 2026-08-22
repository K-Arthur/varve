/**
 * Tests for pathText — glyph placement along all 9 shape kinds.
 *
 * TDD: tests written as failing assertions before implementation.
 */
import { describe, expect, it } from 'vitest';
import {
  pathLength,
  placeGlyphsOnPath,
  samplePathAtLength,
  transformPathShape,
} from './pathText';
import type { Shape } from './types';

function approx(a: number, b: number, tol = 0.05): void {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
}

describe('pathLength', () => {
  it('circle circumference', () => {
    const circ = pathLength({ kind: 'circle', cx: 0, cy: 0, r: 50 });
    approx(circ, 2 * Math.PI * 50);
  });

  it('rect perimeter', () => {
    const perim = pathLength({ kind: 'rect', x: 0, y: 0, w: 100, h: 200 });
    approx(perim, 600);
  });

  it('line length', () => {
    const len = pathLength({ kind: 'line', from: [0, 0], to: [3, 4], tolerance: 0 });
    approx(len, 5);
  });

  it('empty path returns 0', () => {
    const len = pathLength({ kind: 'path', points: [], closed: false, tolerance: 0 });
    approx(len, 0);
  });
});

describe('samplePathAtLength', () => {
  it('line: at half length is midpoint with correct angle', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 0 };
    const s = samplePathAtLength(shape, 50);
    approx(s.x, 50);
    approx(s.y, 0);
    approx(s.angle, 0);
  });

  it('circle: at quarter circumference is at rightmost point', () => {
    // Circle starts at top (y=-r) in screen coords; quarter way = rightmost
    const shape: Shape = { kind: 'circle', cx: 0, cy: 0, r: 10 };
    const s = samplePathAtLength(shape, (2 * Math.PI * 10) / 4);
    approx(s.x, 10);
    approx(s.y, 0);
  });

  it('rect: starts at top-left going right', () => {
    const shape: Shape = { kind: 'rect', x: 0, y: 0, w: 100, h: 50 };
    const s = samplePathAtLength(shape, 0);
    approx(s.x, 0);
    approx(s.y, 0);
    approx(s.angle, 0); // going right
  });

  it('rect: just past corner switches to downward', () => {
    const shape: Shape = { kind: 'rect', x: 0, y: 0, w: 100, h: 50 };
    const s = samplePathAtLength(shape, 101);
    approx(s.x, 100);
    approx(s.y, 1);
    approx(s.angle, Math.PI / 2, 0.05); // going down
  });
});

describe('placeGlyphsOnPath — circle fast path', () => {
  it('places text around a circle', () => {
    const shape: Shape = { kind: 'circle', cx: 100, cy: 100, r: 50 };
    const glyphs = placeGlyphsOnPath('Hi', shape, { fontSize: 16 });
    expect(glyphs.length).toBe(2);
    // First glyph at offset+half-advance along circle
    expect(glyphs[0]?.char).toBe('H');
    expect(glyphs[1]?.char).toBe('i');
    // Each glyph has position and angle
    for (const g of glyphs) {
      expect(typeof g.x).toBe('number');
      expect(typeof g.y).toBe('number');
      expect(typeof g.angle).toBe('number');
    }
  });

  it('returns [] for empty text', () => {
    const shape: Shape = { kind: 'circle', cx: 0, cy: 0, r: 50 };
    expect(placeGlyphsOnPath('', shape, { fontSize: 16 })).toEqual([]);
  });

  it('returns [] for zero-radius circle', () => {
    const shape: Shape = { kind: 'circle', cx: 0, cy: 0, r: 0 };
    expect(placeGlyphsOnPath('Hi', shape, { fontSize: 16 })).toEqual([]);
  });

  it('keeps every quadrant on the circle after affine path conversion', () => {
    const converted = transformPathShape(
      { kind: 'circle', cx: 100, cy: 100, r: 50 },
      [1, 0, 0, 1, 0, 0],
    );
    expect(converted.kind).toBe('path');
    if (converted.kind !== 'path') return;

    const length = pathLength(converted);
    for (const fraction of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
      const point = samplePathAtLength(converted, length * fraction);
      expect(Math.hypot(point.x - 100, point.y - 100)).toBeCloseTo(50, 0);
    }
  });
});

describe('placeGlyphsOnPath — line', () => {
  it('places text along a horizontal line', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [200, 0], tolerance: 0 };
    const glyphs = placeGlyphsOnPath('AB', shape, { fontSize: 16 });
    expect(glyphs.length).toBe(2);
    // Side offset pushes above the line by default
    approx(glyphs[0]?.y ?? 0, 16 * 0.3, 0.5);
    approx(glyphs[1]?.y ?? 0, 16 * 0.3, 0.5);
    // x increases
    expect(glyphs[1]?.x ?? 0).toBeGreaterThan(glyphs[0]?.x ?? 0);
    // angle is 0 (horizontal right)
    approx(glyphs[0]?.angle ?? 0, 0);
  });

  it('places text on a diagonal line', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [100, 100], tolerance: 0 };
    const glyphs = placeGlyphsOnPath('X', shape, { fontSize: 16 });
    expect(glyphs.length).toBe(1);
    approx(glyphs[0]?.angle ?? 0, Math.PI / 4, 0.01);
  });
});

describe('placeGlyphsOnPath — rect perimeter', () => {
  it('places text around a rectangle', () => {
    const shape: Shape = { kind: 'rect', x: 0, y: 0, w: 100, h: 50 };
    const glyphs = placeGlyphsOnPath('ABCD', shape, { fontSize: 16 });
    expect(glyphs.length).toBe(4);
  });
});

describe('placeGlyphsOnPath — polygon', () => {
  it('places glyphs on triangle perimeter', () => {
    const shape: Shape = { kind: 'polygon', cx: 0, cy: 0, radius: 50, sides: 3, rotation: 0 };
    const glyphs = placeGlyphsOnPath('X', shape, { fontSize: 16 });
    expect(glyphs.length).toBe(1);
    expect(typeof glyphs[0]?.x).toBe('number');
  });
});

describe('placeGlyphsOnPath — star', () => {
  it('places glyphs on star perimeter', () => {
    const shape: Shape = {
      kind: 'star',
      cx: 50,
      cy: 50,
      innerRadius: 20,
      outerRadius: 50,
      points: 5,
      rotation: 0,
    };
    const glyphs = placeGlyphsOnPath('*', shape, { fontSize: 16 });
    expect(glyphs.length).toBe(1);
  });
});

describe('placeGlyphsOnPath — arrow', () => {
  it('places glyphs along arrow shaft', () => {
    const shape: Shape = {
      kind: 'arrow',
      from: [0, 0],
      to: [100, 0],
      tolerance: 0,
      arrowheadSize: 10,
    };
    const glyphs = placeGlyphsOnPath('>', shape, { fontSize: 16 });
    expect(glyphs.length).toBe(1);
    approx(glyphs[0]?.angle ?? 0, 0);
  });
});

describe('placeGlyphsOnPath — offset and side', () => {
  it('offset 0.5 starts at middle of line', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 0 };
    const glyphs = placeGlyphsOnPath('A', shape, { fontSize: 16, offset: 0.5 });
    expect(glyphs.length).toBe(1);
    // Starts at 50 + advance/2 = 50 + 4.8 = 54.8
    approx(glyphs[0]?.x ?? 0, 54.8, 0.5);
  });

  it('side bottom places glyph below the path', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 0 };
    const glyphs = placeGlyphsOnPath('A', shape, { fontSize: 16, side: 'bottom' });
    expect(glyphs.length).toBe(1);
    // bottom = negative Y offset in screen space
    approx(glyphs[0]?.y ?? 0, -16 * 0.3, 1);
  });

  it('side top places glyph above the path', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 0 };
    const glyphs = placeGlyphsOnPath('A', shape, { fontSize: 16, side: 'top' });
    expect(glyphs.length).toBe(1);
    approx(glyphs[0]?.y ?? 0, 16 * 0.3, 1);
  });
});

describe('placeGlyphsOnPath — path bezier', () => {
  it('places glyphs on a cubic bezier path', () => {
    const shape: Shape = {
      kind: 'path',
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: [50, 100] },
        { x: 200, y: 0, handleIn: [-50, 100], handleOut: null },
      ],
      closed: false,
      tolerance: 0,
    };
    const glyphs = placeGlyphsOnPath('Hello', shape, { fontSize: 16 });
    expect(glyphs.length).toBe(5);
    // Glyphs should be positioned along the bezier
    for (const g of glyphs) {
      expect(typeof g.x).toBe('number');
      expect(typeof g.y).toBe('number');
      expect(typeof g.angle).toBe('number');
    }
  });

  it('closed path bezier wraps properly', () => {
    const shape: Shape = {
      kind: 'path',
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 100, y: 0, handleIn: null, handleOut: null },
        { x: 100, y: 100, handleIn: null, handleOut: null },
        { x: 0, y: 100, handleIn: null, handleOut: null },
      ],
      closed: true,
      tolerance: 0,
    };
    const glyphs = placeGlyphsOnPath('ABCD', shape, { fontSize: 16 });
    expect(glyphs.length).toBe(4);
  });
});

describe('placeGlyphsOnPath — ellipse', () => {
  it('places glyphs on ellipse perimeter', () => {
    const shape: Shape = { kind: 'ellipse', cx: 100, cy: 100, rx: 80, ry: 50 };
    const glyphs = placeGlyphsOnPath('Ellipse', shape, { fontSize: 16 });
    expect(glyphs.length).toBeGreaterThan(0);
    // All glyphs should be near the ellipse perimeter
    for (const g of glyphs) {
      const dx = g.x - 100;
      const dy = g.y - 100;
      const ratio = (dx * dx) / (80 * 80) + (dy * dy) / (50 * 50);
      // Should be near ellipse boundary (within tolerance)
      expect(Math.abs(ratio - 1)).toBeLessThan(5);
    }
  });
});

describe('placeGlyphsOnPath — multi-glyph text', () => {
  it('places each character with increasing x on horizontal line', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [500, 0], tolerance: 0 };
    const glyphs = placeGlyphsOnPath('Hello', shape, { fontSize: 20 });
    expect(glyphs.length).toBe(5);
    for (let i = 1; i < glyphs.length; i++) {
      expect(glyphs[i]?.x ?? 0).toBeGreaterThan(glyphs[i - 1]?.x ?? 0);
    }
  });

  it('truncates when glyphs exceed path length', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [10, 0], tolerance: 0 };
    const glyphs = placeGlyphsOnPath('ABCDEFGHIJ', shape, { fontSize: 20 });
    // 20 * 0.6 = 12px per glyph, path is 10px, so at most 1 glyph fits
    expect(glyphs.length).toBeLessThanOrEqual(2);
  });
});
