/**
 * Snap optimization parity + scaling tests.
 *
 * The midpoint and spacing snap rules were changed from canonical O(k²) pair
 * scans to O(k log k) sorted binary searches. These tests prove the optimized
 * evaluator produces byte-identical results to a full canonical reference
 * implementation across randomized scenes, and that fine-phase cost now
 * scales near-linearly instead of quadratically.
 */
import { describe, expect, it } from 'vitest';
import {
  createSnapSession,
  type GridSnapConfig,
  type SnapGuide,
  type SnapOptions,
  type SnapResult,
  type SnapSession,
  snapPosition,
} from '../snapping';

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Canonical O(k²) reference: byte-for-byte the original midpoint and spacing
 * pair scans, wired into the same rule cascade as the optimized evaluator.
 */
function snapPositionCanonical(
  x: number,
  y: number,
  w: number,
  h: number,
  otherBounds: Bounds[],
  grid?: number | GridSnapConfig,
  snapExcludedIds?: Set<string>,
  options: SnapOptions = {},
): SnapResult & { session: SnapSession } {
  const zoom = options.zoom ?? 1;
  const sticky = options.sticky !== false;
  const thresh = 8 / Math.max(0.001, zoom);
  const release = thresh * 1.5;
  let session: SnapSession = options.session ?? { stickyX: null, stickyY: null };

  let snappedX = x;
  let snappedY = y;
  const guides: SnapGuide[] = [];

  const activeBounds =
    snapExcludedIds && snapExcludedIds.size > 0
      ? otherBounds.filter((_, i) => !snapExcludedIds.has(String(i)))
      : otherBounds;

  const cx = x + w / 2;
  const cy = y + h / 2;
  const edges = { left: x, right: x + w, centerX: cx, top: y, bottom: y + h, centerY: cy };

  let bestXDiff = Infinity;
  let bestXSnap = x;
  let bestXGuide: SnapGuide | null = null;
  let bestXPriority = -1;
  let bestYDiff = Infinity;
  let bestYSnap = y;
  let bestYGuide: SnapGuide | null = null;
  let bestYPriority = -1;

  const compete = (
    candidatePrio: number,
    candidateDiff: number,
    bestPrio: number,
    bestDiff: number,
  ): boolean =>
    candidatePrio > bestPrio || (candidatePrio === bestPrio && candidateDiff < bestDiff);

  if (grid !== undefined && grid !== null) {
    const gridConfig = typeof grid === 'number' ? { spacingX: grid, spacingY: grid } : grid;
    if (gridConfig.spacingX > 0 && gridConfig.spacingY > 0) {
      const gx =
        Math.round((x - (gridConfig.offsetX ?? 0)) / gridConfig.spacingX) * gridConfig.spacingX +
        (gridConfig.offsetX ?? 0);
      const gy =
        Math.round((y - (gridConfig.offsetY ?? 0)) / gridConfig.spacingY) * gridConfig.spacingY +
        (gridConfig.offsetY ?? 0);
      const dx = Math.abs(gx - x);
      const dy = Math.abs(gy - y);
      if (dx < thresh && compete(100, dx, bestXPriority, bestXDiff)) {
        bestXDiff = dx;
        bestXSnap = gx;
        bestXGuide = { axis: 'vertical', position: gx, label: `${gx}px`, type: 'edge' };
        bestXPriority = 100;
      }
      if (dy < thresh && compete(100, dy, bestYPriority, bestYDiff)) {
        bestYDiff = dy;
        bestYSnap = gy;
        bestYGuide = { axis: 'horizontal', position: gy, label: `${gy}px`, type: 'edge' };
        bestYPriority = 100;
      }
    }
  }

  if (options.layoutGridStep && options.layoutGridStep > 0) {
    const step = options.layoutGridStep;
    const lx = Math.round(x / step) * step;
    const ly = Math.round(y / step) * step;
    const dx = Math.abs(lx - x);
    const dy = Math.abs(ly - y);
    if (dx < thresh && compete(85, dx, bestXPriority, bestXDiff)) {
      bestXDiff = dx;
      bestXSnap = lx;
      bestXGuide = { axis: 'vertical', position: lx, type: 'edge' };
      bestXPriority = 85;
    }
    if (dy < thresh && compete(85, dy, bestYPriority, bestYDiff)) {
      bestYDiff = dy;
      bestYSnap = ly;
      bestYGuide = { axis: 'horizontal', position: ly, type: 'edge' };
      bestYPriority = 85;
    }
  }

  if (options.pixelGridSnap) {
    const px = Math.round(x);
    const py = Math.round(y);
    const dx = Math.abs(px - x);
    const dy = Math.abs(py - y);
    if (dx < thresh && compete(100, dx, bestXPriority, bestXDiff)) {
      bestXDiff = dx;
      bestXSnap = px;
      bestXGuide = { axis: 'vertical', position: px, label: `${px}px`, type: 'edge' };
      bestXPriority = 100;
    }
    if (dy < thresh && compete(100, dy, bestYPriority, bestYDiff)) {
      bestYDiff = dy;
      bestYSnap = py;
      bestYGuide = { axis: 'horizontal', position: py, label: `${py}px`, type: 'edge' };
      bestYPriority = 100;
    }
  }

  if (options.guideTargets && options.guideTargets.length > 0) {
    for (const guide of options.guideTargets) {
      if (guide.axis === 'vertical') {
        for (const key of ['left', 'centerX', 'right'] as const) {
          const diff = edges[key] - guide.position;
          const absDiff = Math.abs(diff);
          if (absDiff < thresh && compete(90, absDiff, bestXPriority, bestXDiff)) {
            bestXDiff = absDiff;
            bestXSnap = x - diff;
            bestXGuide = {
              axis: 'vertical',
              position: guide.position,
              distance: absDiff,
              type: 'guide',
              label: 'guide',
            };
            bestXPriority = 90;
          }
        }
      } else {
        for (const key of ['top', 'centerY', 'bottom'] as const) {
          const diff = edges[key] - guide.position;
          const absDiff = Math.abs(diff);
          if (absDiff < thresh && compete(90, absDiff, bestYPriority, bestYDiff)) {
            bestYDiff = absDiff;
            bestYSnap = y - diff;
            bestYGuide = {
              axis: 'horizontal',
              position: guide.position,
              distance: absDiff,
              type: 'guide',
              label: 'guide',
            };
            bestYPriority = 90;
          }
        }
      }
    }
  }

  // Canonical midpoint — the original O(k²) pair scan.
  for (let i = 0; i < activeBounds.length; i++) {
    const a = activeBounds[i]!;
    for (let j = i + 1; j < activeBounds.length; j++) {
      const b = activeBounds[j]!;
      const midX = (a.x + a.w / 2 + b.x + b.w / 2) / 2;
      const midY = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
      const dmx = Math.abs(cx - midX);
      const dmy = Math.abs(cy - midY);
      if (dmx < thresh && compete(50, dmx, bestXPriority, bestXDiff)) {
        bestXDiff = dmx;
        bestXSnap = x - (cx - midX);
        bestXGuide = { axis: 'vertical', position: midX, type: 'midpoint', label: 'mid' };
        bestXPriority = 50;
      }
      if (dmy < thresh && compete(50, dmy, bestYPriority, bestYDiff)) {
        bestYDiff = dmy;
        bestYSnap = y - (cy - midY);
        bestYGuide = { axis: 'horizontal', position: midY, type: 'midpoint', label: 'mid' };
        bestYPriority = 50;
      }
    }
  }

  for (const b of activeBounds) {
    const bEdges = {
      left: b.x,
      right: b.x + b.w,
      centerX: b.x + b.w / 2,
      top: b.y,
      bottom: b.y + b.h,
      centerY: b.y + b.h / 2,
    };
    for (const key of ['left', 'centerX', 'right'] as const) {
      const diff = edges[key] - bEdges[key];
      const absDiff = Math.abs(diff);
      const prio = key === 'centerX' ? 70 : 80;
      if (absDiff < thresh && compete(prio, absDiff, bestXPriority, bestXDiff)) {
        bestXDiff = absDiff;
        bestXSnap = x - diff;
        bestXGuide = {
          axis: 'vertical',
          position: bEdges[key],
          distance: absDiff,
          type: key === 'centerX' ? 'center' : 'edge',
        };
        bestXPriority = prio;
      }
    }
    for (const key of ['top', 'centerY', 'bottom'] as const) {
      const diff = edges[key] - bEdges[key];
      const absDiff = Math.abs(diff);
      const prio = key === 'centerY' ? 70 : 80;
      if (absDiff < thresh && compete(prio, absDiff, bestYPriority, bestYDiff)) {
        bestYDiff = absDiff;
        bestYSnap = y - diff;
        bestYGuide = {
          axis: 'horizontal',
          position: bEdges[key],
          distance: absDiff,
          type: key === 'centerY' ? 'center' : 'edge',
        };
        bestYPriority = prio;
      }
    }
  }

  const trySticky = (
    currentCoord: number,
    proposedCoord: number,
    guidePosition: number,
    session: SnapSession['stickyX'],
    stickyOn: boolean,
  ): { coord: number; session: SnapSession['stickyX']; snapped: boolean } => {
    if (stickyOn && session && Math.abs(currentCoord - session.snappedCoord) < release) {
      return { coord: session.snappedCoord, session, snapped: true };
    }
    return {
      coord: proposedCoord,
      session: { guidePosition, snappedCoord: proposedCoord },
      snapped: true,
    };
  };

  if (bestXGuide) {
    const r = trySticky(x, bestXSnap, bestXGuide.position, session.stickyX, sticky);
    snappedX = r.coord;
    session = { ...session, stickyX: r.snapped ? r.session : null };
    if (r.snapped || !sticky) guides.push(bestXGuide);
  } else if (sticky && session.stickyX) {
    const hold = trySticky(x, x, session.stickyX.guidePosition, session.stickyX, true);
    if (hold.snapped) snappedX = hold.coord;
    else session = { ...session, stickyX: null };
  }
  if (bestYGuide) {
    const r = trySticky(y, bestYSnap, bestYGuide.position, session.stickyY, sticky);
    snappedY = r.coord;
    session = { ...session, stickyY: r.snapped ? r.session : null };
    if (r.snapped || !sticky) guides.push(bestYGuide);
  } else if (sticky && session.stickyY) {
    const hold = trySticky(y, y, session.stickyY.guidePosition, session.stickyY, true);
    if (hold.snapped) snappedY = hold.coord;
    else session = { ...session, stickyY: null };
  }

  // Canonical spacing — the original O(k²) pair scan.
  const xGaps: { mid: number; gap: number }[] = [];
  const yGaps: { mid: number; gap: number }[] = [];
  for (const a of otherBounds) {
    for (const b of otherBounds) {
      if (a === b) continue;
      const gapX = b.x - (a.x + a.w);
      if (gapX > 0 && a.x + a.w < cx && b.x > cx) {
        xGaps.push({ mid: (a.x + a.w + b.x) / 2, gap: gapX });
      }
      const gapY = b.y - (a.y + a.h);
      if (gapY > 0 && a.y + a.h < cy && b.y > cy) {
        yGaps.push({ mid: (a.y + a.h + b.y) / 2, gap: gapY });
      }
    }
  }
  if (xGaps.length > 0) {
    const best = xGaps.reduce((a, b) =>
      Math.abs(a.gap - (a.mid - cx)) < Math.abs(b.gap - (b.mid - cx)) ? a : b,
    );
    const dmx = Math.abs(cx - best.mid);
    if (dmx < thresh * 3 && compete(30, dmx, bestXPriority, bestXDiff)) {
      snappedX = x - (cx - best.mid);
      guides.push({
        axis: 'vertical',
        position: best.mid,
        type: 'spacing',
        label: `${Math.round(best.gap)}px`,
      });
    }
  }
  if (yGaps.length > 0) {
    const best = yGaps.reduce((a, b) =>
      Math.abs(a.gap - (a.mid - cy)) < Math.abs(b.gap - (b.mid - cy)) ? a : b,
    );
    const dmy = Math.abs(cy - best.mid);
    if (dmy < thresh * 3 && compete(30, dmy, bestYPriority, bestYDiff)) {
      snappedY = y - (cy - best.mid);
      guides.push({
        axis: 'horizontal',
        position: best.mid,
        type: 'spacing',
        label: `${Math.round(best.gap)}px`,
      });
    }
  }

  return { x: snappedX, y: snappedY, guides, session };
}

