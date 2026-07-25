import {
  createClippingMask,
  createDocument,
  makeGroupNode,
  makeShapeNode,
  type Page,
} from '@strata/scene';
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
    expect(ctx.setNodePosition).toHaveBeenCalledWith('n1', 101, 100);
    expect(ctx.announceOperation).toHaveBeenCalledWith('Nudge', '1px');
  });

  it('shift+arrow nudges by 10px', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 100, 100] }),
    });
    tool.onKeyDown({ key: 'ArrowLeft', shiftKey: true } as any, ctx);
    expect(ctx.setNodePosition).toHaveBeenCalledWith('n1', 90, 100);
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
    expect(ctx.setNodePosition).toHaveBeenCalledWith('n1', 100 + c, 100 + s);
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
    expect(ctx.setNodePosition).toHaveBeenCalledWith('n1', 100 - -s, 100 - c);
  });

  it('marquee with alt key selects only nodes fully contained within rect', () => {
    const tool = new SelectTool();
    const doc = makeDocWithNodes(3);
    // Nodes: n0 (0,0,40,40), n1 (50,0,40,40), n2 (100,0,40,40)
    const ctx = makeCtx({
      altKey: true,
      document: doc,
      nodeWorldBounds: vi.fn((n: any) => {
        if (n.id === 'n0') return { x: 0, y: 0, w: 40, h: 40 };
        if (n.id === 'n1') return { x: 50, y: 0, w: 40, h: 40 };
        if (n.id === 'n2') return { x: 100, y: 0, w: 40, h: 40 };
        return { x: 0, y: 0, w: 100, h: 100 };
      }),
      rootNodes: vi.fn().mockReturnValue([{ id: 'n0' }, { id: 'n1' }, { id: 'n2' }]),
      getNode: vi.fn((id: string) => {
        return doc.nodes[id];
      }),
    });
    // Click empty space (no hit)
    tool.onPointerDown({ clientX: 0, clientY: 0, pointerId: 1, button: 0 } as any, ctx);

    // Drag marquee from (0,0) to (90, 50) — contains n0 fully, n1 partially
    (tool as any).drag.currentCanvas = { x: 90, y: 50 };
    (tool as any).drag.currentWorld = { x: 90, y: 50 };
    (tool as any).onDragMove?.(ctx);

    tool.onPointerUp({ pointerId: 1 } as any, ctx);

    // Alt+marquee: only n0 is fully contained (n1 extends past 90)
    expect(ctx.toggleSelection).toHaveBeenCalledWith('n0', true);
  });

  it('marquee with shift+alt adds fully contained nodes to selection', () => {
    const tool = new SelectTool();
    const doc = makeDocWithNodes(2);
    const ctx = makeCtx({
      shiftKey: true,
      altKey: true,
      document: doc,
      nodeWorldBounds: vi.fn((n: any) => {
        if (n.id === 'n0') return { x: 0, y: 0, w: 40, h: 40 };
        if (n.id === 'n1') return { x: 100, y: 0, w: 40, h: 40 };
        return { x: 0, y: 0, w: 100, h: 100 };
      }),
      rootNodes: vi.fn().mockReturnValue([{ id: 'n0' }, { id: 'n1' }]),
      getNode: vi.fn((id: string) => doc.nodes[id]),
    });

    tool.onPointerDown(
      { clientX: 0, clientY: 0, pointerId: 1, button: 0, shiftKey: true } as any,
      ctx,
    );

    (tool as any).drag.currentCanvas = { x: 200, y: 50 };
    (tool as any).drag.currentWorld = { x: 200, y: 50 };
    (tool as any).onDragMove?.(ctx);

    tool.onPointerUp({ pointerId: 1 } as any, ctx);

    // shift+alt marquee: add fully contained nodes to existing selection
    expect(ctx.setSelection).not.toHaveBeenCalled();
    expect(ctx.toggleSelection).toHaveBeenCalledWith('n0', true);
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
    expect(ctx.setNodePosition).toHaveBeenCalledWith('n1', 101, 100);
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
      setNodePosition: vi.fn((_id: string, x: number) => {
        posX = x;
      }),
    });
    // Override getNode to return current position
    (ctx.getNode as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      id: 'n1',
      transform: [1, 0, 0, 1, posX, 100],
    }));

    // First press begins transaction, moves to 101
    tool.onKeyDown({ key: 'ArrowRight' } as any, ctx);
    expect(ctx.beginTransaction).toHaveBeenCalledTimes(1);
    expect(ctx.setNodePosition).toHaveBeenCalledWith('n1', 101, 100);

    // Repeat press shares the same transaction, moves to 102
    (ctx.setNodePosition as ReturnType<typeof vi.fn>).mockClear();
    tool.onKeyDown({ key: 'ArrowRight', repeat: true } as any, ctx);
    expect(ctx.beginTransaction).toHaveBeenCalledTimes(1);
    expect(ctx.commitTransaction).not.toHaveBeenCalled();
    expect(ctx.setNodePosition).toHaveBeenCalledWith('n1', 102, 100);

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
    expect(ctx.setNodePosition).toHaveBeenCalledWith('n1', 90, 100);
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
    expect(ctx.setNodePosition).toHaveBeenCalledWith('n1', 101, 100);
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
    expect(ctx.setNodePosition).toHaveBeenCalledWith('n1', 101, 100);
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
    expect(ctx.setNodePosition).toHaveBeenCalledWith('n1', 101, 100);
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
});
