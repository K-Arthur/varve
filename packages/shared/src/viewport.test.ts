import { describe, expect, it } from 'vitest';
import { translate } from './affine';
import {
  animateCamera,
  type Camera,
  centerBoundsCamera,
  clampCamera,
  clampZoom,
  clientToCanvas,
  computeFloatingOrigin,
  fitBoundsCamera,
  fitZoom,
  isRectInView,
  isWorldRectInViewport,
  lerpCamera,
  localRectToScreen,
  MAX_ZOOM,
  MIN_ZOOM,
  resetViewRotation,
  revealBoundsCamera,
  rotateAboutScreenPoint,
  screenDeltaToWorld,
  screenToWorld,
  stepZoom,
  type Viewport,
  worldToScreen,
  worldToScreenAffine,
  zoomAboutPoint,
} from './viewport';

const EPS = 1e-9;
const vp: Viewport = { width: 1920, height: 1080 };

function cam(panX = 0, panY = 0, zoom = 1): Camera {
  return { pan: { x: panX, y: panY }, zoom };
}

describe('clampZoom', () => {
  it('clamps below minimum', () => expect(clampZoom(0.0001)).toBe(MIN_ZOOM));
  it('clamps above maximum', () => expect(clampZoom(100)).toBe(MAX_ZOOM));
  it('passes through in-range values', () => expect(clampZoom(1.5)).toBe(1.5));
});

describe('screen<->world round-trips', () => {
  it('round-trips at zoom=1, pan=(0,0)', () => {
    const c = cam();
    const world = screenToWorld(c, 200, 300);
    const screen = worldToScreen(c, world[0], world[1]);
    expect(Math.abs(screen[0] - 200)).toBeLessThan(EPS);
    expect(Math.abs(screen[1] - 300)).toBeLessThan(EPS);
  });

  it('round-trips at zoom=2.5, pan=(100,-50)', () => {
    const c = cam(100, -50, 2.5);
    const world = screenToWorld(c, 800, 600);
    const screen = worldToScreen(c, world[0], world[1]);
    expect(Math.abs(screen[0] - 800)).toBeLessThan(EPS);
    expect(Math.abs(screen[1] - 600)).toBeLessThan(EPS);
  });

  it('screenDeltaToWorld divides by zoom', () => {
    const c = cam(0, 0, 4);
    const d = screenDeltaToWorld(c, 40, 20);
    expect(Math.abs(d[0] - 10)).toBeLessThan(EPS);
    expect(Math.abs(d[1] - 5)).toBeLessThan(EPS);
  });

  it('screenDeltaToWorld applies inverse rotation when rotation is non-zero', () => {
    const c: Camera = { pan: { x: 0, y: 0 }, zoom: 1, rotation: Math.PI / 2 };
    // A 90° rotation: screen delta (0, 1) should map to world delta (1, 0)
    // (inverse rotation of 90° = -90°: cos(-90)=0, sin(-90)=-1)
    // rx = dx*cos(-r) - dy*sin(-r) = 0*0 - 1*(-1) = 1
    // ry = dx*sin(-r) + dy*cos(-r) = 0*(-1) + 1*0 = 0
    const d = screenDeltaToWorld(c, 0, 1);
    expect(Math.abs(d[0] - 1)).toBeLessThan(1e-9);
    expect(Math.abs(d[1] - 0)).toBeLessThan(1e-9);
  });

  it('screenDeltaToWorld with rotation and zoom composes correctly', () => {
    const c: Camera = { pan: { x: 0, y: 0 }, zoom: 2, rotation: Math.PI / 4 };
    const d = screenDeltaToWorld(c, 10, 0);
    // At 45° rotation, zoom 2: world delta = rotate(-45)(10,0) / 2
    // cos(-45) = √2/2, sin(-45) = -√2/2
    // rx = 10*√2/2 - 0*(-√2/2) = 5√2
    // ry = 10*(-√2/2) + 0*√2/2 = -5√2
    // Then divide by zoom (2): 5√2/2, -5√2/2
    const expected = (5 * Math.SQRT2) / 2;
    expect(d[0]).toBeCloseTo(expected, 6);
    expect(d[1]).toBeCloseTo(-expected, 6);
  });
});

describe('clientToCanvas', () => {
  it('subtracts rect.left/top', () => {
    const rect = { left: 100, top: 80 };
    const p = clientToCanvas(rect, 200, 300);
    expect(p).toEqual([100, 220]);
  });
});

