// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArrowTool } from '../ArrowTool';
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

describe('ArrowTool', () => {
  let tool: ArrowTool;

  beforeEach(() => {
    tool = new ArrowTool();
  });

  it('sets cursor to crosshair', () => {
    expect(tool.cursor('idle')).toEqual({ css: 'crosshair' });
  });

  it('starts drag on pointer down and captures pointer', () => {
    const ctx = makeCtx();
    const result = tool.onPointerDown?.(makePointerEvent(100, 100), ctx);

    expect(result.consumed).toBe(true);
    expect(result.captured).toBe(true);
    expect(ctx.setPointerCapture).toHaveBeenCalledWith(1);
  });

  it('shows arrow draft during drag', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(300, 200), ctx);

    expect(ctx.setDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'arrow',
        x1: 100,
        y1: 100,
        x2: 300,
        y2: 200,
      }),
    );
  });

  it('creates an arrow shape on drag end', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(300, 200), ctx);
    tool.onPointerUp?.(makePointerEvent(300, 200), ctx);

    expect(ctx.setDraft).toHaveBeenCalledWith(null);
    expect(ctx.createShapeAt).toHaveBeenCalled();
  });

  it('creates default-sized arrow on click-without-drag (below threshold)', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(101, 100), ctx);
    tool.onPointerUp?.(makePointerEvent(101, 100), ctx);

    const mock = (ctx.createShapeAt as ReturnType<typeof vi.fn>).mock;
    const callArgs = mock.calls[0];
    expect(callArgs?.[0]).toEqual({ x: 100, y: 100 });
    expect(callArgs?.[1]).toBeUndefined();
  });

  it('Shift key constrains to 45-degree increments', () => {
    const ctx = makeCtx({ shiftKey: true });
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(200, 150), ctx);

    expect(ctx.setDraft).toHaveBeenCalled();
    const mock = (ctx.setDraft as ReturnType<typeof vi.fn>).mock;
    const draft = mock.calls[mock.calls.length - 1]?.[0];
    expect(draft).toBeDefined();
    if (draft && draft.kind === 'arrow') {
      const angle = Math.atan2(draft.y2 - draft.y1, draft.x2 - draft.x1);
      const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      expect(Math.abs(angle - snappedAngle)).toBeLessThan(0.01);
    }
  });

  it('clears draft on drag cancel', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(200, 200), ctx);
    tool.onPointerCancel?.(makePointerEvent(200, 200), ctx);

    expect(ctx.setDraft).toHaveBeenCalledWith(null);
  });
});
