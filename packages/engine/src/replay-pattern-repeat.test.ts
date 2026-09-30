// @vitest-environment jsdom
/**
 * Repeat-lattice regression for pattern fills.
 *
 * These pin the *geometry* the shared `@varve/shared` `patternRepeat`
 * contract produces in the engine: independent gaps, half-drop/brick row
 * shift, mirroring, authored phase, and the zero-gap CanvasPattern fast path
 * (including a sheared half-drop). The older `replay-pattern.test.ts` keeps
 * the hardening cases (fallback, rotation transform) pinned separately.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getImageCache, resetImageCache } from './imageCache';
import type { ReplayTarget } from './replay';
import { replayIr } from './replay';
import type { FillIR, RenderItem } from './types';

function mockImage(width: number, height: number): HTMLImageElement {
  return { naturalWidth: width, naturalHeight: height } as unknown as HTMLImageElement;
}

type PatternFields = Extract<FillIR, { type: 'pattern' }>;

function patternItem(
  fields: Partial<PatternFields>,
  primitive: RenderItem['primitive'] = { kind: 'rect', x: 0, y: 0, w: 30, h: 40 },
): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    fills: [
      {
        type: 'pattern',
        tileSrc: 'tile.png',
        spacing: 0,
        rotation: 0,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        ...fields,
      },
    ],
    primitive,
  };
}

interface Capture {
  target: ReplayTarget;
  draws: Array<{ x: number; y: number; w: number; h: number }>;
  transforms: number[][];
  patternTransforms: Array<Record<string, number>>;
  patternUsed: () => boolean;
}

function capture(overrides: Partial<ReplayTarget> = {}): Capture {
  const draws: Array<{ x: number; y: number; w: number; h: number }> = [];
  const transforms: number[][] = [];
  const patternTransforms: Array<Record<string, number>> = [];
  let used = false;
  const target: ReplayTarget = {
    save: () => undefined,
    restore: () => undefined,
    transform: (...args: number[]) => {
      transforms.push(args);
    },
    translate: () => undefined,
    rotate: () => undefined,
    scale: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    beginPath: () => undefined,
    rect: () => undefined,
    ellipse: () => undefined,
    arc: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    bezierCurveTo: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    closePath: () => undefined,
    clip: () => undefined,
    fillText: () => undefined,
    setLineDash: () => undefined,
    font: '10px sans-serif',
    textBaseline: 'alphabetic',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    textAlign: 'left',
    lineJoin: 'miter',
    strokeStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    lineDashOffset: 0,
    drawImage: (_img, x: number, y: number, w: number, h: number) => {
      draws.push({ x, y, w, h });
    },
    createPattern: () =>
      ({
        setTransform(transform: Record<string, number>) {
          patternTransforms.push(transform);
        },
      }) as unknown as CanvasPattern,
    ...overrides,
  };
  // `patternUsed` is true when createPattern's fillStyle was assigned.
  const tracked = new Proxy(target, {
    set(obj, prop, value) {
      if (prop === 'fillStyle' && value && typeof value === 'object') used = true;
      return Reflect.set(obj, prop, value);
    },
  });
  return {
    target: tracked,
    draws,
    transforms,
    patternTransforms,
    patternUsed: () => used,
  };
}

function xPositionsAtY(draws: Capture['draws'], y: number): number[] {
  return draws
    .filter((d) => Math.abs(d.y - y) < 1e-6)
    .map((d) => d.x)
    .sort((a, b) => a - b);
}

function yPositionsAtX(draws: Capture['draws'], x: number): number[] {
  return draws
    .filter((d) => Math.abs(d.x - x) < 1e-6)
    .map((d) => d.y)
    .sort((a, b) => a - b);
}

beforeEach(() => resetImageCache());

describe('pattern repeat lattice in replay', () => {
  it('lays out an independent vertical gap without scaling the tile', () => {
    getImageCache().setLoaded('tile.png', mockImage(10, 10));
    const cap = capture();
    replayIr(cap.target, [patternItem({ gapX: 0, gapY: 5 })]);

    // Column step is 10, row step is 15 — a gap, not a stretched tile.
    expect(xPositionsAtY(cap.draws, 0)).toEqual([0, 10, 20]);
    expect(xPositionsAtY(cap.draws, 15)).toEqual([0, 10, 20]);
    expect(xPositionsAtY(cap.draws, 30)).toEqual([0, 10, 20]);
    for (const d of cap.draws) {
      expect(d.w).toBe(10);
      expect(d.h).toBe(10);
    }
    expect(cap.draws.some((d) => Math.abs(d.y - 5) < 1e-6)).toBe(false);
  });

  it('half-drop shifts every other column down by half the row step', () => {
    getImageCache().setLoaded('tile.png', mockImage(10, 10));
    const cap = capture();
    replayIr(cap.target, [patternItem({ gapX: 4, gapY: 0, arrangement: 'half-drop' })]);

    const column0 = yPositionsAtX(cap.draws, 0);
    const column1 = yPositionsAtX(cap.draws, 14);
    expect(column0.length).toBeGreaterThan(0);
    expect(column1.length).toBeGreaterThan(0);
    // Row step is 10, so the second column is offset down by exactly 5.
    expect(column1[0]! - column0[0]!).toBeCloseTo(5, 10);
  });

  it('brick honours an explicit row shift fraction', () => {
    getImageCache().setLoaded('tile.png', mockImage(10, 10));
    const cap = capture();
    replayIr(cap.target, [patternItem({ gapX: 4, gapY: 0, arrangement: 'brick', rowShift: 0.25 })]);
    const row0 = xPositionsAtY(cap.draws, 0);
    const row1 = xPositionsAtY(cap.draws, 10);
    expect(row1[0]! - row0[0]!).toBeCloseTo(14 * 0.25, 10);
  });

  it('uses a sheared CanvasPattern for a zero-gap half-drop (no per-tile overdraw)', () => {
    getImageCache().setLoaded('tile.png', mockImage(10, 10));
    const cap = capture();
    replayIr(cap.target, [patternItem({ arrangement: 'half-drop' })]);

    expect(cap.patternUsed()).toBe(true);
    expect(cap.draws).toHaveLength(0);
    expect(cap.patternTransforms).toHaveLength(1);
    // u.y / tileWidth = (0.5 * 10) / 10 = 0.5.
    expect(cap.patternTransforms[0]?.b).toBeCloseTo(0.5, 10);
    expect(cap.patternTransforms[0]?.c).toBeCloseTo(0, 10);
    expect(cap.patternTransforms[0]?.a).toBeCloseTo(1, 10);
    expect(cap.patternTransforms[0]?.d).toBeCloseTo(1, 10);
  });

  it('mirrors alternating columns and keeps every flipped copy in place', () => {
    getImageCache().setLoaded('tile.png', mockImage(10, 10));
    const cap = capture();
    replayIr(cap.target, [patternItem({ mirrorX: true })]);

    // Mirroring cannot use the single-fill fast path.
    expect(cap.patternUsed()).toBe(false);
    const flipped = cap.transforms.filter((t) => t[0] === -1);
    const plain = cap.transforms.filter((t) => t[0] === 1 && t[3] === 1);
    expect(flipped.length).toBeGreaterThan(0);
    expect(plain.length).toBeGreaterThan(0);
    // A flipped copy occupies [p, p + tileWidth]: e = p.x + tileWidth, and p.x
    // is an odd multiple of 10, so e is a multiple of 20.
    for (const t of flipped) {
      expect(Number.isFinite(t[4])).toBe(true);
      expect((t[4] ?? 0) % 20).toBeCloseTo(0, 10);
    }
    // Flipped and plain copies alternate by column parity: of the 3 columns
    // (i = 0, 1, 2) and 4 rows, exactly the odd column flips. The (0,0) copy's
    // matrix is the (excluded) identity, so 11 of the 12 instances appear here.
    const nonIdentity = cap.transforms.filter(
      (t) => !(t[0] === 1 && t[1] === 0 && t[2] === 0 && t[3] === 1 && t[4] === 0 && t[5] === 0),
    );
    expect(nonIdentity).toHaveLength(11);
    expect(nonIdentity.filter((t) => t[0] === -1)).toHaveLength(4);
    for (const d of cap.draws) {
      expect(d.w).toBe(10);
      expect(d.h).toBe(10);
    }
  });

  it('marks an over-budget repeat instead of drawing a partial field', () => {
    getImageCache().setLoaded('tile.png', mockImage(10, 10));
    const warningRects: Array<[number, number, number, number]> = [];
    const cap = capture({
      fillRect: (x, y, w, h) => warningRects.push([x, y, w, h]),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      replayIr(cap.target, [
        patternItem(
          { imageWidth: 0.5, imageHeight: 0.5, gapX: 0.1 },
          { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
        ),
      ]);
      expect(cap.draws).toHaveLength(0);
      expect(warningRects).toContainEqual([0, 0, 100, 100]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('exceeds the renderer instance limit'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('applies an authored phase offset to the lattice origin', () => {
    getImageCache().setLoaded('tile.png', mockImage(10, 10));
    const cap = capture();
    replayIr(cap.target, [patternItem({ offsetX: 3, offsetY: 2 })]);
    expect(cap.patternTransforms).toHaveLength(1);
    // Rotation 0 -> the pattern transform is the phase translation itself.
    expect(cap.patternTransforms[0]?.e).toBeCloseTo(3, 10);
    expect(cap.patternTransforms[0]?.f).toBeCloseTo(2, 10);
  });

  it('treats a non-finite phase as an absent phase', () => {
    getImageCache().setLoaded('tile.png', mockImage(10, 10));
    const cap = capture();
    replayIr(cap.target, [patternItem({ offsetX: Number.NaN, offsetY: Number.POSITIVE_INFINITY })]);
    expect(cap.patternTransforms).toHaveLength(1);
    expect(cap.patternTransforms[0]?.e).toBeCloseTo(0, 10);
    expect(cap.patternTransforms[0]?.f).toBeCloseTo(0, 10);
  });

  it('falls back when an arrangement cannot produce a positive period', () => {
    getImageCache().setLoaded('tile.png', mockImage(8, 8));
    const cap = capture({ fillRect: () => undefined, drawImage: () => undefined });
    expect(() =>
      replayIr(cap.target, [patternItem({ spacing: -8, arrangement: 'half-drop' })]),
    ).not.toThrow();
    expect(cap.draws).toHaveLength(0);
  });

  it('never leaves a stale instance transform after a mirrored walk', () => {
    getImageCache().setLoaded('tile.png', mockImage(10, 10));
    let saveCount = 0;
    let restoreCount = 0;
    const cap = capture({
      save: () => saveCount++,
      restore: () => restoreCount++,
    });
    replayIr(cap.target, [patternItem({ mirrorY: true })]);
    // One save/restore pair per mirrored instance, plus the item and the
    // pattern-branch scope; unwinding must stay balanced.
    expect(restoreCount).toBe(saveCount);
  });
});
