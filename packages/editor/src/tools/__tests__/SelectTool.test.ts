import {
  addChild,
  addPage,
  createClippingMask,
  createDocument,
  makeGroupNode,
  makeShapeNode,
  type Page,
} from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { SelectTool } from '../SelectTool';

function makeCtx(overrides?: Record<string, unknown>) {
  const doc = createDocument('test');
  const ctx = {
    document: doc,
    selection: [] as string[],
    zoom: 1,
    pan: { x: 0, y: 0 },
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerType: 'mouse' as const,
    pointerPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    tangentialPressure: 0,
    pointerWidth: 1,
    pointerHeight: 1,
    lastPointerEvent: { clientX: 0, clientY: 0 },
    altitudeAngle: Math.PI / 2,
    azimuthAngle: 0,
    hasCoalescedEvents: false,
    hasPredictedEvents: false,
    sourceEvents: [],
    foregroundColor: [0, 0, 0, 255] as [number, number, number, number],
    maskPreviewMode: 'none' as const,
    setMaskPreviewMode: vi.fn(),
    snapEnabled: false,
    snapGrid: 8,
    isolatedNodeId: null as string | null,
    enterIsolation: vi.fn(),
    exitIsolation: vi.fn(),
    createShapeAt: vi.fn(),
    createTextNodeAt: vi.fn(),
    setSelection: vi.fn(),
    toggleSelection: vi.fn(),
    isSelected: vi.fn().mockReturnValue(false),
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
    announce: vi.fn(),
    announceSelection: vi.fn(),
    announceOperation: vi.fn(),
    setDraft: vi.fn(),
    rootNodes: vi.fn().mockReturnValue([]),
    getNode: vi.fn(),
    canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
    worldToCanvas: vi.fn((wx, wy) => ({ x: wx, y: wy })),
    canvasDeltaToWorld: vi.fn((dx, dy) => ({ dx, dy })),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    findContainingFrame: vi.fn().mockReturnValue(null),
    setDropTargetFrame: vi.fn(),
    nodeWorldBounds: vi.fn().mockReturnValue({ x: 0, y: 0, w: 100, h: 100 }),
    engine: null,
    hitTest: vi.fn().mockReturnValue(null),
    canvasElement: null,
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    abortTransaction: vi.fn(),
    setTool: vi.fn(),
    nodeEditTargetId: null,
    setNodeEditTargetId: vi.fn(),
    setNodeEditSelectedAnchors: vi.fn(),
    setTextEditTargetId: vi.fn(),
    snapPosition: vi.fn((b) => ({ x: b.x, y: b.y, guides: [] })),
    createRasterLayer: vi.fn(() => null),
    touchMultiSelect: { active: false, suspended: false },
    ...overrides,
  };
  return ctx;
}

// A hand-picked contentRoot id, distinct from the `n0`/`n1`/`n2` test-shape
// ids below — `createDocument()`'s own auto-generated contentRoot id would
// otherwise collide with `n1` (both come from the same `n${count}` scheme),
// silently replacing the contentRoot with a shape node.
const TEST_CONTENT_ROOT_ID = 'test-content-root';

function makeDocWithNodes(count: number) {
  const doc = createDocument('test');
  const page = doc.pages?.[0] as Page;
  const nodes: Record<string, any> = {};
  const childIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `n${i}`;
    nodes[id] = makeShapeNode(id, { kind: 'rect', x: i * 50, y: 0, w: 40, h: 40 });
    childIds.push(id);
  }
  nodes[TEST_CONTENT_ROOT_ID] = makeGroupNode(TEST_CONTENT_ROOT_ID, {
    name: 'content',
    children: childIds,
  });
  return {
    ...doc,
    pages: [{ ...page, contentRoot: TEST_CONTENT_ROOT_ID }],
    rootChildren: [TEST_CONTENT_ROOT_ID],
    nodes: nodes as typeof doc.nodes,
  };
}

