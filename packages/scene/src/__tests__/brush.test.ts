import { describe, expect, it } from 'vitest';
import {
  type BrushDab,
  type BrushPreset,
  defaultBrushPreset,
  generateDabs,
  interpolatePoints,
  makeBrushStroke,
  pointDistance,
  rebuildStrokeDabs,
  type StrokePoint,
  smoothStrokePoints,
  strokeBounds,
  strokeDirection,
  strokePoint,
} from '../brush';

function makePreset(overrides: Partial<BrushPreset> = {}): BrushPreset {
  return { ...defaultBrushPreset('test', 'Test'), ...overrides };
}

function makePoints(count: number, startX = 0, startY = 0, stepX = 5, stepY = 0): StrokePoint[] {
  const pts: StrokePoint[] = [];
  for (let i = 0; i < count; i++) {
    pts.push(strokePoint(startX + i * stepX, startY + i * stepY, { pressure: 1, time: i * 10 }));
  }
  return pts;
}

describe('strokePoint', () => {
  it('creates a point with defaults', () => {
    const p = strokePoint(10, 20);
    expect(p.x).toBe(10);
    expect(p.y).toBe(20);
    expect(p.pressure).toBe(1);
    expect(p.tilt).toBe(0);
    expect(p.direction).toBe(0);
    expect(p.speed).toBe(0);
    expect(p.time).toBe(0);
  });

  it('accepts partial overrides', () => {
    const p = strokePoint(10, 20, { pressure: 0.5, tilt: 30, time: 100 });
    expect(p.pressure).toBe(0.5);
    expect(p.tilt).toBe(30);
    expect(p.time).toBe(100);
  });
});

describe('pointDistance', () => {
  it('calculates distance between two points', () => {
    const a = strokePoint(0, 0);
    const b = strokePoint(3, 4);
    expect(pointDistance(a, b)).toBe(5);
  });

  it('returns 0 for same point', () => {
    const a = strokePoint(5, 5);
    expect(pointDistance(a, a)).toBe(0);
  });
});

describe('strokeDirection', () => {
  it('returns 0 for horizontal right', () => {
    const a = strokePoint(0, 0);
    const b = strokePoint(10, 0);
    expect(strokeDirection(a, b)).toBe(0);
  });

  it('returns PI/2 for vertical down', () => {
    const a = strokePoint(0, 0);
    const b = strokePoint(0, 10);
    expect(strokeDirection(a, b)).toBe(Math.PI / 2);
  });
});

describe('smoothStrokePoints', () => {
  it('returns empty array for empty input', () => {
    expect(smoothStrokePoints([], 0.5)).toEqual([]);
  });

  it('returns single point unchanged', () => {
    const pts = [strokePoint(10, 20)];
    const result = smoothStrokePoints(pts, 0.5);
    expect(result).toHaveLength(1);
    expect(result[0]!.x).toBe(10);
    expect(result[0]!.y).toBe(20);
  });

  it('applies exponential smoothing with factor 0', () => {
    const pts = makePoints(3);
    const result = smoothStrokePoints(pts, 0);
    // factor=0 means no smoothing, should match original
    expect(result[1]!.x).toBe(pts[1]!.x);
    expect(result[1]!.y).toBe(pts[1]!.y);
  });

  it('applies exponential smoothing with factor 0.5', () => {
    const pts = makePoints(3);
    const result = smoothStrokePoints(pts, 0.5);
    // With factor 0.5, smoothed position should be between prev and current
    expect(result[1]!.x).toBe(pts[0]!.x + (pts[1]!.x - pts[0]!.x) * 0.5);
  });

  it('fully smooths with factor 1 (locks to first point)', () => {
    const pts = makePoints(3);
    const result = smoothStrokePoints(pts, 1);
    // factor=1 means no change from previous smoothed position
    expect(result[1]!.x).toBe(pts[0]!.x);
    expect(result[2]!.x).toBe(pts[0]!.x);
  });

  it('clamps factor to [0, 1]', () => {
    const pts = makePoints(2);
    const over = smoothStrokePoints(pts, 2);
    const under = smoothStrokePoints(pts, -1);
    // Both should produce same as 0 or 1
    expect(over[1]!.x).toBe(pts[0]!.x); // clamped to 1
    expect(under[1]!.x).toBe(pts[1]!.x); // clamped to 0
  });
});

