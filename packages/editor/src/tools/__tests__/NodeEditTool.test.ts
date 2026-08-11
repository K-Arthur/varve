import type { PathPoint } from '@varve/engine';
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
    fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
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
    nodeEditTargetId: 'n1',
    createShapeAt: vi.fn(),
    createTextNodeAt: vi.fn(),
    setSelection: vi.fn(),
    toggleSelection: vi.fn(),
    isSelected: vi.fn(() => true),
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
    rootNodes: vi.fn(() => [node]),
    getNode: vi.fn((id) => (id === 'n1' ? node : undefined)),
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
    const consumed = tool.onKeyDown?.(makeKeyEvent('Escape'), ctx);
    expect(consumed).toBe(true);
    expect(ctx.setTool).toHaveBeenCalledWith('select');
  });

  it('v exits to select tool', () => {
    const tool = new NodeEditTool();
    const ctx = makeCtx();
    const consumed = tool.onKeyDown?.(makeKeyEvent('v'), ctx);
    expect(consumed).toBe(true);
    expect(ctx.setTool).toHaveBeenCalledWith('select');
  });

  it('onDeactivate clears the node edit target', () => {
    const tool = new NodeEditTool();
    const ctx = makeCtx();
    tool.onDeactivate?.(ctx);
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
    tool.onPointerDown?.(ev, ctx);
    // After click, should have anchor 0 selected; updateNode not called yet (just selection)
    // We verify by then pressing Backspace and checking updateNode is called
    const keyEv = makeKeyEvent('Backspace');
    tool.onKeyDown?.(keyEv, ctx);
    expect(ctx.updateNode).toHaveBeenCalled();
  });

  it('clicking outside all anchors deselects all anchors', () => {
    const tool = new NodeEditTool();
    const ctx = makeCtx();
    // click far from all anchors (300, 300)
    const ev = makePointerEvent(300, 300);
    tool.onPointerDown?.(ev, ctx);
    // Backspace with nothing selected should not call updateNode
    const keyEv = makeKeyEvent('Backspace');
    tool.onKeyDown?.(keyEv, ctx);
    expect(ctx.updateNode).not.toHaveBeenCalled();
  });
});

describe('NodeEditTool — anchor deletion', () => {
  it('Backspace removes selected anchor when 2+ points remain', () => {
    const tool = new NodeEditTool();
    const ctx = makeCtx();
    // Select anchor 0 by clicking near it
    tool.onPointerDown?.(makePointerEvent(10, 10), ctx);
    tool.onKeyDown?.(makeKeyEvent('Backspace'), ctx);
    expect(ctx.updateNode).toHaveBeenCalledWith('n1', expect.any(Function));
    // Verify the updater removes point 0
    const updater = vi.mocked(ctx.updateNode).mock.calls[0]![1] as unknown as (
      n: ReturnType<typeof makePathNode>,
    ) => ReturnType<typeof makePathNode>;
    const original = vi.mocked(ctx.getNode)('n1')! as unknown as ReturnType<
      typeof makePathNode
    >;
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
    tool.onPointerDown?.(makePointerEvent(0, 0), ctx);
    tool.onKeyDown?.(makeKeyEvent('Backspace'), ctx);
    expect(ctx.updateNode).not.toHaveBeenCalled();
  });
});

describe('NodeEditTool — anchor move', () => {
  it('dragging an anchor updates its position via updateNode', () => {
    const tool = new NodeEditTool();
    const ctx = makeCtx();
    // Press down on anchor 0 at (10,10)
    const down = makePointerEvent(10, 10);
    tool.onPointerDown?.(down, ctx);
    // Move pointer to (30, 20) — simulated via onPointerMove
    const move = makePointerEvent(30, 20);
    tool.onPointerMove?.(move, ctx);
    // Release
    const up = makePointerEvent(30, 20);
    tool.onPointerUp?.(up, ctx);
    expect(ctx.updateNode).toHaveBeenCalled();
    const updater = vi.mocked(ctx.updateNode).mock.calls[0]![1] as unknown as (
      n: ReturnType<typeof makePathNode>,
    ) => ReturnType<typeof makePathNode>;
    const original = vi.mocked(ctx.getNode)('n1')! as unknown as ReturnType<
      typeof makePathNode
    >;
    const updated = updater(original);
    // Anchor 0 should have moved from (10,10) to (30,20)
    expect(updated.shape.points[0]!.x).toBeCloseTo(30);
    expect(updated.shape.points[0]!.y).toBeCloseTo(20);
  });
});

