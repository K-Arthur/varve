import { describe, expect, it } from 'vitest';
import type { Shape } from '../../types';
import { fitEnvelopeFromPath, makeWarpPreset, perspectiveFromQuad } from '../fit';
import {
  analyzeFoldover,
  buildWarpEvaluation,
  isIdentityWarp,
  warpDomainBounds,
  warpShapeToPath,
} from '../geometry';
import { makeWarpPlan, validateWarpPlan } from '../plan';
import { splitGraphemesText, warpTextToClusterAdjustments } from '../text';
import { validateWarpModifier, type WarpModifier } from '../types';

const BOUNDS = { x: 10, y: 20, w: 200, h: 100 };

describe('mathematical invariants', () => {
  it('identity stack reproduces the source exactly', () => {
    const m: WarpModifier = {
      id: 'm1',
      kind: 'perspective',
      corners: {
        tl: { x: 0, y: 0 },
        tr: { x: 1, y: 0 },
        br: { x: 1, y: 1 },
        bl: { x: 0, y: 1 },
      },
    };
    const { shape } = warpShapeToPath({ kind: 'rect', x: 10, y: 20, w: 200, h: 100 }, [m], BOUNDS, {
      quality: { profile: 'export', tolerance: 1e-7 },
    });
    expect(shape).toMatchObject({ kind: 'path' });
    if (shape.kind === 'path') {
      expect(shape.points[0]!.x).toBeCloseTo(10, 6);
      expect(shape.points[0]!.y).toBeCloseTo(20, 6);
      expect(shape.points[2]!.x).toBeCloseTo(210, 6);
      expect(shape.points[2]!.y).toBeCloseTo(120, 6);
    }
  });

  it('disabled modifiers are inert (exact source)', () => {
    const m: WarpModifier = {
      id: 'm1',
      kind: 'skew',
      enabled: false,
      skewX: 45,
      skewY: 0,
      origin: { x: 0.5, y: 0.5 },
    };
    const { shape } = warpShapeToPath({ kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, [m], {
      x: 0,
      y: 0,
      w: 100,
      h: 50,
    });
    expect(shape.kind).toBe('rect');
  });

  it('every finite input produces finite output', () => {
    const evalW = buildWarpEvaluation(
      [makeWarpPreset('bulge'), makeWarpPreset('four-edge')],
      BOUNDS,
    );
    for (let i = 0; i <= 20; i++) {
      for (let j = 0; j <= 20; j++) {
        const [x, y] = evalW.map(10 + i * 10, 20 + j * 5);
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
      }
    }
  });

  it('isIdentityWarp detects true identity and rejects deformation', () => {
    const identity: WarpModifier = {
      id: 'm1',
      kind: 'perspective',
      corners: { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } },
    };
    expect(isIdentityWarp([identity], BOUNDS)).toBe(true);
    const deformed: WarpModifier = {
      id: 'm1',
      kind: 'skew',
      skewX: 10,
      skewY: 0,
      origin: { x: 0.5, y: 0.5 },
    };
    expect(isIdentityWarp([deformed], BOUNDS)).toBe(false);
  });

  it('zero-size bounds never produce non-finite geometry', () => {
    const evalW = buildWarpEvaluation([makeWarpPreset('arch')], { x: 0, y: 0, w: 0, h: 0 });
    const [x, y] = evalW.map(0, 0);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
  });

  it('evaluated bounds contain all generated geometry', () => {
    const warps = [makeWarpPreset('four-edge'), makeWarpPreset('wave')];
    const { shape } = warpShapeToPath(
      { kind: 'star', cx: 110, cy: 70, innerRadius: 30, outerRadius: 60, points: 5, rotation: 0 },
      warps,
      BOUNDS,
      {
        quality: { profile: 'high' },
      },
    );
    const { bounds } = warpDomainBounds(BOUNDS, warps, { quality: { profile: 'high' } });
    if (shape.kind === 'path') {
      for (const p of shape.points) {
        expect(p.x).toBeGreaterThanOrEqual(bounds.x - 0.01);
        expect(p.y).toBeGreaterThanOrEqual(bounds.y - 0.01);
        expect(p.x).toBeLessThanOrEqual(bounds.x + bounds.w + 0.01);
        expect(p.y).toBeLessThanOrEqual(bounds.y + bounds.h + 0.01);
      }
    }
  });
});

