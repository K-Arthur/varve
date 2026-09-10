/**
 * Tests for pathText — glyph placement along all 9 shape kinds.
 *
 * TDD: tests written as failing assertions before implementation.
 */
import { describe, expect, it } from 'vitest';
import {
  flattenShapedRuns,
  type PathCluster,
  pathLength,
  placeClustersOnPath,
  placeGlyphsOnPath,
  placeLinesOnPath,
  samplePathAtLength,
  transformPathShape,
} from './pathText';
import type { Shape, ShapedRun } from './types';

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
    // Baseline sits exactly on the path (top side, no lift)
    approx(glyphs[0]?.y ?? 0, 0, 0.1);
    approx(glyphs[1]?.y ?? 0, 0, 0.1);
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
    // Left-baseline anchor: glyph left edge sits at 50.0
    approx(glyphs[0]?.x ?? 0, 50, 0.5);
  });

  it('side bottom rotates glyph 180° and puts baseline on the path', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 0 };
    const glyphs = placeGlyphsOnPath('A', shape, { fontSize: 16, side: 'bottom' });
    expect(glyphs.length).toBe(1);
    // Baseline sits exactly on the path (y = 0), rotated 180°.
    approx(glyphs[0]?.y ?? 0, 0, 0.1);
    approx(glyphs[0]?.angle ?? 0, Math.PI, 0.05);
  });

  it('side top keeps baseline on the path with no rotation', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 0 };
    const glyphs = placeGlyphsOnPath('A', shape, { fontSize: 16, side: 'top' });
    expect(glyphs.length).toBe(1);
    // Baseline on the path (y = 0), tangent angle unchanged.
    approx(glyphs[0]?.y ?? 0, 0, 0.1);
    approx(glyphs[0]?.angle ?? 0, 0, 0.05);
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

// ── placeClustersOnPath (shaped clusters) ──────────────────────────────

describe('placeClustersOnPath', () => {
  it('places shaped clusters along a circle', () => {
    const shape: Shape = { kind: 'circle', cx: 0, cy: 0, r: 100 };
    const clusters: PathCluster[] = [
      { text: 'AV', advance: 18 }, // single cluster (ligature-like)
      { text: 'o', advance: 10 },
      { text: 'w', advance: 14 },
    ];
    const glyphs = placeClustersOnPath(clusters, shape, { fontSize: 16 });
    expect(glyphs.length).toBe(3);
    expect(glyphs[0]?.char).toBe('AV');
    expect(glyphs[1]?.char).toBe('o');
    expect(glyphs[2]?.char).toBe('w');
    // All on circle (r ≈ 100)
    for (const g of glyphs) {
      approx(Math.hypot(g.x, g.y), 100, 1);
    }
  });

  it('endOffset clips text to a sub-interval on an open path', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 0 };
    const clusters: PathCluster[] = [
      { text: 'A', advance: 10 },
      { text: 'B', advance: 10 },
      { text: 'C', advance: 10 },
      { text: 'D', advance: 10 },
      { text: 'E', advance: 10 },
      { text: 'F', advance: 10 },
      { text: 'G', advance: 10 },
    ];
    // Usable interval: 0%–50% of 100px = [0–50]px
    // A=0, B=10, C=20, D=30, E=40, F=50 (at boundary, included), G=60 (excluded)
    const glyphs = placeClustersOnPath(clusters, shape, { offset: 0, endOffset: 0.5 });
    expect(glyphs.length).toBe(6);
    for (const g of glyphs) {
      expect(g.x).toBeLessThanOrEqual(50.01);
    }
  });

  it('endOffset wraps through the seam on closed paths', () => {
    const shape: Shape = { kind: 'circle', cx: 0, cy: 0, r: 50 };
    const clusters: PathCluster[] = [
      { text: 'A', advance: 20 },
      { text: 'B', advance: 20 },
      { text: 'C', advance: 20 },
      { text: 'D', advance: 20 },
    ];
    // Start at 80%, end at 20% → wraps through seam: 80%..100% + 0%..20%
    const glyphs = placeClustersOnPath(clusters, shape, { offset: 0.8, endOffset: 0.2 });
    // The interval wraps through the seam, so all four 20px clusters fit in
    // the 40% forward arc rather than being rejected by an absolute end check.
    expect(glyphs).toHaveLength(4);
    for (const g of glyphs) {
      expect(Number.isFinite(g.x)).toBe(true);
      expect(Number.isFinite(g.y)).toBe(true);
    }
  });

  it('baselineShift moves glyphs perpendicular to the path', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 0 };
    const clusters: PathCluster[] = [{ text: 'A', advance: 10 }];
    const plain = placeClustersOnPath(clusters, shape, { baselineShift: 0 });
    const shifted = placeClustersOnPath(clusters, shape, { baselineShift: 20 });
    expect(plain[0]?.y).toBe(0);
    // Shift of +20 should move glyph up (y negative) on a LTR horizontal line
    expect(shifted[0]?.y).toBeLessThan(plain[0]?.y ?? 0);
  });

  it('side bottom rotates glyphs 180 degrees', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 0 };
    const clusters: PathCluster[] = [{ text: 'A', advance: 10 }];
    const top = placeClustersOnPath(clusters, shape, { side: 'top' });
    const bottom = placeClustersOnPath(clusters, shape, { side: 'bottom' });
    approx(top[0]?.angle ?? 0, 0, 0.05);
    approx(bottom[0]?.angle ?? 0, Math.PI, 0.05);
  });

  it('flip adds an independent 180 degree orientation change', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 0 };
    const normal = placeClustersOnPath([{ text: 'A', advance: 10 }], shape);
    const flipped = placeClustersOnPath([{ text: 'A', advance: 10 }], shape, { flip: true });
    approx(flipped[0]?.angle ?? 0, Math.PI, 0.05);
    approx(normal[0]?.angle ?? 0, 0, 0.05);
  });

  it('normalizes non-finite offsets instead of producing NaN placements', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 0 };
    const glyphs = placeClustersOnPath([{ text: 'A', advance: 10 }], shape, {
      offset: Number.NaN,
      endOffset: Number.NaN,
    });
    expect(glyphs).toHaveLength(1);
    expect(Number.isFinite(glyphs[0]?.x)).toBe(true);
  });
});