describe('NodeEditTool — handle hit detection', () => {
  it('clicking near handleOut control point selects handle out drag mode', () => {
    const smoothPoints: PathPoint[] = [
      { x: 10, y: 10, handleIn: null, handleOut: null },
      {
        x: 100,
        y: 10,
        handleIn: [0, 0] as [number, number],
        handleOut: [30, 0] as [number, number],
      },
      { x: 130, y: 40, handleIn: null, handleOut: null },
    ];
    const node = makePathNode(smoothPoints);
    const ctx = makeCtx({
      document: {
        nodes: { n1: node },
        rootChildren: ['n1'],
        name: 'Test',
      } as unknown as ToolContext['document'],
      getNode: vi.fn((id) => (id === 'n1' ? node : undefined)),
      rootNodes: vi.fn(() => [node]),
    });
    const tool = new NodeEditTool();
    // handleOut of point 1 is at local (100+30, 10+0) = (130, 10); click at (132, 10)
    const down = makePointerEvent(132, 10);
    const result = tool.onPointerDown?.(down, ctx);
    expect(result.consumed).toBe(true);
    // Pointer move should now update handleOut, not anchor position
    const move = makePointerEvent(135, 10);
    tool.onPointerMove?.(move, ctx);
    expect(ctx.updateNode).toHaveBeenCalled();
    const updater = vi.mocked(ctx.updateNode).mock.calls[0]![1] as unknown as (
      n: ReturnType<typeof makePathNode>,
    ) => ReturnType<typeof makePathNode>;
    const original = vi.mocked(ctx.getNode)('n1')! as unknown as ReturnType<
      typeof makePathNode
    >;
    const updated = updater(original);
    // handleOut should have moved from [30,0] to [33,0] (delta 3 in x)
    expect(updated.shape.points[1]?.handleOut?.[0]).toBeCloseTo(33);
    expect(updated.shape.points[1]?.handleOut?.[1]).toBeCloseTo(0);
  });

  it('clicking near handleIn control point selects handle in drag mode', () => {
    const smoothPoints: PathPoint[] = [
      { x: 10, y: 10, handleIn: null, handleOut: null },
      {
        x: 100,
        y: 10,
        handleIn: [-30, 0] as [number, number],
        handleOut: [30, 0] as [number, number],
      },
      { x: 130, y: 40, handleIn: null, handleOut: null },
    ];
    const node = makePathNode(smoothPoints);
    const ctx = makeCtx({
      document: {
        nodes: { n1: node },
        rootChildren: ['n1'],
        name: 'Test',
      } as unknown as ToolContext['document'],
      getNode: vi.fn((id) => (id === 'n1' ? node : undefined)),
      rootNodes: vi.fn(() => [node]),
    });
    const tool = new NodeEditTool();
    // handleIn of point 1 is at local (100-30, 10+0) = (70, 10); click at (68, 10)
    const down = makePointerEvent(68, 10);
    tool.onPointerDown?.(down, ctx);
    const move = makePointerEvent(64, 10);
    tool.onPointerMove?.(move, ctx);
    const updater = vi.mocked(ctx.updateNode).mock.calls[0]![1] as unknown as (
      n: ReturnType<typeof makePathNode>,
    ) => ReturnType<typeof makePathNode>;
    const original = vi.mocked(ctx.getNode)('n1')! as unknown as ReturnType<
      typeof makePathNode
    >;
    const updated = updater(original);
    // handleIn should have moved from [-30,0] to [-34,0] (delta -4 in x)
    expect(updated.shape.points[1]?.handleIn?.[0]).toBeCloseTo(-34);
    expect(updated.shape.points[1]?.handleIn?.[1]).toBeCloseTo(0);
  });

  it('corner anchor with null handles: clicking adjacent to anchor does not enter handle drag', () => {
    // Point 1 has null handles; clicking far enough from anchor (outside 8px radius)
    // but where a handle might be — should NOT trigger handle drag (no handles exist).
    // Click at (115, 10) — 15px from point 1 at (100,10), outside 8px anchor radius
    const tool = new NodeEditTool();
    const ctx = makeCtx();
    const down = makePointerEvent(115, 10);
    tool.onPointerDown?.(down, ctx);
    // No anchor or handle was hit → no drag started → moving pointer should not call updateNode
    const move = makePointerEvent(120, 10);
    tool.onPointerMove?.(move, ctx);
    expect(ctx.updateNode).not.toHaveBeenCalled();
  });

  it('anchor hit takes priority over handle hit when both are within radius', () => {
    // When a point has handles and the user clicks very near the anchor center,
    // anchor selection should win over handle drag.
    const smoothPoints: PathPoint[] = [
      { x: 10, y: 10, handleIn: null, handleOut: null },
      {
        x: 100,
        y: 10,
        handleIn: [-8, 0] as [number, number],
        handleOut: [8, 0] as [number, number],
      },
      { x: 130, y: 40, handleIn: null, handleOut: null },
    ];
    const node = makePathNode(smoothPoints);
    const ctx = makeCtx({
      document: {
        nodes: { n1: node },
        rootChildren: ['n1'],
        name: 'Test',
      } as unknown as ToolContext['document'],
      getNode: vi.fn((id) => (id === 'n1' ? node : undefined)),
      rootNodes: vi.fn(() => [node]),
    });
    const tool = new NodeEditTool();
    // Click at anchor center (100, 10) — inside 8px anchor radius AND inside 6px handle radius
    // Anchor has 8px radius, handles have 6px radius
    // Anchor hit should win → draggingAnchorIdx set, not draggingHandle
    const down = makePointerEvent(100, 10);
    tool.onPointerDown?.(down, ctx);
    // Move pointer diagonally — anchor move should update anchor position, not handle
    const move = makePointerEvent(105, 15);
    tool.onPointerMove?.(move, ctx);
    expect(ctx.updateNode).toHaveBeenCalled();
    const updater = vi.mocked(ctx.updateNode).mock.calls[0]![1] as unknown as (
      n: ReturnType<typeof makePathNode>,
    ) => ReturnType<typeof makePathNode>;
    const original = vi.mocked(ctx.getNode)('n1')! as unknown as ReturnType<
      typeof makePathNode
    >;
    const updated = updater(original);
    // Anchor should have moved from (100,10) to (105,15) — NOT the handle
    expect(updated.shape.points[1]?.x).toBeCloseTo(105);
    expect(updated.shape.points[1]?.y).toBeCloseTo(15);
  });
});