describe('worldToScreenAffine', () => {
  it('produces an affine equivalent to worldToScreen at four corners', () => {
    const c = cam(50, 60, 2);
    const m = worldToScreenAffine(c);
    const pts: [number, number][] = [
      [0, 0],
      [10, 20],
      [-5, 3],
      [100, 200],
    ];
    for (const [wx, wy] of pts) {
      const viaFn = worldToScreen(c, wx, wy);
      const viaM: [number, number] = [m[0] * wx + m[2] * wy + m[4], m[1] * wx + m[3] * wy + m[5]];
      expect(Math.abs(viaFn[0] - viaM[0])).toBeLessThan(EPS);
      expect(Math.abs(viaFn[1] - viaM[1])).toBeLessThan(EPS);
    }
  });
});

describe('isRectInView', () => {
  it('returns true for rect inside viewport', () => {
    const c = cam(0, 0, 1);
    expect(isRectInView(c, vp, { x: 10, y: 10, w: 100, h: 50 })).toBe(true);
  });

  it('returns false for rect off-screen to the right', () => {
    const c = cam(0, 0, 1);
    expect(isRectInView(c, vp, { x: 2000, y: 0, w: 100, h: 50 })).toBe(false);
  });

  it('works at zoom=0.5 pan=(100,0)', () => {
    const c = cam(100, 0, 0.5);
    expect(isRectInView(c, vp, { x: 0, y: 0, w: 100, h: 100 })).toBe(true);
    expect(isRectInView(c, vp, { x: 4000, y: 0, w: 10, h: 10 })).toBe(false);
  });
});

describe('isWorldRectInViewport', () => {
  it('returns true for rect fully inside viewport', () => {
    const c = cam(0, 0, 1);
    expect(isWorldRectInViewport(c, vp, { x: 100, y: 100, w: 200, h: 200 })).toBe(true);
  });

  it('returns true for rect partially inside viewport', () => {
    const c = cam(0, 0, 1);
    expect(isWorldRectInViewport(c, vp, { x: -50, y: 100, w: 200, h: 200 })).toBe(true);
  });

  it('returns false for rect completely left of viewport', () => {
    const c = cam(0, 0, 1);
    expect(isWorldRectInViewport(c, vp, { x: -500, y: 0, w: 100, h: 100 })).toBe(false);
  });

  it('returns false for rect completely right of viewport', () => {
    const c = cam(0, 0, 1);
    expect(isWorldRectInViewport(c, vp, { x: 3000, y: 0, w: 100, h: 100 })).toBe(false);
  });

  it('returns false for rect completely below viewport', () => {
    const c = cam(0, 0, 1);
    expect(isWorldRectInViewport(c, vp, { x: 0, y: 2000, w: 100, h: 100 })).toBe(false);
  });

  it('works at different zoom levels', () => {
    const c = cam(200, 100, 2);
    const origin = computeFloatingOrigin(c, vp);
    const [cx, cy] = screenToWorld(c, vp.width / 2, vp.height / 2, vp, origin);
    expect(isWorldRectInViewport(c, vp, { x: cx - 25, y: cy - 25, w: 50, h: 50 })).toBe(true);
    expect(isWorldRectInViewport(c, vp, { x: 10000, y: 10000, w: 50, h: 50 })).toBe(false);
    expect(isWorldRectInViewport(c, vp, { x: -10000, y: -10000, w: 50, h: 50 })).toBe(false);
  });

  it('handles tiny rect on viewport edge', () => {
    const c = cam(0, 0, 1);
    expect(isWorldRectInViewport(c, vp, { x: 1919, y: 0, w: 1, h: 1 })).toBe(true);
    expect(isWorldRectInViewport(c, vp, { x: 1921, y: 0, w: 1, h: 1 })).toBe(false);
  });
});