describe('cubic arc-length parameterization', () => {
  it('does not use raw cubic t as the distance coordinate', () => {
    const shape: Shape = {
      kind: 'path',
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: [0, 300] },
        { x: 300, y: 0, handleIn: [-1, 0], handleOut: null },
      ],
      closed: false,
      tolerance: 0,
    };
    const total = pathLength(shape);
    const sample = samplePathAtLength(shape, total / 2);
    // A raw-t midpoint would be x=37.5 for this strongly asymmetric curve;
    // half the physical length is materially farther along the curve.
    expect(sample.x).toBeGreaterThan(50);
  });
});

// ── Ellipse arc-length accuracy ────────────────────────────────────────

describe('ellipse arc-length parameterization', () => {
  it('produces approximately uniform glyph spacing on a wide ellipse', () => {
    const shape: Shape = { kind: 'ellipse', cx: 0, cy: 0, rx: 200, ry: 50 };
    const clusters: PathCluster[] = Array.from({ length: 10 }, (_, i) => ({
      text: `${i}`,
      advance: 10,
    }));
    const glyphs = placeClustersOnPath(clusters, shape, { fontSize: 10 });
    expect(glyphs.length).toBe(10);
    // Check that consecutive x-distances don't vary wildly (within 15% of mean)
    const gaps: number[] = [];
    for (let i = 1; i < glyphs.length; i++) {
      gaps.push(Math.hypot(glyphs[i]!.x - glyphs[i - 1]!.x, glyphs[i]!.y - glyphs[i - 1]!.y));
    }
    const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(meanGap * 0.85);
      expect(gap).toBeLessThan(meanGap * 1.15);
    }
  });
});

// ── flattenShapedRuns ──────────────────────────────────────────────────

