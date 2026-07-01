import type { PathPoint } from '@strata/engine';
import { describe, expect, it, vi } from 'vitest';
import { NodeEditTool } from '../NodeEditTool';
import type { ToolContext } from '../types';

function makePathNode(points: PathPoint[]) {
  return {
    id: 'n1',
    kind: 'shape' as const,
    name: 'Path',
    index: 0,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    fill: [0, 0, 0, 255] as const,
    transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
    shape: { kind: 'path' as const, points, closed: false, tolerance: 3 },
    fills: [] as [],
    strokes: [] as [],
    effects: [] as [],
  };
}

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  const node = makePathNode([
    { x: 10, y: 10, handleIn: null, handleOut: null },
    { x: 100, y: 10, handleIn: null, handleOut: null },
    { x: 100, y: 100, handleIn: null, handleOut: null },
  ]);
  return {
    document: {
      nodes: { n1: node },
      rootChildren: ['n1'],
      name: 'Test',
    } as unknown as ToolContext['document'],
    selection: ['n1'],
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
    nodeEditTargetId: 'n1',
    createShapeAt: vi.fn(),
    createTextNodeAt: vi.fn(),
    setSelection: vi.fn(),
    toggleSelection: vi.fn(),
    isSelected: vi.fn(() => true),
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
    rootNodes: vi.fn(() => [node]),
    getNode: vi.fn((id) => (id === 'n1' ? node : undefined)),
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

function makeKeyEvent(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true });
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

describe('NodeEditTool — exit', () => {
  it('Escape exits to select tool', () => {
    const tool = new NodeEditTool();
    const ctx = makeCtx();
    const consumed = tool.onKeyDown!(makeKeyEvent('Escape'), ctx);
    expect(consumed).toBe(true);
    expect(ctx.setTool).toHaveBeenCalledWith('select');
  });

  it('v exits to select tool', () => {
    const tool = new NodeEditTool();
    const ctx = makeCtx();
    const consumed = tool.onKeyDown!(makeKeyEvent('v'), ctx);
    expect(consumed).toBe(true);
    expect(ctx.setTool).toHaveBeenCalledWith('select');
  });

  it('onDeactivate clears the node edit target', () => {
    const tool = new NodeEditTool();
    const ctx = makeCtx();
    tool.onDeactivate!(ctx);
    expect(ctx.setNodeEditTargetId).toHaveBeenCalledWith(null);
  });
});

describe('NodeEditTool — anchor selection via pointer', () => {
  it('clicking near an anchor selects it (within 8px radius)', () => {
    const tool = new NodeEditTool();
    const ctx = makeCtx();
    // node.transform[4]=0, node.transform[5]=0, first point at (10,10) in world space
    // click at canvas (12, 12) → world (12, 12) — distance = sqrt(4+4) ≈ 2.8 < 8
    const ev = makePointerEvent(12, 12);
    tool.onPointerDown!(ev, ctx);
    // After click, should have anchor 0 selected; updateNode not called yet (just selection)
    // We verify by then pressing Backspace and checking updateNode is called
    const keyEv = makeKeyEvent('Backspace');
    tool.onKeyDown!(keyEv, ctx);
    expect(ctx.updateNode).toHaveBeenCalled();
  });

  it('clicking outside all anchors deselects all anchors', () => {
    const tool = new NodeEditTool();
    const ctx = makeCtx();
    // click far from all anchors (300, 300)
    const ev = makePointerEvent(300, 300);
    tool.onPointerDown!(ev, ctx);
    // Backspace with nothing selected should not call updateNode
    const keyEv = makeKeyEvent('Backspace');
    tool.onKeyDown!(keyEv, ctx);
    expect(ctx.updateNode).not.toHaveBeenCalled();
  });
});

describe('NodeEditTool — anchor deletion', () => {
  it('Backspace removes selected anchor when 2+ points remain', () => {
    const tool = new NodeEditTool();
    const ctx = makeCtx();
    // Select anchor 0 by clicking near it
    tool.onPointerDown!(makePointerEvent(10, 10), ctx);
    tool.onKeyDown!(makeKeyEvent('Backspace'), ctx);
    expect(ctx.updateNode).toHaveBeenCalledWith('n1', expect.any(Function));
    // Verify the updater removes point 0
    const updater = (ctx.updateNode as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    const original = (ctx.getNode as ReturnType<typeof vi.fn>)('n1')!;
    const updated = updater(original);
    expect(updated.shape.points).toHaveLength(2);
  });

  it('Backspace does not remove anchor when only 2 points remain', () => {
    const twoPointNode = makePathNode([
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 100, y: 0, handleIn: null, handleOut: null },
    ]);
    const ctx = makeCtx({
      document: {
        nodes: { n1: twoPointNode },
        rootChildren: ['n1'],
        name: 'Test',
      } as unknown as ToolContext['document'],
      getNode: vi.fn((id) => (id === 'n1' ? twoPointNode : undefined)),
      rootNodes: vi.fn(() => [twoPointNode]),
    });
    const tool = new NodeEditTool();
    // Select anchor 0
    tool.onPointerDown!(makePointerEvent(0, 0), ctx);
    tool.onKeyDown!(makeKeyEvent('Backspace'), ctx);
    expect(ctx.updateNode).not.toHaveBeenCalled();
  });
});

describe('NodeEditTool — anchor move', () => {
  it('dragging an anchor updates its position via updateNode', () => {
    const tool = new NodeEditTool();
    const ctx = makeCtx();
    // Press down on anchor 0 at (10,10)
    const down = makePointerEvent(10, 10);
    tool.onPointerDown!(down, ctx);
    // Move pointer to (30, 20) — simulated via onPointerMove
    const move = makePointerEvent(30, 20);
    tool.onPointerMove!(move, ctx);
    // Release
    const up = makePointerEvent(30, 20);
    tool.onPointerUp!(up, ctx);
    expect(ctx.updateNode).toHaveBeenCalled();
    const updater = (ctx.updateNode as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    const original = (ctx.getNode as ReturnType<typeof vi.fn>)('n1')!;
    const updated = updater(original);
    // Anchor 0 should have moved from (10,10) to (30,20)
    expect(updated.shape.points[0].x).toBeCloseTo(30);
    expect(updated.shape.points[0].y).toBeCloseTo(20);
  });
});
