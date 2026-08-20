// @vitest-environment jsdom

import {
  createEmptyTile,
  makeRasterLayerNode,
  makeTileKey,
  type RasterLayerNode,
  TILE_SIZE,
} from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { CloneStampTool } from '../CloneStampTool';
import { HealingBrushTool } from '../HealingBrushTool';
import type { ToolContext } from '../types';

/** Raster layer whose left half is red and right half is blue. */
function makeSplitLayer(): RasterLayerNode {
  const node = makeRasterLayerNode('raster-1', { width: TILE_SIZE, height: TILE_SIZE });
  const tile = createEmptyTile();
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const i = (y * TILE_SIZE + x) * 4;
      const left = x < TILE_SIZE / 2;
      tile.pixels[i] = left ? 255 : 0;
      tile.pixels[i + 1] = 0;
      tile.pixels[i + 2] = left ? 0 : 255;
      tile.pixels[i + 3] = 255;
    }
  }
  node.tiles.set(makeTileKey(0, 0), tile);
  return node;
}

function pixelAt(node: RasterLayerNode, x: number, y: number) {
  const tile = node.tiles.get(makeTileKey(0, 0));
  if (!tile) return null;
  const i = (y * TILE_SIZE + x) * 4;
  return {
    r: tile.pixels[i]!,
    g: tile.pixels[i + 1]!,
    b: tile.pixels[i + 2]!,
    a: tile.pixels[i + 3]!,
  };
}

function makeCtx(node: RasterLayerNode) {
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
    getNode: (id: string) => (id === 'raster-1' ? state.node : undefined),
    updateNode: vi.fn((id: string, updater: (n: RasterLayerNode) => RasterLayerNode) => {
      if (id !== 'raster-1') return;
      state.node = updater(state.node);
      (ctx.document as { nodes: Record<string, unknown> }).nodes['raster-1'] = state.node;
    }),
    createRasterLayer: vi.fn(() => 'raster-1'),
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
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerType: 'mouse',
    timeStamp: x,
    tiltX: 0,
    tiltY: 0,
    getCoalescedEvents: () => [],
    ...overrides,
  } as unknown as PointerEvent;
}

describe('CloneStampTool', () => {
  it('requires a source before painting', () => {
    const { ctx, current } = makeCtx(makeSplitLayer());
    const tool = new CloneStampTool();
    const result = tool.onPointerDown(ptr(80, 40), ctx);
    expect(result.consumed).toBe(false);
    expect(ctx.announce).toHaveBeenCalledWith(expect.stringContaining('Alt-click'));
    expect(current().tiles.get(makeTileKey(0, 0))!.version).toBe(1);
  });

  it('sets the source on Alt-click without painting', () => {
    const { ctx } = makeCtx(makeSplitLayer());
    const tool = new CloneStampTool();
    const result = tool.onPointerDown(ptr(20, 40, { altKey: true }), ctx);
    expect(result.consumed).toBe(true);
    expect(tool.getSourcePoint()).toMatchObject({ x: 20, y: 40 });
    expect(ctx.updateNode).not.toHaveBeenCalled();
  });

  it('writes cloned pixels into canonical raster tiles', () => {
    const { ctx, current } = makeCtx(makeSplitLayer());
    const tool = new CloneStampTool();
    tool.setOptions({ brushSize: 20, hardness: 1, opacity: 1 });

    // Source in the red half, paint in the blue half.
    tool.onPointerDown(ptr(20, 40, { altKey: true }), ctx);
    tool.onPointerDown(ptr(90, 40), ctx);
    tool.onPointerUp(ptr(90, 40), ctx);

    // The painted pixel is now red, taken from the source region.
    expect(pixelAt(current(), 90, 40)).toMatchObject({ r: 255, b: 0 });
    // Untouched blue elsewhere.
    expect(pixelAt(current(), 120, 100)).toMatchObject({ r: 0, b: 255 });
    expect(ctx.commitTransaction).toHaveBeenCalledOnce();
  });

  it('samples a stroke-start snapshot rather than its own output', () => {
    const { ctx, current } = makeCtx(makeSplitLayer());
    const tool = new CloneStampTool();
    tool.setOptions({ brushSize: 16, hardness: 1, spacing: 0.2 });

    tool.onPointerDown(ptr(20, 40, { altKey: true }), ctx);
    tool.onPointerDown(ptr(90, 40), ctx);
    // Drag right, back over pixels this stroke has already recoloured.
    for (let x = 92; x <= 110; x += 2) tool.onPointerMove(ptr(x, 40), ctx);
    tool.onPointerUp(ptr(110, 40), ctx);

    // Source is red throughout, so a snapshot-sampled clone stays pure red.
    // Self-sampling would drag red into a smear of intermediate values.
    const p = pixelAt(current(), 105, 40)!;
    expect(p.r).toBe(255);
    expect(p.b).toBe(0);
  });

  it('aborts without mutating the document', () => {
    const { ctx } = makeCtx(makeSplitLayer());
    const tool = new CloneStampTool();
    tool.onPointerDown(ptr(20, 40, { altKey: true }), ctx);
    tool.onPointerDown(ptr(90, 40), ctx);
    tool.onDragCancel(ctx);
    expect(ctx.abortTransaction).toHaveBeenCalledOnce();
    expect(ctx.commitTransaction).not.toHaveBeenCalled();
  });

  it('clears its source marker when the tool is deactivated', () => {
    const { ctx } = makeCtx(makeSplitLayer());
    const tool = new CloneStampTool();
    tool.onPointerDown(ptr(20, 40, { altKey: true }), ctx);
    expect(tool.getSourcePoint()).not.toBeNull();
    tool.onDeactivate(ctx);
    expect(tool.getSourcePoint()).toBeNull();
  });
});

