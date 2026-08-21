/**
 * CloneStampTool tests — 6 TDD tests.
 */
import { makeRasterLayerNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { CloneStampTool } from '../CloneStampTool';

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

describe('CloneStampTool', () => {
  function makeMockCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 100, 100);
    return canvas;
  }

  it('sets source point on Alt+click', () => {
    const tool = new CloneStampTool();
    const ctx = makeMockContext(makeMockCanvas());

    const result = tool.onPointerDown(
      { altKey: true, clientX: 30, clientY: 40, pointerId: 1 } as any,
      ctx,
    );
    expect(result.consumed).toBe(true);
    expect(ctx.announce).toHaveBeenCalledWith('Clone source set');
  });

  it('paints from source to target on click', () => {
    const tool = new CloneStampTool();
    const canvas = makeMockCanvas();
    const canvasCtx = canvas.getContext('2d')!;
    canvasCtx.fillStyle = '#ff0000';
    canvasCtx.fillRect(0, 0, 10, 10);
    canvasCtx.fillStyle = '#0000ff';
    canvasCtx.fillRect(50, 50, 10, 10);

    const ctx = makeMockContext(canvas);

    (tool as any).sourcePoint = { nodeId: 'raster-1', x: 5, y: 5 };

    const result = tool.onPointerDown(
      { altKey: false, clientX: 55, clientY: 55, pointerId: 1 } as any,
      ctx,
    );
    expect(result.consumed).toBe(true);
  });

  it('prompts to set source if none set', () => {
    const tool = new CloneStampTool();
    const ctx = makeMockContext(makeMockCanvas());

    const result = tool.onPointerDown(
      { altKey: false, clientX: 10, clientY: 10, pointerId: 1 } as any,
      ctx,
    );
    expect(result.consumed).toBe(false);
    expect(ctx.announce).toHaveBeenCalledWith('Alt-click to set the clone source first');
  });

  it('supports aligned mode offset tracking', () => {
    const tool = new CloneStampTool();
    (tool as any).options.aligned = true;
    (tool as any).sourcePoint = { nodeId: 'raster-1', x: 10, y: 10 };

    const canvas = makeMockCanvas();
    const ctx = makeMockContext(canvas);

    const result = tool.onPointerDown(
      { altKey: false, clientX: 60, clientY: 60, pointerId: 2 } as any,
      ctx,
    );
    expect(result.consumed).toBe(true);
  });

  it('supports non-aligned mode (fixed offset)', () => {
    const tool = new CloneStampTool();
    (tool as any).options.aligned = false;
    (tool as any).sourcePoint = { nodeId: 'raster-1', x: 10, y: 10 };

    const canvas = makeMockCanvas();
    const ctx = makeMockContext(canvas);

    const result = tool.onPointerDown(
      { altKey: false, clientX: 55, clientY: 55, pointerId: 2 } as any,
      ctx,
    );
    expect(result.consumed).toBe(true);
  });

  it('supports undo via transaction lifecycle', () => {
    const tool = new CloneStampTool();
    const canvas = makeMockCanvas();
    const beginTx = vi.fn();
    const commitTx = vi.fn();
    const abortTx = vi.fn();

    const ctx = makeMockContext(canvas, {
      beginTransaction: beginTx,
      commitTransaction: commitTx,
      abortTransaction: abortTx,
    });

    (tool as any).sourcePoint = { nodeId: 'raster-1', x: 5, y: 5 };

    tool.onPointerDown({ altKey: false, clientX: 30, clientY: 30, pointerId: 3 } as any, ctx);
    expect(beginTx).toHaveBeenCalled();

    tool.onPointerUp({ clientX: 30, clientY: 30, pointerId: 3 } as any, ctx);
    expect(commitTx).toHaveBeenCalled();
  });
});
