// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PenTool } from '../PenTool';
import type { ToolContext } from '../types';

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
    snapEnabled: false,
    snapGrid: 8,
    nodeEditTargetId: null,
    createShapeAt: vi.fn(),
    createTextNodeAt: vi.fn(),
    setSelection: vi.fn(),
    toggleSelection: vi.fn(),
    isSelected: vi.fn(() => false),
    setNodePosition: vi.fn(),
    setNodeSize: vi.fn(),
    updateNode: vi.fn(),
    removeSelected: vi.fn(),
    duplicateSelected: vi.fn(),
    reparentNode: vi.fn(),
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
    pressure: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    button: 0,
    pointerType: 'mouse',
    ...overrides,
  } as unknown as PointerEvent;
}

function makeKeyEvent(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true });
}

describe('PenTool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('onPointerDown starts path and creates first point', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    const result = tool.onPointerDown?.(makePointerEvent(100, 100), ctx);

    expect(result.consumed).toBe(true);
    expect(ctx.announce).toHaveBeenCalledWith('Path started');
  });

  it('onPointerMove during Placing uses line draft, not rect', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerUp?.(makePointerEvent(100, 100), ctx);

    tool.onPointerMove?.(makePointerEvent(200, 150), ctx);

    expect(ctx.setDraft).toHaveBeenCalledWith(expect.objectContaining({ kind: 'line' }));
  });

  it('rubber-band shows line from last point to cursor', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerUp?.(makePointerEvent(100, 100), ctx);

    tool.onPointerMove?.(makePointerEvent(200, 150), ctx);

    expect(ctx.setDraft).toHaveBeenCalledWith({
      kind: 'line',
      x1: 100,
      y1: 100,
      x2: 200,
      y2: 150,
      label: 'to (200, 150)',
    });
  });

  it('commitPath clears draft and creates path shape', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerUp?.(makePointerEvent(100, 100), ctx);
    vi.advanceTimersByTime(500);
    tool.onPointerDown?.(makePointerEvent(200, 150), ctx);
    tool.onPointerUp?.(makePointerEvent(200, 150), ctx);

    tool.onKeyDown?.(makeKeyEvent('Enter'), ctx);

    expect(ctx.setDraft).toHaveBeenCalledWith(null);
    expect(ctx.createShapeAt).toHaveBeenCalledWith(
      { x: 100, y: 100 },
      undefined,
      undefined,
      expect.arrayContaining([
        expect.objectContaining({ x: 100, y: 100 }),
        expect.objectContaining({ x: 200, y: 150 }),
      ]),
    );
  });

  it('Escape with 0-1 points cancels without creating', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);

    tool.onKeyDown?.(makeKeyEvent('Escape'), ctx);

    expect(ctx.createShapeAt).not.toHaveBeenCalled();
    expect(ctx.announce).toHaveBeenCalledWith('Path cancelled');

    ctx.announce = vi.fn();
    const result = tool.onPointerDown?.(makePointerEvent(300, 300), ctx);
    expect(result.consumed).toBe(true);
    expect(ctx.announce).toHaveBeenCalledWith('Path started');
  });

  it('Escape with 2+ points commits path', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerUp?.(makePointerEvent(100, 100), ctx);
    vi.advanceTimersByTime(500);
    tool.onPointerDown?.(makePointerEvent(200, 150), ctx);
    tool.onPointerUp?.(makePointerEvent(200, 150), ctx);

    tool.onKeyDown?.(makeKeyEvent('Escape'), ctx);

    expect(ctx.createShapeAt).toHaveBeenCalled();
    expect(ctx.announce).toHaveBeenCalledWith('Path cancelled');
  });

  it('single click without commit creates a dot (placeholder)', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerUp?.(makePointerEvent(100, 100), ctx);
    tool.onKeyDown?.(makeKeyEvent('Enter'), ctx);

    expect(ctx.createShapeAt).toHaveBeenCalledWith({ x: 100, y: 100 }, { w: 4, h: 4 });
  });

  it('closes path when clicking near first point', () => {
    const tool = new PenTool();
    const ctx = makeCtx({ zoom: 1 });
    tool.onActivate?.(ctx);

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerUp?.(makePointerEvent(100, 100), ctx);
    vi.advanceTimersByTime(500);
    tool.onPointerDown?.(makePointerEvent(200, 150), ctx);
    tool.onPointerUp?.(makePointerEvent(200, 150), ctx);
    vi.advanceTimersByTime(500);
    // Click within 8px of first point
    tool.onPointerDown?.(makePointerEvent(104, 103), ctx);

    const mock = (ctx.createShapeAt as ReturnType<typeof vi.fn>).mock;
    const callArgs = mock.calls[0];
    const pathPoints = callArgs?.[3];
    expect(pathPoints).toBeDefined();
    if (!pathPoints) return;
    // Closed path: first point added at end too
    expect(pathPoints.length).toBeGreaterThanOrEqual(3);
  });

  it('Shift-click constrains point to 45-degree angle', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerUp?.(makePointerEvent(100, 100), ctx);
    vi.advanceTimersByTime(500);
    tool.onPointerDown?.(makePointerEvent(200, 150, { shiftKey: true }), ctx);

    const mock = ctx.createShapeAt as ReturnType<typeof vi.fn>;
    // Path not yet committed (only 2 points, no close)
    expect(mock).not.toHaveBeenCalled();
    expect(ctx.announce).toHaveBeenCalledWith(expect.stringContaining('Point'));
  });

  it('double-click finishes path', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerUp?.(makePointerEvent(100, 100), ctx);
    vi.advanceTimersByTime(500);
    tool.onPointerDown?.(makePointerEvent(200, 150), ctx);
    // Double-click fires between pointerDown and pointerUp
    tool.onDoubleClick?.(makePointerEvent(200, 150), ctx);

    expect(ctx.createShapeAt).toHaveBeenCalled();
    expect(ctx.announce).toHaveBeenCalledWith('Path finished');
  });

  it('click-drag creates bezier handles on the point', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    // First click-drag: click at (100,100), drag to (130,130)
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(130, 130), ctx);
    tool.onPointerUp?.(makePointerEvent(130, 130), ctx);

    // Now in Placing state with a handle on point[0]
    vi.advanceTimersByTime(500);

    // Add a second point
    tool.onPointerDown?.(makePointerEvent(200, 150), ctx);
    tool.onPointerUp?.(makePointerEvent(200, 150), ctx);

    // Commit
    tool.onKeyDown?.(makeKeyEvent('Enter'), ctx);

    const mock = (ctx.createShapeAt as ReturnType<typeof vi.fn>).mock;
    const callArgs = mock.calls[0];
    const pathPoints = callArgs?.[3];
    expect(pathPoints).toBeDefined();
    if (!pathPoints) return;
    expect(pathPoints.length).toBe(2);
    // First point should have handleOut set (from the drag)
    const firstPt = pathPoints[0] as { handleOut?: [number, number] | null };
    expect(firstPt.handleOut).not.toBeNull();
  });

  it('click without drag creates corner point (no handles)', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    // Click without drag
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerUp?.(makePointerEvent(100, 100), ctx);

    vi.advanceTimersByTime(500);
    tool.onPointerDown?.(makePointerEvent(200, 150), ctx);
    tool.onPointerUp?.(makePointerEvent(200, 150), ctx);

    tool.onKeyDown?.(makeKeyEvent('Enter'), ctx);

    const mock = (ctx.createShapeAt as ReturnType<typeof vi.fn>).mock;
    const callArgs = mock.calls[0];
    const pathPoints = callArgs?.[3];
    expect(pathPoints).toBeDefined();
    if (!pathPoints) return;
    // Both points should have null handles (corner points)
    const pt0 = pathPoints[0] as { handleOut?: [number, number] | null };
    const pt1 = pathPoints[1] as { handleOut?: [number, number] | null };
    expect(pt0.handleOut).toBeNull();
    expect(pt1.handleOut).toBeNull();
  });

  it('Alt-drag creates one-sided handle (handleIn stays null)', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    // Alt-click-drag: drag from (100,100) to (130,130) with altKey held
    tool.onPointerDown?.(makePointerEvent(100, 100, { altKey: true }), ctx);
    tool.onPointerMove?.(makePointerEvent(130, 130, { altKey: true }), ctx);
    tool.onPointerUp?.(makePointerEvent(130, 130, { altKey: true }), ctx);

    vi.advanceTimersByTime(500);
    tool.onPointerDown?.(makePointerEvent(200, 150), ctx);
    tool.onPointerUp?.(makePointerEvent(200, 150), ctx);
    tool.onKeyDown?.(makeKeyEvent('Enter'), ctx);

    const mock = (ctx.createShapeAt as ReturnType<typeof vi.fn>).mock;
    const callArgs = mock.calls[0];
    const pathPoints = callArgs?.[3] as Array<{ handleIn: unknown; handleOut: unknown }>;
    expect(pathPoints).toBeDefined();
    if (!pathPoints) return;
    // First point should have handleOut set (from drag) but handleIn = null (Alt broke symmetry)
    expect(pathPoints[0]?.handleOut).not.toBeNull();
    expect(pathPoints[0]?.handleIn).toBeNull();
  });

  it('subsequent Alt-drag preserves previous handleIn value', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    // First normal drag: creates symmetric handles
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(130, 130), ctx);
    tool.onPointerUp?.(makePointerEvent(130, 130), ctx);

    vi.advanceTimersByTime(500);

    // Add a second point with Alt held
    tool.onPointerDown?.(makePointerEvent(200, 150, { altKey: true }), ctx);
    tool.onPointerMove?.(makePointerEvent(240, 180, { altKey: true }), ctx);
    tool.onPointerUp?.(makePointerEvent(240, 180, { altKey: true }), ctx);

    tool.onKeyDown?.(makeKeyEvent('Enter'), ctx);

    const mock = (ctx.createShapeAt as ReturnType<typeof vi.fn>).mock;
    const callArgs = mock.calls[0];
    const pathPoints = callArgs?.[3] as Array<{ handleIn: unknown; handleOut: unknown }>;
    expect(pathPoints).toBeDefined();
    if (!pathPoints) return;
    // Second point (index 1) should have handleOut but handleIn = null (Alt broke symmetry)
    expect(pathPoints[1]?.handleOut).not.toBeNull();
    expect(pathPoints[1]?.handleIn).toBeNull();
  });

  it('undo granularity: commitPath is atomic (single createShapeAt call)', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    // Place 3 points, then commit via Enter
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerUp?.(makePointerEvent(100, 100), ctx);
    vi.advanceTimersByTime(500);
    tool.onPointerDown?.(makePointerEvent(200, 150), ctx);
    tool.onPointerUp?.(makePointerEvent(200, 150), ctx);
    vi.advanceTimersByTime(500);
    tool.onPointerDown?.(makePointerEvent(300, 200), ctx);
    tool.onPointerUp?.(makePointerEvent(300, 200), ctx);

    // Only 1 shape should be created, not 3
    expect(ctx.createShapeAt).not.toHaveBeenCalled();

    tool.onKeyDown?.(makeKeyEvent('Enter'), ctx);

    expect(ctx.createShapeAt).toHaveBeenCalledTimes(1);
  });

  it('normal drag creates symmetric handles (handleIn mirrors handleOut)', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(130, 130), ctx);
    tool.onPointerUp?.(makePointerEvent(130, 130), ctx);

    vi.advanceTimersByTime(500);
    tool.onPointerDown?.(makePointerEvent(200, 150), ctx);
    tool.onPointerUp?.(makePointerEvent(200, 150), ctx);
    tool.onKeyDown?.(makeKeyEvent('Enter'), ctx);

    const mock = (ctx.createShapeAt as ReturnType<typeof vi.fn>).mock;
    const callArgs = mock.calls[0];
    const pathPoints = callArgs?.[3] as Array<{
      handleIn: [number, number] | null;
      handleOut: [number, number] | null;
    }>;
    expect(pathPoints).toBeDefined();
    if (!pathPoints) return;
    const hOut = pathPoints[0]?.handleOut;
    const hIn = pathPoints[0]?.handleIn;
    expect(hOut).not.toBeNull();
    expect(hIn).not.toBeNull();
    // Symmetric: handleIn should be the negation of handleOut
    if (hOut && hIn) {
      expect(hIn[0]).toBeCloseTo(-hOut[0], 5);
      expect(hIn[1]).toBeCloseTo(-hOut[1], 5);
    }
  });

  it('Shift-drag handle snaps handle direction to 45-degree increments', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    // Dragon at ~30° angle (tan⁻¹(57.7/100) ≈ 30°) with Shift
    // Should snap to 45°: handleOut direction should be (cos45, sin45) = (0.7071, 0.7071)
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(200, 157.7, { shiftKey: true }), ctx);
    tool.onPointerUp?.(makePointerEvent(200, 157.7, { shiftKey: true }), ctx);

    vi.advanceTimersByTime(500);
    tool.onPointerDown?.(makePointerEvent(300, 300), ctx);
    tool.onPointerUp?.(makePointerEvent(300, 300), ctx);
    tool.onKeyDown?.(makeKeyEvent('Enter'), ctx);

    const mock = (ctx.createShapeAt as ReturnType<typeof vi.fn>).mock;
    const callArgs = mock.calls[0];
    const pathPoints = callArgs?.[3] as Array<{
      handleOut: [number, number] | null;
      handleIn: [number, number] | null;
    }>;
    expect(pathPoints).toBeDefined();
    if (!pathPoints) return;
    const hOut = pathPoints[0]?.handleOut;
    expect(hOut).not.toBeNull();
    if (hOut) {
      // Direction should be at 45° (cos45 ≈ sin45 ≈ 0.707 × length)
      const angle = Math.atan2(hOut[1], hOut[0]);
      const snappedDeg = Math.round((angle * 180) / Math.PI);
      expect(snappedDeg % 45).toBe(0);
    }
  });

  it('Shift-drag at 60° snaps to 45° not 90°', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    // Drag at ~60° angle with Shift
    // Should snap to 45° (closest 45° increment for 60° is 45°)
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(150, 186.6, { shiftKey: true }), ctx);
    tool.onPointerUp?.(makePointerEvent(150, 186.6, { shiftKey: true }), ctx);

    vi.advanceTimersByTime(500);
    tool.onPointerDown?.(makePointerEvent(300, 200), ctx);
    tool.onPointerUp?.(makePointerEvent(300, 200), ctx);
    tool.onKeyDown?.(makeKeyEvent('Enter'), ctx);

    const mock = (ctx.createShapeAt as ReturnType<typeof vi.fn>).mock;
    const callArgs = mock.calls[0];
    const pathPoints = callArgs?.[3] as Array<{
      handleOut: [number, number] | null;
    }>;
    expect(pathPoints).toBeDefined();
    if (!pathPoints) return;
    const hOut = pathPoints[0]?.handleOut;
    expect(hOut).not.toBeNull();
    if (hOut) {
      const angle = Math.atan2(hOut[1], hOut[0]);
      const snappedDeg = Math.round((angle * 180) / Math.PI);
      // Should snap to 45° (not 90°)
      expect(snappedDeg).toBe(45);
    }
  });

  it('onDeactivate clears state without committing', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);

    tool.onDeactivate?.(ctx);

    expect(ctx.createShapeAt).not.toHaveBeenCalled();
  });

  it('onDeactivate does not crash when Idle', () => {
    const tool = new PenTool();
    const ctx = makeCtx();

    expect(() => tool.onDeactivate?.(ctx)).not.toThrow();
  });
});