describe('flattenShapedRuns', () => {
  it('flattens single LTR run into path clusters', () => {
    const runs: ShapedRun[] = [
      {
        fontFamily: 'Arial',
        fontSize: 16,
        fontWeight: 400,
        fontStyle: 'normal',
        direction: 'ltr',
        level: 0,
        script: 'Latn',
        glyphs: [
          {
            glyphId: 0,
            xAdvance: 10,
            yAdvance: 0,
            xOffset: 0,
            yOffset: 0,
            clusterUtf16: 0,
            sourceEnd: 1,
          },
          {
            glyphId: 0,
            xAdvance: 8,
            yAdvance: 0,
            xOffset: 0,
            yOffset: 0,
            clusterUtf16: 1,
            sourceEnd: 2,
          },
        ],
        width: 18,
        ascent: 12,
        descent: 4,
      },
    ];
    const clusters = flattenShapedRuns(runs, 'Hi');
    expect(clusters).toEqual([
      { text: 'H', advance: 10 },
      { text: 'i', advance: 8 },
    ]);
  });

  it('skips newlines', () => {
    const runs: ShapedRun[] = [
      {
        fontFamily: 'Arial',
        fontSize: 16,
        fontWeight: 400,
        fontStyle: 'normal',
        direction: 'ltr',
        level: 0,
        script: 'Latn',
        glyphs: [
          {
            glyphId: 0,
            xAdvance: 10,
            yAdvance: 0,
            xOffset: 0,
            yOffset: 0,
            clusterUtf16: 0,
            sourceEnd: 1,
          },
          {
            glyphId: 0,
            xAdvance: 8,
            yAdvance: 0,
            xOffset: 0,
            yOffset: 0,
            clusterUtf16: 2,
            sourceEnd: 3,
          },
        ],
        width: 18,
        ascent: 12,
        descent: 4,
      },
    ];
    const clusters = flattenShapedRuns(runs, 'H\ni');
    expect(clusters).toEqual([
      { text: 'H', advance: 10 },
      { text: 'i', advance: 8 },
    ]);
  });

  it('handles sourceEnd fallback when not provided', () => {
    const runs: ShapedRun[] = [
      {
        fontFamily: 'Arial',
        fontSize: 16,
        fontWeight: 400,
        fontStyle: 'normal',
        direction: 'ltr',
        level: 0,
        script: 'Latn',
        glyphs: [
          { glyphId: 0, xAdvance: 10, yAdvance: 0, xOffset: 0, yOffset: 0, clusterUtf16: 0 },
        ],
        width: 10,
        ascent: 12,
        descent: 4,
      },
    ];
    const clusters = flattenShapedRuns(runs, 'AB');
    expect(clusters[0]?.text).toBe('A');
  });

  it('reverses only RTL runs for visual path traversal', () => {
    const runs: ShapedRun[] = [
      {
        fontFamily: 'Arial',
        fontSize: 16,
        fontWeight: 400,
        fontStyle: 'normal',
        direction: 'rtl',
        level: 1,
        script: 'Arab',
        glyphs: [
          {
            glyphId: 0,
            xAdvance: 12,
            yAdvance: 0,
            xOffset: 0,
            yOffset: 0,
            clusterUtf16: 0,
            sourceEnd: 1,
          },
          {
            glyphId: 0,
            xAdvance: 14,
            yAdvance: 0,
            xOffset: 0,
            yOffset: 0,
            clusterUtf16: 1,
            sourceEnd: 2,
          },
        ],
        width: 26,
        ascent: 12,
        descent: 4,
      },
    ];
    expect(flattenShapedRuns(runs, 'אב')).toEqual([
      { text: 'ב', advance: 14 },
      { text: 'א', advance: 12 },
    ]);
  });
});

// ── placeLinesOnPath ───────────────────────────────────────────────────