describe('foldover analysis', () => {
  it('detects inverted envelope regions (top edge below bottom edge)', () => {
    const inverted: WarpModifier = {
      id: 'm1',
      kind: 'envelope',
      corners: { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } },
      edges: {
        top: [
          { x: 1 / 3, y: 0.8 },
          { x: 2 / 3, y: 0.8 },
        ],
        right: [
          { x: 1, y: 1 / 3 },
          { x: 1, y: 2 / 3 },
        ],
        bottom: [
          { x: 1 / 3, y: 0.2 },
          { x: 2 / 3, y: 0.2 },
        ],
        left: [
          { x: 0, y: 1 / 3 },
          { x: 0, y: 2 / 3 },
        ],
      },
      interpolation: 'coons',
    };
    const result = analyzeFoldover(BOUNDS, [inverted]);
    expect(result.foldover).toBe(true);
    expect(result.invertedCells).toBeGreaterThan(0);
    expect(result.regions.length).toBeGreaterThan(0);
  });

  it('reports none for identity', () => {
    const identity: WarpModifier = {
      id: 'm1',
      kind: 'perspective',
      corners: { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } },
    };
    const result = analyzeFoldover(BOUNDS, [identity]);
    expect(result.foldover).toBe(false);
    expect(result.severity).toBe('none');
  });
});

describe('envelope corner editing domain', () => {
  const CORNERS = makeWarpPreset('four-edge');

  it('accepts a corner dragged outward past the unit square', () => {
    const moved = {
      ...CORNERS,
      corners: { ...CORNERS.corners, tr: { x: 1.3, y: 0.45 } },
    };
    expect(validateWarpModifier(moved)).not.toBeNull();
  });

  it('rejects a corner outside the extended editing domain (same as edges)', () => {
    const out = {
      ...CORNERS,
      corners: { ...CORNERS.corners, tr: { x: 3.5, y: 0 } },
    };
    const validated = validateWarpModifier(out);
    expect(validated).toBeNull();
    const edgesOut = {
      ...CORNERS,
      edges: { ...CORNERS.edges, top: [{ x: 4, y: 0 }, { x: 0.7, y: -0.1 }] },
    };
    expect(validateWarpModifier(edgesOut)).toBeNull();
  });

  it('deforms the artwork outward when a corner extends past the source box', () => {
    const moved = {
      ...CORNERS,
      corners: { ...CORNERS.corners, tr: { x: 1.3, y: 0.45 } },
    } as WarpModifier;
    const { shape } = warpShapeToPath(
      { kind: 'rect', x: 10, y: 20, w: 200, h: 100 },
      [moved],
      BOUNDS,
      {
        quality: { profile: 'export', tolerance: 1e-7 },
        settings: undefined,
      },
    );
    expect(shape.kind).toBe('path');
    if (shape.kind !== 'path') return;
    const xs = shape.points.map((p) => p.x);
    expect(Math.max(...xs)).toBeGreaterThan(BOUNDS.x + BOUNDS.w + 5);
  });
});

describe('text warp', () => {
  it('splits graphemes with combining marks and surrogate pairs', () => {
    expect(splitGraphemesText('a\u0301b')).toEqual(['a\u0301', 'b']);
    expect(splitGraphemesText('\ud83d\ude00x')).toEqual(['\ud83d\ude00', 'x']);
  });

  it('derives cluster adjustments for an arc bend', () => {
    const evalW = buildWarpEvaluation(
      [{ id: 'm1', kind: 'bend', mode: 'arch', amount: 0.6, axis: 'horizontal', origin: 0.5 }],
      { x: 0, y: 0, w: 300, h: 60 },
    );
    const result = warpTextToClusterAdjustments(
      {
        text: 'Hello',
        fontSize: 40,
        fontFamily: 'sans-serif',
        w: 300,
        h: 60,
        measure: (cluster) => cluster.length * 40 * 0.6,
      },
      evalW,
    );
    expect(result.unsupported).toBeNull();
    const keys = Object.keys(result.adjustments).map(Number);
    expect(keys.length).toBeGreaterThan(0);
    // Arch peaks at center: middle cluster gets the largest |dy|.
    const dys = keys.map((k) => Math.abs(result.adjustments[k]!.dy));
    const middleIndex = Math.floor(keys.length / 2);
    expect(dys[middleIndex]).toBeGreaterThan(dys[0]!);
  });

  it('returns unsupported for multi-line text', () => {
    const evalW = buildWarpEvaluation(
      [{ id: 'm1', kind: 'bend', mode: 'arch', amount: 0.5, axis: 'horizontal', origin: 0.5 }],
      { x: 0, y: 0, w: 100, h: 100 },
    );
    const result = warpTextToClusterAdjustments(
      { text: 'a\nb', fontSize: 20, fontFamily: 'sans', w: 100, h: 100 },
      evalW,
    );
    expect(result.unsupported).not.toBeNull();
  });
});