describe('fitZoom', () => {
  it('fits a 400x300 rect into a 1920x1080 viewport', () => {
    const z = fitZoom({ x: 0, y: 0, w: 400, h: 300 }, vp, 40);
    expect(z).toBeCloseTo(1000 / 300, 4);
  });

  it('caps at maxZoom', () => {
    const z = fitZoom({ x: 0, y: 0, w: 10, h: 10 }, vp, 40, 5);
    expect(z).toBe(5);
  });

  it('handles tiny rect', () => {
    const z = fitZoom({ x: 0, y: 0, w: 1e-9, h: 1e-9 }, vp, 40);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it('handles zero-padding', () => {
    const z = fitZoom({ x: 0, y: 0, w: 1920, h: 1080 }, vp, 0);
    expect(z).toBe(1);
  });
});

describe('centerBoundsCamera', () => {
  it('centers a 400x300 rect in a 1920x1080 viewport at zoom 3', () => {
    const c = centerBoundsCamera({ x: 100, y: 50, w: 400, h: 300 }, vp, 3);
    expect(c.pan.x).toBe(960 - 300 * 3);
    expect(c.pan.y).toBe(540 - 200 * 3);
    expect(c.zoom).toBe(3);
  });
});

describe('fitBoundsCamera', () => {
  it('centers and zooms to fit', () => {
    const c = fitBoundsCamera({ x: 0, y: 0, w: 400, h: 300 }, vp, 40);
    const expectedZoom = Math.min((1920 - 80) / 400, (1080 - 80) / 300);
    expect(c.zoom).toBeCloseTo(expectedZoom, 4);
    const worldCentre: [number, number] = [200, 150];
    const screenCentre: [number, number] = [960, 540];
    expect(c.pan.x).toBeCloseTo(screenCentre[0] - worldCentre[0] * expectedZoom, 2);
    expect(c.pan.y).toBeCloseTo(screenCentre[1] - worldCentre[1] * expectedZoom, 2);
  });
});

describe('revealBoundsCamera', () => {
  it('returns the same camera when already in view', () => {
    const c = cam(0, 0, 1);
    const out = revealBoundsCamera(c, vp, { x: 10, y: 10, w: 100, h: 50 }, 10);
    expect(out.pan.x).toBe(0);
    expect(out.pan.y).toBe(0);
    expect(out.zoom).toBe(1);
  });

  it('shifts left when the rect is off-screen left', () => {
    const c = cam(0, 0, 1);
    const out = revealBoundsCamera(c, vp, { x: -500, y: 0, w: 100, h: 50 }, 10);
    expect(out.pan.x).toBe(510);
    expect(out.zoom).toBe(1);
  });

  it('shifts right when the rect is off-screen right', () => {
    const c = cam(0, 0, 1);
    const out = revealBoundsCamera(c, vp, { x: 2000, y: 0, w: 100, h: 50 }, 10);
    const expectedPanX = 0 - (2100 - (1920 - 10));
    expect(out.pan.x).toBeCloseTo(expectedPanX, 0);
  });

  it('shifts down when the rect is below viewport', () => {
    const c = cam(0, 0, 1);
    const out = revealBoundsCamera(c, vp, { x: 0, y: 2000, w: 100, h: 50 }, 10);
    expect(out.pan.y).toBeCloseTo(-980, 0);
  });
});

describe('zoomAboutPoint', () => {
  it('keeps world anchor at the same screen position after zoom', () => {
    const c = cam(200, 100, 2);
    const anchor: [number, number] = [300, 400];
    const newZoom = 4;
    const after = zoomAboutPoint(c, anchor, newZoom);
    const screenBefore = worldToScreen(c, anchor[0], anchor[1]);
    const screenAfter = worldToScreen(after, anchor[0], anchor[1]);
    expect(Math.abs(screenBefore[0] - screenAfter[0])).toBeLessThan(EPS);
    expect(Math.abs(screenBefore[1] - screenAfter[1])).toBeLessThan(EPS);
  });

  it('keeps world anchor stable with floating origin and real viewport', () => {
    const c: Camera = {
      pan: { x: -8620.25, y: 4317.5 },
      zoom: 3.75,
      rotation: 0,
    };
    const viewport: Viewport = { width: 1377, height: 813 };
    const beforeOrigin = computeFloatingOrigin(c, viewport);
    const anchor = screenToWorld(c, 589, 377, viewport, beforeOrigin);
    const after = zoomAboutPoint(c, anchor, 5.5, viewport);
    const afterOrigin = computeFloatingOrigin(after, viewport);
    const screenAfter = worldToScreen(after, anchor[0], anchor[1], viewport, afterOrigin);

    expect(screenAfter[0]).toBeCloseTo(589, 6);
    expect(screenAfter[1]).toBeCloseTo(377, 6);
  });

  it('keeps world anchor stable while rotated', () => {
    const c: Camera = {
      pan: { x: -1200, y: 700 },
      zoom: 1.8,
      rotation: Math.PI / 7,
    };
    const viewport: Viewport = { width: 1200, height: 700 };
    const beforeOrigin = computeFloatingOrigin(c, viewport);
    const anchor = screenToWorld(c, 840, 220, viewport, beforeOrigin);
    const after = zoomAboutPoint(c, anchor, 2.6, viewport);
    const afterOrigin = computeFloatingOrigin(after, viewport);
    const screenAfter = worldToScreen(after, anchor[0], anchor[1], viewport, afterOrigin);

    expect(screenAfter[0]).toBeCloseTo(840, 6);
    expect(screenAfter[1]).toBeCloseTo(220, 6);
    expect(after.rotation).toBeCloseTo(c.rotation ?? 0, 9);
  });

  it('clamps the new zoom', () => {
    const c = cam(0, 0, 1);
    const clamped = zoomAboutPoint(c, [0, 0], 100);
    expect(clamped.zoom).toBe(MAX_ZOOM);
  });
});

describe('zoomAboutPoint floating-origin edge cases', () => {
  // Previously, the with-viewport branch tried to also re-converge the
  // floating origin for the *new* camera state via an 8-iteration
  // fixed-point loop. When the anchor's world coordinate sat near a
  // FLOATING_ORIGIN_GRID cell boundary, the loop could oscillate between
  // two adjacent origins forever, never hit its exact-match exit
  // condition, and fall back to "lowest error seen" — which for a genuine
  // 2-cycle doesn't distinguish between two equally-bad candidates and can
  // return an answer with hundreds of pixels of anchor drift.
  const viewport: Viewport = { width: 1000, height: 800 };
  const c: Camera = { pan: { x: 40, y: -25 }, zoom: 1.5, rotation: 0 };

  it('is deterministic for an anchor near a floating-origin grid boundary', () => {
    const origin = computeFloatingOrigin(c, viewport);
    const anchor = screenToWorld(c, viewport.width / 2, viewport.height / 2, viewport, origin);

    const results = Array.from({ length: 5 }, () => zoomAboutPoint(c, anchor, 1.2, viewport));
    for (const r of results.slice(1)) {
      expect(r).toEqual(results[0]);
    }
  });

  it('matches the closed-form single-origin calculation (no iteration)', () => {
    // zoomAboutPoint now computes pan directly from the *starting* camera's
    // origin, matching the same pattern the !viewport branch already used.
    // This asserts the implementation is exactly that — not an
    // approximation of it — as a regression guard against reintroducing
    // the iterative solver.
    const origin = computeFloatingOrigin(c, viewport);
    const anchor = screenToWorld(c, viewport.width / 2, viewport.height / 2, viewport, origin);
    const newZoom = 1.2;

    const [screenX, screenY] = worldToScreen(c, anchor[0], anchor[1], viewport, origin);
    const baseCam: Camera = { ...c, pan: { x: 0, y: 0 }, zoom: newZoom };
    const [baseX, baseY] = worldToScreen(baseCam, anchor[0], anchor[1], viewport, origin);
    const expected: Camera = {
      ...c,
      zoom: newZoom,
      pan: { x: screenX - baseX, y: screenY - baseY },
    };

    expect(zoomAboutPoint(c, anchor, newZoom, viewport)).toEqual(expected);
  });

  // NOT asserted here: that the anchor stays pixel-exact under the
  // viewport center after a *fresh* origin recompute (i.e. what the next
  // real paint call does — see packages/editor/src/CanvasArea.tsx:1006's
  // applyEditorCameraToCtx, which calls computeFloatingOrigin fresh from
  // whatever camera state is current, with no memory of the origin used
  // here). That's a real, separate gap: for a meaningful fraction of
  // zoom/anchor/pan combinations there is no pan value that's
  // self-consistent with a freshly-recomputed origin for the *new* camera
  // state (verified analytically — the fixed-point equation this implies
  // has no integer solution whenever a derived quantity has odd parity,
  // confirmed empirically at ~44% of random inputs). When it doesn't
  // resolve, the resulting jump is exactly one grid cell in screen space
  // (zoom * FLOATING_ORIGIN_GRID px), not a rounding error. Fixing this
  // needs hysteretic origin tracking (reuse the previous origin unless the
  // camera has drifted meaningfully past it) threaded through the render
  // pipeline — a distinctly larger change than this function.
});

describe('rotateAboutScreenPoint', () => {
  it('updates rotation and keeps anchor fixed on screen', () => {
    const c = cam(100, 50, 1);
    const anchor: [number, number] = [960, 540];
    const after = rotateAboutScreenPoint(c, anchor, Math.PI / 4, vp);
    expect(after.rotation).toBeCloseTo(Math.PI / 4, 6);
    const before = screenToWorld(c, anchor[0], anchor[1], vp);
    const afterWorld = screenToWorld(after, anchor[0], anchor[1], vp);
    expect(Math.abs(before[0] - afterWorld[0])).toBeLessThan(1e-3);
    expect(Math.abs(before[1] - afterWorld[1])).toBeLessThan(1e-3);
  });
});

describe('resetViewRotation', () => {
  it('clears rotation', () => {
    const c = { ...cam(), rotation: 0.5 };
    expect(resetViewRotation(c, vp).rotation).toBe(0);
  });
});

describe('computeFloatingOrigin', () => {
  it('stays at semantic zero until scene geometry is atomically rebased', () => {
    const c = cam(-600, -400, 1);
    const origin = computeFloatingOrigin(c, vp);
    expect(origin).toEqual([0, 0]);
  });

  it('does not change semantic world-to-screen coordinates at a grid boundary', () => {
    const c = cam(0, 13.25, 1);
    const origin = computeFloatingOrigin(c, vp);
    expect(origin).toEqual([0, 0]);
    expect(worldToScreen(c, 160, 140, vp, origin)).toEqual([160, 153.25]);
    expect(screenToWorld(c, 160, 153.25, vp, origin)).toEqual([160, 140]);
  });
});

describe('stepZoom', () => {
  it('steps in and out within bounds', () => {
    expect(stepZoom(1, 'in')).toBeGreaterThan(1);
    expect(stepZoom(1, 'out')).toBeLessThan(1);
  });
});

describe('localRectToScreen', () => {
  it('transforms a local rect through world matrix and camera', () => {
    const worldMatrix = translate(50, 60);
    const c = cam(10, 20, 2);
    const local = { x: 0, y: 0, w: 100, h: 80 };
    const screen = localRectToScreen(worldMatrix, c, local);
    expect(screen.x).toBe(110);
    expect(screen.y).toBe(140);
    expect(screen.w).toBe(200);
    expect(screen.h).toBe(160);
  });
});

describe('lerpCamera', () => {
  it('returns start at t=0', () => {
    const from = cam(100, 200, 1);
    const to = cam(300, 400, 3);
    const result = lerpCamera(from, to, 0);
    expect(result.pan.x).toBe(100);
    expect(result.pan.y).toBe(200);
    expect(result.zoom).toBe(1);
  });

  it('returns end at t=1', () => {
    const from = cam(100, 200, 1);
    const to = cam(300, 400, 3);
    const result = lerpCamera(from, to, 1);
    expect(result.pan.x).toBe(300);
    expect(result.pan.y).toBe(400);
    expect(result.zoom).toBe(3);
  });

  it('is eased (non-linear interpolation)', () => {
    const from = cam(0, 0, 1);
    const to = cam(100, 0, 2);
    const mid = lerpCamera(from, to, 0.5);
    expect(mid.pan.x).toBeGreaterThan(50);
    expect(mid.zoom).toBeGreaterThan(1.5);
  });

  it('clamps t to [0, 1]', () => {
    const from = cam(0, 0, 1);
    const to = cam(100, 100, 2);
    expect(lerpCamera(from, to, -0.5).pan.x).toBe(0);
    expect(lerpCamera(from, to, 1.5).pan.x).toBe(100);
  });
});

describe('animateCamera', () => {
  it('returns done=true when elapsed >= duration', () => {
    const result = animateCamera(cam(0, 0, 1), cam(100, 0, 2), 200, 200);
    expect(result.done).toBe(true);
    expect(result.camera.pan.x).toBe(100);
  });

  it('returns done=false for partial progress', () => {
    const result = animateCamera(cam(0, 0, 1), cam(100, 0, 2), 100, 200);
    expect(result.done).toBe(false);
  });
});

describe('clampCamera', () => {
  it('returns unchanged camera when within bounds', () => {
    const c = cam(100, 100, 1);
    const bounds = { x: 0, y: 0, w: 500, h: 500 };
    const clamped = clampCamera(c, vp, bounds);
    expect(clamped.pan.x).toBe(100);
    expect(clamped.pan.y).toBe(100);
    expect(clamped.zoom).toBe(1);
  });

  it('returns same camera when documentBounds is null', () => {
    const c = cam(-9999, -9999, 1);
    expect(clampCamera(c, vp, null)).toBe(c);
  });

  it('clamps pan when document is far off-screen', () => {
    const c = cam(-5000, -5000, 1);
    const bounds = { x: 0, y: 0, w: 100, h: 100 };
    const clamped = clampCamera(c, vp, bounds, 100);
    expect(clamped.pan).toEqual({ x: -200, y: -200 });
  });

  it('does not reverse direction when crossing an offscreen margin', () => {
    const bounds = { x: 0, y: 0, w: 100, h: 100 };
    const clamped = clampCamera(cam(-250, -250, 1), vp, bounds, 100);
    expect(clamped.pan).toEqual({ x: -200, y: -200 });
  });

  it('uses the viewport plus margin as the positive boundary', () => {
    const bounds = { x: 0, y: 0, w: 100, h: 100 };
    const clamped = clampCamera(cam(2500, 1600, 1), vp, bounds, 100);
    expect(clamped.pan).toEqual({ x: 2020, y: 1180 });
  });
});