describe('NodeEditTool — handle drag movement', () => {
  it('handle drag: releasing pointer exits drag mode', () => {
    const smoothPoints: PathPoint[] = [
      { x: 10, y: 10, handleIn: null, handleOut: null },
      {
        x: 100,
        y: 10,
        handleIn: [0, 0] as [number, number],
        handleOut: [30, 0] as [number, number],
      },
      { x: 130, y: 40, handleIn: null, handleOut: null },
    ];
    const node = makePathNode(smoothPoints);
    const ctx = makeCtx({
      document: {
        nodes: { n1: node },
        rootChildren: ['n1'],
        name: 'Test',
      } as unknown as ToolContext['document'],
      getNode: vi.fn((id) => (id === 'n1' ? node : undefined)),
      rootNodes: vi.fn(() => [node]),
    });
    const tool = new NodeEditTool();
    const down = makePointerEvent(132, 10);
    tool.onPointerDown?.(down, ctx);
    const move = makePointerEvent(140, 10);
    tool.onPointerMove?.(move, ctx);
    expect(ctx.updateNode).toHaveBeenCalledTimes(1);
    // Release
    const up = makePointerEvent(140, 10);
    tool.onPointerUp?.(up, ctx);
    // Moving after release should not call updateNode
    vi.mocked(ctx.updateNode).mockClear();
    const move2 = makePointerEvent(150, 10);
    tool.onPointerMove?.(move2, ctx);
    expect(ctx.updateNode).not.toHaveBeenCalled();
  });
});

