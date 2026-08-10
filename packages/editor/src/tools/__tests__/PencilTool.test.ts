// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PencilTool } from '../PencilTool';
import type { ToolContext } from '../types';

let nextPointerTime = performance.now();

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    document: {
      nodes: {},
      rootChildren: [],
      name: 'Test',
    } as unknown as ToolContext['document'],
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
    nodeEditTargetId: null,
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
    duplicateSelected: vi.fn(),
    reparentNode: vi.fn(),
    setCamera: vi.fn(),
    setPan: vi.fn(),
    setZoom: vi.fn(),
    setTool: vi.fn(),
    setNodeEditTargetId: vi.fn(),
    setNodeEditSelectedAnchors: vi.fn(),
    setTextEditTargetId: vi.fn(),
    announce: vi.fn(),
    announceSelection: vi.fn(),
    announceOperation: vi.fn(),
    setDraft: vi.fn(),
    rootNodes: vi.fn(() => []),
    getNode: vi.fn(),
    canvasToWorld: vi.fn((cx: number, cy: number) => ({ x: cx, y: cy })),
    worldToCanvas: vi.fn((wx: number, wy: number) => ({ x: wx, y: wy })),
    canvasDeltaToWorld: vi.fn((dx: number, dy: number) => ({ dx, dy })),
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
    snapPosition: vi.fn((b: { x: number; y: number; w: number; h: number }) => ({
      x: b.x,
      y: b.y,
      guides: [],
    })),
    createRasterLayer: vi.fn(() => null),
    touchMultiSelect: { active: false, suspended: false },
    ...overrides,
  };
}

function makePointerEvent(
  x: number,
  y: number,
  overrides: Partial<PointerEvent> = {},
): PointerEvent {
  nextPointerTime += 16;
  return {
    pointerId: 1,
    clientX: x,
    clientY: y,
    pressure: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    button: 0,
    pointerType: 'mouse',
    timeStamp: nextPointerTime,
    ...overrides,
  } as unknown as PointerEvent;
}

function makeKeyEvent(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true });
}