function normalizeGuides(guides: SnapGuide[]): Array<[string, number, number, string]> {
  return guides.map((g) => [
    g.axis,
    g.position,
    g.distance ?? -1,
    `${g.type ?? ''}:${g.label ?? ''}`,
  ]);
}

function randomScene(rand: () => number, count: number): Bounds[] {
  const bounds: Bounds[] = [];
  for (let i = 0; i < count; i++) {
    bounds.push({
      x: rand() * 600 - 100,
      y: rand() * 600 - 100,
      w: 20 + rand() * 160,
      h: 20 + rand() * 160,
    });
  }
  return bounds;
}

function compareOne(
  x: number,
  y: number,
  bounds: Bounds[],
  options: SnapOptions,
  grid?: number | GridSnapConfig,
  excluded?: Set<string>,
): void {
  const fast = snapPosition(x, y, 40, 40, bounds, grid, excluded, options);
  const canonical = snapPositionCanonical(x, y, 40, 40, bounds, grid, excluded, options);
  expect({ x: fast.x, y: fast.y }).toEqual({ x: canonical.x, y: canonical.y });
  expect(normalizeGuides(fast.guides).sort()).toEqual(normalizeGuides(canonical.guides).sort());
}

describe('snapPosition parity (optimized vs canonical O(k²))', () => {
  it('randomized scenes across densities, zooms, and snap options match the canonical evaluator', () => {
    let seed = 1;
    for (let scene = 0; scene < 40; scene++) {
      const rand = rng(seed++);
      const count = 2 + Math.floor(rand() * 14);
      const bounds = randomScene(rand, count);
      const zoom = [0.5, 1, 2, 3.5][Math.floor(rand() * 4)]!;
      const useGrid = rand() > 0.5;
      const grid = useGrid
        ? rand() > 0.5
          ? 12
          : { spacingX: 16, spacingY: 24, offsetX: 3 }
        : undefined;
      const guideTargets =
        rand() > 0.6
          ? [
              { axis: 'vertical' as const, position: 120 + rand() * 100 },
              { axis: 'horizontal' as const, position: 80 + rand() * 100 },
            ]
          : undefined;
      const pixelGridSnap = rand() > 0.8;
      const layoutGridStep = rand() > 0.85 ? 32 : undefined;
      const session = createSnapSession();

      for (let trial = 0; trial < 12; trial++) {
        const x = -80 + rand() * 560;
        const y = -80 + rand() * 560;
        compareOne(
          x,
          y,
          bounds,
          { zoom, guideTargets, pixelGridSnap, layoutGridStep, session },
          grid,
        );
        // Sticky-hysteresis pass: reuse the session from the previous call.
        compareOne(x + 2, y + 1, bounds, { zoom, guideTargets, session, sticky: true }, grid);
      }
    }
  });

  it('snapExcludedIds exclusion parity', () => {
    const rand = rng(999);
    for (let scene = 0; scene < 12; scene++) {
      const bounds = randomScene(rand, 3 + Math.floor(rand() * 6));
      const excluded = new Set([String(Math.floor(rand() * bounds.length))]);
      compareOne(100 + rand() * 100, 100 + rand() * 100, bounds, { zoom: 1 }, undefined, excluded);
    }
  });

  it('dense evenly-spaced grids (the common midpoint/gap case) match', () => {
    const bounds: Bounds[] = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        bounds.push({ x: col * 120, y: row * 120, w: 60, h: 60 });
      }
    }
    for (let x = 0; x < 480; x += 13) {
      for (let y = 0; y < 480; y += 17) {
        compareOne(x, y, bounds, { zoom: 1 });
      }
    }
  });
});