describe('NodeEditTool — toggleCornerSmooth segment-aware', () => {
  it('toggleCornerSmooth creates handles at ~1/3 of adjacent segment length', () => {
    const points: PathPoint[] = [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 0, y: 60, handleIn: null, handleOut: null },
      { x: 60, y: 60, handleIn: null, handleOut: null },
    ];
    const node = makePathNode(points);
    const ctx = makeCtx({
      document: {
        nodes: { n1: node },
        rootChildren: ['n1'],
        name: 'Test',
      } as unknown as ToolContext['document'],
      getNode: vi.fn((id) => (id === 'n1' ? node : undefined)),
      rootNodes: vi.fn(() => [node]),
    });
    const tool = new NodeEditTool();
    // Select point 1 (middle anchor)
    const down = makePointerEvent(0, 60);
    tool.onPointerDown?.(down, ctx);
    // Toggle to smooth — should compute handles based on adjacent segments
    tool.onKeyDown?.(makeKeyEvent('c'), ctx);
    expect(ctx.updateNode).toHaveBeenCalled();
    const updater = vi.mocked(ctx.updateNode).mock.calls[0]![1] as unknown as (
      n: ReturnType<typeof makePathNode>,
    ) => ReturnType<typeof makePathNode>;
    const original = vi.mocked(ctx.getNode)('n1')! as unknown as ReturnType<
      typeof makePathNode
    >;
    const updated = updater(original);
    const p1 = updated.shape.points[1]!;
    // Segment to prev (point 0→1): length 60, 1/3 = 20
    // Segment to next (point 1→2): length 60, 1/3 = 20
    // Min = 20
    // handleIn should be along the prev→this vector (0,60)→(0,0) = (0, -60), so handleIn = [0, -20]
    // handleOut should be along the this→next vector (0,60)→(60,60) = (60, 0), so handleOut = [20, 0]
    expect(p1.handleIn).not.toBeNull();
    expect(p1.handleOut).not.toBeNull();
    expect(p1.handleIn?.[0]).toBeCloseTo(0);
    expect(p1.handleIn?.[1]).toBeCloseTo(-20);
    expect(p1.handleOut?.[0]).toBeCloseTo(20);
    expect(p1.handleOut?.[1]).toBeCloseTo(0);
  });

  it('toggleCornerSmooth creates handles with minimum 4px length for close points', () => {
    const points: PathPoint[] = [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 5, y: 0, handleIn: null, handleOut: null },
      { x: 10, y: 0, handleIn: null, handleOut: null },
    ];
    const node = makePathNode(points);
    const ctx = makeCtx({
      document: {
        nodes: { n1: node },
        rootChildren: ['n1'],
        name: 'Test',
      } as unknown as ToolContext['document'],
      getNode: vi.fn((id) => (id === 'n1' ? node : undefined)),
      rootNodes: vi.fn(() => [node]),
    });
    const tool = new NodeEditTool();
    const down = makePointerEvent(5, 0);
    tool.onPointerDown?.(down, ctx);
    tool.onKeyDown?.(makeKeyEvent('c'), ctx);
    const updater = vi.mocked(ctx.updateNode).mock.calls[0]![1] as unknown as (
      n: ReturnType<typeof makePathNode>,
    ) => ReturnType<typeof makePathNode>;
    const original = vi.mocked(ctx.getNode)('n1')! as unknown as ReturnType<
      typeof makePathNode
    >;
    const updated = updater(original);
    const p1 = updated.shape.points[1]!;
    // Segment lengths: 5px each. 1/3 = 1.67, but min is 4px.
    expect(p1.handleIn).not.toBeNull();
    expect(p1.handleOut).not.toBeNull();
    const inLen = Math.sqrt((p1.handleIn?.[0] ?? 0) ** 2 + (p1.handleIn?.[1] ?? 0) ** 2);
    const outLen = Math.sqrt((p1.handleOut?.[0] ?? 0) ** 2 + (p1.handleOut?.[1] ?? 0) ** 2);
    expect(inLen).toBeGreaterThanOrEqual(4);
    expect(outLen).toBeGreaterThanOrEqual(4);
  });
});

