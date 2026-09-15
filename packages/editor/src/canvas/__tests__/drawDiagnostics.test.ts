// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameDiagnostics } from '../drawDiagnostics';
import {
  enableDrawDiagnostics,
  getFrameCount,
  getLastFrame,
  getRecentFrames,
  isDiagnosticsEnabled,
  isDiagnosticsFrozen,
  recordFrame,
  renderDrawDiagnostics,
  resetDiagnostics,
  resolveDirtyScreenRect,
  setDiagnosticsFrozen,
} from '../drawDiagnostics';

function makeFrame(overrides?: Partial<FrameDiagnostics>): FrameDiagnostics {
  return {
    frameIndex: 0,
    docVersion: 1,
    redrawCount: 0,
    nodeCount: 0,
    culledCount: 0,
    cacheHitCount: 0,
    buildIrMs: 0,
    replayMs: 0,
    totalMs: 0,
    renderPath: 'structural',
    wasDirty: false,
    partialRedraw: false,
    ...overrides,
  };
}

beforeEach(() => {
  resetDiagnostics();
  setDiagnosticsFrozen(false);
});

describe('drawDiagnostics', () => {
  it('recording is disabled by default', () => {
    expect(isDiagnosticsEnabled()).toBe(false);
    recordFrame(makeFrame());
    expect(getFrameCount()).toBe(0);
  });

  it('does not enable the overlay when called without an explicit opt-in', () => {
    enableDrawDiagnostics();
    expect(isDiagnosticsEnabled()).toBe(false);
  });

  it('can be force-enabled and records frames', () => {
    enableDrawDiagnostics(true);
    expect(isDiagnosticsEnabled()).toBe(true);
    recordFrame(makeFrame({ frameIndex: 1 }));
    recordFrame(makeFrame({ frameIndex: 2 }));
    expect(getFrameCount()).toBe(2);
  });

  it('can be force-disabled after being enabled', () => {
    enableDrawDiagnostics(true);
    expect(isDiagnosticsEnabled()).toBe(true);
    enableDrawDiagnostics(false);
    expect(isDiagnosticsEnabled()).toBe(false);
    recordFrame(makeFrame({ frameIndex: 1 }));
    expect(getFrameCount()).toBe(0);
  });

  it('omitting the argument resolves to disabled, never an environment auto-detect', () => {
    enableDrawDiagnostics(true);
    expect(isDiagnosticsEnabled()).toBe(true);
    enableDrawDiagnostics();
    expect(isDiagnosticsEnabled()).toBe(false);
  });

  it('getLastFrame returns null when empty', () => {
    enableDrawDiagnostics(true);
    expect(getLastFrame()).toBeNull();
  });

  it('getLastFrame returns the most recent frame', () => {
    enableDrawDiagnostics(true);
    recordFrame(makeFrame({ frameIndex: 1 }));
    recordFrame(makeFrame({ frameIndex: 2 }));
    const last = getLastFrame();
    expect(last).not.toBeNull();
    expect(last!.frameIndex).toBe(2);
  });

  it('getRecentFrames(n) returns at most n frames', () => {
    enableDrawDiagnostics(true);
    for (let i = 1; i <= 20; i++) {
      recordFrame(makeFrame({ frameIndex: i }));
    }
    expect(getRecentFrames(5)).toHaveLength(5);
    expect(getRecentFrames(100)).toHaveLength(20);
  });

  it('getRecentFrames returns last n frames in order', () => {
    enableDrawDiagnostics(true);
    for (let i = 1; i <= 10; i++) {
      recordFrame(makeFrame({ frameIndex: i }));
    }
    const recent = getRecentFrames(3);
    expect(recent.map((f) => f.frameIndex)).toEqual([8, 9, 10]);
  });

  it('resetDiagnostics clears all frames', () => {
    enableDrawDiagnostics(true);
    recordFrame(makeFrame({ frameIndex: 1 }));
    recordFrame(makeFrame({ frameIndex: 2 }));
    expect(getFrameCount()).toBe(2);
    resetDiagnostics();
    expect(getFrameCount()).toBe(0);
    expect(getLastFrame()).toBeNull();
  });

  it('ring buffer does not exceed MAX_DIAG_FRAMES', () => {
    enableDrawDiagnostics(true);
    const max = 120;
    for (let i = 1; i <= max + 50; i++) {
      recordFrame(makeFrame({ frameIndex: i }));
    }
    expect(getFrameCount()).toBeLessThanOrEqual(max);
    expect(getFrameCount()).toBe(max);
    const last = getLastFrame();
    expect(last).not.toBeNull();
    expect(last!.frameIndex).toBe(max + 50);
    const first = getRecentFrames(max)[0];
    expect(first.frameIndex).toBe(51);
  });

  it('recording continues after reset when diagnostics remain enabled', () => {
    enableDrawDiagnostics(true);
    recordFrame(makeFrame());
    expect(getFrameCount()).toBe(1);
    resetDiagnostics();
    expect(getFrameCount()).toBe(0);
    recordFrame(makeFrame());
    expect(getFrameCount()).toBe(1);
  });

  it('freezes and resumes the current diagnostics frame', () => {
    enableDrawDiagnostics(true);
    recordFrame(makeFrame({ frameIndex: 1 }));
    setDiagnosticsFrozen(true);
    expect(isDiagnosticsFrozen()).toBe(true);
    recordFrame(makeFrame({ frameIndex: 2 }));
    expect(getLastFrame()?.frameIndex).toBe(1);

    setDiagnosticsFrozen(false);
    recordFrame(makeFrame({ frameIndex: 3 }));
    expect(getLastFrame()?.frameIndex).toBe(3);
  });

  it('draws the merged dirty screen rectangle for a partial frame', () => {
    enableDrawDiagnostics(true);
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext('2d')!;
    const strokeRect = vi.spyOn(ctx, 'strokeRect');
    recordFrame(
      makeFrame({
        partialRedraw: true,
        dirtyScreenRect: { x: 10, y: 20, w: 120, h: 80 },
      }),
    );

    renderDrawDiagnostics(ctx, canvas.width);

    expect(strokeRect).toHaveBeenCalledWith(10, 20, 120, 80);
  });

  it('converts CSS-pixel dirty bounds to backing-store pixels only for partial redraw', () => {
    expect(resolveDirtyScreenRect(true, { x: 5, y: 10, w: 20, h: 30 }, 2)).toEqual({
      x: 10,
      y: 20,
      w: 40,
      h: 60,
    });
    expect(resolveDirtyScreenRect(false, { x: 5, y: 10, w: 20, h: 30 }, 2)).toBeUndefined();
    expect(resolveDirtyScreenRect(true, null, 2)).toBeUndefined();
  });

  // Regression guard for the diagnostics blind spot that hid the image-src
  // hashing cost: the per-frame hash-loop time (hashMs) must survive round-trip
  // through the ring buffer so it can be surfaced in the HUD.
  describe('hashMs (per-frame hash-loop timing)', () => {
    it('records and returns hashMs on a frame', () => {
      enableDrawDiagnostics(true);
      recordFrame(
        makeFrame({ frameIndex: 7, hashMs: 6.2, buildIrMs: 1, replayMs: 2, totalMs: 12 }),
      );
      expect(getLastFrame()!.hashMs).toBe(6.2);
    });

    it('renders the HUD without throwing whether hashMs is present or absent', () => {
      enableDrawDiagnostics(true);
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = canvas.getContext('2d')!;
      recordFrame(makeFrame({ hashMs: 6.2, buildIrMs: 1, replayMs: 2, totalMs: 12 }));
      expect(() => renderDrawDiagnostics(ctx, 800)).not.toThrow();
      resetDiagnostics();
      // hashMs omitted (pre-existing frame shape) must still render.
      recordFrame(makeFrame({ buildIrMs: 1, replayMs: 2, totalMs: 12 }));
      expect(() => renderDrawDiagnostics(ctx, 800)).not.toThrow();
    });
  });
});