describe('snapPosition fine-phase scaling', () => {
  function makeDenseCluster(count: number): Bounds[] {
    const bounds: Bounds[] = [];
    const cols = Math.ceil(Math.sqrt(count));
    for (let i = 0; i < count; i++) {
      bounds.push({ x: (i % cols) * 50, y: Math.floor(i / cols) * 50, w: 30, h: 30 });
    }
    return bounds;
  }

  function measureP95(count: number, samples = 800): number {
    const candidates = makeDenseCluster(count);
    const times: number[] = [];
    for (let s = 0; s < samples; s++) {
      const x = 150 + Math.sin(s) * 40;
      const y = 150 + Math.cos(s) * 40;
      const t0 = performance.now();
      snapPosition(x, y, 30, 30, candidates, undefined, undefined, { zoom: 1 });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length * 0.95)] ?? 0;
  }

  it('fine-phase cost scales near-linearly, not quadratically, with candidate count', () => {
    // Load-independent gate: the pre-optimization O(k²) pair scans cost ~64x
    // more at k=800 than at k=100; the near-linear evaluator should be well
    // under the 8x proportional bound even on a noisy shared runner. Absolute
    // wall-clock ceilings on shared CI are flaky, so assert the RATIO and keep
    // only a generous absolute sanity cap.
    const p95Base = Math.max(measureP95(100), 0.01);
    const p95Big = measureP95(800);
    const ratio = p95Big / p95Base;
    expect(ratio).toBeLessThan(12);
    // Absolute sanity: pre-optimization p95 at k=800 measured ~59ms; current
    // runs ~1.5ms. 25ms is a generous load-tolerant ceiling that still catches
    // a full regression to the quadratic pair scans.
    expect(p95Big).toBeLessThan(25);
    console.log(
      `[snap-scaling] k=100 p95=${p95Base.toFixed(2)}ms  k=800 p95=${p95Big.toFixed(2)}ms  ratio=${ratio.toFixed(1)}x`,
    );
  }, 30_000);
});