describe('placeLinesOnPath', () => {
  it('places line 1 offset along the up normal (lineHeight px away)', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [200, 0], tolerance: 0 };
    const line0: PathCluster[] = [{ text: 'A', advance: 10 }];
    const line1: PathCluster[] = [{ text: 'B', advance: 10 }];
    const glyphs = placeLinesOnPath([line0, line1], shape, { fontSize: 16, lineHeightPx: 20 });
    expect(glyphs.length).toBe(2);
    approx(glyphs[0]?.y ?? 0, 0, 0.1); // line 0 on path
    approx(glyphs[1]?.y ?? 0, -20, 0.1); // line 1 offset 20px up (side top)
  });

  it('stacks line 1 inward for side bottom', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [200, 0], tolerance: 0 };
    const line0: PathCluster[] = [{ text: 'X', advance: 10 }];
    const line1: PathCluster[] = [{ text: 'Y', advance: 10 }];
    const glyphs = placeLinesOnPath([line0, line1], shape, {
      fontSize: 16,
      lineHeightPx: 24,
      side: 'bottom',
    });
    approx(glyphs[0]?.y ?? 0, 0, 0.1);
    approx(glyphs[1]?.y ?? 0, 24, 0.1); // downward on screen = outward for bottom side
  });

  it('blank paragraphs are skipped and do not consume ring slots', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [200, 0], tolerance: 0 };
    const line0: PathCluster[] = [{ text: 'A', advance: 10 }];
    const empty: PathCluster[] = [];
    const line2: PathCluster[] = [{ text: 'C', advance: 10 }];
    const glyphs = placeLinesOnPath([line0, empty, line2], shape, {
      fontSize: 16,
      lineHeightPx: 20,
    });
    expect(glyphs.length).toBe(2);
    approx(glyphs[0]?.y ?? 0, 0, 0.1);
    approx(glyphs[1]?.y ?? 0, -20, 0.1); // placedLineIndex 1 → 1*20 up
  });

  it('multiline ring has outer ring larger than inner', () => {
    const shape: Shape = { kind: 'circle', cx: 0, cy: 0, r: 80 };
    const clusters: PathCluster[] = [{ text: 'X', advance: 10 }];
    const glyphs = placeLinesOnPath([clusters, clusters], shape, {
      fontSize: 16,
      lineHeightPx: 15,
    });
    const r0 = Math.hypot(glyphs[0]?.x ?? 0, glyphs[0]?.y ?? 0);
    const r1 = Math.hypot(glyphs[1]?.x ?? 0, glyphs[1]?.y ?? 0);
    expect(r1).toBeGreaterThan(r0);
  });
});

// ── reverse direction ──────────────────────────────────────────────────

describe('reverse direction', () => {
  it('reverses the traversal along the path', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 0 };
    const clusters: PathCluster[] = [
      { text: 'A', advance: 10 },
      { text: 'B', advance: 10 },
    ];
    const normal = placeLinesOnPath([clusters], shape, { fontSize: 16, offset: 0 });
    const reversed = placeLinesOnPath([clusters], shape, {
      fontSize: 16,
      offset: 0,
      reverse: true,
    });
    expect(normal.length).toBe(2);
    expect(reversed.length).toBe(2);
    // Reversed text starts from the end of the path
    expect(reversed[0]?.x).toBeGreaterThan(normal[0]?.x ?? Number.NEGATIVE_INFINITY);
  });

  it('flips glyph angle by pi when reversed', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 0 };
    const clusters: PathCluster[] = [{ text: 'A', advance: 10 }];
    const normal = placeLinesOnPath([clusters], shape, { fontSize: 16 });
    const reversed = placeLinesOnPath([clusters], shape, { fontSize: 16, reverse: true });
    approx(normal[0]?.angle ?? 0, 0, 0.05);
    approx(reversed[0]?.angle ?? 0, Math.PI, 0.05);
  });
});

// ── fitToInterval ──────────────────────────────────────────────────────

describe('fitToInterval', () => {
  it('stretches single-line text to span the full interval', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [100, 0], tolerance: 0 };
    const clusters: PathCluster[] = [
      { text: 'A', advance: 10 },
      { text: 'B', advance: 10 },
    ];
    const glyphs = placeLinesOnPath([clusters], shape, {
      fontSize: 16,
      offset: 0,
      endOffset: 1,
      fitToInterval: true,
    });
    expect(glyphs.length).toBe(2);
    // First glyph at 0, second at 100 (full span)
    approx(glyphs[0]?.x ?? 0, 0, 1);
    approx(glyphs[1]?.x ?? 0, 90, 1); // advance=10 + extra=80 gap
  });

  it('single cluster does not crash', () => {
    const shape: Shape = { kind: 'line', from: [0, 0], to: [50, 0], tolerance: 0 };
    const clusters: PathCluster[] = [{ text: 'X', advance: 10 }];
    const glyphs = placeLinesOnPath([clusters], shape, {
      fontSize: 16,
      fitToInterval: true,
    });
    expect(glyphs.length).toBe(1);
    expect(Number.isFinite(glyphs[0]?.x)).toBe(true);
  });
});