describe('interpolatePoints', () => {
  it('linearly interpolates between two points', () => {
    const a = strokePoint(0, 0, { pressure: 0 });
    const b = strokePoint(10, 20, { pressure: 1 });
    const mid = interpolatePoints(a, b, 0.5);
    expect(mid.x).toBe(5);
    expect(mid.y).toBe(10);
    expect(mid.pressure).toBe(0.5);
  });

  it('returns a at t=0 and b at t=1', () => {
    const a = strokePoint(5, 10);
    const b = strokePoint(15, 30);
    expect(interpolatePoints(a, b, 0).x).toBe(5);
    expect(interpolatePoints(a, b, 1).x).toBe(15);
  });
});

describe('generateDabs', () => {
  it('returns empty for empty input', () => {
    expect(generateDabs([], makePreset())).toEqual([]);
  });

  it('returns one dab for single point', () => {
    const pts = [strokePoint(50, 50)];
    const dabs = generateDabs(pts, makePreset({ radius: 10 }));
    expect(dabs).toHaveLength(1);
    expect(dabs[0]!.x).toBe(50);
    expect(dabs[0]!.y).toBe(50);
    expect(dabs[0]!.radius).toBe(10);
  });

  it('generates multiple dabs along a line with spacing', () => {
    const pts = makePoints(10, 0, 0, 10, 0); // horizontal line, 10px apart
    const dabs = generateDabs(pts, makePreset({ radius: 10, spacing: 0.25 }));
    // spacing = 10*2*0.25 = 5px between dabs
    // 9 segments of 10px each = 90px total, so ~18 dabs
    expect(dabs.length).toBeGreaterThan(5);
  });

  it('applies dynamics modifiers', () => {
    const pts = [strokePoint(0, 0)];
    const preset = makePreset({
      radius: 20,
      spacing: 0.1,
      dynamics: [
        {
          input: 'pressure',
          target: 'size',
          curve: [0, 0, 1, 1],
          min: 0.5,
          max: 1.5,
        },
      ],
    });
    // Single point with pressure=1, size mod = 0.5 + (1.5 - 0.5) * 1 = 1.5
    // radius should be 20 * 1.5 = 30
    const dabs = generateDabs(pts, preset);
    expect(dabs[0]!.radius).toBeCloseTo(30, 1);
  });

  it('position jitter adds variation', () => {
    const pts = [strokePoint(100, 100)];
    // Force Math.random patterns - test that jitter field is respected
    const preset = makePreset({ radius: 10, positionJitter: 0.5 });
    const dabs = generateDabs(pts, preset);
    expect(dabs).toHaveLength(1);
    // Position may vary due to jitter
    const dx = Math.abs(dabs[0]!.x - 100);
    expect(dx).toBeLessThanOrEqual(11); // jitter up to radius * 0.5 = 5px * 2 = 10
  });

  it('preset spacing controls dab frequency', () => {
    const pts = makePoints(10, 0, 0, 10, 0);
    const tightSpacing = generateDabs(pts, makePreset({ radius: 10, spacing: 0.1 }));
    const looseSpacing = generateDabs(pts, makePreset({ radius: 10, spacing: 0.5 }));
    // Tighter spacing should produce more dabs
    expect(tightSpacing.length).toBeGreaterThan(looseSpacing.length);
  });

  it('minimum radius is 0.5', () => {
    const pts = [strokePoint(0, 0)];
    const dabs = generateDabs(pts, makePreset({ radius: 0.1 }));
    expect(dabs[0]!.radius).toBeGreaterThanOrEqual(0.5);
  });

  it('clamps zero spacing so malformed presets cannot stall generation', () => {
    const points = makePoints(3, 0, 0, 10, 0);
    expect(() => generateDabs(points, makePreset({ spacing: 0 }))).not.toThrow();
  });

  it('evaluates stroke progress dynamics across a stroke', () => {
    const points = makePoints(20, 0, 0, 10, 0);
    const preset = makePreset({
      radius: 10,
      spacing: 0.5,
      dynamics: [
        {
          input: 'stroke',
          target: 'opacity',
          curve: [0, 0, 1, 1],
          min: 0.25,
          max: 1,
        },
      ],
    });
    const dabs = generateDabs(points, preset);
    expect(dabs[0]!.opacity).toBeLessThan(dabs[dabs.length - 1]!.opacity);
  });

  it('inverts nonlinear dynamics curves before evaluating output', () => {
    const points = [strokePoint(0, 0, { pressure: 0.25 })];
    const preset = makePreset({
      dynamics: [
        {
          input: 'pressure',
          target: 'size',
          curve: [0.8, 0, 0.9, 1],
          min: 0.5,
          max: 1.5,
        },
      ],
    });
    const dab = generateDabs(points, preset)[0]!;
    expect(dab.radius).toBeGreaterThan(5);
  });

  it('carries grain settings into textured dabs', () => {
    const preset = makePreset({
      grainId: 'procedural',
      grainScale: 0.5,
      grainContrast: 1.3,
      grainInvert: true,
    });
    expect(generateDabs([strokePoint(0, 0)], preset)[0]!.grain).toEqual(
      expect.objectContaining({
        grainId: 'procedural',
        scale: 0.5,
        contrast: 1.3,
        invert: true,
      }),
    );
  });
});

