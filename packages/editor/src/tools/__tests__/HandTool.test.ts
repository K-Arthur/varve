import { createDocument } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEditorFrameRuntimeForTests } from '../../performance/editorFrameRuntime';
import { HandTool } from '../HandTool';

function makeCtx(overrides?: Record<string, unknown>) {
  const doc = createDocument('test');
  const pan = { x: 0, y: 0 };
  const ctx = {
    document: doc,
    selection: [] as string[],
    zoom: 1,
    pan,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerType: 'mouse' as const,
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
    maskPreviewMode: 'none' as const,
    setMaskPreviewMode: vi.fn(),
    snapEnabled: false,
    snapGrid: 8,
    createShapeAt: vi.fn(),
    createTextNodeAt: vi.fn(),
    setSelection: vi.fn(),
    toggleSelection: vi.fn(),
    isSelected: vi.fn().mockReturnValue(false),
    setNodePosition: vi.fn(),
    setNodePositions: vi.fn(),
    updateNodes: vi.fn(),
    setNodeSize: vi.fn(),
    updateNode: vi.fn(),
    removeSelected: vi.fn(),
    duplicateSelected: vi.fn(),
    reparentNode: vi.fn(),
    setCamera: vi.fn(),
    setPan: vi.fn((p: { x: number; y: number }) => {
      pan.x = p.x;
      pan.y = p.y;
    }),
    setZoom: vi.fn(),
    announce: vi.fn(),
    announceSelection: vi.fn(),
    announceOperation: vi.fn(),
    setDraft: vi.fn(),
    rootNodes: vi.fn().mockReturnValue([]),
    getNode: vi.fn(),
    canvasToWorld: vi.fn((cx: number, cy: number) => ({ x: cx, y: cy })),
    worldToCanvas: vi.fn((wx: number, wy: number) => ({ x: wx, y: wy })),
    canvasDeltaToWorld: vi.fn((dx: number, dy: number) => ({ dx, dy })),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    findContainingFrame: vi.fn().mockReturnValue(null),
    setDropTargetFrame: vi.fn(),
    setLayoutInsertion: vi.fn(),
    nodeWorldBounds: vi.fn().mockReturnValue(null),
    engine: null,
    hitTest: vi.fn().mockReturnValue(null),
    canvasElement: null,
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    abortTransaction: vi.fn(),
    setTool: vi.fn(),
    nodeEditTargetId: null,
    setNodeEditTargetId: vi.fn(),
    setNodeEditSelectedAnchors: vi.fn(),
    setTextEditTargetId: vi.fn(),
    snapPosition: vi.fn((b: { x: number; y: number }) => ({ x: b.x, y: b.y, guides: [] })),
    createRasterLayer: vi.fn(() => null),
    touchMultiSelect: { active: false, suspended: false },
    ...overrides,
  };
  return ctx;
}