describe('typed warp plans', () => {
  it('validates a well-formed plan', () => {
    const plan = makeWarpPlan(
      'req-1',
      'rev-1',
      ['n1'],
      makeWarpPreset('arch'),
      'deterministic-path',
    );
    const v = validateWarpPlan(plan);
    expect(v.plan).not.toBeNull();
    expect(v.errors).toHaveLength(0);
  });

  it('rejects unknown modifier kinds and non-finite data', () => {
    const bad = makeWarpPlan(
      'req-1',
      'rev-1',
      ['n1'],
      makeWarpPreset('arch'),
      'deterministic-path',
    );
    const mutated = { ...bad, modifier: { ...bad.modifier, kind: 'ffd-3d' } };
    expect(validateWarpPlan(mutated).errors.length).toBeGreaterThan(0);
    const nan = { ...bad, modifier: { ...bad.modifier, amount: NaN } };
    expect(validateWarpPlan(nan).errors.length).toBeGreaterThan(0);
  });

  it('rejects missing request identity', () => {
    const plan = makeWarpPlan(
      'req-1',
      'rev-1',
      ['n1'],
      makeWarpPreset('arch'),
      'deterministic-path',
    );
    expect(validateWarpPlan({ ...plan, requestId: '' }).errors.length).toBeGreaterThan(0);
  });
});

describe('deterministic fitting', () => {
  it('fits a perspective modifier from a world quad', () => {
    const p = perspectiveFromQuad(
      [
        { x: 10, y: 20 },
        { x: 210, y: 20 },
        { x: 210, y: 120 },
        { x: 10, y: 120 },
      ],
      BOUNDS,
    );
    expect(p).not.toBeNull();
    expect(p!.corners.tl).toMatchObject({ x: 0, y: 0 });
    expect(p!.corners.br).toMatchObject({ x: 1, y: 1 });
  });

  it('fits an envelope edge to a straight top path with near-zero error', () => {
    const ring = Array.from({ length: 9 }, (_, i) => ({
      x: 10 + i * 25,
      y: 20,
      handleIn: null as [number, number] | null,
      handleOut: null as [number, number] | null,
    }));
    const { modifier, fitError } = fitEnvelopeFromPath(ring, BOUNDS, 'top');
    expect(modifier.kind).toBe('envelope');
    expect(fitError).toBeLessThan(0.02);
    // Endpoints pinned to bounds corners
    expect(modifier.corners.tl).toMatchObject({ x: 0, y: 0 });
    expect(modifier.corners.tr).toMatchObject({ x: 1, y: 0 });
  });

  it('presets produce ordinary validated modifiers', () => {
    for (const kind of ['skew-horizontal', 'arch', 'flag', 'four-edge', 'mesh-4x4'] as const) {
      const m = makeWarpPreset(kind);
      expect(m.id.length).toBeGreaterThan(0);
      const v = validateWarpPlan({
        schemaVersion: 1,
        requestId: 'r',
        selectionRevision: 's',
        sourceNodeIds: ['n'],
        modifier: m,
        warnings: [],
        assumptions: [],
        derivedFrom: 'user',
      });
      expect(v.plan, kind).not.toBeNull();
    }
  });
});

describe('compound paths under warp', () => {
  it('warped path preserves holes and fill rule', () => {
    const shape: Shape = {
      kind: 'path',
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 200, y: 0, handleIn: null, handleOut: null },
        { x: 200, y: 100, handleIn: null, handleOut: null },
        { x: 0, y: 100, handleIn: null, handleOut: null },
      ],
      closed: true,
      tolerance: 0.5,
      holes: [
        [
          { x: 20, y: 20, handleIn: null, handleOut: null },
          { x: 40, y: 20, handleIn: null, handleOut: null },
          { x: 40, y: 40, handleIn: null, handleOut: null },
          { x: 20, y: 40, handleIn: null, handleOut: null },
        ],
      ],
      fillRule: 'evenodd',
    };
    const { shape: out } = warpShapeToPath(shape, [makeWarpPreset('arch')], BOUNDS, {
      quality: { profile: 'high' },
    });
    if (out.kind !== 'path') throw new Error('expected path');
    expect(out.holes).toHaveLength(1);
    expect(out.fillRule).toBe('evenodd');
    expect(out.closed).toBe(true);
  });
});