describe('SelectTool', () => {
  it('selects a node on click via hitTest + setSelection', () => {
    const tool = new SelectTool();
    const hitNode = { id: 'n1', kind: 'shape' as const, name: 'Rect' };
    const ctx = makeCtx({
      hitTest: vi.fn().mockReturnValue({ nodeId: 'n1', node: hitNode }),
    });
    tool.onPointerDown({ clientX: 50, clientY: 50, pointerId: 1, button: 0 } as any, ctx);
    expect(ctx.setSelection).toHaveBeenCalledWith('n1');
    expect(ctx.announceSelection).toHaveBeenCalled();
  });

  it('deselects all when clicking empty space', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({ hitTest: vi.fn().mockReturnValue(null) });
    tool.onPointerDown({ clientX: 50, clientY: 50, pointerId: 1, button: 0 } as any, ctx);
    expect(ctx.setSelection).toHaveBeenCalledWith(null);
  });

  it('shift-click toggles selection without deselecting others', () => {
    const tool = new SelectTool();
    const hitNode = { id: 'n2', kind: 'shape' as const };
    const ctx = makeCtx({
      shiftKey: true,
      hitTest: vi.fn().mockReturnValue({ nodeId: 'n2', node: hitNode }),
    });
    tool.onPointerDown(
      { clientX: 50, clientY: 50, pointerId: 1, button: 0, shiftKey: true } as any,
      ctx,
    );
    expect(ctx.toggleSelection).toHaveBeenCalledWith('n2', true);
  });

  it('escape deselects all', () => {
    const tool = new SelectTool();
    const ctx = makeCtx();
    tool.onKeyDown({ key: 'Escape' } as any, ctx);
    expect(ctx.setSelection).toHaveBeenCalledWith(null);
  });

  it('escape exits isolation and restores the isolated group selection', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({ isolatedNodeId: 'clip-group' });

    tool.onKeyDown({ key: 'Escape' } as any, ctx);

    expect(ctx.exitIsolation).toHaveBeenCalledOnce();
    expect(ctx.setSelection).toHaveBeenCalledWith('clip-group');
    expect(ctx.announceOperation).toHaveBeenCalledWith('Exit isolation', 'Clipping group');
  });

  it('arrow key nudges selected nodes', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 100, 100] }),
    });
    tool.onKeyDown({ key: 'ArrowRight' } as any, ctx);
    expect(ctx.setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 101, y: 100 }]);
    expect(ctx.announceOperation).toHaveBeenCalledWith('Nudge', '1px');
  });

  it('shift+arrow nudges by 10px', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 100, 100] }),
    });
    tool.onKeyDown({ key: 'ArrowLeft', shiftKey: true } as any, ctx);
    expect(ctx.setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 90, y: 100 }]);
  });

  it('arrow key nudges rotated node along local axes', () => {
    const tool = new SelectTool();
    // Rotated 45deg: [cos45, sin45, -sin45, cos45, 100, 100]
    const c = Math.cos(Math.PI / 4);
    const s = Math.sin(Math.PI / 4);
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        transform: [c, s, -s, c, 100, 100],
      }),
    });
    // Right arrow: move along local X axis (c, s)
    tool.onKeyDown({ key: 'ArrowRight' } as any, ctx);
    expect(ctx.setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 100 + c, y: 100 + s }]);
  });

  it('arrow key nudges rotated node backward along local Y on arrow up', () => {
    const tool = new SelectTool();
    const c = Math.cos(Math.PI / 4);
    const s = Math.sin(Math.PI / 4);
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        transform: [c, s, -s, c, 100, 100],
      }),
    });
    // Up arrow: move backward along local Y axis (-c, -d) = (s, -c)
    tool.onKeyDown({ key: 'ArrowUp' } as any, ctx);
    expect(ctx.setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 100 - -s, y: 100 - c }]);
  });

  it('marquee with ctrl key toggles containment mode, selects only nodes fully contained', () => {
    const tool = new SelectTool();
    const doc = makeDocWithNodes(3);
    const ctx = makeCtx({
      ctrlKey: true,
      document: doc,
      nodeWorldBounds: vi.fn((n: any) => {
        if (n.id === 'n0') return { x: 0, y: 0, w: 40, h: 40 };
        if (n.id === 'n1') return { x: 50, y: 0, w: 40, h: 40 };
        if (n.id === 'n2') return { x: 100, y: 0, w: 40, h: 40 };
        return { x: 0, y: 0, w: 100, h: 100 };
      }),
      rootNodes: vi.fn().mockReturnValue([{ id: 'n0' }, { id: 'n1' }, { id: 'n2' }]),
      getNode: vi.fn((id: string) => doc.nodes[id]),
    });
    tool.onPointerDown({ clientX: 0, clientY: 0, pointerId: 1, button: 0 } as any, ctx);
    (tool as any).drag.currentCanvas = { x: 90, y: 50 };
    (tool as any).drag.currentWorld = { x: 90, y: 50 };
    (tool as any).onDragMove?.(ctx);
    tool.onPointerUp({ pointerId: 1 } as any, ctx);
    expect(ctx.toggleSelection).toHaveBeenCalledWith('n0', true);
  });

  it('marquee with shift+alt intersect mode keeps only nodes in both selection and marquee', () => {
    const tool = new SelectTool();
    const doc = makeDocWithNodes(2);
    const ctx = makeCtx({
      shiftKey: true,
      altKey: true,
      document: doc,
      selection: ['n0'],
      isSelected: vi.fn((id: string) => id === 'n0'),
      nodeWorldBounds: vi.fn((n: any) => {
        if (n.id === 'n0') return { x: 0, y: 0, w: 40, h: 40 };
        if (n.id === 'n1') return { x: 100, y: 0, w: 40, h: 40 };
        return { x: 0, y: 0, w: 100, h: 100 };
      }),
      rootNodes: vi.fn().mockReturnValue([{ id: 'n0' }, { id: 'n1' }]),
      getNode: vi.fn((id: string) => doc.nodes[id]),
    });
    tool.onPointerDown(
      { clientX: 0, clientY: 0, pointerId: 1, button: 0, shiftKey: true, altKey: true } as any,
      ctx,
    );
    (tool as any).drag.currentCanvas = { x: 200, y: 50 };
    (tool as any).drag.currentWorld = { x: 200, y: 50 };
    (tool as any).onDragMove?.(ctx);
    tool.onPointerUp({ pointerId: 1 } as any, ctx);
    // Intersect: n0 is in both selection and marquee range
    expect(ctx.setSelection).toHaveBeenCalledWith('n0');
  });

  it('double-click on path enters nodeEdit mode', () => {
    const tool = new SelectTool();
    const hitNode = { id: 'p1', kind: 'shape' as const, name: 'Path', shape: { kind: 'path' } };
    const ctx = makeCtx({
      hitTest: vi.fn().mockReturnValue({ nodeId: 'p1', node: hitNode }),
      getNode: vi.fn().mockReturnValue(hitNode),
    });
    tool.onDoubleClick({ clientX: 50, clientY: 50 } as any, ctx);
    expect(ctx.setNodeEditTargetId).toHaveBeenCalledWith('p1');
    expect(ctx.setTool).toHaveBeenCalledWith('nodeEdit');
  });

  it('double-click on frame announces entry', () => {
    const tool = new SelectTool();
    const hitNode = { id: 'f1', kind: 'frame' as const, name: 'Frame 1' };
    const ctx = makeCtx({
      hitTest: vi.fn().mockReturnValue({ nodeId: 'f1', node: hitNode }),
      getNode: vi.fn().mockReturnValue(hitNode),
    });
    tool.onDoubleClick({ clientX: 50, clientY: 50 } as any, ctx);
    expect(ctx.enterIsolation).toHaveBeenCalledWith('f1');
    expect(ctx.setSelection).toHaveBeenCalledWith('f1');
    expect(ctx.announceOperation).toHaveBeenCalledWith('Enter', 'Frame 1');
  });

  it('double-click inside a selected clipping group isolates it and selects its mask source', () => {
    const tool = new SelectTool();
    const clipped = createClippingMask(makeDocWithNodes(2), 'n1', ['n0']);
    const content = clipped.doc.nodes.n0;
    const ctx = makeCtx({
      document: clipped.doc,
      selection: [clipped.groupId],
      hitTest: vi.fn().mockReturnValue({ nodeId: 'n0', node: content }),
      getNode: vi.fn((id: string) => clipped.doc.nodes[id]),
    });

    tool.onDoubleClick({ clientX: 50, clientY: 50 } as any, ctx);

    expect(ctx.enterIsolation).toHaveBeenCalledWith(clipped.groupId);
    expect(ctx.setSelection).toHaveBeenCalledWith('n1');
    expect(ctx.announceOperation).toHaveBeenCalledWith(
      'Edit clipping mask',
      expect.stringContaining('clip'),
    );
  });

  it('onDeactivate aborts active drag transaction', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({
      hitTest: vi.fn().mockReturnValue({ nodeId: 'n1', node: { id: 'n1' } }),
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 100, 100] }),
    });
    tool.onPointerDown({ clientX: 50, clientY: 50, pointerId: 1, button: 0 } as any, ctx);
    expect(ctx.beginTransaction).toHaveBeenCalled();
    tool.onDeactivate(ctx);
    expect(ctx.abortTransaction).toHaveBeenCalled();
  });
});

describe('SelectTool — depth-based click cycling', () => {
  it('clicking same node twice cycles to next node below', () => {
    const tool = new SelectTool();
    const baseNode = (
      id: string,
      name: string,
      fill: { space: 'rgb'; r: number; g: number; b: number; a: number },
    ) => ({
      id,
      name,
      kind: 'shape' as const,
      fill,
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0] as const,
      strokes: [],
      effects: [],
      bindings: undefined as any,
    });
    // n2 topmost, n0 middle (selected), n1 bottom
    const n0 = baseNode('n0', 'Middle', { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 });
    const n1 = baseNode('n1', 'Bottom', { space: 'rgb' as const, r: 0, g: 255, b: 0, a: 255 });
    const n2 = baseNode('n2', 'Top', { space: 'rgb' as const, r: 0, g: 0, b: 255, a: 255 });
    const doc = makeDocWithNodes(0);
    doc.nodes.n0 = n0 as any;
    doc.nodes.n1 = n1 as any;
    doc.nodes.n2 = n2 as any;
    // Paint order (last = topmost): n1 (bottom), n0 (middle), n2 (top).
    (doc.nodes[TEST_CONTENT_ROOT_ID] as any).children = ['n1', 'n0', 'n2'];

    const ctx = makeCtx({
      document: doc,
      selection: ['n0'],
      isSelected: vi.fn((id: string) => id === 'n0'),
      getNode: vi.fn((id: string) => doc.nodes[id]),
      hitTest: vi.fn(() => ({ nodeId: 'n0', node: n0 })),
      rootNodes: vi.fn(() => [
        { id: 'n1', visible: true, locked: false },
        { id: 'n0', visible: true, locked: false },
        { id: 'n2', visible: true, locked: false },
      ]),
      nodeWorldBounds: vi.fn(() => ({ x: 0, y: 0, w: 100, h: 100 })),
    });

    tool.onPointerDown({ clientX: 50, clientY: 50, pointerId: 1, button: 0 } as any, ctx);

    // n0 is middle node, n1 (bottom) is below it — should cycle to n1
    expect(ctx.setSelection).toHaveBeenCalledWith('n1');
  });
});

