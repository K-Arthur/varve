/**
 * ZoomTool unit tests.
 *
 * Tests cursor-anchored click-zoom, alt-click zoom-out, and marquee zoom.
 * All assertions verify that `setZoom` + `setPan` are called with values that
 * keep the world point under the cursor fixed after zoom.
 */
import {
  computeFloatingOrigin,
  MAX_ZOOM,
  MIN_ZOOM,
  screenToWorld,
  worldToScreen,
} from '@strata/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from './types';
import { ZoomTool } from './ZoomTool';

// Minimal ToolContext for ZoomTool tests — only the fields ZoomTool reads.
function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    document: { nodes: {}, rootChildren: [], name: 'Test' } as unknown as ToolContext['document'],
    selection: [],
    zoom: 1,
    pan: { x: 0, y: 0 },
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerType: 'mouse',
    pointerPressure: 0,
    snapEnabled: false,
    snapGrid: 8,
    createShapeAt: vi.fn(),
    createTextNodeAt: vi.fn(),
    setSelection: vi.fn(),
    toggleSelection: vi.fn(),
    isSelected: vi.fn(() => false),
    setNodePosition: vi.fn(),
    setNodeSize: vi.fn(),
    updateNode: vi.fn(),
    removeSelected: vi.fn(),
    reparentNode: vi.fn(),
    setPan: vi.fn(),
    setZoom: vi.fn(),
    announce: vi.fn(),
    announceSelection: vi.fn(),
    announceOperation: vi.fn(),
    setDraft: vi.fn(),
    rootNodes: vi.fn(() => []),
    getNode: vi.fn(),
    canvasToWorld: vi.fn((cx: number, cy: number) => {
      const z = (overrides.zoom as number | undefined) ?? 1;
      const pan = (overrides.pan as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
      return { x: (cx - pan.x) / z, y: (cy - pan.y) / z };
    }),
    worldToCanvas: vi.fn((wx: number, wy: number) => {
      const z = (overrides.zoom as number | undefined) ?? 1;
      const pan = (overrides.pan as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
      return { x: wx * z + pan.x, y: wy * z + pan.y };
    }),
    canvasDeltaToWorld: vi.fn((dx: number, dy: number) => {
      const z = (overrides.zoom as number | undefined) ?? 1;
      return { dx: dx / z, dy: dy / z };
    }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    findContainingFrame: vi.fn(() => null),
    setDropTargetFrame: vi.fn(),
    nodeWorldBounds: vi.fn(() => null),
    engine: null,
    hitTest: vi.fn(() => null),
    canvasElement: null,
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    abortTransaction: vi.fn(),
    setTool: vi.fn(),
    nodeEditTargetId: null,
    setNodeEditTargetId: vi.fn(),
    setNodeEditSelectedAnchors: vi.fn(),
    setTextEditTargetId: vi.fn(),
    duplicateSelected: vi.fn(),
    snapPosition: vi.fn((b: { x: number; y: number; w: number; h: number }) => ({
      x: b.x,
      y: b.y,
      guides: [],
    })),
    ...overrides,
  };
}

function makePointerEvent(
  x: number,
  y: number,
  overrides: Partial<PointerEvent> = {},
): PointerEvent {
  return {
    pointerId: 1,
    clientX: x,
    clientY: y,
    pressure: 0.5,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    button: 0,
    pointerType: 'mouse',
    ...overrides,
  } as unknown as PointerEvent;
}

/** Pull the first call's first argument from a vi.fn mock. */
function firstCallArg<T>(mockFn: ReturnType<typeof vi.fn>): T {
  const call = mockFn.mock.calls[0];
  if (!call) throw new Error('mock was not called');
  return call[0] as T;
}

describe('ZoomTool — cursor-anchored click zoom', () => {
  it('click zoom-in: world point under cursor stays fixed after zoom', () => {
    const tool = new ZoomTool();
    const ctx = makeCtx({ zoom: 1, pan: { x: 0, y: 0 } });

    // Simulate pointer down at canvas coords (400, 300).
    // With zoom=1 pan=(0,0), world point = (400, 300).
    const pointerDown = makePointerEvent(400, 300);
    tool.onPointerDown(pointerDown, ctx);

    // Pointer up at same position (no marquee) → click zoom
    tool.onPointerUp?.(pointerDown, ctx);

    const setZoomMock = ctx.setZoom as ReturnType<typeof vi.fn>;
    const setPanMock = ctx.setPan as ReturnType<typeof vi.fn>;

    expect(setZoomMock.mock.calls).toHaveLength(1);
    expect(setPanMock.mock.calls).toHaveLength(1);

    const newZoom = firstCallArg<number>(setZoomMock);
    const newPan = firstCallArg<{ x: number; y: number }>(setPanMock);

    // The world point (400, 300) should map to the same screen position after zoom.
    // screenAfter = worldPoint * newZoom + newPan
    const screenX = 400 * newZoom + newPan.x;
    const screenY = 300 * newZoom + newPan.y;

    // Screen position before zoom: 400*1 + 0 = 400, 300*1 + 0 = 300
    expect(screenX).toBeCloseTo(400, 1);
    expect(screenY).toBeCloseTo(300, 1);
    expect(newZoom).toBeGreaterThan(1); // zoomed in
  });

  it('alt+click zoom-out: world point under cursor stays fixed after zoom', () => {
    const tool = new ZoomTool();
    const ctx = makeCtx({ zoom: 2, pan: { x: -200, y: -100 }, altKey: true });

    // Canvas coords (300, 200); world point = (300 - (-200)) / 2, (200 - (-100)) / 2 = (250, 150)
    const pointerDown = makePointerEvent(300, 200, { altKey: true });
    tool.onPointerDown(pointerDown, ctx);
    tool.onPointerUp?.(pointerDown, ctx);

    const newZoom = firstCallArg<number>(ctx.setZoom as ReturnType<typeof vi.fn>);
    const newPan = firstCallArg<{ x: number; y: number }>(ctx.setPan as ReturnType<typeof vi.fn>);

    // screen before zoom: 250*2 + (-200) = 300, 150*2 + (-100) = 200 (verified)
    const screenX = 250 * newZoom + newPan.x;
    const screenY = 150 * newZoom + newPan.y;

    expect(screenX).toBeCloseTo(300, 1);
    expect(screenY).toBeCloseTo(200, 1);
    expect(newZoom).toBeLessThan(2); // zoomed out
  });

  it('click zoom-in zoom factor is ~1.25x', () => {
    const tool = new ZoomTool();
    const ctx = makeCtx({ zoom: 1, pan: { x: 0, y: 0 } });
    const ev = makePointerEvent(0, 0);
    tool.onPointerDown(ev, ctx);
    tool.onPointerUp?.(ev, ctx);

    const newZoom = firstCallArg<number>(ctx.setZoom as ReturnType<typeof vi.fn>);
    expect(newZoom).toBeCloseTo(1.25, 2);
  });

  it('alt+click zoom-out factor is ~0.8x', () => {
    const tool = new ZoomTool();
    const ctx = makeCtx({ zoom: 1, pan: { x: 0, y: 0 }, altKey: true });
    const ev = makePointerEvent(0, 0, { altKey: true });
    tool.onPointerDown(ev, ctx);
    tool.onPointerUp?.(ev, ctx);

    const newZoom = firstCallArg<number>(ctx.setZoom as ReturnType<typeof vi.fn>);
    expect(newZoom).toBeCloseTo(0.8, 2);
  });
});

describe('ZoomTool — viewport-aware anchor (floating-origin correction)', () => {
  it('click zoom-in keeps the anchor fixed once the camera has panned past the floating-origin grid (FLOATING_ORIGIN_GRID=512)', () => {
    // zoomAboutPoint(cam, anchor, newZoom, viewport) needs the real viewport
    // to compute the same floating-origin correction (computeFloatingOrigin)
    // the renderer will use. ZoomTool previously called it with only 3 args,
    // silently falling into the `!viewport` branch, which assumes origin=[0,0]
    // and a hardcoded 1920x1080 size — invisible near world (0,0), but once
    // pan/zoom puts the viewport more than one 512-unit grid cell away from
    // true origin, the assumed and actual origins diverge and the anchor
    // drifts hundreds of pixels off the cursor on click-to-zoom.
    //
    // Reproduced directly against packages/shared/src/viewport.ts: pan
    // (-1800,-1100) at zoom 1 -> 1.25, viewport 640x480 -- without the real
    // viewport passed through, the anchor (world (3736, 2424), screen
    // (400,300) before the click) renders at screen (-624, 44) after zoom, a
    // ~1000px jump. With the viewport passed through it lands exactly back
    // at (400, 300).
    const tool = new ZoomTool();
    const fakeCanvas = {
      getBoundingClientRect: () => ({ width: 640, height: 480 }) as DOMRect,
    } as unknown as HTMLCanvasElement;
    const pan = { x: -1800, y: -1100 };
    const zoom = 1;
    const ctx = makeCtx({
      zoom,
      pan,
      canvasElement: fakeCanvas,
      // Faithful floating-origin-aware canvasToWorld, matching the real
      // implementation in context.tsx (editorScreenToWorld), unlike this
      // file's default naive mock.
      canvasToWorld: vi.fn((cx: number, cy: number) => {
        const origin = computeFloatingOrigin({ pan, zoom }, { width: 640, height: 480 });
        const [wx, wy] = screenToWorld({ pan, zoom }, cx, cy, { width: 640, height: 480 }, origin);
        return { x: wx, y: wy };
      }),
    });

    const pointerDown = makePointerEvent(400, 300);
    tool.onPointerDown(pointerDown, ctx);
    tool.onPointerUp?.(pointerDown, ctx);

    const newZoom = firstCallArg<number>(ctx.setZoom as ReturnType<typeof vi.fn>);
    const newPan = firstCallArg<{ x: number; y: number }>(ctx.setPan as ReturnType<typeof vi.fn>);
    const resultCam = { pan: newPan, zoom: newZoom };
    const finalOrigin = computeFloatingOrigin(resultCam, { width: 640, height: 480 });
    const [screenX, screenY] = worldToScreen(
      resultCam,
      3736,
      2424,
      { width: 640, height: 480 },
      finalOrigin,
    );

    expect(screenX).toBeCloseTo(400, 0);
    expect(screenY).toBeCloseTo(300, 0);
  });
});

describe('ZoomTool — zoom clamping', () => {
  it(`does not zoom above MAX_ZOOM (${MAX_ZOOM})`, () => {
    const tool = new ZoomTool();
    const ctx = makeCtx({ zoom: MAX_ZOOM * 0.99, pan: { x: 0, y: 0 } });
    const ev = makePointerEvent(0, 0);
    tool.onPointerDown(ev, ctx);
    tool.onPointerUp?.(ev, ctx);

    const newZoom = firstCallArg<number>(ctx.setZoom as ReturnType<typeof vi.fn>);
    expect(newZoom).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it(`does not zoom below MIN_ZOOM (${MIN_ZOOM})`, () => {
    const tool = new ZoomTool();
    const ctx = makeCtx({ zoom: MIN_ZOOM * 1.1, pan: { x: 0, y: 0 }, altKey: true });
    const ev = makePointerEvent(0, 0, { altKey: true });
    tool.onPointerDown(ev, ctx);
    tool.onPointerUp?.(ev, ctx);

    const newZoom = firstCallArg<number>(ctx.setZoom as ReturnType<typeof vi.fn>);
    expect(newZoom).toBeGreaterThanOrEqual(MIN_ZOOM);
  });
});
