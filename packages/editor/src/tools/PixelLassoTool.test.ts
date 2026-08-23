import { type AreaSelectionSettings, DEFAULT_AREA_SELECTION_SETTINGS } from '@varve/engine';
import { describe, expect, it, vi } from 'vitest';
import { PixelLassoTool } from './PixelLassoTool';

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

function makeContext(settings?: Partial<AreaSelectionSettings>) {
  let areaSelection = null as any;
  const ctx = {
    areaSelection,
    areaSelectionSettings: { ...DEFAULT_AREA_SELECTION_SETTINGS, ...settings },
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
    lastPointerEvent: null,
  } as any;
  return ctx;
}

function freehandDrag(
  tool: PixelLassoTool,
  ctx: any,
  modifiers: Partial<Pick<PointerEvent, 'shiftKey' | 'altKey'>> = {},
) {
  tool.onPointerDown(pointer(0, 0, modifiers), ctx);
  tool.onPointerMove(pointer(10, 0, modifiers), ctx);
  tool.onPointerMove(pointer(20, 0, modifiers), ctx);
  tool.onPointerMove(pointer(30, 0, modifiers), ctx);
  tool.onPointerMove(pointer(40, 5, modifiers), ctx);
  tool.onPointerUp(pointer(40, 5, modifiers), ctx);
}

describe('PixelLassoTool', () => {
  it('creates an analytical polygon area selection and leaves node selection untouched', () => {
    const tool = new PixelLassoTool();
    const ctx = makeContext();
    freehandDrag(tool, ctx);

    expect(ctx.setSelection).not.toHaveBeenCalled();
    expect(ctx.areaSelection.expression).toEqual({
      kind: 'shape',
      shape: {
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
          { x: 30, y: 0 },
          { x: 40, y: 5 },
        ],
        feather: 0,
        antialias: false,
      },
    });
    expect(ctx.areaSelection.coordinateSpace).toBe('document');
    expect(ctx.setDraft).toHaveBeenLastCalledWith(null);
  });

  it('applies feather and antialias from the area-selection settings', () => {
    const tool = new PixelLassoTool();
    const ctx = makeContext({ feather: 5, antialias: true });
    freehandDrag(tool, ctx);

    const shape = ctx.areaSelection.expression.shape;
    expect(shape.feather).toBe(5);
    expect(shape.antialias).toBe(true);
  });

  it('uses the option-bar operation when no modifier is held', () => {
    const tool = new PixelLassoTool();
    const ctx = makeContext({ operation: 'add' });
    freehandDrag(tool, ctx);

    // First gesture with operation 'add' over an empty selection collapses to a
    // plain shape (replace semantics for the initial selection).
    expect(ctx.areaSelection.expression.kind).toBe('shape');
  });

  it('combines subsequent lassos with add, subtract and intersect modifiers', () => {
    const tool = new PixelLassoTool();
    const ctx = makeContext();
    freehandDrag(tool, ctx);
    freehandDrag(tool, ctx, { shiftKey: true });
    expect(ctx.areaSelection.expression.kind).toBe('combine');
    expect(ctx.areaSelection.expression.operation).toBe('add');

    freehandDrag(tool, ctx, { altKey: true });
    expect(ctx.areaSelection.expression.operation).toBe('subtract');

    freehandDrag(tool, ctx, { shiftKey: true, altKey: true });
    expect(ctx.areaSelection.expression.operation).toBe('intersect');
  });

  it('clears the active area selection with Escape when idle', () => {
    const tool = new PixelLassoTool();
    const ctx = makeContext();
    freehandDrag(tool, ctx);
    expect(tool.onKeyDown({ key: 'Escape' } as KeyboardEvent, ctx)).toBe(true);
    expect(ctx.areaSelection).toBeNull();
    expect(ctx.announce).toHaveBeenLastCalledWith('Pixel selection cleared');
  });

  it('cancels a freehand gesture without committing', () => {
    const tool = new PixelLassoTool();
    const ctx = makeContext();
    tool.onPointerDown(pointer(0, 0), ctx);
    tool.onPointerMove(pointer(10, 0), ctx);
    tool.onPointerCancel(pointer(10, 0), ctx);

    expect(ctx.setAreaSelection).not.toHaveBeenCalled();
    expect(ctx.setDraft).toHaveBeenLastCalledWith(null);
  });
});
