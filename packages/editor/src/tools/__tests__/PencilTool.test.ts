// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PencilTool } from '../PencilTool';
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
    snapPosition: vi.fn(
      (b: { x: number; y: number; w: number; h: number }) => ({
        x: b.x,
        y: b.y,
        guides: [],
      }),
    ),
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

describe('PencilTool', () => {
  let rafCb: FrameRequestCallback;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
      (cb: FrameRequestCallback) => {
        rafCb = cb;
        return 0;
      },
    );
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('onPointerDown starts capturing', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    const result = tool.onPointerDown!(makePointerEvent(100, 100), ctx);

    expect(result.consumed).toBe(true);
    expect(result.captured).toBe(true);
    expect(window.requestAnimationFrame).toHaveBeenCalled();
  });

  it('onPointerUp with <2 points creates a rect shape', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown!(makePointerEvent(100, 100), ctx);
    tool.onPointerUp!(makePointerEvent(100, 100), ctx);

    expect(ctx.createShapeAt).toHaveBeenCalledWith(
      { x: 100, y: 100 },
      { w: 4, h: 4 },
    );
  });

  it('onPointerUp with 2+ points creates a path with simplified points', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown!(makePointerEvent(100, 100), ctx);

    rafCb!(0);

    tool.onPointerMove!(makePointerEvent(110, 110), ctx);
    rafCb!(0);

    tool.onPointerMove!(makePointerEvent(120, 120), ctx);
    rafCb!(0);

    tool.onPointerUp!(makePointerEvent(120, 120), ctx);

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

    tool.onPointerDown!(makePointerEvent(100, 100), ctx);

    rafCb!(0);

    tool.onPointerMove!(makePointerEvent(110, 110), ctx);
    rafCb!(0);

    tool.onPointerMove!(makePointerEvent(120, 120), ctx);
    rafCb!(0);

    tool.onPointerUp!(makePointerEvent(120, 120), ctx);

    const { mock } = ctx.createShapeAt as ReturnType<typeof vi.fn>;
    const callArgs = mock.calls[0];
    const pathPoints = callArgs?.[3];
    expect(pathPoints).toHaveLength(2);
  });

  it('Escape cancels capture', () => {
    const tool = new PencilTool();
    const ctx = makeCtx();

    tool.onPointerDown!(makePointerEvent(100, 100), ctx);
    tool.onKeyDown!(makeKeyEvent('Escape'), ctx);

    expect(ctx.createShapeAt).not.toHaveBeenCalled();
    expect(ctx.setDraft).toHaveBeenCalledWith(null);
  });
});