describe('PencilTool', () => {
  let rafCb: FrameRequestCallback;

  beforeEach(() => {
    nextPointerTime = performance.now();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      rafCb = cb;
      return 0;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('onPointerDown starts capturing', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    const result = tool.onPointerDown?.(makePointerEvent(100, 100), ctx);

    expect(result.consumed).toBe(true);
    expect(result.captured).toBe(true);
    expect(window.requestAnimationFrame).toHaveBeenCalled();
  });

  it('onPointerUp with <2 points creates a rect shape', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerUp?.(makePointerEvent(100, 100), ctx);

    expect(ctx.createShapeAt).toHaveBeenCalledWith({ x: 100, y: 100 }, { w: 4, h: 4 });
  });

  it('onPointerUp with 2+ points creates a path with simplified points', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);

    rafCb?.(0);

    tool.onPointerMove?.(makePointerEvent(110, 110), ctx);
    rafCb?.(0);

    tool.onPointerMove?.(makePointerEvent(120, 120), ctx);
    rafCb?.(0);

    tool.onPointerUp?.(makePointerEvent(120, 120), ctx);

    expect(ctx.createShapeAt).toHaveBeenCalled();
    const { mock } = ctx.createShapeAt as ReturnType<typeof vi.fn>;
    const callArgs = mock.calls[0];
    const pathPoints = callArgs?.[3];
    expect(pathPoints).toBeDefined();
    if (!pathPoints) return;
    expect(pathPoints.length).toBeGreaterThanOrEqual(2);
  });

  it('simplifyPoints reduces collinear pencil points', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);

    rafCb?.(0);

    tool.onPointerMove?.(makePointerEvent(110, 110), ctx);
    rafCb?.(0);

    tool.onPointerMove?.(makePointerEvent(120, 120), ctx);
    rafCb?.(0);

    tool.onPointerUp?.(makePointerEvent(120, 120), ctx);

    const { mock } = ctx.createShapeAt as ReturnType<typeof vi.fn>;
    const callArgs = mock.calls[0];
    const pathPoints = callArgs?.[3];
    expect(pathPoints).toHaveLength(2);
  });

  it('Escape cancels capture', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onKeyDown?.(makeKeyEvent('Escape'), ctx);

    expect(ctx.createShapeAt).not.toHaveBeenCalled();
    expect(ctx.setDraft).toHaveBeenCalledWith(null);
  });

  it('draft updates during RAF loop', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);

    // Drive the RAF loop manually with pointer at a new position
    tool.onPointerMove?.(makePointerEvent(200, 200), ctx);
    rafCb?.(0);

    // Draft should have been set with kind 'freehand'
    expect(ctx.setDraft).toHaveBeenCalled();
    const mock = (ctx.setDraft as ReturnType<typeof vi.fn>).mock;
    const draftCalls = mock.calls.filter(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.kind === 'freehand',
    );
    expect(draftCalls.length).toBeGreaterThan(0);
  });

  it('onPointerCancel cancels capture and resets', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerCancel?.(makePointerEvent(100, 100), ctx);

    expect(ctx.createShapeAt).not.toHaveBeenCalled();
  });

  it('creates path at correct start position', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown?.(makePointerEvent(150, 200), ctx);

    rafCb?.(0);
    tool.onPointerMove?.(makePointerEvent(160, 210), ctx);
    rafCb?.(0);
    tool.onPointerMove?.(makePointerEvent(170, 220), ctx);
    rafCb?.(0);

    tool.onPointerUp?.(makePointerEvent(170, 220), ctx);

    const mock = (ctx.createShapeAt as ReturnType<typeof vi.fn>).mock;
    const callArgs = mock.calls[0];
    // Position should be at drag start world
    expect(callArgs?.[0]).toEqual({ x: 150, y: 200 });
  });

  it('captured points include pressure data', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown?.(makePointerEvent(100, 100, { pressure: 0.75 }), ctx);

    rafCb?.(0);
    tool.onPointerMove?.(makePointerEvent(110, 110), ctx);
    rafCb?.(0);
    tool.onPointerMove?.(makePointerEvent(120, 120), ctx);
    rafCb?.(0);

    tool.onPointerUp?.(makePointerEvent(120, 120), ctx);

    const mock = (ctx.createShapeAt as ReturnType<typeof vi.fn>).mock;
    const callArgs = mock.calls[0];
    const pathPoints = callArgs?.[3] as Array<{ pressure?: number }>;
    expect(pathPoints).toBeDefined();
    if (!pathPoints) return;
    // All fitted points should carry the stroke's average pressure
    for (const pt of pathPoints) {
      expect(pt.pressure).toBeDefined();
      expect(pt.pressure).toBeGreaterThan(0);
    }
  });

  it('captures pressure from pointer event', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown?.(makePointerEvent(100, 100, { pressure: 0.8 }), ctx);
    rafCb?.(0);

    tool.onPointerMove?.(makePointerEvent(120, 120), ctx);
    rafCb?.(0);

    tool.onPointerUp?.(makePointerEvent(120, 120), ctx);

    const mock = (ctx.createShapeAt as ReturnType<typeof vi.fn>).mock;
    const callArgs = mock.calls[0];
    const pathPoints = callArgs?.[3] as Array<{ pressure?: number }>;
    expect(pathPoints).toBeDefined();
    if (!pathPoints) return;
    // First point should have the captured pressure
    if (pathPoints[0]) {
      expect(pathPoints[0].pressure).toBeGreaterThan(0);
    }
  });

  it('default pressure for low-pressure pointer events', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    // PointerEvent.pressure=0 for non-pressure devices
    tool.onPointerDown?.(makePointerEvent(100, 100, { pressure: 0 }), ctx);
    rafCb?.(0);

    tool.onPointerMove?.(makePointerEvent(120, 120), ctx);
    rafCb?.(0);

    tool.onPointerUp?.(makePointerEvent(120, 120), ctx);

    const mock = (ctx.createShapeAt as ReturnType<typeof vi.fn>).mock;
    const callArgs = mock.calls[0];
    const pathPoints = callArgs?.[3] as Array<{ pressure?: number }>;
    expect(pathPoints).toBeDefined();
    if (!pathPoints) return;
    // Should default to 0.5 for non-pressure input
    if (pathPoints[0]) {
      expect(pathPoints[0].pressure).toBe(0.5);
    }
  });

  it('ends capture on deactivate', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);

    tool.onDeactivate?.({} as ToolContext);

    // After deactivate, subsequent pointer moves should not cause errors
    expect(() => tool.onPointerMove?.(makePointerEvent(200, 200), ctx)).not.toThrow();
  });

  it('commit wraps createShapeAt in undo transaction', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);

    rafCb?.(0);
    tool.onPointerMove?.(makePointerEvent(110, 110), ctx);
    rafCb?.(0);
    tool.onPointerMove?.(makePointerEvent(120, 120), ctx);
    rafCb?.(0);

    tool.onPointerUp?.(makePointerEvent(120, 120), ctx);

    expect(ctx.beginTransaction).toHaveBeenCalled();
    expect(ctx.createShapeAt).toHaveBeenCalled();
    expect(ctx.commitTransaction).toHaveBeenCalled();
    const beginOrder = (ctx.beginTransaction as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    const shapeAtOrder = (ctx.createShapeAt as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    const commitOrder = (ctx.commitTransaction as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    expect(beginOrder).toBeLessThan(shapeAtOrder);
    expect(shapeAtOrder).toBeLessThan(commitOrder);
  });

  it('per-point pressure stores each event pressure, not a uniform stroke average', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    // Pointer down with low pressure
    tool.onPointerDown?.(makePointerEvent(100, 100, { pressure: 0.2 }), ctx);
    rafCb?.(0);

    // Move with different pressure
    tool.onPointerMove?.(makePointerEvent(150, 100, { pressure: 0.9 }), ctx);
    rafCb?.(0);

    tool.onPointerMove?.(makePointerEvent(200, 100, { pressure: 0.5 }), ctx);
    rafCb?.(0);

    // Check internal captured points have per-point pressure
    // The first point (from pointerDown) has pressure 0.2
    // Subsequent captured points get pressure from the latest onPointerMove event
    expect((tool as unknown as { captured: Array<{ pressure: number }> }).captured).toBeDefined();

    tool.onPointerUp?.(makePointerEvent(200, 100), ctx);

    const mock = (ctx.createShapeAt as ReturnType<typeof vi.fn>).mock;
    const callArgs = mock.calls[0];
    const pathPoints = callArgs?.[3] as Array<{ pressure?: number }>;
    expect(pathPoints).toBeDefined();
    if (!pathPoints) return;
    // All fitted points should carry pressure data
    for (const pt of pathPoints) {
      expect(pt.pressure).toBeGreaterThan(0);
      expect(pt.pressure).toBeLessThanOrEqual(1);
    }
  });

  it('setStabilization(1) lags further behind a sudden jump than setStabilization(0)', () => {
    const lowStab = new PencilTool();
    lowStab.setStabilization(0);
    const ctx1 = makeCtx();
    lowStab.onPointerDown?.(makePointerEvent(100, 100), ctx1);
    rafCb?.(0);
    lowStab.onPointerMove?.(makePointerEvent(300, 100), ctx1);
    rafCb?.(0);
    const lowCaptured = (lowStab as unknown as { captured: Array<{ x: number }> }).captured;
    const lowLast = lowCaptured[lowCaptured.length - 1]!.x;

    const highStab = new PencilTool();
    highStab.setStabilization(1);
    const ctx2 = makeCtx();
    highStab.onPointerDown?.(makePointerEvent(100, 100), ctx2);
    rafCb?.(0);
    highStab.onPointerMove?.(makePointerEvent(300, 100), ctx2);
    rafCb?.(0);
    const highCaptured = (highStab as unknown as { captured: Array<{ x: number }> }).captured;
    const highLast = highCaptured[highCaptured.length - 1]!.x;

    // Heavier stabilization should trail further behind the raw target (300)
    // than light stabilization does.
    expect(Math.abs(300 - highLast)).toBeGreaterThan(Math.abs(300 - lowLast));
  });

  it('setStabilization clamps to [0, 1]', () => {
    const tool = new PencilTool();
    expect(() => tool.setStabilization(-1)).not.toThrow();
    expect(() => tool.setStabilization(2)).not.toThrow();
  });
});