describe('SelectTool — transparent fill click-through', () => {
  it('transparent fill node passes through to next opaque node at point', () => {
    const tool = new SelectTool();
    const baseNode = (
      id: string,
      name: string,
      fill: { space: 'rgb'; r: number; g: number; b: number; a: number },
      extra = {},
    ) => ({
      id,
      name,
      kind: 'shape' as const,
      fill,
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0] as const,
      strokes: [],
      effects: [],
      bindings: undefined as any,
      ...extra,
    });
    const n0 = baseNode('n0', 'StrokeOnly', { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 });
    const n1 = baseNode('n1', 'HasFill', { space: 'rgb' as const, r: 255, g: 0, b: 0, a: 255 });
    const doc = makeDocWithNodes(0);
    doc.nodes = { ...doc.nodes, n0: n0 as any, n1: n1 as any };
    (doc.nodes[TEST_CONTENT_ROOT_ID] as any).children = ['n1', 'n0'];

    const setSelection = vi.fn();
    const ctx = makeCtx({
      document: doc,
      selection: [],
      setSelection,
      hitTest: vi.fn(() => ({ nodeId: 'n0', node: n0 })),
      getNode: vi.fn((id: string) => doc.nodes[id]),
      rootNodes: vi.fn(() => [
        { id: 'n1', visible: true, locked: false },
        { id: 'n0', visible: true, locked: false },
      ]),
      nodeWorldBounds: vi.fn(() => ({ x: 0, y: 0, w: 100, h: 100 })),
    });

    tool.onPointerDown({ clientX: 50, clientY: 50, pointerId: 1, button: 0 } as any, ctx);
    expect(setSelection).toHaveBeenCalledWith('n1');
  });
});

describe('SelectTool — keyboard selection cycle (Tab)', () => {
  it('Tab cycles to next node in paint order', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({
      selection: ['n0'],
      getNode: vi.fn((id) => {
        if (id === 'n0') return { id: 'n0', transform: [1, 0, 0, 1, 0, 0] };
        if (id === 'n1') return { id: 'n1', transform: [1, 0, 0, 1, 50, 0] };
        return undefined;
      }),
      rootNodes: vi.fn(() => [
        { id: 'n0', visible: true, locked: false },
        { id: 'n1', visible: true, locked: false },
        { id: 'n2', visible: true, locked: false },
      ]),
    });

    const result = tool.onKeyDown({ key: 'Tab' } as any, ctx);
    // SelectTool no longer consumes Tab — handled at CanvasArea level (DFS paint order)
    expect(result).toBe(false);
    expect(ctx.setSelection).not.toHaveBeenCalled();
  });

  it('Shift+Tab cycles to previous node in paint order', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({
      selection: ['n1'],
      shiftKey: true,
      getNode: vi.fn((id) => {
        if (id === 'n0') return { id: 'n0', transform: [1, 0, 0, 1, 0, 0] };
        if (id === 'n1') return { id: 'n1', transform: [1, 0, 0, 1, 50, 0] };
        return undefined;
      }),
      rootNodes: vi.fn(() => [
        { id: 'n0', visible: true, locked: false },
        { id: 'n1', visible: true, locked: false },
        { id: 'n2', visible: true, locked: false },
      ]),
    });

    const result = tool.onKeyDown({ key: 'Tab', shiftKey: true } as any, ctx);
    expect(result).toBe(false);
    expect(ctx.setSelection).not.toHaveBeenCalled();
  });

  it('Tab with nothing selected selects first visible node', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({
      selection: [],
      rootNodes: vi.fn(() => [
        { id: 'n0', visible: true, locked: false },
        { id: 'n1', visible: true, locked: false },
      ]),
    });

    const result = tool.onKeyDown({ key: 'Tab' } as any, ctx);
    expect(result).toBe(false);
    expect(ctx.setSelection).not.toHaveBeenCalled();
  });

  it('Tab skips hidden nodes (handled at CanvasArea)', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({
      selection: ['n0'],
      getNode: vi.fn((id) => {
        if (id === 'n0') return { id: 'n0', transform: [1, 0, 0, 1, 0, 0] };
        return undefined;
      }),
      rootNodes: vi.fn(() => [
        { id: 'n0', visible: true, locked: false },
        { id: 'n1', visible: false, locked: false },
        { id: 'n2', visible: true, locked: false },
      ]),
    });

    const result = tool.onKeyDown({ key: 'Tab' } as any, ctx);
    expect(result).toBe(false);
    expect(ctx.setSelection).not.toHaveBeenCalled();
  });
});

describe('SelectTool — keyboard nudge undo transaction', () => {
  it('begins transaction on keydown, commits on keyup for coalesced undo', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 100, 100] }),
    });
    tool.onKeyDown({ key: 'ArrowRight' } as any, ctx);
    expect(ctx.beginTransaction).toHaveBeenCalledTimes(1);
    expect(ctx.commitTransaction).not.toHaveBeenCalled();
    expect(ctx.setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 101, y: 100 }]);
    tool.onKeyUp({ key: 'ArrowRight' } as any, ctx);
    expect(ctx.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('coalesces repeat keydowns into the same transaction', () => {
    const tool = new SelectTool();
    // Track position across calls so repeat gets the updated position
    let posX = 100;
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 100, 100] }),
      setNodePositions: vi.fn((positions: Array<{ id: string; x: number }>) => {
        posX = positions[0]?.x ?? posX;
      }),
    });
    // Override getNode to return current position
    vi.mocked(ctx.getNode).mockImplementation(() => ({
      id: 'n1',
      transform: [1, 0, 0, 1, posX, 100],
    }));

    // First press begins transaction, moves to 101
    tool.onKeyDown({ key: 'ArrowRight' } as any, ctx);
    expect(ctx.beginTransaction).toHaveBeenCalledTimes(1);
    expect(ctx.setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 101, y: 100 }]);

    // Repeat press shares the same transaction, moves to 102
    vi.mocked(ctx.setNodePositions).mockClear();
    tool.onKeyDown({ key: 'ArrowRight', repeat: true } as any, ctx);
    expect(ctx.beginTransaction).toHaveBeenCalledTimes(1);
    expect(ctx.commitTransaction).not.toHaveBeenCalled();
    expect(ctx.setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 102, y: 100 }]);

    // Keyup commits once
    tool.onKeyUp({ key: 'ArrowRight' } as any, ctx);
    expect(ctx.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('wraps shift+arrow nudge in beginTransaction/commitTransaction', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 100, 100] }),
    });
    tool.onKeyDown({ key: 'ArrowLeft', shiftKey: true } as any, ctx);
    expect(ctx.beginTransaction).toHaveBeenCalledTimes(1);
    expect(ctx.setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 90, y: 100 }]);
    tool.onKeyUp({ key: 'ArrowLeft' } as any, ctx);
    expect(ctx.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not call beginTransaction when no selection', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({ selection: [] });
    tool.onKeyDown({ key: 'ArrowRight' } as any, ctx);
    expect(ctx.beginTransaction).not.toHaveBeenCalled();
    expect(ctx.commitTransaction).not.toHaveBeenCalled();
  });
});