describe('HealingBrushTool', () => {
  it('writes healed pixels into canonical raster tiles', () => {
    const { ctx, current } = makeCtx(makeSplitLayer());
    const tool = new HealingBrushTool();
    tool.setOptions({ brushSize: 20, hardness: 1, opacity: 1 });

    tool.onPointerDown(ptr(20, 40, { altKey: true }), ctx);
    tool.onPointerDown(ptr(90, 40), ctx);
    tool.onPointerUp(ptr(90, 40), ctx);

    expect(ctx.updateNode).toHaveBeenCalled();
    expect(ctx.commitTransaction).toHaveBeenCalledOnce();
    expect(current().tiles.get(makeTileKey(0, 0))!.version).toBeGreaterThan(1);
  });

  it('takes colour from the destination, unlike a clone', () => {
    const cloneCtx = makeCtx(makeSplitLayer());
    const clone = new CloneStampTool();
    clone.setOptions({ brushSize: 20, hardness: 1, opacity: 1 });
    clone.onPointerDown(ptr(20, 40, { altKey: true }), cloneCtx.ctx);
    clone.onPointerDown(ptr(90, 40), cloneCtx.ctx);
    clone.onPointerUp(ptr(90, 40), cloneCtx.ctx);

    const healCtx = makeCtx(makeSplitLayer());
    const heal = new HealingBrushTool();
    heal.setOptions({ brushSize: 20, hardness: 1, opacity: 1 });
    heal.onPointerDown(ptr(20, 40, { altKey: true }), healCtx.ctx);
    heal.onPointerDown(ptr(90, 40), healCtx.ctx);
    heal.onPointerUp(ptr(90, 40), healCtx.ctx);

    const cloned = pixelAt(cloneCtx.current(), 90, 40)!;
    const healed = pixelAt(healCtx.current(), 90, 40)!;
    // Clone imports the source colour wholesale; heal shifts it back towards
    // the blue surroundings it is repairing.
    expect(cloned.r).toBe(255);
    expect(healed.r).toBeLessThan(cloned.r);
    expect(healed.b).toBeGreaterThan(cloned.b);
  });

  it('stamps at the cursor, not at the layer origin', () => {
    const { ctx, current } = makeCtx(makeSplitLayer());
    const tool = new HealingBrushTool();
    tool.setOptions({ brushSize: 20, hardness: 1 });
    tool.onPointerDown(ptr(20, 40, { altKey: true }), ctx);
    tool.onPointerDown(ptr(90, 90), ctx);
    tool.onPointerUp(ptr(90, 90), ctx);

    // Regression: healing used to write the patch to the top-left corner of
    // the canvas regardless of where the brush was.
    const origin = pixelAt(current(), 0, 0)!;
    expect(origin).toMatchObject({ r: 255, g: 0, b: 0, a: 255 });
  });

  it('handles a source near the layer edge without throwing', () => {
    const { ctx } = makeCtx(makeSplitLayer());
    const tool = new HealingBrushTool();
    tool.setOptions({ brushSize: 40 });
    tool.onPointerDown(ptr(1, 1, { altKey: true }), ctx);
    expect(() => {
      tool.onPointerDown(ptr(TILE_SIZE - 2, TILE_SIZE - 2), ctx);
      tool.onPointerUp(ptr(TILE_SIZE - 2, TILE_SIZE - 2), ctx);
    }).not.toThrow();
  });

  it('aborts without mutating the document', () => {
    const { ctx } = makeCtx(makeSplitLayer());
    const tool = new HealingBrushTool();
    tool.onPointerDown(ptr(20, 40, { altKey: true }), ctx);
    tool.onPointerDown(ptr(90, 40), ctx);
    tool.onDragCancel(ctx);
    expect(ctx.abortTransaction).toHaveBeenCalledOnce();
  });
});

describe('CloneStampTool sample-all-layers', () => {
  it('samples only the target layer by default', () => {
    const { ctx, current } = makeCtx(makeSplitLayer());
    const tool = new CloneStampTool();
    tool.setOptions({ brushSize: 20, hardness: 1 });
    expect(tool.getOptions().sampleAllLayers).toBe(false);

    tool.onPointerDown(ptr(20, 40, { altKey: true }), ctx);
    tool.onPointerDown(ptr(90, 40), ctx);
    tool.onPointerUp(ptr(90, 40), ctx);
    expect(pixelAt(current(), 90, 40)).toMatchObject({ r: 255, b: 0 });
  });

  it('samples the visible stack when asked, and still deposits on one layer', () => {
    const { ctx, current } = makeCtx(makeSplitLayer());
    const tool = new CloneStampTool();
    tool.setOptions({ brushSize: 20, hardness: 1, sampleAllLayers: true });

    tool.onPointerDown(ptr(20, 40, { altKey: true }), ctx);
    tool.onPointerDown(ptr(90, 40), ctx);
    tool.onPointerUp(ptr(90, 40), ctx);

    // Only one raster layer exists here, so the composite equals it — the
    // point is that deposits still land on the active layer alone.
    expect(pixelAt(current(), 90, 40)).toMatchObject({ r: 255, b: 0 });
    expect(ctx.commitTransaction).toHaveBeenCalledOnce();
  });
});