describe('NodeEditTool — undo transactions', () => {
  it('anchor drag-move is wrapped in undo transaction', () => {
    const tool = new NodeEditTool();
    const ctx = makeCtx();
    tool.onPointerDown?.(makePointerEvent(10, 10), ctx);
    tool.onPointerMove?.(makePointerEvent(30, 20), ctx);
    tool.onPointerUp?.(makePointerEvent(30, 20), ctx);

    expect(ctx.beginTransaction).toHaveBeenCalled();
    expect(ctx.updateNode).toHaveBeenCalled();
    expect(ctx.commitTransaction).toHaveBeenCalled();
    const beginOrder = vi.mocked(ctx.beginTransaction).mock
      .invocationCallOrder[0]!;
    const updateOrder = vi.mocked(ctx.updateNode).mock.invocationCallOrder[0]!;
    const commitOrder = vi.mocked(ctx.commitTransaction).mock
      .invocationCallOrder[0]!;
    expect(beginOrder).toBeLessThan(updateOrder);
    expect(updateOrder).toBeLessThan(commitOrder);
  });

  it('handle drag is wrapped in undo transaction', () => {
    const smoothPoints: PathPoint[] = [
      { x: 10, y: 10, handleIn: null, handleOut: null },
      {
        x: 100,
        y: 10,
        handleIn: [0, 0] as [number, number],
        handleOut: [30, 0] as [number, number],
      },
      { x: 130, y: 40, handleIn: null, handleOut: null },
    ];
    const node = makePathNode(smoothPoints);
    const ctx = makeCtx({
      document: {
        nodes: { n1: node },
        rootChildren: ['n1'],
        name: 'Test',
      } as unknown as ToolContext['document'],
      getNode: vi.fn((id) => (id === 'n1' ? node : undefined)),
      rootNodes: vi.fn(() => [node]),
    });
    const tool = new NodeEditTool();
    tool.onPointerDown?.(makePointerEvent(132, 10), ctx);
    tool.onPointerMove?.(makePointerEvent(140, 10), ctx);
    tool.onPointerUp?.(makePointerEvent(140, 10), ctx);

    expect(ctx.beginTransaction).toHaveBeenCalled();
    expect(ctx.updateNode).toHaveBeenCalled();
    expect(ctx.commitTransaction).toHaveBeenCalled();
    const beginOrder = vi.mocked(ctx.beginTransaction).mock
      .invocationCallOrder[0]!;
    const updateOrder = vi.mocked(ctx.updateNode).mock.invocationCallOrder[0]!;
    const commitOrder = vi.mocked(ctx.commitTransaction).mock
      .invocationCallOrder[0]!;
    expect(beginOrder).toBeLessThan(updateOrder);
    expect(updateOrder).toBeLessThan(commitOrder);
  });

  it('anchor delete is wrapped in undo transaction', () => {
    const tool = new NodeEditTool();
    const ctx = makeCtx();
    tool.onPointerDown?.(makePointerEvent(10, 10), ctx);
    tool.onKeyDown?.(makeKeyEvent('Backspace'), ctx);

    expect(ctx.beginTransaction).toHaveBeenCalled();
    expect(ctx.updateNode).toHaveBeenCalled();
    expect(ctx.commitTransaction).toHaveBeenCalled();
  });
});