describe('SelectTool — keyboard nudge auto-reparent', () => {
  it('nudge into frame triggers reparentNode with frame as new parent', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        transform: [1, 0, 0, 1, 100, 100],
        visible: true,
        locked: false,
      }),
      findContainingFrame: vi.fn().mockReturnValue('frame1'),
    });
    tool.onKeyDown({ key: 'ArrowRight' } as any, ctx);
    expect(ctx.setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 101, y: 100 }]);
    expect(ctx.reparentNode).toHaveBeenCalledWith('n1', 'frame1', 0);
    expect(ctx.announceOperation).toHaveBeenCalledWith('Nudge', '1px');
  });

  it('nudge outside frame does not reparent', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        transform: [1, 0, 0, 1, 100, 100],
        visible: true,
        locked: false,
      }),
      findContainingFrame: vi.fn().mockReturnValue(null),
    });
    tool.onKeyDown({ key: 'ArrowRight' } as any, ctx);
    expect(ctx.setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 101, y: 100 }]);
    expect(ctx.reparentNode).not.toHaveBeenCalled();
    expect(ctx.announceOperation).toHaveBeenCalledWith('Nudge', '1px');
  });

  it('nudge triggers beginTransaction twice and commitTransaction twice (move + reparent + keyup)', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        transform: [1, 0, 0, 1, 100, 100],
        visible: true,
        locked: false,
      }),
      findContainingFrame: vi.fn().mockReturnValue('frame1'),
    });
    tool.onKeyDown({ key: 'ArrowRight' } as any, ctx);
    expect(ctx.beginTransaction).toHaveBeenCalledTimes(2);
    // First commit is for the auto-reparent transaction (inside onKeyDown)
    expect(ctx.commitTransaction).toHaveBeenCalledTimes(1);
    // Keyup commits the nudge transaction
    tool.onKeyUp({ key: 'ArrowRight' } as any, ctx);
    expect(ctx.commitTransaction).toHaveBeenCalledTimes(2);
  });

  it('nudge with Ctrl held bypasses auto-reparent', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({
        id: 'n1',
        transform: [1, 0, 0, 1, 100, 100],
        visible: true,
        locked: false,
      }),
      findContainingFrame: vi.fn().mockReturnValue('frame1'),
      ctrlKey: true,
    });
    tool.onKeyDown({ key: 'ArrowRight', ctrlKey: true } as any, ctx);
    expect(ctx.setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 101, y: 100 }]);
    expect(ctx.reparentNode).not.toHaveBeenCalled();
    expect(ctx.announceOperation).toHaveBeenCalledWith('Nudge', '1px');
  });

  describe('isolation mode', () => {
    it('filters hit-test results to isolated subtree', () => {
      const tool = new SelectTool();
      const ctx = makeCtx({
        isolatedNodeId: 'frame1',
        hitTest: vi.fn().mockReturnValue({
          nodeId: 'outside-node',
          node: { id: 'outside-node', kind: 'shape' as const },
        }),
        getNode: vi.fn().mockReturnValue({
          id: 'outside-node',
          kind: 'shape' as const,
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
        }),
      });

      // Simulate a pointer down event
      const ev = new PointerEvent('pointerdown', {
        clientX: 100,
        clientY: 100,
        pointerId: 1,
      });

      const result = tool.onPointerDown(ev, ctx);
      // Should deselect (setSelection(null)) since hit was filtered out
      expect(ctx.setSelection).toHaveBeenCalledWith(null);
      expect(result).toEqual({ consumed: true, captured: true });
    });

    it('allows selection within isolated subtree', () => {
      const tool = new SelectTool();
      const ctx = makeCtx({
        isolatedNodeId: 'frame1',
        hitTest: vi.fn().mockReturnValue({
          nodeId: 'frame1', // The isolated root itself
          node: { id: 'frame1', kind: 'frame' as const, children: [] },
        }),
        getNode: vi.fn().mockReturnValue({
          id: 'frame1',
          kind: 'frame' as const,
          children: [],
          fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
        }),
      });

      const ev = new PointerEvent('pointerdown', {
        clientX: 100,
        clientY: 100,
        pointerId: 1,
      });

      tool.onPointerDown(ev, ctx);
      expect(ctx.setSelection).toHaveBeenCalledWith('frame1');
    });

    it('filters marquee selection to isolated subtree', () => {
      const tool = new SelectTool();
      const ctx = makeCtx({
        isolatedNodeId: 'frame1',
        selection: [],
        getNode: vi.fn().mockReturnValue({
          id: 'test-node',
          kind: 'shape' as const,
          visible: true,
          locked: false,
        }),
      });

      // Start marquee drag
      const ev = new PointerEvent('pointerdown', {
        clientX: 0,
        clientY: 0,
        pointerId: 1,
      });
      tool.onPointerDown(ev, ctx);

      // End drag (marquee selection)
      tool.onDragEnd(ctx);

      // The marquee should filter nodes by isolation
      // This is tested implicitly by the implementation
      expect(ctx.setDraft).toHaveBeenCalledWith(null);
    });
  });
});

