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

    tool.onPointerMove?.(makePointerEvent(200, 150), ctx);

    expect(ctx.setDraft).toHaveBeenCalledWith(expect.objectContaining({ kind: 'line' }));
  });

  it('rubber-band shows line from last point to cursor', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);

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
    vi.advanceTimersByTime(500);
    tool.onPointerDown?.(makePointerEvent(200, 150), ctx);

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
    vi.advanceTimersByTime(500);
    tool.onPointerDown?.(makePointerEvent(200, 150), ctx);

    tool.onKeyDown?.(makeKeyEvent('Escape'), ctx);

    expect(ctx.createShapeAt).toHaveBeenCalled();
    expect(ctx.announce).toHaveBeenCalledWith('Path cancelled');
  });

  it('single click without commit creates a dot (placeholder)', () => {
    const tool = new PenTool();
    const ctx = makeCtx();
    tool.onActivate?.(ctx);

    tool.onPointerDown?.(makePointerEvent(100, 100), ctx);
    tool.onKeyDown?.(makeKeyEvent('Enter'), ctx);

    expect(ctx.createShapeAt).toHaveBeenCalledWith({ x: 100, y: 100 }, { w: 4, h: 4 });
  });
});
