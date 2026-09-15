// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnifeTool } from '../KnifeTool';
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
    sliceWithKnife: vi.fn(),
    ...overrides,
  } as unknown as ToolContext;
}

function pointerEvent(x: number, y: number, overrides: Partial<PointerEvent> = {}): PointerEvent {
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

describe('KnifeTool', () => {
  let tool: KnifeTool;

  beforeEach(() => {
    tool = new KnifeTool();
  });

  it('previews the cut without touching the document', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(pointerEvent(100, 100), ctx);
    tool.onPointerMove?.(pointerEvent(300, 100), ctx);

    expect(ctx.setDraft).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'line', x1: 100, y1: 100, x2: 300, y2: 100 }),
    );
    // Nothing is committed mid-gesture: no cut, no transaction, no mutation.
    expect(ctx.sliceWithKnife).not.toHaveBeenCalled();
    expect(ctx.beginTransaction).not.toHaveBeenCalled();
    expect(ctx.updateNode).not.toHaveBeenCalled();
  });

  it('commits exactly one cut on pointer up and clears the draft', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(pointerEvent(100, 100), ctx);
    tool.onPointerMove?.(pointerEvent(200, 150), ctx);
    tool.onPointerMove?.(pointerEvent(300, 200), ctx);
    tool.onPointerUp?.(pointerEvent(300, 200), ctx);

    expect(ctx.sliceWithKnife).toHaveBeenCalledTimes(1);
    expect(ctx.sliceWithKnife).toHaveBeenCalledWith({ start: [100, 100], end: [300, 200] });
    expect(ctx.setDraft).toHaveBeenLastCalledWith(null);
  });

  it('does not cut on a click that never became a drag', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(pointerEvent(100, 100), ctx);
    tool.onPointerUp?.(pointerEvent(101, 100), ctx);

    expect(ctx.sliceWithKnife).not.toHaveBeenCalled();
  });

  it('abandons the cut on Escape, and the pointer up that follows commits nothing', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(pointerEvent(100, 100), ctx);
    tool.onPointerMove?.(pointerEvent(300, 200), ctx);

    const consumed = tool.onKeyDown?.(new KeyboardEvent('keydown', { key: 'Escape' }), ctx);

    expect(consumed).toBe(true);
    expect(ctx.setDraft).toHaveBeenLastCalledWith(null);

    tool.onPointerUp?.(pointerEvent(300, 200), ctx);
    expect(ctx.sliceWithKnife).not.toHaveBeenCalled();
  });

  it('ignores Escape when no cut is in progress', () => {
    const ctx = makeCtx();
    expect(tool.onKeyDown?.(new KeyboardEvent('keydown', { key: 'Escape' }), ctx)).toBe(false);
  });

  it('commits again after an abandoned cut', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(pointerEvent(100, 100), ctx);
    tool.onPointerMove?.(pointerEvent(300, 200), ctx);
    tool.onKeyDown?.(new KeyboardEvent('keydown', { key: 'Escape' }), ctx);
    tool.onPointerUp?.(pointerEvent(300, 200), ctx);

    tool.onPointerDown?.(pointerEvent(0, 0), ctx);
    tool.onPointerMove?.(pointerEvent(400, 0), ctx);
    tool.onPointerUp?.(pointerEvent(400, 0), ctx);

    expect(ctx.sliceWithKnife).toHaveBeenCalledTimes(1);
    expect(ctx.sliceWithKnife).toHaveBeenCalledWith({ start: [0, 0], end: [400, 0] });
  });

  it('commits nothing when the pointer is cancelled', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(pointerEvent(100, 100), ctx);
    tool.onPointerMove?.(pointerEvent(300, 200), ctx);
    tool.onPointerCancel?.(pointerEvent(300, 200), ctx);

    expect(ctx.sliceWithKnife).not.toHaveBeenCalled();
    expect(ctx.setDraft).toHaveBeenLastCalledWith(null);
  });

  it('constrains the cut to 45 degrees with Shift', () => {
    const ctx = makeCtx({ shiftKey: true });
    tool.onPointerDown?.(pointerEvent(0, 0), ctx);
    tool.onPointerMove?.(pointerEvent(100, 10), ctx);
    tool.onPointerUp?.(pointerEvent(100, 10), ctx);

    const call = (ctx.sliceWithKnife as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // Snapped to horizontal: the y component is gone.
    expect(call.end[1]).toBeCloseTo(0, 6);
  });

  it('uses a crosshair cursor in every state', () => {
    expect(tool.cursor('idle')).toEqual({ css: 'crosshair' });
    expect(tool.cursor('hover')).toEqual({ css: 'crosshair' });
    expect(tool.cursor('drag')).toEqual({ css: 'crosshair' });
  });
});