describe('NodeEditTool — Alt-drag handle symmetry', () => {
  it('Alt-drag handleOut does not update handleIn (breaks symmetry)', () => {
    const smoothPoints: PathPoint[] = [
      { x: 10, y: 10, handleIn: null, handleOut: null },
      {
        x: 100,
        y: 10,
        handleIn: [-30, 0] as [number, number],
        handleOut: [30, 0] as [number, number],
      },
      { x: 130, y: 40, handleIn: null, handleOut: null },
    ];
    const node = makePathNode(smoothPoints);
    const ctx = makeCtx({
      document: {
        nodes: { n1: node },
        rootChildren: ['n1'],
        name: 'Test',
      } as unknown as ToolContext['document'],
      getNode: vi.fn((id) => (id === 'n1' ? node : undefined)),
      rootNodes: vi.fn(() => [node]),
    });
    const tool = new NodeEditTool();
    // Click on handleOut of point 1 (at 130, 10) with Alt held
    const down = makePointerEvent(132, 10, { altKey: true });
    tool.onPointerDown?.(down, ctx);
    // Drag handleOut right by 20px
    const move = makePointerEvent(152, 10, { altKey: true });
    tool.onPointerMove?.(move, ctx);
    // handleOut should have moved by +20 in x
    const updater = vi.mocked(ctx.updateNode).mock.calls[0]![1] as unknown as (
      n: ReturnType<typeof makePathNode>,
    ) => ReturnType<typeof makePathNode>;
    const original = vi.mocked(ctx.getNode)('n1')! as unknown as ReturnType<
      typeof makePathNode
    >;
    const updated = updater(original);
    // handleOut moved from [30,0] to [50,0]
    expect(updated.shape.points[1]?.handleOut?.[0]).toBeCloseTo(50);
    expect(updated.shape.points[1]?.handleOut?.[1]).toBeCloseTo(0);
    // handleIn should still be [-30, 0] (NOT moved to [-50, 0])
    expect(updated.shape.points[1]?.handleIn?.[0]).toBeCloseTo(-30);
    expect(updated.shape.points[1]?.handleIn?.[1]).toBeCloseTo(0);
  });

  it('Alt-drag handleIn does not update handleOut (breaks symmetry)', () => {
    const smoothPoints: PathPoint[] = [
      { x: 10, y: 10, handleIn: null, handleOut: null },
      {
        x: 100,
        y: 10,
        handleIn: [-30, 0] as [number, number],
        handleOut: [30, 0] as [number, number],
      },
      { x: 130, y: 40, handleIn: null, handleOut: null },
    ];
    const node = makePathNode(smoothPoints);
    const ctx = makeCtx({
      document: {
        nodes: { n1: node },
        rootChildren: ['n1'],
        name: 'Test',
      } as unknown as ToolContext['document'],
      getNode: vi.fn((id) => (id === 'n1' ? node : undefined)),
      rootNodes: vi.fn(() => [node]),
    });
    const tool = new NodeEditTool();
    // Click on handleIn of point 1 (at 70, 10) with Alt held
    const down = makePointerEvent(68, 10, { altKey: true });
    tool.onPointerDown?.(down, ctx);
    // Drag handleIn further left by 20px
    const move = makePointerEvent(48, 10, { altKey: true });
    tool.onPointerMove?.(move, ctx);
    // handleIn should have moved by -20 in x
    const updater = vi.mocked(ctx.updateNode).mock.calls[0]![1] as unknown as (
      n: ReturnType<typeof makePathNode>,
    ) => ReturnType<typeof makePathNode>;
    const original = vi.mocked(ctx.getNode)('n1')! as unknown as ReturnType<
      typeof makePathNode
    >;
    const updated = updater(original);
    // handleIn moved from [-30,0] to [-50,0]
    expect(updated.shape.points[1]?.handleIn?.[0]).toBeCloseTo(-50);
    expect(updated.shape.points[1]?.handleIn?.[1]).toBeCloseTo(0);
    // handleOut should still be [30, 0] (NOT moved to [50, 0])
    expect(updated.shape.points[1]?.handleOut?.[0]).toBeCloseTo(30);
    expect(updated.shape.points[1]?.handleOut?.[1]).toBeCloseTo(0);
  });
});
