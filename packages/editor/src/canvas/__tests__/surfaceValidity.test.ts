/**
 * Retained-pixel validity for partial redraw.
 *
 * A partial redraw repaints only the dirty rects and keeps everything else
 * from the previous frame. Those retained pixels are only correct while the
 * camera and the backing store are identical to when they were painted — a
 * pan, zoom or resize moves or discards every one of them. These tests pin
 * that contract and the prune/paint gate agreement that depends on it.
 */

import { describe, expect, it } from 'vitest';
import { computeDirtyPruneDecision } from '../dirtyQuery';
import {
  type PaintedSurfaceIdentity,
  paintedSurfaceAfterFrame,
  resolveFullRedrawReason,
  surfaceMatchesBackingStore,
} from '../dirtyRegion';
import type { DirtyMergeResult } from '../dirtyRegionMerge';

const painted: PaintedSurfaceIdentity = {
  zoom: 1,
  panX: 100,
  panY: 50,
  rotation: 0,
  dpr: 2,
  surfaceW: 1600,
  surfaceH: 1200,
};

describe('surfaceMatchesBackingStore', () => {
  it('matches when nothing changed', () => {
    expect(surfaceMatchesBackingStore(painted, { ...painted })).toBe('match');
  });

  it('reports never-painted before the first frame', () => {
    expect(surfaceMatchesBackingStore(null, painted)).toBe('never-painted');
  });

  it('rejects a horizontal pan (the scroll case)', () => {
    expect(surfaceMatchesBackingStore(painted, { ...painted, panX: 140 })).toBe('camera-moved');
  });

  it('rejects a vertical pan', () => {
    expect(surfaceMatchesBackingStore(painted, { ...painted, panY: 51 })).toBe('camera-moved');
  });

  it('rejects a sub-pixel pan — retained pixels still shift', () => {
    expect(surfaceMatchesBackingStore(painted, { ...painted, panX: 100.25 })).toBe('camera-moved');
  });

  it('rejects zoom and rotation changes', () => {
    expect(surfaceMatchesBackingStore(painted, { ...painted, zoom: 1.1 })).toBe('camera-moved');
    expect(surfaceMatchesBackingStore(painted, { ...painted, rotation: 0.01 })).toBe(
      'camera-moved',
    );
  });

  it('rejects a resized or re-scaled backing store', () => {
    expect(surfaceMatchesBackingStore(painted, { ...painted, surfaceW: 1601 })).toBe(
      'surface-resized',
    );
    expect(surfaceMatchesBackingStore(painted, { ...painted, surfaceH: 900 })).toBe(
      'surface-resized',
    );
    expect(surfaceMatchesBackingStore(painted, { ...painted, dpr: 1 })).toBe('surface-resized');
  });

  it('prefers surface-resized over camera-moved when both changed', () => {
    expect(surfaceMatchesBackingStore(painted, { ...painted, panX: 0, surfaceW: 800 })).toBe(
      'surface-resized',
    );
  });
});

describe('resolveFullRedrawReason surface attribution', () => {
  const base = {
    rotation: 0,
    profileEnablePartialRedraw: true,
    dirtyRectArea: 100,
    viewportArea: 1_000,
    hasDirtyRect: true,
  };

  it('attributes a camera move so no full redraw is unexplained', () => {
    expect(resolveFullRedrawReason({ ...base, surfaceMatch: 'camera-moved' })).toBe('camera-moved');
  });

  it('attributes a resized or never-painted surface', () => {
    expect(resolveFullRedrawReason({ ...base, surfaceMatch: 'surface-resized' })).toBe(
      'surface-stale',
    );
    expect(resolveFullRedrawReason({ ...base, surfaceMatch: 'never-painted' })).toBe(
      'surface-stale',
    );
  });

  it('defaults to a match so existing callers keep their attribution', () => {
    expect(resolveFullRedrawReason(base)).toBeNull();
  });
});

describe('computeDirtyPruneDecision surface gate', () => {
  const merged: DirtyMergeResult = {
    rects: [{ x: 0, y: 0, w: 20, h: 20 }],
    beforeCount: 1,
    afterCount: 1,
    sumAreaBefore: 400,
    sumAreaAfter: 400,
    unionAreaAfter: 400,
    amplification: 1,
    overflowed: 0,
    mergesApplied: 0,
    fallback: 'none',
  };
  const opts = {
    dirtyKind: 'partial' as const,
    merged,
    profileEnablePartialRedraw: true,
    rotation: 0,
    dirtyScreenRect: { x: 0, y: 0, w: 20, h: 20 },
    viewportW: 800,
    viewportH: 600,
    workerWillRender: false,
    worldToScreen: (wx: number, wy: number) => [wx, wy] as const,
  };

  it('prunes when the backing store matches', () => {
    const decision = computeDirtyPruneDecision({ ...opts, surfaceMatch: 'match' });
    expect(decision.screenRects).not.toBeNull();
    expect(decision.worldRects).not.toBeNull();
  });

  it('refuses to prune after a pan — a pruned replay on a cleared surface erases the scene', () => {
    const decision = computeDirtyPruneDecision({ ...opts, surfaceMatch: 'camera-moved' });
    expect(decision.screenRects).toBeNull();
    expect(decision.worldRects).toBeNull();
  });

  it('refuses to prune on a resized or never-painted surface', () => {
    expect(
      computeDirtyPruneDecision({ ...opts, surfaceMatch: 'surface-resized' }).worldRects,
    ).toBeNull();
    expect(
      computeDirtyPruneDecision({ ...opts, surfaceMatch: 'never-painted' }).worldRects,
    ).toBeNull();
  });

  it('defaults to pruning when no surface match is supplied', () => {
    expect(computeDirtyPruneDecision(opts).worldRects).not.toBeNull();
  });
});

describe('paintedSurfaceAfterFrame', () => {
  const surface: PaintedSurfaceIdentity = {
    zoom: 1,
    panX: 0,
    panY: 0,
    rotation: 0,
    dpr: 2,
    surfaceW: 800,
    surfaceH: 600,
  };

  it('records the surface when the frame rendered it authoritatively', () => {
    expect(paintedSurfaceAfterFrame(surface, true)).toEqual(surface);
  });

  it('records nothing when the frame only approximated the camera', () => {
    // The reprojected-worker-bitmap path: a resampled older frame composited
    // under a camera it was never rendered for.
    expect(paintedSurfaceAfterFrame(surface, false)).toBeNull();
  });

  it('forces a full redraw on the next frame after an approximated one', () => {
    // The invariant that matters: an approximated frame must not authorise a
    // partial redraw over its own non-authoritative pixels. 'never-painted' is
    // already pinned above as refusing both the paint and the prune gate.
    const recorded = paintedSurfaceAfterFrame(surface, false);
    expect(surfaceMatchesBackingStore(recorded, surface)).toBe('never-painted');
  });

  it('keeps an authoritative frame on the partial-redraw path', () => {
    // The fix must not turn every worker frame into a full redraw: an exact
    // camera match still retains its pixels.
    const recorded = paintedSurfaceAfterFrame(surface, true);
    expect(surfaceMatchesBackingStore(recorded, surface)).toBe('match');
  });
});
