import { describe, expect, it } from 'vitest';
import { translate } from './affine';
import {
  type Camera,
  centerBoundsCamera,
  clampZoom,
  clientToCanvas,
  fitBoundsCamera,
  fitZoom,
  isRectInView,
  isWorldRectInViewport,
  localRectToScreen,
  MAX_ZOOM,
  MIN_ZOOM,
  revealBoundsCamera,
  screenDeltaToWorld,
  screenToWorld,
  type Viewport,
  worldToScreen,
  worldToScreenAffine,
  zoomAboutPoint,
} from './viewport';

const EPS = 1e-9;
const vp: Viewport = { width: 1920, height: 1080 };

function cam(panX = 0, panY = 0, zoom = 1): Camera {
  return { pan: [panX, panY] as [number, number], zoom };
}

describe('clampZoom', () => {
  it('clamps below minimum', () => expect(clampZoom(0.05)).toBe(MIN_ZOOM));
  it('clamps above maximum', () => expect(clampZoom(20)).toBe(MAX_ZOOM));
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
    // At zoom=1 pan=(0,0), viewport shows world (-∞,∞) ∩ (vp.w,vp.h).
    const c = cam(0, 0, 1);
    expect(isRectInView(c, vp, { x: 10, y: 10, w: 100, h: 50 })).toBe(true);
  });

  it('returns false for rect off-screen to the right', () => {
    const c = cam(0, 0, 1);
    expect(isRectInView(c, vp, { x: 2000, y: 0, w: 100, h: 50 })).toBe(false);
  });

  it('works at zoom=0.5 pan=(100,0)', () => {
    const c = cam(100, 0, 0.5);
    // World viewport: left = -100/0.5 = -200, right = (1920-100)/0.5 = 3640
    expect(isRectInView(c, vp, { x: 0, y: 0, w: 100, h: 100 })).toBe(true);
    expect(isRectInView(c, vp, { x: 4000, y: 0, w: 10, h: 10 })).toBe(false);
  });
});

describe('isWorldRectInViewport', () => {
  it('returns true for rect fully inside viewport', () => {
    const c = cam(0, 0, 1);
    expect(isWorldRectInViewport(c, vp, { x: 100, y: 100, w: 200, h: 200 })).toBe(true);
  });

  it('returns true for rect partially inside viewport (intersecting left edge)', () => {
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
    // Viewport world: left=-100, right=(1920-200)/2=860, top=-50, bottom=(1080-100)/2=490
    expect(isWorldRectInViewport(c, vp, { x: 500, y: 200, w: 50, h: 50 })).toBe(true);
    expect(isWorldRectInViewport(c, vp, { x: 1000, y: 200, w: 50, h: 50 })).toBe(false);
    expect(isWorldRectInViewport(c, vp, { x: -200, y: 200, w: 50, h: 50 })).toBe(false);
  });

  it('handles tiny rect on viewport edge', () => {
    const c = cam(0, 0, 1);
    // Rect right on the viewport right edge
    expect(isWorldRectInViewport(c, vp, { x: 1919, y: 0, w: 1, h: 1 })).toBe(true);
    expect(isWorldRectInViewport(c, vp, { x: 1921, y: 0, w: 1, h: 1 })).toBe(false);
  });
});

