// @vitest-environment jsdom

import {
  createEmptyTile,
  makeRasterLayerNode,
  makeTileKey,
  type RasterLayerNode,
  TILE_SIZE,
} from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { PatchTool } from '../PatchTool';
import type { ToolContext } from '../types';

function makeSplitLayer(): RasterLayerNode {
  const node = makeRasterLayerNode('raster-1', { width: TILE_SIZE, height: TILE_SIZE });
  const tile = createEmptyTile();
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const index = (y * TILE_SIZE + x) * 4;
      const left = x < TILE_SIZE / 2;
      tile.pixels[index] = left ? 220 : 20;
      tile.pixels[index + 1] = left ? 40 : 60;
      tile.pixels[index + 2] = left ? 20 : 220;
      tile.pixels[index + 3] = 255;
    }
  }
  node.tiles.set(makeTileKey(0, 0), tile);
  return node;
}

function makeContext(node: RasterLayerNode) {
  let current = node;
  const context = {
    document: { nodes: { [node.id]: current }, rootChildren: [node.id] },
    selection: [node.id],
    shiftKey: false,
    altKey: false,
    canvasToWorld: (x: number, y: number) => ({ x, y }),
    getNode: (id: string) => (id === node.id ? current : undefined),
    updateNode: vi.fn((id: string, update: (value: RasterLayerNode) => RasterLayerNode) => {
      if (id !== node.id) return;
      current = update(current);
      context.document.nodes[node.id] = current;
    }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    abortTransaction: vi.fn(),
    setDraft: vi.fn(),
    announce: vi.fn(),
  } as unknown as ToolContext & {
    updateNode: ReturnType<typeof vi.fn>;
    document: { nodes: Record<string, RasterLayerNode> };
  };
  return { context, current: () => current };
}

function pointer(pointerId: number, clientX: number, clientY: number): PointerEvent {
  return {
    pointerId,
    clientX,
    clientY,
    pointerType: 'mouse',
    button: 0,
  } as PointerEvent;
}

describe('PatchTool', () => {
  it('selects a source in raster-local coordinates and persists the target patch', () => {
    const { context, current } = makeContext(makeSplitLayer());
    const tool = new PatchTool();
    tool.onActivate(context);

    tool.onPointerDown(pointer(1, 12, 20), context);
    tool.onPointerMove(pointer(1, 32, 40), context);
    tool.onPointerUp(pointer(1, 32, 40), context);

    const before = current().tiles.get(makeTileKey(0, 0))!.pixels.slice();
    const result = tool.onPointerDown(pointer(2, 94, 80), context);

    expect(result.consumed).toBe(true);
    expect(context.updateNode).toHaveBeenCalledOnce();
    expect(context.commitTransaction).toHaveBeenCalledOnce();
    expect(context.announce).toHaveBeenCalledWith('Patch applied to the raster layer');
    expect(Array.from(current().tiles.get(makeTileKey(0, 0))!.pixels)).not.toEqual(
      Array.from(before),
    );
    const targetIndex = (80 * TILE_SIZE + 94) * 4;
    const targetPixels = current().tiles.get(makeTileKey(0, 0))!.pixels;
    expect(targetPixels[targetIndex]).toBeGreaterThan(targetPixels[targetIndex + 2]!);
  });

  it('cancels a source selection without writing pixels', () => {
    const { context, current } = makeContext(makeSplitLayer());
    const tool = new PatchTool();
    tool.onActivate(context);
    const before = current().tiles.get(makeTileKey(0, 0))!.pixels.slice();

    tool.onPointerDown(pointer(1, 12, 20), context);
    tool.onPointerMove(pointer(1, 32, 40), context);
    expect(tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }), context)).toBe(true);

    expect(context.abortTransaction).toHaveBeenCalledOnce();
    expect(Array.from(current().tiles.get(makeTileKey(0, 0))!.pixels)).toEqual(Array.from(before));
  });

  it('reports unsupported selection when no editable raster exists', () => {
    const context = {
      document: { nodes: {}, rootChildren: [] },
      selection: [],
      canvasToWorld: (x: number, y: number) => ({ x, y }),
      getNode: () => undefined,
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
      updateNode: vi.fn(),
      announce: vi.fn(),
    } as unknown as ToolContext;
    const tool = new PatchTool();

    expect(tool.onPointerDown(pointer(1, 10, 10), context).consumed).toBe(false);
    expect(context.beginTransaction).not.toHaveBeenCalled();
    expect(context.announce).toHaveBeenCalledWith(
      'Patch needs an editable raster layer with source pixels',
    );
  });
});