describe('HandTool — pan with momentum', () => {
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let rafIdCounter: number;

  beforeEach(() => {
    resetEditorFrameRuntimeForTests();
    rafCallbacks = new Map();
    rafIdCounter = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      const id = ++rafIdCounter;
      rafCallbacks.set(id, cb);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      rafCallbacks.delete(id);
    });
  });

  afterEach(() => {
    resetEditorFrameRuntimeForTests();
    vi.restoreAllMocks();
  });

  it('drag pans the canvas by the delta between start and current', () => {
    const tool = new HandTool();
    const ctx = makeCtx({ pan: { x: 50, y: 100 } });

    tool.onPointerDown({ clientX: 200, clientY: 300, pointerId: 1, button: 0 } as any, ctx);

    // Exceed 3px threshold
    tool.onPointerMove({ clientX: 210, clientY: 320, pointerId: 1 } as any, ctx);

    // Delta: (10, 20), startPan was { x: 50, y: 100 }
    expect(ctx.setPan).toHaveBeenCalledWith({ x: 60, y: 120 });
  });

  it('middle-click drag pans the canvas', () => {
    const tool = new HandTool();
    const ctx = makeCtx({ pan: { x: 100, y: 200 } });

    tool.onPointerDown({ clientX: 400, clientY: 500, pointerId: 2, button: 1 } as any, ctx);

    tool.onPointerMove({ clientX: 420, clientY: 530, pointerId: 2 } as any, ctx);

    // Delta: (20, 30), startPan was { x: 100, y: 200 }
    expect(ctx.setPan).toHaveBeenCalledWith({ x: 120, y: 230 });
  });

  it('after drag release, momentum decay continues panning', () => {
    const tool = new HandTool();
    const ctx = makeCtx({ pan: { x: 100, y: 200 } });

    tool.onPointerDown({ clientX: 100, clientY: 100, pointerId: 1, button: 0 } as any, ctx);

    // Seed position history with samples showing velocity (10px over 32ms).
    (tool as any).positionHistory = [
      { x: 140, y: 130, time: 100 },
      { x: 145, y: 135, time: 116 },
      { x: 150, y: 140, time: 132 },
    ];

    tool.onPointerUp({ pointerId: 1 } as any, ctx);

    // RAF should be scheduled for momentum
    expect(rafCallbacks.size).toBe(1);

    // Run one tick
    const first = rafCallbacks.entries().next().value;
    if (!first) throw new Error('expected a scheduled RAF callback');
    const [id, cb] = first;
    rafCallbacks.delete(id);
    cb(132);

    // Exact time-based integration preserves the tuned decay without making
    // travel depend on the display refresh rate.
    expect(ctx.setPan).toHaveBeenLastCalledWith({
      x: expect.closeTo(105.07701191307909, 8),
      y: expect.closeTo(205.07701191307908, 8),
    });
    // Momentum should continue (velocity still > 0.5)
    expect(rafCallbacks.size).toBeGreaterThanOrEqual(1);
  });

  it('momentum decay stops after velocity drops below threshold', () => {
    const tool = new HandTool();
    const ctx = makeCtx({ pan: { x: 0, y: 0 } });

    tool.onPointerDown({ clientX: 0, clientY: 0, pointerId: 1, button: 0 } as any, ctx);

    // Seed very slow velocity: 1px over 16ms ≈ 1px/frame
    (tool as any).positionHistory = [
      { x: 0, y: 0, time: 0 },
      { x: 1, y: 1, time: 16 },
    ];

    tool.onPointerUp({ pointerId: 1 } as any, ctx);

    // Run ticks until momentum stops (RAF no longer queued)
    let tickCount = 0;
    while (rafCallbacks.size > 0 && tickCount < 100) {
      const entry = rafCallbacks.entries().next().value;
      if (!entry) break;
      const [id, cb] = entry;
      rafCallbacks.delete(id);
      cb(tickCount * (1000 / 60));
      tickCount++;
    }

    // The 0.5 reference-frame threshold is converted to px/s, so the stop
    // time is stable rather than changing with refresh rate.
    expect(tickCount).toBeGreaterThanOrEqual(10);
    expect(tickCount).toBeLessThan(50);
    // Should have stopped (no more RAF callbacks)
    expect(rafCallbacks.size).toBe(0);
    // Internal velocity should be null
    expect((tool as any).velocity).toBeNull();
  });

  it('momentum is cleared on new pointer down', () => {
    const tool = new HandTool();
    const ctx = makeCtx({ pan: { x: 100, y: 200 } });

    tool.onPointerDown({ clientX: 100, clientY: 100, pointerId: 1, button: 0 } as any, ctx);

    // Seed fast velocity
    (tool as any).positionHistory = [
      { x: 0, y: 0, time: 0 },
      { x: 100, y: 100, time: 16 },
    ];

    tool.onPointerUp({ pointerId: 1 } as any, ctx);

    // Momentum is running
    expect(rafCallbacks.size).toBe(1);

    // New pointer down should cancel momentum
    tool.onPointerDown({ clientX: 200, clientY: 200, pointerId: 2, button: 0 } as any, ctx);

    // RAF should be cancelled (rafCallbacks cleared)
    expect(rafCallbacks.size).toBe(0);
    // Velocity should be null
    expect((tool as any).velocity).toBeNull();
  });

  it('does not pan when pointer moves less than 3px threshold', () => {
    const tool = new HandTool();
    const ctx = makeCtx();

    tool.onPointerDown({ clientX: 100, clientY: 100, pointerId: 1, button: 0 } as any, ctx);

    // Move 2px (below 3px threshold)
    tool.onPointerMove({ clientX: 102, clientY: 100, pointerId: 1 } as any, ctx);

    expect(ctx.setPan).not.toHaveBeenCalled();
  });
});

describe('HandTool — middle-click activation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('middle-click (button===1) activates pan', () => {
    const tool = new HandTool();
    const ctx = makeCtx({ pan: { x: 0, y: 0 } });

    const result = tool.onPointerDown(
      {
        clientX: 100,
        clientY: 100,
        pointerId: 1,
        button: 1,
      } as any,
      ctx,
    );

    expect(result.consumed).toBe(true);
    expect(result.captured).toBe(true);
    expect(ctx.setPointerCapture).toHaveBeenCalledWith(1);
  });

  it('left-click on hand tool also pans', () => {
    const tool = new HandTool();
    const ctx = makeCtx({ pan: { x: 0, y: 0 } });

    const result = tool.onPointerDown(
      {
        clientX: 100,
        clientY: 100,
        pointerId: 1,
        button: 0,
      } as any,
      ctx,
    );

    expect(result.consumed).toBe(true);
    expect(result.captured).toBe(true);
    expect(ctx.setPointerCapture).toHaveBeenCalledWith(1);
  });

  it('right-click does not activate pan', () => {
    const tool = new HandTool();
    const ctx = makeCtx();

    const result = tool.onPointerDown(
      {
        clientX: 100,
        clientY: 100,
        pointerId: 1,
        button: 2,
      } as any,
      ctx,
    );

    expect(result.consumed).toBe(false);
  });
});
