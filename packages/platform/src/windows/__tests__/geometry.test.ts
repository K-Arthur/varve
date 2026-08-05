/**
 * Pure window-geometry tests (ADR-0033) — clamping, fingerprints,
 * matching, cascading, and logical/physical conversion.
 */

import { describe, expect, it } from 'vitest';
import {
  cascadePlacement,
  clampPlacementToWorkArea,
  computeRelativeRole,
  fingerprintFromDisplay,
  logicalToPhysical,
  MIN_DISPLAY_MATCH_SCORE,
  matchDisplayFingerprint,
  physicalToLogical,
  pickDisplayForFingerprint,
  TITLE_BAR_MARGIN,
} from '../geometry';
import type { DisplayInfo } from '../types';

const primary: DisplayInfo = {
  runtimeId: 'p',
  name: 'Primary',
  isPrimary: true,
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};

const right: DisplayInfo = {
  runtimeId: 'r',
  name: 'Right',
  isPrimary: false,
  position: { x: 1920, y: 0 },
  size: { width: 1920, height: 1080 },
  workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};

const left: DisplayInfo = {
  runtimeId: 'l',
  name: 'Left',
  isPrimary: false,
  position: { x: -1920, y: 0 },
  size: { width: 1920, height: 1080 },
  workArea: { x: -1920, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};

function placement(overrides: Partial<import('../types').WindowPlacement> = {}) {
  return {
    displayId: 'p',
    logicalPosition: { x: 100, y: 100 },
    logicalSize: { width: 800, height: 600 },
    state: 'normal' as const,
    ...overrides,
  };
}

describe('clampPlacementToWorkArea', () => {
  it('keeps an already-inside placement unchanged', () => {
    const result = clampPlacementToWorkArea(placement(), primary.workArea, {
      width: 240,
      height: 160,
    });
    expect(result.logicalPosition).toEqual({ x: 100, y: 100 });
    expect(result.logicalSize).toEqual({ width: 800, height: 600 });
  });

  it('clamps position and size into the work area', () => {
    const result = clampPlacementToWorkArea(
      placement({
        logicalPosition: { x: 2000, y: 5000 },
        logicalSize: { width: 5000, height: 5000 },
      }),
      primary.workArea,
      { width: 240, height: 160 },
    );
    expect(result.logicalPosition.x).toBeLessThanOrEqual(
      primary.workArea.width - result.logicalSize.width,
    );
    expect(result.logicalSize.width).toBe(primary.workArea.width);
    expect(result.logicalSize.height).toBe(primary.workArea.height);
  });

  it('keeps the top edge reachable (title bar margin)', () => {
    const result = clampPlacementToWorkArea(
      placement({ logicalPosition: { x: 0, y: -100 } }),
      primary.workArea,
      { width: 240, height: 160 },
    );
    expect(result.logicalPosition.y).toBeGreaterThanOrEqual(primary.workArea.y);
    expect(result.logicalPosition.y).toBeLessThanOrEqual(primary.workArea.y + TITLE_BAR_MARGIN);
  });

  it('handles negative-coordinate displays', () => {
    const result = clampPlacementToWorkArea(
      placement({ logicalPosition: { x: -3000, y: -3000 } }),
      left.workArea,
      { width: 240, height: 160 },
    );
    expect(result.logicalPosition.x).toBeGreaterThanOrEqual(left.workArea.x);
    expect(result.logicalPosition.x).toBeLessThanOrEqual(
      left.workArea.x + left.workArea.width - 240,
    );
  });

  it('passes maximized/fullscreen states through untouched', () => {
    const result = clampPlacementToWorkArea(
      placement({ logicalPosition: { x: 99999, y: 99999 }, state: 'maximized' }),
      primary.workArea,
      { width: 240, height: 160 },
    );
    expect(result.state).toBe('maximized');
    expect(result.logicalPosition.x).toBe(99999);
  });

  it('keeps windows within the work area even when the display is tiny', () => {
    // Reachability wins: a window is never larger than its display work
    // area, even when that is below the panel minimum (ADR-0033).
    const tiny = { x: 0, y: 0, width: 200, height: 150 };
    const result = clampPlacementToWorkArea(placement(), tiny, { width: 240, height: 160 });
    expect(result.logicalSize.width).toBe(200);
    expect(result.logicalSize.height).toBe(150);
  });
});

describe('fingerprints', () => {
  it('computes relative roles against the primary display', () => {
    expect(computeRelativeRole(primary, primary)).toBe('primary');
    expect(computeRelativeRole(right, primary)).toBe('right');
    expect(computeRelativeRole(left, primary)).toBe('left');
    expect(computeRelativeRole({ ...right, position: { x: 0, y: -1080 } }, primary)).toBe('above');
    expect(computeRelativeRole({ ...right, position: { x: 0, y: 1080 } }, primary)).toBe('below');
    expect(computeRelativeRole({ ...right, isPrimary: false }, undefined)).toBeUndefined();
  });

  it('builds a fingerprint without absolute coordinates', () => {
    const fp = fingerprintFromDisplay(right, primary);
    expect(fp.relativeRole).toBe('right');
    expect(fp.resolution).toEqual({ width: 1920, height: 1080 });
    expect('position' in fp).toBe(false);
  });
});

describe('matchDisplayFingerprint', () => {
  it('disqualifies role mismatches', () => {
    const fp = fingerprintFromDisplay(right, primary);
    expect(matchDisplayFingerprint(fp, left, primary)).toBe(0);
    const primaryFp = fingerprintFromDisplay(primary, primary);
    expect(matchDisplayFingerprint(primaryFp, right, primary)).toBe(0);
  });

  it('scores identical displays above the match threshold', () => {
    const fp = fingerprintFromDisplay(right, primary);
    const score = matchDisplayFingerprint(fp, right, primary);
    expect(score).toBeGreaterThanOrEqual(MIN_DISPLAY_MATCH_SCORE);
  });

  it('scores a same-role but different-resolution display below an exact match', () => {
    const fp = fingerprintFromDisplay(right, primary);
    const otherRight = {
      ...right,
      size: { width: 2560, height: 1440 },
      workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
    };
    const exact = matchDisplayFingerprint(fp, right, primary);
    const fuzzy = matchDisplayFingerprint(fp, otherRight, primary);
    expect(fuzzy).toBeLessThan(exact);
  });

  it('requires primary match for primary fingerprints', () => {
    const fp = fingerprintFromDisplay(primary, primary);
    const anotherPrimary = {
      ...primary,
      size: { width: 1280, height: 720 },
      workArea: { x: 0, y: 0, width: 1280, height: 700 },
    };
    expect(matchDisplayFingerprint(fp, anotherPrimary, primary)).toBeGreaterThan(0);
  });
});

describe('pickDisplayForFingerprint', () => {
  it('picks the matching display over the primary fallback', () => {
    const fp = fingerprintFromDisplay(right, primary);
    const picked = pickDisplayForFingerprint(fp, [primary, right, left]);
    expect(picked.runtimeId).toBe('r');
  });

  it('falls back to the primary display when nothing matches', () => {
    const unknown: DisplayInfo = {
      runtimeId: 'weird',
      isPrimary: false,
      position: { x: 1920, y: 0 },
      size: { width: 640, height: 480 },
      workArea: { x: 1920, y: 0, width: 640, height: 440 },
      scaleFactor: 3,
    };
    const fp = fingerprintFromDisplay(right, primary);
    const picked = pickDisplayForFingerprint(fp, [primary, unknown]);
    expect(picked.isPrimary).toBe(true);
  });
});

describe('cascadePlacement', () => {
  it('offsets successive windows diagonally and clamps sizes', () => {
    const first = cascadePlacement(
      right,
      0,
      { width: 800, height: 600 },
      { width: 240, height: 160 },
    );
    const second = cascadePlacement(
      right,
      1,
      { width: 800, height: 600 },
      { width: 240, height: 160 },
    );
    expect(second.logicalPosition.x).toBeGreaterThan(first.logicalPosition.x);
    expect(second.logicalPosition.y).toBeGreaterThan(first.logicalPosition.y);
    expect(first.logicalSize).toEqual({ width: 800, height: 600 });
  });

  it('never places a window off the work area', () => {
    for (let i = 0; i < 200; i += 1) {
      const p = cascadePlacement(
        right,
        i,
        { width: 800, height: 600 },
        { width: 240, height: 160 },
      );
      expect(p.logicalPosition.x).toBeGreaterThanOrEqual(right.workArea.x);
      expect(p.logicalPosition.y).toBeGreaterThanOrEqual(right.workArea.y);
      expect(p.logicalPosition.x + p.logicalSize.width).toBeLessThanOrEqual(
        right.workArea.x + right.workArea.width,
      );
    }
  });
});

describe('logical/physical conversion', () => {
  it('round-trips through scale factor 2', () => {
    const logical = { x: 10, y: 20, width: 300, height: 400 };
    const physical = logicalToPhysical(logical, 2) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    expect(physical).toEqual({ x: 20, y: 40, width: 600, height: 800 });
    const back = physicalToLogical(physical, 2) as typeof logical;
    expect(back).toEqual(logical);
  });

  it('converts sizes separately from positions', () => {
    const size = logicalToPhysical({ width: 300, height: 400 }, 2);
    expect(size).toEqual({ width: 600, height: 800 });
  });
});