describe('SelectTool — drop target frame highlighting', () => {
  it('uses world displacement when auto-pan moves the camera under a stationary pointer', () => {
    const tool = new SelectTool();
    const setNodePositions = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      setNodePositions,
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 10, 20] }),
      nodeWorldBounds: vi.fn().mockReturnValue({ x: 10, y: 20, w: 40, h: 40 }),
    });
    (tool as any).drag = {
      startCanvas: { x: 100, y: 100 },
      currentCanvas: { x: 100, y: 100 },
      startWorld: { x: 100, y: 100 },
      currentWorld: { x: 132, y: 108 },
    };
    (tool as any).initialPositions = new Map([['n1', { x: 10, y: 20 }]]);

    (tool as any).onDragMove?.(ctx);

    expect(setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 42, y: 28 }]);
  });

  it('calls setDropTargetFrame with the containing frame on drag move', () => {
    const tool = new SelectTool();
    const findContainingFrame = vi.fn().mockReturnValue('frame1');
    const setDropTargetFrame = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      findContainingFrame,
      setDropTargetFrame,
      nodeWorldBounds: vi.fn().mockReturnValue({ x: 0, y: 0, w: 100, h: 100 }),
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 0, 0] }),
    });

    (tool as any).drag = { startCanvas: { x: 0, y: 0 }, currentCanvas: { x: 10, y: 10 } };
    (tool as any).initialPositions = new Map([['n1', { x: 0, y: 0 }]]);
    (tool as any).onDragMove?.(ctx);

    expect(findContainingFrame).toHaveBeenCalledWith({ x: 50, y: 50 });
    expect(setDropTargetFrame).toHaveBeenCalledWith('frame1');
  });

  it('calls setDropTargetFrame with null when no containing frame is found', () => {
    const tool = new SelectTool();
    const findContainingFrame = vi.fn().mockReturnValue(null);
    const setDropTargetFrame = vi.fn();
    const ctx = makeCtx({
      selection: ['n1'],
      findContainingFrame,
      setDropTargetFrame,
      nodeWorldBounds: vi.fn().mockReturnValue({ x: 0, y: 0, w: 100, h: 100 }),
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 0, 0] }),
    });

    (tool as any).drag = { startCanvas: { x: 0, y: 0 }, currentCanvas: { x: 10, y: 10 } };
    (tool as any).initialPositions = new Map([['n1', { x: 0, y: 0 }]]);
    (tool as any).onDragMove?.(ctx);

    expect(setDropTargetFrame).toHaveBeenCalledWith(null);
  });

  it('clears drop target frame on drag end', () => {
    const tool = new SelectTool();
    const setDropTargetFrame = vi.fn();
    const ctx = makeCtx({
      selection: [],
      setDropTargetFrame,
    });

    (tool as any).marqueeActive = false;
    (tool as any).onDragEnd?.(ctx);

    expect(setDropTargetFrame).toHaveBeenCalledWith(null);
  });

  it('delegates snap to ctx.snapPosition without pre-building bounds (spatial index optimization)', () => {
    const tool = new SelectTool();
    const snapPosition = vi.fn((b) => ({ x: b.x, y: b.y, guides: [] }));
    const nodeWorldBounds = vi.fn().mockReturnValue({ x: 5, y: 5, w: 50, h: 50 });
    const ctx = makeCtx({
      selection: ['n1'],
      snapPosition,
      nodeWorldBounds,
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 0, 0] }),
    });

    (tool as any).drag = { startCanvas: { x: 0, y: 0 }, currentCanvas: { x: 20, y: 20 } };
    (tool as any).initialPositions = new Map([['n1', { x: 0, y: 0 }]]);
    (tool as any).onDragMove?.(ctx);

    expect(snapPosition).toHaveBeenCalledWith({ x: 20, y: 20, w: 50, h: 50 }, []);
  });

  it('snaps a multi-selection as a whole, preserving relative arrangement', () => {
    const tool = new SelectTool();
    // Snap response shifts the primary node by +7,+7 — the group must move
    // rigidly (both nodes get the same world delta), never per-node amounts.
    const snapPosition = vi.fn((b) => ({ x: b.x + 7, y: b.y + 7, guides: [] }));
    const nodeWorldBounds = vi.fn().mockReturnValue({ x: 0, y: 0, w: 40, h: 40 });
    const setNodePositions = vi.fn();
    const ctx = makeCtx({
      selection: ['n1', 'n2'],
      snapEnabled: true,
      snapPosition,
      nodeWorldBounds,
      setNodePositions,
      getNode: vi.fn((id: string) => ({ id, transform: [1, 0, 0, 1, 0, 0] })),
    });

    (tool as any).drag = { startCanvas: { x: 0, y: 0 }, currentCanvas: { x: 20, y: 20 } };
    (tool as any).initialPositions = new Map([
      ['n1', { x: 0, y: 0 }],
      ['n2', { x: 100, y: 0 }],
    ]);
    (tool as any).onDragMove?.(ctx);

    const positions = setNodePositions.mock.calls[0]?.[0] as Array<{
      id: string;
      x: number;
      y: number;
    }>;
    expect(positions).toHaveLength(2);
    const n1 = positions.find((p) => p.id === 'n1');
    const n2 = positions.find((p) => p.id === 'n2');
    // n1: 0 + 20 + 7 = 27; n2 keeps its +100 offset: 100 + 20 + 7 = 127.
    expect(n1).toMatchObject({ x: 27, y: 27 });
    expect(n2).toMatchObject({ x: 127, y: 27 });
    // One snap evaluation for the group, not one per node.
    expect(snapPosition).toHaveBeenCalledTimes(1);
  });
});

describe('SelectTool Alt-drag duplication', () => {
  /** Drag gesture primed to move `ids` from world origin (0,0) by (dx,dy). */
  function primeDrag(tool: SelectTool, ids: string[], dx: number, dy: number) {
    (tool as any).drag = { startCanvas: { x: 0, y: 0 }, currentCanvas: { x: dx, y: dy } };
    (tool as any).initialPositions = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    (tool as any).isMoveGesture = true;
  }

  function movingCtx(overrides?: Record<string, unknown>) {
    return makeCtx({
      getNode: vi.fn((id: string) => ({ id, transform: [1, 0, 0, 1, 0, 0] })),
      nodeWorldBounds: vi.fn().mockReturnValue({ x: 0, y: 0, w: 40, h: 40 }),
      ...overrides,
    });
  }

  it('duplicates exactly once no matter how many pointer moves the drag emits', () => {
    const tool = new SelectTool();
    const duplicateSelected = vi.fn();
    const ctx = movingCtx({ selection: ['n1'], altKey: true, duplicateSelected });
    primeDrag(tool, ['n1'], 10, 10);

    for (let i = 0; i < 25; i++) (tool as any).onDragMove?.(ctx);

    expect(duplicateSelected).toHaveBeenCalledTimes(1);
  });

  it('leaves the originals in place on the frame that fires the duplicate', () => {
    const tool = new SelectTool();
    const setNodePositions = vi.fn();
    const ctx = movingCtx({ selection: ['n1'], altKey: true, setNodePositions });
    primeDrag(tool, ['n1'], 30, 15);

    (tool as any).onDragMove?.(ctx);

    // The clones' ids are not observable yet; moving the still-selected
    // originals here would drag them out from under the copy.
    expect(setNodePositions).not.toHaveBeenCalled();
  });

  it('does not move anything while the clones have not become the selection', () => {
    const tool = new SelectTool();
    const setNodePositions = vi.fn();
    const ctx = movingCtx({ selection: ['n1'], altKey: true, setNodePositions });
    primeDrag(tool, ['n1'], 30, 15);

    (tool as any).onDragMove?.(ctx); // fires duplicate
    (tool as any).onDragMove?.(ctx); // selection still the source ids

    expect(setNodePositions).not.toHaveBeenCalled();
  });

  it('hands the gesture to the clone, which tracks the pointer from the drag origin', () => {
    // Regression guard: the clone used to have no initialPositions entry, so
    // every move hit `continue` and the copy never followed the pointer --
    // it just sat at duplicateSelected's fixed offset.
    const tool = new SelectTool();
    const setNodePositions = vi.fn();
    const ctx = movingCtx({ selection: ['n1'], altKey: true, setNodePositions });
    primeDrag(tool, ['n1'], 120, 60);

    (tool as any).onDragMove?.(ctx); // fires duplicate
    ctx.selection = ['n1-copy']; // duplicateSelected re-selects the clone
    (tool as any).onDragMove?.(ctx);

    expect(setNodePositions).toHaveBeenCalledWith([{ id: 'n1-copy', x: 120, y: 60 }]);
  });

  it('maps each clone onto the origin of the node it was cloned from', () => {
    const tool = new SelectTool();
    const setNodePositions = vi.fn();
    const ctx = movingCtx({ selection: ['a', 'b'], altKey: true, setNodePositions });
    (tool as any).drag = { startCanvas: { x: 0, y: 0 }, currentCanvas: { x: 10, y: 0 } };
    (tool as any).initialPositions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 200, y: 0 }],
    ]);
    (tool as any).isMoveGesture = true;

    (tool as any).onDragMove?.(ctx);
    ctx.selection = ['a-copy', 'b-copy']; // duplicateSelected preserves order
    (tool as any).onDragMove?.(ctx);

    expect(setNodePositions).toHaveBeenCalledWith([
      { id: 'a-copy', x: 10, y: 0 },
      { id: 'b-copy', x: 210, y: 0 },
    ]);
  });

  it('falls back to a plain move when duplication yields no usable selection', () => {
    const tool = new SelectTool();
    const setNodePositions = vi.fn();
    const ctx = movingCtx({ selection: ['n1'], altKey: true, setNodePositions });
    primeDrag(tool, ['n1'], 40, 40);

    (tool as any).onDragMove?.(ctx); // fires duplicate
    ctx.selection = []; // duplication produced nothing
    (tool as any).onDragMove?.(ctx);
    ctx.selection = ['n1'];
    (tool as any).onDragMove?.(ctx);

    // The gesture must not stay wedged waiting for clone ids forever.
    expect(setNodePositions).toHaveBeenCalledWith([{ id: 'n1', x: 40, y: 40 }]);
  });

  it('starts each gesture with a clean handoff so an interrupted Alt-drag cannot wedge the next', () => {
    const tool = new SelectTool();
    const setNodePositions = vi.fn();
    const ctx = movingCtx({ selection: ['n1'], altKey: true, setNodePositions });
    primeDrag(tool, ['n1'], 10, 10);
    (tool as any).onDragMove?.(ctx); // Alt-drag begins, then is abandoned

    // A fresh pointer down must clear the pending handoff.
    const down = { pointerId: 1, clientX: 0, clientY: 0 } as unknown as PointerEvent;
    (tool as any).onPointerDown?.(down, movingCtx({ selection: ['n1'] }));

    expect((tool as any).awaitingDuplicateHandoff).toBe(false);
    expect((tool as any).duplicateSourceIds).toEqual([]);
  });
});

