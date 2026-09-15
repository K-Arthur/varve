// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TextTool } from '../TextTool';
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

describe('TextTool', () => {
  let tool: TextTool;

  beforeEach(() => {
    tool = new TextTool();
  });

  it('creates point text on a click', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerUp?.(makePointerEvent(101, 100), ctx);

    expect(ctx.createTextNodeAt).toHaveBeenCalledTimes(1);
    // No size argument: point text derives its box from its content.
    expect(vi.mocked(ctx.createTextNodeAt).mock.calls[0]?.[1]).toBeUndefined();
  });

  it('creates a sized container on a drag', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(300, 220), ctx);
    tool.onPointerUp?.(makePointerEvent(300, 220), ctx);

    const size = vi.mocked(ctx.createTextNodeAt).mock.calls[0]?.[1];
    expect(size).toEqual({ w: 200, h: 120 });
  });

  it('still creates a box when the drag has no vertical extent', () => {
    // The drag threshold is per-axis, so a purely horizontal sweep clears it
    // while leaving the rectangle zero-height. That used to fall through the
    // `w > 0 && h > 0` guard and create nothing, with no feedback at all.
    const ctx = makeCtx();
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(320, 100), ctx);
    tool.onPointerUp?.(makePointerEvent(320, 100), ctx);

    expect(ctx.createTextNodeAt).toHaveBeenCalledTimes(1);
    const size = vi.mocked(ctx.createTextNodeAt).mock.calls[0]?.[1];
    expect(size?.w).toBe(220);
    expect(size?.h).toBeGreaterThan(0);
  });

  it('still creates a box when the drag has no horizontal extent', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(100, 320), ctx);
    tool.onPointerUp?.(makePointerEvent(100, 320), ctx);

    const size = vi.mocked(ctx.createTextNodeAt).mock.calls[0]?.[1];
    expect(size?.w).toBeGreaterThan(0);
    expect(size?.h).toBe(220);
  });

  it('clears the draft when the drag is cancelled', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(300, 220), ctx);
    tool.onPointerCancel?.(makePointerEvent(300, 220), ctx);

    expect(ctx.setDraft).toHaveBeenLastCalledWith(null);
    expect(ctx.createTextNodeAt).not.toHaveBeenCalled();
  });
});
