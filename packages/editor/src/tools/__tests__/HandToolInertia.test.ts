import { createDocument } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEditorFrameRuntimeForTests } from '../../performance/editorFrameRuntime';
import { HandTool } from '../HandTool';

/**
 * Tests for HandTool momentum inertia fix.
 *
 * The production ToolContext's ctx.pan is NOT mutated by setPan — it's
 * replaced in state. The HandTool should track its own currentPan
 * reference so the momentum RAF loop uses the latest pan value even
 * when ctx.pan is a stale closure capture.
 */
describe('HandTool inertia fix — immutable ctx.pan', () => {
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let rafIdCounter: number;
  let pan: { x: number; y: number };

  beforeEach(() => {
    resetEditorFrameRuntimeForTests();
    rafCallbacks = new Map();
    rafIdCounter = 0;
    pan = { x: 0, y: 0 };

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

  function makeCtx() {
    const doc = createDocument('test');
    return {
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
      setPan: vi.fn(() => {
        // Simulate production behavior: setPan does NOT mutate pan.
        // The pan object reference stays the same.
        // In production, ctx.pan is built from stateRef.current.pan
        // each time buildToolCtx is called, so it's a read-only snapshot.
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
    };
  }

  it('momentum applies from release position, not accumulated', () => {
    const tool = new HandTool();
    const ctx = makeCtx();
    // Start pan at (100, 200) — ctx.pan is a readonly snapshot.
    ctx.pan = { x: 100, y: 200 };

    tool.onPointerDown({ clientX: 100, clientY: 100, pointerId: 1, button: 0 } as any, ctx);

    // Drag by (50, 50)
    tool.onPointerMove({ clientX: 150, clientY: 150, pointerId: 1 } as any, ctx);

    // Simulate that setPan was called, but ctx.pan is NOT mutated.
    // The HandTool should have tracked its own currentPan.
    expect(ctx.setPan).toHaveBeenLastCalledWith({ x: 150, y: 250 });

    // Seed position history with a fast flick (100px in 16ms ≈ 100px/frame)
    (tool as any).positionHistory = [
      { x: 150, y: 150, time: 100 },
      { x: 200, y: 200, time: 110 },
      { x: 250, y: 250, time: 116 },
    ];

    tool.onPointerUp({ pointerId: 1 } as any, ctx);

    // RAF should be scheduled for momentum
    expect(rafCallbacks.size).toBe(1);

    // Run one tick. Momentum is integrated from the release velocity using
    // elapsed time, starting from currentPan rather than the stale ctx.pan.
    const firstEntry = rafCallbacks.entries().next().value;
    if (!firstEntry) throw new Error('expected RAF callback');
    const [id, cb] = firstEntry;
    rafCallbacks.delete(id);
    cb(116);

    expect(ctx.setPan).toHaveBeenLastCalledWith({
      x: expect.closeTo(251.54023826158172, 8),
      y: expect.closeTo(351.54023826158175, 8),
    });

    // Now run a second tick — it should accumulate from the updated currentPan
    const secondEntry = rafCallbacks.entries().next().value;
    if (!secondEntry) throw new Error('expected second RAF callback');
    const [id2, cb2] = secondEntry;
    rafCallbacks.delete(id2);
    cb2(132);

    const secondPan = (ctx.setPan as any).mock.calls.at(-1)?.[0] as
      | { x: number; y: number }
      | undefined;
    expect(secondPan?.x).toBeGreaterThan(251.54);
    expect(secondPan?.y).toBeGreaterThan(351.54);
  });

  it('momentum continues to accumulate on current pan even when ctx.pan is stale', () => {
    const tool = new HandTool();
    const ctx = makeCtx();
    ctx.pan = { x: 50, y: 50 };

    tool.onPointerDown({ clientX: 0, clientY: 0, pointerId: 1, button: 0 } as any, ctx);

    // Drag by (20, 20) → setPan({x: 70, y: 70})
    tool.onPointerMove({ clientX: 20, clientY: 20, pointerId: 1 } as any, ctx);

    // Simulate stale ctx.pan (immutable, not updated by setPan)
    // After the drag, currentPan should be {70, 70} but ctx.pan is still {50, 50}.

    // Seed moderate velocity: 10px/frame
    (tool as any).positionHistory = [
      { x: 0, y: 0, time: 0 },
      { x: 10, y: 10, time: 16 },
    ];

    tool.onPointerUp({ pointerId: 1 } as any, ctx);

    // Run a few ticks
    for (let i = 0; i < 5; i++) {
      const entry = rafCallbacks.entries().next().value;
      if (!entry) break;
      const [rid, rcb] = entry;
      rafCallbacks.delete(rid);
      rcb((i + 1) * (1000 / 60));
    }

    // After 5 ticks: velocity decays as 10*0.95^5 = 7.74, still above threshold
    // Accumulated pan should be 70 + 10*0.95 + 10*0.95^2 + ... ≈ 70 + 42.87 ≈ 112.87
    // Verify the last call used a pan value > 100 (it accumulated from 70, not from stale 50)
    const lastCallX = (ctx.setPan as any).mock.calls.at(-1)?.[0]?.x as number | undefined;
    expect(lastCallX).toBeDefined();
    expect(lastCallX!).toBeGreaterThan(100);
  });
});