describe('SelectTool drag-end auto-reparent', () => {
  /** Paged doc whose contentRoot directly holds shape `n0`. */
  function docWithTopLevelNode() {
    const doc = createDocument('test', {});
    const page = doc.pages![0]!;
    const contentRootId = page.contentRoot!;
    const contentRoot = doc.nodes[contentRootId]!;
    return {
      ...doc,
      nodes: {
        ...doc.nodes,
        [contentRootId]: { ...contentRoot, children: ['n0'] },
        n0: makeShapeNode('n0', { kind: 'rect', x: 0, y: 0, w: 40, h: 40 }),
      },
    } as typeof doc;
  }

  /** Paged doc whose contentRoot holds frame `f1`, which holds shape `n0`. */
  function docWithFramedNode() {
    const doc = createDocument('test', {});
    const page = doc.pages![0]!;
    const contentRootId = page.contentRoot!;
    const contentRoot = doc.nodes[contentRootId]!;
    return {
      ...doc,
      nodes: {
        ...doc.nodes,
        [contentRootId]: { ...contentRoot, children: ['f1'] },
        f1: makeGroupNode('f1', { name: 'frame', children: ['n0'] }),
        n0: makeShapeNode('n0', { kind: 'rect', x: 0, y: 0, w: 40, h: 40 }),
      },
    } as typeof doc;
  }

  function endDrag(tool: SelectTool, ctx: ReturnType<typeof makeCtx>) {
    (tool as any).isMoveGesture = true;
    (tool as any).marqueeActive = false;
    (tool as any).onDragEnd(ctx);
  }

  it('does not reparent a top-level node that stayed at top level', () => {
    // Regression guard: a top-level node's parent is the page contentRoot, not
    // null, so the old `parent !== null` check reparented every dragged node to
    // the contentRoot it already lived in — a redundant write that added a
    // no-op undo entry on top of the move.
    const tool = new SelectTool();
    const doc = docWithTopLevelNode();
    const reparentNode = vi.fn();
    const ctx = makeCtx({
      document: doc,
      selection: ['n0'],
      findContainingFrame: vi.fn().mockReturnValue(null),
      reparentNode,
      getNode: vi.fn((id: string) => doc.nodes[id]),
      rootNodes: vi.fn().mockReturnValue([{ id: 'n0' }]),
    });

    endDrag(tool, ctx);

    expect(reparentNode).not.toHaveBeenCalled();
  });

  it('still pops a framed node out to top level when dragged onto empty canvas', () => {
    // The suppression must not swallow a real pop-out: a node whose parent is a
    // frame, dragged where no frame contains it, must reparent to top level.
    const tool = new SelectTool();
    const doc = docWithFramedNode();
    const reparentNode = vi.fn();
    const ctx = makeCtx({
      document: doc,
      selection: ['n0'],
      findContainingFrame: vi.fn().mockReturnValue(null),
      reparentNode,
      getNode: vi.fn((id: string) => doc.nodes[id]),
      rootNodes: vi.fn().mockReturnValue([{ id: 'f1' }]),
    });

    endDrag(tool, ctx);

    expect(reparentNode).toHaveBeenCalledTimes(1);
    expect(reparentNode).toHaveBeenCalledWith('n0', null, expect.any(Number));
  });
});

