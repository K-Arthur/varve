import { describe, expect, it, vi } from 'vitest';
import { createDocument, addNode, makeShapeNode, makeFrameNode } from '@strata/scene';
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
    snapEnabled: false,
    snapGrid: 8,
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
    snapPosition: vi.fn((b) => ({ x: b.x, y: b.y, guides: [] })),
    ...overrides,
  };
  return ctx;
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
    tool.onPointerDown({ clientX: 50, clientY: 50, pointerId: 1, button: 0, shiftKey: true } as any, ctx);
    expect(ctx.toggleSelection).toHaveBeenCalledWith('n2', true);
  });

  it('escape deselects all', () => {
    const tool = new SelectTool();
    const ctx = makeCtx();
    tool.onKeyDown({ key: 'Escape' } as any, ctx);
    expect(ctx.setSelection).toHaveBeenCalledWith(null);
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
    expect(ctx.announceOperation).toHaveBeenCalledWith('Enter', 'Frame 1');
  });

  it('onDeactivate aborts active drag transaction', () => {
    const tool = new SelectTool();
    const ctx = makeCtx({
      hitTest: vi.fn().mockReturnValue({ nodeId: 'n1', node: { id: 'n1' } }),
      selection: ['n1'],
      getNode: vi.fn().mockReturnValue({ id: 'n1', transform: [1, 0, 0, 1, 100, 100] }),
    });
    // Start a move gesture
    tool.onPointerDown({ clientX: 50, clientY: 50, pointerId: 1, button: 0 } as any, ctx);
    expect(ctx.beginTransaction).toHaveBeenCalled();
    // Deactivate mid-drag
    tool.onDeactivate(ctx);
    expect(ctx.abortTransaction).toHaveBeenCalled();
  });
});
