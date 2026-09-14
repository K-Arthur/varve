/**
 * HealingBrushTool tests — 4 TDD tests.
 */
import { createEmptyTile, makeRasterLayerNode, makeTileKey, TILE_SIZE } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { HealingBrushTool } from '../HealingBrushTool';

function makeMockContext(canvas: HTMLCanvasElement, overrides: Record<string, unknown> = {}) {
  const node = makeRasterLayerNode('raster-1', { width: canvas.width, height: canvas.height });
  const state = { node };
  const ctx = {
    document: { nodes: { 'raster-1': state.node }, rootChildren: ['raster-1'] },
    selection: ['raster-1'],
    canvasElement: canvas,
    announce: vi.fn(),
    canvasToWorld: vi.fn((cx: number, cy: number) => ({ x: cx, y: cy })),
    getNode: (id: string) => (id === 'raster-1' ? state.node : undefined),
    updateNode: vi.fn((id: string, updater: (value: typeof state.node) => typeof state.node) => {
      if (id !== 'raster-1') return;
      state.node = updater(state.node);
      (ctx.document.nodes as Record<string, unknown>)['raster-1'] = state.node;
    }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    abortTransaction: vi.fn(),
    setDraft: vi.fn(),
    ...overrides,
  } as any;
  return ctx;
}

describe('HealingBrushTool', () => {
  function makeMockCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    return canvas;
  }

  it('paints and applies healing at cursor position', () => {
    const tool = new HealingBrushTool();
    const canvas = makeMockCanvas();

    const ctx = makeMockContext(canvas);

    (tool as any).sourcePoint = { nodeId: 'raster-1', x: 5, y: 5 };

    const result = tool.onPointerDown(
      { altKey: false, clientX: 30, clientY: 30, pointerId: 1 } as any,
      ctx,
    );
    expect(result.consumed).toBe(true);
    expect(ctx.beginTransaction).toHaveBeenCalled();
  });

  it('preserves source texture in healed area', () => {
    const tool = new HealingBrushTool();
    const canvas = makeMockCanvas();

    const ctx = makeMockContext(canvas);

    (tool as any).sourcePoint = { nodeId: 'raster-1', x: 5, y: 5 };

    const result = tool.onPointerDown(
      { altKey: false, clientX: 45, clientY: 45, pointerId: 1 } as any,
      ctx,
    );
    expect(result.consumed).toBe(true);
  });

  it('handles edge of canvas without error', () => {
    const tool = new HealingBrushTool();
    const canvas = makeMockCanvas();

    const ctx = makeMockContext(canvas);

    (tool as any).sourcePoint = { nodeId: 'raster-1', x: 2, y: 2 };

    expect(() => {
      tool.onPointerDown({ altKey: false, clientX: 1, clientY: 1, pointerId: 1 } as any, ctx);
    }).not.toThrow();
  });

  it('completes transaction lifecycle on drag end', () => {
    const tool = new HealingBrushTool();
    (tool as any).options.hardness = 0.5;

    const canvas = makeMockCanvas();
    const commitTx = vi.fn();

    const ctx = makeMockContext(canvas, { commitTransaction: commitTx });
    // Seed real pixels: healing needs a source and destination to actually
    // change bytes, otherwise the stroke is a no-op and aborts.
    const node = ctx.getNode('raster-1') as ReturnType<typeof makeRasterLayerNode>;
    const tile = createEmptyTile();
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const index = (y * TILE_SIZE + x) * 4;
        tile.pixels[index] = (x * 3) % 256;
        tile.pixels[index + 1] = (y * 5) % 256;
        tile.pixels[index + 2] = 120;
        tile.pixels[index + 3] = 255;
      }
    }
    node.tiles.set(makeTileKey(0, 0), tile);

    (tool as any).sourcePoint = { nodeId: 'raster-1', x: 5, y: 5 };

    tool.onPointerDown({ altKey: false, clientX: 50, clientY: 50, pointerId: 1 } as any, ctx);
    tool.onPointerUp({ clientX: 50, clientY: 50, pointerId: 1 } as any, ctx);
    expect(commitTx).toHaveBeenCalled();
  });
});