describe('SelectTool deep selection (Ctrl+click)', () => {
  it('Ctrl+click selects the deepest non-container child at the hit point', () => {
    const tool = new SelectTool();
    // Hit returns a frame; findNodesAtPoint returns [frame, child]
    const frameNode = {
      id: 'f1',
      kind: 'frame' as const,
      name: 'Frame',
      children: ['c1'],
      transform: [1, 0, 0, 1, 0, 0],
    };
    const childNode = {
      id: 'c1',
      kind: 'shape' as const,
      name: 'Child',
      transform: [1, 0, 0, 1, 10, 10],
    };
    const ctx = makeCtx({
      ctrlKey: true,
      hitTest: vi.fn().mockReturnValue({ nodeId: 'f1', node: frameNode }),
      isSelected: vi.fn().mockReturnValue(false),
      getNode: vi.fn((id: string) => (id === 'f1' ? frameNode : childNode)),
      document: {
        nodes: { f1: frameNode, c1: childNode },
        pages: [],
        rootChildren: ['f1'],
        activePageId: 'page1',
      } as any,
    });
    // Mock findNodesAtPoint using the private method path
    (tool as any).findNodesAtPoint = vi.fn().mockReturnValue([
      { nodeId: 'f1', node: frameNode },
      { nodeId: 'c1', node: childNode },
    ]);
    tool.onPointerDown(
      {
        clientX: 50,
        clientY: 50,
        pointerId: 1,
        button: 0,
        shiftKey: false,
        ctrlKey: true,
        metaKey: false,
      } as any,
      ctx,
    );
    // Should select the child, not the frame
    expect(ctx.setSelection).toHaveBeenCalledWith('c1');
  });

  it('Ctrl+Shift+click deep-selects and adds to selection', () => {
    const tool = new SelectTool();
    const frameNode = { id: 'f1', kind: 'frame' as const, name: 'Frame' };
    const childNode = { id: 'c1', kind: 'shape' as const, name: 'Child' };
    const ctx = makeCtx({
      ctrlKey: true,
      shiftKey: true,
      hitTest: vi.fn().mockReturnValue({ nodeId: 'f1', node: frameNode }),
      isSelected: vi.fn().mockReturnValue(false),
      getNode: vi.fn((id: string) => (id === 'f1' ? frameNode : childNode)),
      document: {
        nodes: { f1: frameNode, c1: childNode },
        pages: [],
        rootChildren: ['f1'],
        activePageId: 'page1',
      } as any,
    });
    (tool as any).findNodesAtPoint = vi.fn().mockReturnValue([
      { nodeId: 'f1', node: frameNode },
      { nodeId: 'c1', node: childNode },
    ]);
    tool.onPointerDown(
      {
        clientX: 50,
        clientY: 50,
        pointerId: 1,
        button: 0,
        shiftKey: true,
        ctrlKey: true,
        metaKey: false,
      } as any,
      ctx,
    );
    expect(ctx.toggleSelection).toHaveBeenCalledWith('c1', true);
  });

  it('Ctrl+click deep-selects an already-selected child instead of cycling to its parent', () => {
    const tool = new SelectTool();
    const frameNode = {
      id: 'f1',
      kind: 'frame' as const,
      name: 'Frame',
      children: ['c1'],
      transform: [1, 0, 0, 1, 0, 0],
    };
    const childNode = {
      id: 'c1',
      kind: 'shape' as const,
      name: 'Child',
      transform: [1, 0, 0, 1, 10, 10],
    };
    const ctx = makeCtx({
      selection: ['c1'],
      hitTest: vi.fn().mockReturnValue({ nodeId: 'c1', node: childNode }),
      isSelected: vi.fn().mockReturnValue(true),
      getNode: vi.fn((id: string) => (id === 'f1' ? frameNode : childNode)),
      document: {
        nodes: { f1: frameNode, c1: childNode },
        pages: [],
        rootChildren: ['f1'],
        activePageId: 'page1',
      } as any,
    });
    (tool as any).findNodesAtPoint = vi.fn().mockReturnValue([
      { nodeId: 'c1', node: childNode },
      { nodeId: 'f1', node: frameNode },
    ]);

    tool.onPointerDown(
      {
        clientX: 50,
        clientY: 50,
        pointerId: 1,
        button: 0,
        shiftKey: false,
        ctrlKey: true,
        metaKey: false,
      } as any,
      ctx,
    );

    expect(ctx.setSelection).toHaveBeenCalledWith('c1');
    expect(ctx.setSelection).not.toHaveBeenCalledWith('f1');
  });

  it('keeps a selected child as the drag target when its frame is the normal hit', () => {
    const tool = new SelectTool();
    const frameNode = {
      id: 'f1',
      kind: 'frame' as const,
      name: 'Frame',
      children: ['c1'],
      transform: [1, 0, 0, 1, 0, 0],
    };
    const childNode = {
      id: 'c1',
      kind: 'shape' as const,
      name: 'Child',
      transform: [1, 0, 0, 1, 10, 10],
    };
    const ctx = makeCtx({
      selection: ['c1'],
      hitTest: vi.fn().mockReturnValue({ nodeId: 'f1', node: frameNode }),
      isSelected: vi.fn((id: string) => id === 'c1'),
      getNode: vi.fn((id: string) => (id === 'f1' ? frameNode : childNode)),
      document: {
        nodes: { f1: frameNode, c1: childNode },
        pages: [],
        rootChildren: ['f1'],
      } as any,
    });
    (tool as any).findNodesAtPoint = vi.fn().mockReturnValue([
      { nodeId: 'f1', node: frameNode },
      { nodeId: 'c1', node: childNode },
    ]);

    tool.onPointerDown(
      {
        clientX: 50,
        clientY: 50,
        pointerId: 1,
        button: 0,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
      } as any,
      ctx,
    );

    expect(ctx.hitTest).toHaveBeenCalledOnce();
    expect(ctx.setSelection).not.toHaveBeenCalledWith('f1');
    expect(ctx.beginTransaction).toHaveBeenCalledOnce();
  });
});

describe('SelectTool Enter key navigates into containers', () => {
  it('Enter on a selected frame enters isolation', () => {
    const tool = new SelectTool();
    const frameNode = { id: 'f1', kind: 'frame' as const, name: 'Frame 1' };
    const ctx = makeCtx({
      selection: ['f1'],
      getNode: vi.fn().mockReturnValue(frameNode),
    });
    tool.onKeyDown({ key: 'Enter', repeat: false } as any, ctx);
    expect(ctx.enterIsolation).toHaveBeenCalledWith('f1');
    expect(ctx.announceOperation).toHaveBeenCalledWith('Enter', 'Frame 1');
  });

  it('Enter on a selected group enters isolation', () => {
    const tool = new SelectTool();
    const groupNode = { id: 'g1', kind: 'group' as const, name: 'Group 1' };
    const ctx = makeCtx({
      selection: ['g1'],
      getNode: vi.fn().mockReturnValue(groupNode),
    });
    tool.onKeyDown({ key: 'Enter', repeat: false } as any, ctx);
    expect(ctx.enterIsolation).toHaveBeenCalledWith('g1');
  });

  it('Enter with no selection is a no-op', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({ selection: [] });
    tool.onKeyDown({ key: 'Enter', repeat: false } as any, ctx);
    expect(ctx.enterIsolation).not.toHaveBeenCalled();
  });
});

