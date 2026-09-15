import { describe, expect, it, vi } from 'vitest';
import { MarqueeTool } from './MarqueeTool';

function pointer(
  clientX: number,
  clientY: number,
  modifiers: Partial<Pick<PointerEvent, 'shiftKey' | 'altKey'>> = {},
): PointerEvent {
  return {
    clientX,
    clientY,
    pointerId: 1,
    pointerType: 'mouse',
    shiftKey: false,
    altKey: false,
    ...modifiers,
  } as PointerEvent;
}

describe('MarqueeTool', () => {
  function makeContext() {
    let areaSelection = null as any;
    const ctx = {
      areaSelection,
      setAreaSelection: vi.fn((selection: any) => {
        areaSelection = selection;
        ctx.areaSelection = selection;
      }),
      setSelection: vi.fn(),
      setDraft: vi.fn(),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      canvasToWorld: vi.fn((x: number, y: number) => ({ x, y })),
      announce: vi.fn(),
    } as any;
    return ctx;
  }

  function drag(
    tool: MarqueeTool,
    ctx: any,
    modifiers: Partial<Pick<PointerEvent, 'shiftKey' | 'altKey'>> = {},
  ) {
    tool.onPointerDown(pointer(20, 30, modifiers), ctx);
    tool.onPointerMove(pointer(80, 90, modifiers), ctx);
    tool.onPointerUp(pointer(80, 90, modifiers), ctx);
  }

  it('creates a normalized document-space rectangle and keeps node selection separate', () => {
    const tool = new MarqueeTool();
    const ctx = makeContext();

    drag(tool, ctx);

    expect(ctx.setSelection).not.toHaveBeenCalledWith(expect.anything());
    expect(ctx.areaSelection.expression).toEqual({
      kind: 'shape',
      shape: {
        kind: 'rectangle',
        x: 20,
        y: 30,
        w: 60,
        h: 60,
        feather: 0,
        antialias: false,
      },
    });
    expect(ctx.areaSelection.coordinateSpace).toBe('document');
    expect(ctx.setDraft).toHaveBeenLastCalledWith(null);
  });

  it('captures add and subtract modifiers at pointer-down', () => {
    const tool = new MarqueeTool();
    const ctx = makeContext();

    drag(tool, ctx);
    drag(tool, ctx, { shiftKey: true });
    expect(ctx.areaSelection.expression.kind).toBe('combine');
    expect(ctx.areaSelection.expression.operation).toBe('add');

    drag(tool, ctx, { altKey: true });
    expect(ctx.areaSelection.expression.kind).toBe('combine');
    expect(ctx.areaSelection.expression.operation).toBe('subtract');
  });

  it('cancels the draft without committing a selection', () => {
    const tool = new MarqueeTool();
    const ctx = makeContext();

    tool.onPointerDown(pointer(10, 10), ctx);
    tool.onPointerMove(pointer(11, 11), ctx);
    tool.onPointerCancel(pointer(11, 11), ctx);

    expect(ctx.setAreaSelection).not.toHaveBeenCalled();
    expect(ctx.setDraft).toHaveBeenLastCalledWith(null);
  });

  it('clears the persistent area selection with Escape when idle', () => {
    const tool = new MarqueeTool();
    const ctx = makeContext();
    drag(tool, ctx);

    expect(tool.onKeyDown({ key: 'Escape' } as KeyboardEvent, ctx)).toBe(true);
    expect(ctx.areaSelection).toBeNull();
    expect(ctx.announce).toHaveBeenLastCalledWith('Pixel selection cleared');
  });
});
