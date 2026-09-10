import { createAreaSelection } from '@varve/engine';
import { describe, expect, it, vi } from 'vitest';
import { SelectionPaintTool } from './SelectionPaintTool';

function pointer(clientX: number, clientY: number, altKey = false): PointerEvent {
  return {
    clientX,
    clientY,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    altKey,
  } as PointerEvent;
}

function makeContext() {
  let areaSelection = createAreaSelection({
    kind: 'rectangle',
    x: 20,
    y: 20,
    w: 20,
    h: 20,
    feather: 0,
    antialias: false,
  });
  const ctx = {
    areaSelection,
    zoom: 1,
    setAreaSelection: vi.fn((next: typeof areaSelection) => {
      areaSelection = next;
      ctx.areaSelection = next;
    }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    canvasToWorld: vi.fn((x: number, y: number) => ({ x, y })),
    announce: vi.fn(),
  } as any;
  return ctx;
}

describe('SelectionPaintTool', () => {
  it('paints a bounded selection and lets additive dabs grow its bounds', () => {
    const tool = new SelectionPaintTool();
    const ctx = makeContext();
    tool.onActivate(ctx);
    tool.onPointerDown(pointer(5, 30), ctx);
    tool.onPointerUp(pointer(5, 30), ctx);

    expect(ctx.setAreaSelection).toHaveBeenCalledTimes(1);
    const next = ctx.areaSelection.expression.shape;
    expect(next.kind).toBe('raster-mask');
    if (next.kind !== 'raster-mask') return;
    expect(next.x).toBeLessThan(20);
    expect(next.w).toBeGreaterThan(20);
  });

  it('cancels the current stroke without replacing the selection', () => {
    const tool = new SelectionPaintTool();
    const ctx = makeContext();
    const before = ctx.areaSelection;
    tool.onActivate(ctx);
    tool.onPointerDown(pointer(30, 30), ctx);
    expect(tool.onKeyDown({ key: 'Escape' } as KeyboardEvent, ctx)).toBe(true);
    expect(ctx.areaSelection).toBe(before);
    expect(ctx.setAreaSelection).not.toHaveBeenCalled();
  });

  it('commits one undoable selection change per completed stroke', () => {
    const tool = new SelectionPaintTool();
    const ctx = makeContext();
    ctx.commitAreaSelection = vi.fn((next: typeof ctx.areaSelection) => {
      ctx.areaSelection = next;
    });
    tool.onActivate(ctx);
    tool.onPointerDown(pointer(25, 25), ctx);
    tool.onPointerMove(pointer(30, 30), ctx);
    tool.onPointerUp(pointer(35, 35), ctx);

    expect(ctx.commitAreaSelection).toHaveBeenCalledTimes(1);
    expect(ctx.setAreaSelection).not.toHaveBeenCalled();
  });
});