describe('fitZoom', () => {
  it('fits a 400×300 rect into a 1920×1080 viewport', () => {
    const z = fitZoom({ x: 0, y: 0, w: 400, h: 300 }, vp, 40);
    // Available: 1920-80=1840 W, 1080-80=1000 H. Restricting: 1840/400=4.6, 1000/300≈3.33 → min=3.33
    expect(z).toBeCloseTo(1000 / 300, 4);
  });

  it('caps at maxZoom', () => {
    const z = fitZoom({ x: 0, y: 0, w: 10, h: 10 }, vp, 40, 5);
    expect(z).toBe(5);
  });

  it('handles tiny rect without blowing up', () => {
    const z = fitZoom({ x: 0, y: 0, w: 1e-9, h: 1e-9 }, vp, 40);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it('handles zero-padding edge case', () => {
    const z = fitZoom({ x: 0, y: 0, w: 1920, h: 1080 }, vp, 0);
    expect(z).toBe(1);
  });
});

describe('centerBoundsCamera', () => {
  it('centers a 400×300 rect in a 1920×1080 viewport at zoom 3', () => {
    const c = centerBoundsCamera({ x: 100, y: 50, w: 400, h: 300 }, vp, 3);
    // World center: (300, 200). Screen center: (960, 540).
    // pan = screenC - worldC * zoom = (960 - 300*3, 540 - 200*3) = (60, -60)
    expect(c.pan[0]).toBe(960 - 300 * 3);
    expect(c.pan[1]).toBe(540 - 200 * 3);
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
    expect(c.pan[0]).toBeCloseTo(screenCentre[0] - worldCentre[0] * expectedZoom, 2);
    expect(c.pan[1]).toBeCloseTo(screenCentre[1] - worldCentre[1] * expectedZoom, 2);
  });
});

describe('revealBoundsCamera', () => {
  it('returns the same camera when already in view', () => {
    const c = cam(0, 0, 1);
    const out = revealBoundsCamera(c, vp, { x: 10, y: 10, w: 100, h: 50 }, 10);
    expect(out.pan[0]).toBe(0);
    expect(out.pan[1]).toBe(0);
    expect(out.zoom).toBe(1);
  });

  it('shifts left when the rect is off-screen left', () => {
    const c = cam(0, 0, 1);
    const out = revealBoundsCamera(c, vp, { x: -500, y: 0, w: 100, h: 50 }, 10);
    // rectMinX=-500. leftReqX = -1*(-500) + 10 = 510. panX=0 < 510, snaps to 510.
    // This shifts viewport left: viewportMinWorld = -510/1 = -510, so rect is visible.
    expect(out.pan[0]).toBe(510);
    expect(out.zoom).toBe(1);
  });

  it('shifts right when the rect is off-screen right', () => {
    const c = cam(0, 0, 1);
    const out = revealBoundsCamera(c, vp, { x: 2000, y: 0, w: 100, h: 50 }, 10);
    // rectMaxX=2100, viewMaxX-pad=1920-10=1910. Shift needed: 2100-1910=190 world px = 190 CSS px.
    // Wait, that would be negative shift... Let me think.
    // The rect's right edge is at 2100. Viewport right edge (world) = 1920.
    // rectMaxX > viewMaxX - pad => 2100 > 1910. Need to shift right by 2100-1910=190.
    // Shift right means subtract from pan? Let me re-derive.
    // If rect is to the right, we need to move viewport right. pan.x is world-origin's screen offset.
    // To move viewport right, we add to pan.x (more of world is visible to the left).
    // Actually: world X maps to screen X = wx*zoom + pan.x. If pan.x is large, world 0 shifts right.
    // Wait no — the math: screen origin (0,0) is canvas top-left. world point (0,0) maps to screen (pan.x, pan.y).
    // If pan.x = 0, world 0 is at canvas left edge. If pan.x = 100, world 0 is 100px to the right (shifted right).
    // So to reveal a rect to the right, we need to make pan.x smaller (move world origin leftwards).
    const expectedPanX = 0 - (2100 - (1920 - 10));
    expect(out.pan[0]).toBeCloseTo(expectedPanX, 0);
  });

  it('shifts down when the rect is below viewport', () => {
    const c = cam(0, 0, 1);
    const out = revealBoundsCamera(c, vp, { x: 0, y: 2000, w: 100, h: 50 }, 10);
    // rect bottom edge = 2050. Need 2050*zoom + panY <= viewport.height - padding.
    // 2050*1 + panY <= 1080 - 10 → panY <= -980. Result should be -980.
    expect(out.pan[1]).toBeCloseTo(-980, 0);
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

  it('clamps the new zoom', () => {
    const c = cam(0, 0, 1);
    const clamped = zoomAboutPoint(c, [0, 0], 100);
    expect(clamped.zoom).toBe(MAX_ZOOM);
  });
});

describe('localRectToScreen', () => {
  it('transforms a local rect through world matrix and camera', () => {
    const worldMatrix = translate(50, 60);
    const c = cam(10, 20, 2);
    const local = { x: 0, y: 0, w: 100, h: 80 };
    const screen = localRectToScreen(worldMatrix, c, local);
    // World rect = translate(50,60) applied to local => x=50,y=60,w=100,h=80.
    // Screen: x = (50*2 + 10) = 110, y = (60*2 + 20) = 140, w = 100*2 = 200, h = 80*2 = 160.
    expect(screen.x).toBe(110);
    expect(screen.y).toBe(140);
    expect(screen.w).toBe(200);
    expect(screen.h).toBe(160);
  });
});
