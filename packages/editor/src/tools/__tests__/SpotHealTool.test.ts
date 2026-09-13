// @vitest-environment jsdom

import {
  createEmptyTile,
  makeRasterLayerNode,
  makeTileKey,
  type RasterLayerNode,
  TILE_SIZE,
} from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { SpotHealTool } from '../SpotHealTool';
import type { ToolContext } from '../types';

function makeBlemishLayer(): RasterLayerNode {
  const node = makeRasterLayerNode('raster-1', { width: TILE_SIZE, height: TILE_SIZE });
  const tile = createEmptyTile();
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const index = (y * TILE_SIZE + x) * 4;
      const blemish = x >= 76 && x <= 84 && y >= 56 && y <= 64;
      tile.pixels[index] = blemish ? 255 : 40;
      tile.pixels[index + 1] = blemish ? 0 : 80;
      tile.pixels[index + 2] = blemish ? 0 : 120;
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
    canvasToWorld: (x: number, y: number) => ({ x, y }),
    getNode: (id: string) => (id === node.id ? current : undefined),
    updateNode: vi.fn((id: string, update: (value: RasterLayerNode) => RasterLayerNode) => {
      if (id !== node.id) return;
      current = update(current);
      context.document.nodes[node.id] = current;
    }),
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    abortTransaction: vi.fn(),
    announce: vi.fn(),
  } as unknown as ToolContext & {
    updateNode: ReturnType<typeof vi.fn>;
    document: { nodes: Record<string, RasterLayerNode> };
  };
  return { context, current: () => current };
}

function pointer(clientX: number, clientY: number): PointerEvent {
  return {
    pointerId: 1,
    clientX,
    clientY,
    pointerType: 'mouse',
    button: 0,
  } as PointerEvent;
}

describe('SpotHealTool', () => {
  it('writes a bounded nearby repair into the raster document', () => {
    const { context, current } = makeContext(makeBlemishLayer());
    const tool = new SpotHealTool();
    tool.setOptions({ brushSize: 12, type: 'proximity-match' });

    const before = current().tiles.get(makeTileKey(0, 0))!.pixels.slice();
    const result = tool.onPointerDown(pointer(80, 60), context);

    expect(result.consumed).toBe(true);
    expect(context.updateNode).toHaveBeenCalledOnce();
    expect(context.commitTransaction).toHaveBeenCalledOnce();
    expect(Array.from(current().tiles.get(makeTileKey(0, 0))!.pixels)).not.toEqual(
      Array.from(before),
    );
    expect(context.announce).toHaveBeenCalledWith('Spot healed from a nearby source patch');
  });

  it('does not create history for an empty source', () => {
    const empty = makeRasterLayerNode('raster-1', { width: TILE_SIZE, height: TILE_SIZE });
    const { context } = makeContext(empty);
    const tool = new SpotHealTool();

    expect(tool.onPointerDown(pointer(10, 10), context).consumed).toBe(true);
    expect(context.commitTransaction).not.toHaveBeenCalled();
    expect(context.abortTransaction).toHaveBeenCalledOnce();
    expect(context.announce).toHaveBeenCalledWith('Spot Heal found no valid nearby source patch');
  });

  it('reports that a raster target is required instead of touching the canvas', () => {
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
    const tool = new SpotHealTool();

    expect(tool.onPointerDown(pointer(19, 19), context).consumed).toBe(false);
    expect(context.beginTransaction).not.toHaveBeenCalled();
    expect(context.announce).toHaveBeenCalledWith(
      'Spot Heal needs an editable raster layer with source pixels',
    );
  });
});
