// @vitest-environment jsdom

import { createEmptyTile, makeRasterLayerNode, makeTileKey, TILE_SIZE } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { DodgeBurnTool } from '../DodgeBurnTool';
import type { ToolContext } from '../types';

function makeGreyLayer(): ReturnType<typeof makeRasterLayerNode> {
  const node = makeRasterLayerNode('raster-1', { width: TILE_SIZE, height: TILE_SIZE });
  const tile = createEmptyTile();
  for (let i = 0; i < tile.pixels.length; i += 4) {
    tile.pixels[i] = 128;
    tile.pixels[i + 1] = 128;
    tile.pixels[i + 2] = 128;
    tile.pixels[i + 3] = 255;
  }
  node.tiles.set(makeTileKey(0, 0), tile);
  return node;
}

function makeCtx(node: ReturnType<typeof makeRasterLayerNode>) {
  const state = { node };
  const ctx = {
    document: { nodes: { 'raster-1': state.node }, rootChildren: ['raster-1'] },
    selection: ['raster-1'],
    areaSelection: null,
    zoom: 1,
    pan: { x: 0, y: 0 },
    pointerType: 'mouse' as const,
    sourceEvents: [],
    foregroundColor: [0, 0, 0, 255] as [number, number, number, number],
    canvasToWorld: (cx: number, cy: number) => ({ x: cx, y: cy }),
    worldToCanvas: (wx: number, wy: number) => ({ x: wx, y: wy }),
    rootNodes: () => Object.values(ctx.document.nodes) as never,
    getNode: (id: string) => (id === 'raster-1' ? state.node : undefined),
    updateNode: vi.fn(
      (
        id: string,
        updater: (
          n: ReturnType<typeof makeRasterLayerNode>,
        ) => ReturnType<typeof makeRasterLayerNode>,
      ) => {
        if (id !== 'raster-1') return;
        state.node = updater(state.node);
        (ctx.document as { nodes: Record<string, unknown> }).nodes['raster-1'] = state.node;
      },
    ),
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    abortTransaction: vi.fn(),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    setDraft: vi.fn(),
    announce: vi.fn(),
    getWorldTransform: undefined,
  } as unknown as ToolContext & { updateNode: ReturnType<typeof vi.fn> };
  return { ctx, current: () => state.node };
}

function ptr(x: number, y: number, overrides: Partial<PointerEvent> = {}): PointerEvent {
  return {
    pointerId: 1,
    clientX: x,
    clientY: y,
    pressure: 0.5,
    button: 0,
    altKey: false,
    pointerType: 'mouse',
    timeStamp: x,
    getCoalescedEvents: () => [],
    ...overrides,
  } as unknown as PointerEvent;
}

function pixelAt(node: ReturnType<typeof makeRasterLayerNode>, x: number, y: number) {
  const tile = node.tiles.get(makeTileKey(0, 0))!;
  const i = (y * TILE_SIZE + x) * 4;
  return {
    r: tile.pixels[i]!,
    g: tile.pixels[i + 1]!,
    b: tile.pixels[i + 2]!,
    a: tile.pixels[i + 3]!,
  };
}

describe('DodgeBurnTool', () => {
  it('brightens pixels inside a canonical raster tile and commits', () => {
    const { ctx, current } = makeCtx(makeGreyLayer());
    const tool = new DodgeBurnTool();
    tool.setOptions({ brushSize: 20, hardness: 1, exposure: 1 });

    tool.onPointerDown(ptr(64, 64), ctx);
    tool.onPointerUp(ptr(64, 64), ctx);

    const center = pixelAt(current(), 64, 64);
    expect(center.r).toBeGreaterThan(128);
    expect(center.a).toBe(255);
    expect(ctx.commitTransaction).toHaveBeenCalledOnce();
  });

  it('burn darkens and dodge brightens through the same tile path', () => {
    const burned = makeCtx(makeGreyLayer());
    const burnTool = new DodgeBurnTool();
    burnTool.setOptions({ brushSize: 20, hardness: 1, mode: 'burn', exposure: 2 });
    burnTool.onPointerDown(ptr(64, 64), burned.ctx);
    burnTool.onPointerUp(ptr(64, 64), burned.ctx);
    expect(pixelAt(burned.current(), 64, 64).r).toBeLessThan(128);

    const dodged = makeCtx(makeGreyLayer());
    const dodgeTool = new DodgeBurnTool();
    dodgeTool.setOptions({ brushSize: 20, hardness: 1, mode: 'dodge', exposure: 2 });
    dodgeTool.onPointerDown(ptr(64, 64), dodged.ctx);
    dodgeTool.onPointerUp(ptr(64, 64), dodged.ctx);
    expect(pixelAt(dodged.current(), 64, 64).r).toBeGreaterThan(128);
  });

  it('aborts without a history step when the layer has no pixels to adjust', () => {
    const empty = makeRasterLayerNode('raster-1', { width: TILE_SIZE, height: TILE_SIZE });
    const { ctx } = makeCtx(empty);
    const tool = new DodgeBurnTool();
    tool.setOptions({ brushSize: 40, hardness: 1 });

    tool.onPointerDown(ptr(64, 64), ctx);
    tool.onPointerUp(ptr(64, 64), ctx);

    expect(ctx.commitTransaction).not.toHaveBeenCalled();
    expect(ctx.abortTransaction).toHaveBeenCalledOnce();
  });

  it('cancel discards the stroke transaction', () => {
    const { ctx } = makeCtx(makeGreyLayer());
    const tool = new DodgeBurnTool();
    tool.onPointerDown(ptr(64, 64), ctx);
    tool.onDragCancel(ctx);
    expect(ctx.abortTransaction).toHaveBeenCalledOnce();
    expect(ctx.commitTransaction).not.toHaveBeenCalled();
  });

  it('refuses a selected non-raster object instead of guessing a target', () => {
    const { ctx } = makeCtx(makeGreyLayer());
    (ctx.document.nodes as Record<string, unknown>)['frame-1'] = {
      id: 'frame-1',
      kind: 'frame',
      name: 'Photo frame',
      children: [],
      visible: true,
      locked: false,
    };
    ctx.selection = ['frame-1'];

    const tool = new DodgeBurnTool();
    const result = tool.onPointerDown(ptr(40, 40), ctx);
    expect(result.consumed).toBe(false);
    expect(ctx.announce).toHaveBeenCalledWith(expect.stringContaining('not a pixel layer'));
    expect(ctx.updateNode).not.toHaveBeenCalled();
  });
});
