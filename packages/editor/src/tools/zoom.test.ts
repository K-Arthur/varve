/**
 * ZoomTool unit tests.
 *
 * Tests cursor-anchored click-zoom, alt-click zoom-out, and marquee zoom.
 * All assertions verify that one atomic `setCamera` call keeps the world point
 * under the cursor fixed after zoom.
 */
import {
  computeFloatingOrigin,
  MAX_ZOOM,
  MIN_ZOOM,
  screenToWorld,
  worldToScreen,
} from '@varve/shared';
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
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    tangentialPressure: 0,
    pointerWidth: 1,
    pointerHeight: 1,
    lastPointerEvent: { clientX: 0, clientY: 0 },
    altitudeAngle: Math.PI / 2,
    azimuthAngle: 0,
    hasCoalescedEvents: false,
    hasPredictedEvents: false,
    sourceEvents: [],
    foregroundColor: [0, 0, 0, 255] as [number, number, number, number],
    maskPreviewMode: 'none',
    setMaskPreviewMode: vi.fn(),
    snapEnabled: false,
    snapGrid: 8,
    createShapeAt: vi.fn(),
    createTextNodeAt: vi.fn(),
    setSelection: vi.fn(),
    toggleSelection: vi.fn(),
    isSelected: vi.fn(() => false),
    setNodePosition: vi.fn(),
    setNodePositions: vi.fn(),
    updateNodes: vi.fn(),
    setNodeSize: vi.fn(),
    updateNode: vi.fn(),
    removeSelected: vi.fn(),
    reparentNode: vi.fn(),
    setCamera: vi.fn(),
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
    createRasterLayer: vi.fn(() => null),
    touchMultiSelect: { active: false, suspended: false },
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

    const setCameraMock = ctx.setCamera as ReturnType<typeof vi.fn>;

    expect(setCameraMock.mock.calls).toHaveLength(1);

    const camera = firstCallArg<import('@varve/shared').Camera>(setCameraMock);
    const newZoom = camera.zoom;
    const newPan = camera.pan;

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

    const camera = firstCallArg<import('@varve/shared').Camera>(
      ctx.setCamera as ReturnType<typeof vi.fn>,
    );
    const newZoom = camera.zoom;
    const newPan = camera.pan;

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

    const camera = firstCallArg<import('@varve/shared').Camera>(
      ctx.setCamera as ReturnType<typeof vi.fn>,
    );
    expect(camera.zoom).toBeCloseTo(1.25, 2);
  });

  it('alt+click zoom-out factor is ~0.8x', () => {
    const tool = new ZoomTool();
    const ctx = makeCtx({ zoom: 1, pan: { x: 0, y: 0 }, altKey: true });
    const ev = makePointerEvent(0, 0, { altKey: true });
    tool.onPointerDown(ev, ctx);
    tool.onPointerUp?.(ev, ctx);

    const camera = firstCallArg<import('@varve/shared').Camera>(
      ctx.setCamera as ReturnType<typeof vi.fn>,
    );
    expect(camera.zoom).toBeCloseTo(0.8, 2);
  });
});

describe('ZoomTool — viewport-aware anchor', () => {
  it('click zoom-in keeps the semantic world anchor fixed after a large pan', () => {
    // The floating-origin grid is a renderer precision aid, not part of the
    // document coordinate system. The point under the cursor must therefore
    // remain stable without adding or subtracting a grid cell.
    const tool = new ZoomTool();
    const fakeCanvas = {
      getBoundingClientRect: () => ({ width: 640, height: 480 }) as DOMRect,
    } as unknown as HTMLCanvasElement;
    const pan = { x: -1800, y: -1100 };
    const zoom = 1;
    const pointerScreen = { x: 400, y: 300 };
    const worldAnchor = {
      x: (pointerScreen.x - pan.x) / zoom,
      y: (pointerScreen.y - pan.y) / zoom,
    };
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

    const pointerDown = makePointerEvent(pointerScreen.x, pointerScreen.y);
    tool.onPointerDown(pointerDown, ctx);
    tool.onPointerUp?.(pointerDown, ctx);

    const resultCam = firstCallArg<import('@varve/shared').Camera>(
      ctx.setCamera as ReturnType<typeof vi.fn>,
    );
    const finalOrigin = computeFloatingOrigin(resultCam, { width: 640, height: 480 });
    const [screenX, screenY] = worldToScreen(
      resultCam,
      worldAnchor.x,
      worldAnchor.y,
      { width: 640, height: 480 },
      finalOrigin,
    );

    expect(screenX).toBeCloseTo(pointerScreen.x, 0);
    expect(screenY).toBeCloseTo(pointerScreen.y, 0);
  });
});

describe('ZoomTool — zoom clamping', () => {
  it(`does not zoom above MAX_ZOOM (${MAX_ZOOM})`, () => {
    const tool = new ZoomTool();
    const ctx = makeCtx({ zoom: MAX_ZOOM * 0.99, pan: { x: 0, y: 0 } });
    const ev = makePointerEvent(0, 0);
    tool.onPointerDown(ev, ctx);
    tool.onPointerUp?.(ev, ctx);

    const camera = firstCallArg<import('@varve/shared').Camera>(
      ctx.setCamera as ReturnType<typeof vi.fn>,
    );
    expect(camera.zoom).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it(`does not zoom below MIN_ZOOM (${MIN_ZOOM})`, () => {
    const tool = new ZoomTool();
    const ctx = makeCtx({ zoom: MIN_ZOOM * 1.1, pan: { x: 0, y: 0 }, altKey: true });
    const ev = makePointerEvent(0, 0, { altKey: true });
    tool.onPointerDown(ev, ctx);
    tool.onPointerUp?.(ev, ctx);

    const camera = firstCallArg<import('@varve/shared').Camera>(
      ctx.setCamera as ReturnType<typeof vi.fn>,
    );
    expect(camera.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
  });
});
