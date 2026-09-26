// @vitest-environment jsdom

import { createAreaSelection } from '@varve/engine';
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
      'No editable pixel layer is available. Add a pixel layer or prepare one from the photo before retouching.',
    );
  });

  it('clips the deposited patch to the active area selection', () => {
    const { context } = makeContext(makeSplitLayer());
    // Selection over the left half of the canvas only.
    const selection = createAreaSelection(
      {
        kind: 'rectangle',
        x: 0,
        y: 0,
        w: TILE_SIZE / 2,
        h: TILE_SIZE,
        feather: 0,
        antialias: false,
      },
      1,
    );
    (context as { areaSelection: unknown }).areaSelection = selection;
    const tool = new PatchTool();
    tool.onActivate(context);

    // Source in the red half; target centred in the blue half.
    tool.onPointerDown(pointer(1, 12, 20), context);
    tool.onPointerMove(pointer(1, 32, 40), context);
    tool.onPointerUp(pointer(1, 32, 40), context);
    const result = tool.onPointerDown(pointer(2, 94, 80), context);

    expect(result.consumed).toBe(true);
    // The whole target rectangle lies outside the selection, so nothing is
    // written and the gesture is reported as a no-op.
    expect(context.announce).toHaveBeenCalledWith(
      'Patch had no valid source or destination pixels',
    );
    expect(context.commitTransaction).not.toHaveBeenCalled();
  });

  it('keeps pixels outside the selection unchanged when the patch overlaps it', () => {
    // Three vertical bands: red (x<42), blue (42..85), green (x>=86). The
    // selection is the left part of the blue band, the source is green, so a
    // leak past the selection boundary would be visible as green pixels.
    const node = makeRasterLayerNode('raster-1', { width: TILE_SIZE, height: TILE_SIZE });
    const tile = createEmptyTile();
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const index = (y * TILE_SIZE + x) * 4;
        const band = x < 42 ? [220, 40, 20] : x < 86 ? [20, 60, 220] : [30, 200, 40];
        tile.pixels[index] = band[0]!;
        tile.pixels[index + 1] = band[1]!;
        tile.pixels[index + 2] = band[2]!;
        tile.pixels[index + 3] = 255;
      }
    }
    node.tiles.set(makeTileKey(0, 0), tile);

    const { context, current } = makeContext(node);
    // Selection: x 42..64 only.
    const selection = createAreaSelection(
      {
        kind: 'rectangle',
        x: 42,
        y: 0,
        w: 22,
        h: TILE_SIZE,
        feather: 0,
        antialias: false,
      },
      1,
    );
    (context as { areaSelection: unknown }).areaSelection = selection;
    const tool = new PatchTool();
    tool.onActivate(context);

    // Source: green band x 90..110. Target spans x 48..68, straddling the
    // selection boundary at x=64.
    tool.onPointerDown(pointer(1, 90, 20), context);
    tool.onPointerMove(pointer(1, 110, 40), context);
    tool.onPointerUp(pointer(1, 110, 40), context);
    tool.onPointerDown(pointer(2, 58, 40), context);

    expect(context.commitTransaction).toHaveBeenCalledOnce();
    const pixels = current().tiles.get(makeTileKey(0, 0))!.pixels;
    const inside = (40 * TILE_SIZE + 50) * 4;
    const outside = (40 * TILE_SIZE + 66) * 4;
    // Inside the selection the blue destination picked up green source pixels.
    expect(pixels[inside]!).toBeLessThan(120);
    expect(pixels[inside + 1]!).toBeGreaterThan(60);
    // Outside the selection the blue destination is byte-identical; an
    // unclipped patch would have deposited green there.
    expect(pixels[outside]!).toBe(20);
    expect(pixels[outside + 1]!).toBe(60);
    expect(pixels[outside + 2]!).toBe(220);
  });
});
