// @vitest-environment jsdom

import { makeWarpPreset } from '@varve/engine';
import type { ShapeNode } from '@varve/scene';
import { addNode, createDocument } from '@varve/scene';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../types';
import { WarpTool } from '../WarpTool';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  const doc = createDocument('warp-test');
  const node: ShapeNode = {
    id: 'n1',
    name: 'Rect',
    kind: 'shape',
    shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    strokes: [],
    effects: [],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: '1',
  };
  const withNode = addNode(doc, node);
  const updateNode = vi.fn((id: string, updater: (n: ShapeNode) => ShapeNode) => {
    const n = (withNode.nodes as Record<string, ShapeNode>)[id];
    if (n) (withNode.nodes as Record<string, ShapeNode>)[id] = updater(n);
  }) as unknown as (
    id: string,
    updater: (n: import('@varve/scene').SceneNode) => import('@varve/scene').SceneNode,
  ) => void;
  return {
    document: withNode,
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
    touchMultiSelect: { active: false, suspended: false },
    createRasterLayer: vi.fn(() => null),
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
    updateNode,
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
    setDropTargetFrame: vi.fn(),
    rootNodes: () => [],
    getNode: (id) => withNode.nodes[id as keyof typeof withNode.nodes] as never,
    canvasToWorld: (x, y) => ({ x, y }),
    worldToCanvas: (x, y) => ({ x, y }),
    canvasDeltaToWorld: (dx, dy) => ({ dx, dy }),
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
    setWarpEdit: vi.fn(),
    applyWarpToSelection: vi.fn(() => true),
    snapPosition: vi.fn((b) => ({ x: b.x, y: b.y, guides: [] })),
    ...overrides,
  };
}

describe('WarpTool', () => {
  let ctx: ToolContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('adds a default envelope modifier to a warp-less compatible selection', () => {
    ctx.selection = ['n1'];
    const tool = new WarpTool();
    tool.onActivate(ctx);
    const node = ctx.document.nodes.n1 as ShapeNode;
    expect(node.warps).toHaveLength(1);
    expect(node.warps![0]!.kind).toBe('envelope');
    expect(ctx.setWarpEdit).toHaveBeenCalledWith({ nodeId: 'n1', modifierId: node.warps![0]!.id });
    expect(ctx.beginTransaction).toHaveBeenCalled();
    expect(ctx.commitTransaction).toHaveBeenCalled();
  });

  it('targets the existing modifier when the selection already has warps', () => {
    const modifier = makeWarpPreset('arch');
    (ctx.document.nodes.n1 as ShapeNode).warps = [modifier];
    ctx.selection = ['n1'];
    const tool = new WarpTool();
    tool.onActivate(ctx);
    expect(ctx.updateNode).not.toHaveBeenCalled();
    expect(ctx.setWarpEdit).toHaveBeenCalledWith({ nodeId: 'n1', modifierId: modifier.id });
  });

  it('groups multi-selection into one shared warp via applyWarpToSelection', () => {
    ctx.selection = ['n1'];
    const tool = new WarpTool();
    tool.onActivate(ctx);
    // single-node path is covered above; multi-select delegates
    ctx.selection = ['n1', 'n2'];
    ctx.document.nodes.n2 = { ...(ctx.document.nodes.n1 as ShapeNode), id: 'n2' } as ShapeNode;
    tool.onActivate(ctx);
    expect(ctx.applyWarpToSelection).toHaveBeenCalledWith('four-edge');
  });

  it('announces the unsupported reason for non-eligible nodes', () => {
    const raster = {
      ...(ctx.document.nodes.n1 as ShapeNode),
      id: 'r1',
      kind: 'rasterLayer',
      width: 10,
      height: 10,
      tiles: new Map(),
    };
    ctx.document.nodes.r1 = raster as unknown as ShapeNode;
    ctx.selection = ['r1'];
    const tool = new WarpTool();
    tool.onActivate(ctx);
    expect(ctx.announce).toHaveBeenCalledWith(expect.stringContaining('Warp unavailable'));
    expect(ctx.updateNode).not.toHaveBeenCalled();
  });

  it('Escape exits warp edit and returns to select', () => {
    const tool = new WarpTool();
    const consumed = tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }), ctx);
    expect(consumed).toBe(true);
    expect(ctx.setWarpEdit).toHaveBeenCalledWith(null);
    expect(ctx.setTool).toHaveBeenCalledWith('select');
  });

  it('clears the edit surface and aborts an active transaction on deactivate', () => {
    const tool = new WarpTool();
    tool.onDeactivate?.(ctx);

    expect(ctx.abortTransaction).toHaveBeenCalledTimes(1);
    expect(ctx.setWarpEdit).toHaveBeenCalledWith(null);
  });

  it('does nothing without a selection', () => {
    const tool = new WarpTool();
    tool.onActivate(ctx);
    expect(ctx.updateNode).not.toHaveBeenCalled();
  });
});