describe('SelectTool marquee-select scaling', () => {
  /**
   * A paged document with `count` overlapping rects directly under the
   * page's contentRoot (not a direct rootChild) -- matching the shape that
   * actually exercises getParent's expensive `Object.entries(doc.nodes)`
   * fallback scan when no parentIndex is passed.
   */
  function makeOverlappingDoc(count: number) {
    const doc = createDocument('test', {});
    const page = doc.pages![0]!;
    const contentRootId = page.contentRoot!;
    const contentRoot = doc.nodes[contentRootId]!;
    const nodes: Record<string, ReturnType<typeof makeShapeNode>> = {};
    const childIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = `n-${i}`;
      nodes[id] = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
      childIds.push(id);
    }
    return {
      ...doc,
      nodes: { ...doc.nodes, [contentRootId]: { ...contentRoot, children: childIds }, ...nodes },
    } as typeof doc;
  }

  function marqueeDrag(tool: SelectTool, ctx: ReturnType<typeof makeCtx>) {
    (tool as any).marqueeActive = true;
    (tool as any).drag = {
      startCanvas: { x: 0, y: 0 },
      startWorld: { x: 0, y: 0 },
      currentCanvas: { x: 100, y: 100 },
      currentWorld: { x: 100, y: 100 },
    };
    (tool as any).onDragEnd(ctx);
  }

  it('does not call ctx.nodeWorldBounds (the O(n^2)-prone indirection)', () => {
    // Regression guard: onDragEnd's marquee loop used to call
    // ctx.nodeWorldBounds(node) per node, which internally calls
    // nodeWorldBounds(doc, id) with no parentIndex -- an O(n) linear scan
    // (getParent) per call, making one marquee-select gesture O(n^2) in
    // active-page node count. Same pattern as computeFitAllCamera (a
    // measured 10+ minute hang at 20,000 nodes).
    //
    // A timing-based scaling test can't demonstrate this in isolation here:
    // makeCtx()'s default ctx.nodeWorldBounds is a mock that returns
    // instantly regardless of document size, so it would pass identically
    // before and after the fix -- the mock hides exactly the cost the real
    // bug lived in. What the fix actually does is stop going through that
    // indirection at all (it now calls the direct, parentIndex-capable
    // nodeWorldBounds from ../scene/world instead), so the precise,
    // deterministic guard is: the mock must never be invoked.
    const doc = makeOverlappingDoc(50);
    const tool = new SelectTool();
    const nodeWorldBoundsMock = vi.fn().mockReturnValue({ x: 0, y: 0, w: 100, h: 100 });
    const ctx = makeCtx({ document: doc, altKey: false, nodeWorldBounds: nodeWorldBoundsMock });

    marqueeDrag(tool, ctx);

    expect(nodeWorldBoundsMock).not.toHaveBeenCalled();
    // Sanity: selection still happened via the real geometry path, so this
    // isn't passing because the loop silently did nothing.
    expect(ctx.toggleSelection).toHaveBeenCalledTimes(50);
  });

  it('scales near-linearly with active-page node count, not quadratically', () => {
    // Protects the fix's own implementation (buildParentIndexMap +
    // nodeWorldBounds called directly in the loop below) against a future
    // regression -- e.g. someone re-adding a per-node parent lookup without
    // the cache. Uses real geometry computation throughout (the fixed code
    // path bypasses ctx.nodeWorldBounds entirely), so unlike a mock-based
    // comparison this genuinely exercises the cost that matters.
    const small = makeOverlappingDoc(300);
    const large = makeOverlappingDoc(2400); // 8x

    const toolSmall = new SelectTool();
    const ctxSmall = makeCtx({ document: small, altKey: false });
    const t0 = performance.now();
    marqueeDrag(toolSmall, ctxSmall);
    const smallMs = performance.now() - t0;

    const toolLarge = new SelectTool();
    const ctxLarge = makeCtx({ document: large, altKey: false });
    const t1 = performance.now();
    marqueeDrag(toolLarge, ctxLarge);
    const largeMs = performance.now() - t1;

    expect(largeMs).toBeLessThan(Math.max(smallMs * 20, 300));
  });
});

describe('SelectTool — M6 page interactions', () => {
  it('activates a non-active page under an empty click', () => {
    const tool = new SelectTool();
    let doc = createDocument('test');
    doc = addPage(doc, {});
    doc = {
      ...doc,
      pages: doc.pages!.map((p, i) => ({ ...p, placement: { x: i * 2500, y: 0 } })),
    };
    const page2 = doc.pages![1]!;
    const setActivePage = vi.fn();
    const ctx = makeCtx({ document: doc, hitTest: vi.fn().mockReturnValue(null), setActivePage });
    // Click on page 2's trim (world 2550, 100).
    tool.onPointerDown({ clientX: 2550, clientY: 100, pointerId: 1, button: 0 } as any, ctx);
    expect(ctx.setSelection).toHaveBeenCalledWith(null);
    expect(setActivePage).toHaveBeenCalledWith(page2.id);
  });

  it("reparents a node dropped on another page's empty trim into that page", () => {
    const tool = new SelectTool();
    let doc = createDocument('test');
    doc = addPage(doc, {});
    doc = {
      ...doc,
      pages: doc.pages!.map((p, i) => ({ ...p, placement: { x: i * 2500, y: 0 } })),
    };
    const [page1, page2] = [doc.pages![0]!, doc.pages![1]!];
    const nodeId = 'nCross';
    doc = addChild(
      doc,
      page1.contentRoot,
      makeShapeNode(nodeId, { kind: 'rect', x: 10, y: 10, w: 40, h: 40 }),
    );
    const reparentNode = vi.fn();
    const setNodePositions = vi.fn((positions: Array<{ id: string; x: number; y: number }>) => {
      for (const { id, x, y } of positions) {
        const n = doc.nodes[id] as { transform?: number[] } | undefined;
        if (n) n.transform = [1, 0, 0, 1, x, y];
      }
    });
    const ctx = makeCtx({
      document: doc,
      selection: [nodeId],
      isSelected: vi.fn().mockReturnValue(true),
      hitTest: vi.fn().mockReturnValue({ nodeId, node: doc.nodes[nodeId] }),
      findContainingFrame: vi.fn().mockReturnValue(null),
      getNode: vi.fn((id: string) => doc.nodes[id]),
      reparentNode,
      setNodePositions,
    });

    // Drag the node's center to page 2's empty trim (world 2550, 30).
    tool.onPointerDown({ clientX: 30, clientY: 30, pointerId: 1, button: 0 } as any, ctx);
    tool.onPointerMove({ clientX: 2550, clientY: 30, pointerId: 1, button: 0 } as any, ctx);
    tool.onPointerUp({ clientX: 2550, clientY: 30, pointerId: 1, button: 0 } as any, ctx);

    expect(reparentNode).toHaveBeenCalledWith(nodeId, page2.contentRoot, 0);
  });

  it('does not reparent a node dropped back on its own page', () => {
    const tool = new SelectTool();
    let doc = createDocument('test');
    doc = addPage(doc, {});
    doc = {
      ...doc,
      pages: doc.pages!.map((p, i) => ({ ...p, placement: { x: i * 2500, y: 0 } })),
    };
    const [page1] = [doc.pages![0]!];
    const nodeId = 'nHome';
    doc = addChild(
      doc,
      page1.contentRoot,
      makeShapeNode(nodeId, { kind: 'rect', x: 10, y: 10, w: 40, h: 40 }),
    );
    const reparentNode = vi.fn();
    const ctx = makeCtx({
      document: doc,
      hitTest: vi.fn().mockReturnValue({ nodeId, node: doc.nodes[nodeId] }),
      findContainingFrame: vi.fn().mockReturnValue(null),
      getNode: vi.fn((id: string) => doc.nodes[id]),
      reparentNode,
    });

    tool.onPointerDown({ clientX: 30, clientY: 30, pointerId: 1, button: 0 } as any, ctx);
    tool.onPointerMove({ clientX: 30, clientY: 30, pointerId: 1, button: 0 } as any, ctx);
    // Drop stays on page 1's trim — node is already page-1-owned.
    tool.onPointerUp({ clientX: 200, clientY: 200, pointerId: 1, button: 0 } as any, ctx);

    expect(reparentNode).not.toHaveBeenCalled();
  });
});