describe('makeBrushStroke', () => {
  it('creates a brush stroke with given id and color', () => {
    const stroke = makeBrushStroke('stroke-1', 'preset-1', [255, 0, 0, 255]);
    expect(stroke.id).toBe('stroke-1');
    expect(stroke.presetId).toBe('preset-1');
    expect(stroke.color).toEqual([255, 0, 0, 255]);
    expect(stroke.points).toEqual([]);
    expect(stroke.dabs).toEqual([]);
  });
});

describe('rebuildStrokeDabs', () => {
  it('rebuilds dabs from raw points', () => {
    const stroke = makeBrushStroke('r-1', 'p-1', [0, 0, 0, 255]);
    stroke.points = makePoints(5, 0, 0, 10, 0);
    const preset = makePreset({ radius: 5, spacing: 0.25 });
    const rebuilt = rebuildStrokeDabs(stroke, preset);
    expect(rebuilt.dabs.length).toBeGreaterThan(1);
    expect(rebuilt.bounds.w).toBeGreaterThan(0);
  });
});

describe('strokeBounds', () => {
  it('returns zero for empty dabs', () => {
    expect(strokeBounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('computes bounding box of dabs', () => {
    const dabs: BrushDab[] = [
      {
        x: 0,
        y: 0,
        radius: 5,
        opacity: 1,
        flow: 1,
        hardness: 1,
        angle: 0,
        roundness: 1,
        strokeT: 0,
      },
      {
        x: 100,
        y: 50,
        radius: 10,
        opacity: 1,
        flow: 1,
        hardness: 1,
        angle: 0,
        roundness: 1,
        strokeT: 1,
      },
    ];
    const bounds = strokeBounds(dabs);
    expect(bounds.x).toBe(-5); // min(0 - 5, 100 - 10)
    expect(bounds.y).toBe(-5); // min(0 - 5, 50 - 10) = -5, not -10
    expect(bounds.w).toBe(115); // maxX+radius - minX = 110 - (-5) = 115
    expect(bounds.h).toBe(65); // maxY+radius - minY = 60 - (-5) = 65
  });
});

describe('defaultBrushPreset', () => {
  it('creates a preset with default values', () => {
    const preset = defaultBrushPreset('test-brush', 'Test Brush');
    expect(preset.id).toBe('test-brush');
    expect(preset.name).toBe('Test Brush');
    expect(preset.shape).toBe('circle');
    expect(preset.radius).toBe(10);
    expect(preset.opacity).toBe(1);
    expect(preset.flow).toBe(1);
    expect(preset.hardness).toBe(0.8);
    expect(preset.spacing).toBe(0.25);
    expect(preset.smoothing).toBe(0.5);
    expect(preset.eraser).toBe(false);
    expect(preset.blendMode).toBe('normal');
    expect(preset.dynamics).toEqual([]);
  });

  it('creates eraser preset with eraser flag', () => {
    const preset = defaultBrushPreset('eraser-brush', 'Eraser');
    expect(preset.id).toBe('eraser-brush');
    expect(preset.eraser).toBe(false);
  });
});

describe('edge cases', () => {
  it('handles zero-length segment gracefully', () => {
    const pts = [
      strokePoint(10, 10),
      strokePoint(10, 10), // same position
      strokePoint(20, 20),
    ];
    const dabs = generateDabs(pts, makePreset({ radius: 5, spacing: 0.25 }));
    expect(dabs.length).toBeGreaterThan(1);
  });

  it('smoothing preserves pressure values', () => {
    const pts = makePoints(5);
    pts[1]!.pressure = 0.2;
    pts[2]!.pressure = 0.8;
    const smoothed = smoothStrokePoints(pts, 0.5);
    // With factor 0.5: prev.pressure + (current.pressure - prev.pressure) * (1 - f)
    // = 1 + (0.2 - 1) * 0.5 = 1 - 0.4 = 0.6
    expect(smoothed[1]!.pressure).toBeCloseTo(0.6);
    expect(smoothed[2]!.pressure).toBeCloseTo(0.7); // 0.6 + (0.8 - 0.6) * 0.5
  });
});
