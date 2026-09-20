// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelTool } from '../PanelTool';
import type { ToolContext } from '../types';

const DEFAULT_PANEL_W = 400;
const DEFAULT_PANEL_H = 300;

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

describe('PanelTool', () => {
  let tool: PanelTool;

  beforeEach(() => {
    tool = new PanelTool();
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

  it('shows a frame draft during the drag', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(300, 250), ctx);

    expect(ctx.setDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'frame',
        x: 100,
        y: 100,
        w: 200,
        h: 150,
      }),
    );
  });

  it('creates a panel at the dragged rect on drag end', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(300, 250), ctx);
    tool.onPointerUp?.(makePointerEvent(300, 250), ctx);

    expect(ctx.setDraft).toHaveBeenCalledWith(null);
    const call = vi.mocked(ctx.createShapeAt).mock.calls[0];
    expect(call?.[0]).toEqual({ x: 100, y: 100 });
    expect(call?.[1]).toEqual({ w: 200, h: 150 });
    expect(call?.[2]).toBeNull();
  });

  it('creates a default-sized panel on click-without-drag', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(makePointerEvent(200, 200), ctx);
    tool.onPointerMove?.(makePointerEvent(201, 200), ctx);
    tool.onPointerUp?.(makePointerEvent(201, 200), ctx);

    const call = vi.mocked(ctx.createShapeAt).mock.calls[0];
    expect(call?.[0]).toEqual({
      x: 200 - DEFAULT_PANEL_W / 2,
      y: 200 - DEFAULT_PANEL_H / 2,
    });
    expect(call?.[1]).toEqual({ w: DEFAULT_PANEL_W, h: DEFAULT_PANEL_H });
  });

  it('clears the draft on cancel without creating anything', () => {
    const ctx = makeCtx();
    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onPointerMove?.(makePointerEvent(200, 200), ctx);
    tool.onPointerCancel?.(makePointerEvent(200, 200), ctx);

    expect(ctx.setDraft).toHaveBeenCalledWith(null);
    expect(ctx.createShapeAt).not.toHaveBeenCalled();
  });
});
