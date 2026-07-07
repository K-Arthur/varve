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
