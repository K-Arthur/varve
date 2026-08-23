import { describe, expect, it, vi } from 'vitest';
import { LassoTool } from './LassoTool';

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

function makeContext() {
  const doc = {
    activePageId: 'page1',
    pages: [
      { id: 'page1', contentRoot: 'root', width: 1000, height: 1000, placement: { x: 0, y: 0 } },
    ],
    nodes: {},
  } as any;
  const ctx = {
    document: doc,
    selection: [] as string[],
    setSelection: vi.fn(),
    toggleSelection: vi.fn(),
    isSelected: vi.fn(() => false),
    getNode: vi.fn(() => undefined),
    announceSelection: vi.fn(),
    setDraft: vi.fn(),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    canvasToWorld: vi.fn((x: number, y: number) => ({ x, y })),
    announce: vi.fn(),
    lastPointerEvent: null,
  } as any;
  return ctx;
}

function freehandDrag(tool: LassoTool, ctx: any) {
  tool.onPointerDown(pointer(0, 0), ctx);
  tool.onPointerMove(pointer(10, 0), ctx);
  tool.onPointerMove(pointer(20, 0), ctx);
  tool.onPointerMove(pointer(30, 0), ctx);
  tool.onPointerMove(pointer(40, 5), ctx);
  tool.onPointerUp(pointer(40, 5), ctx);
}

describe('LassoTool (object selection)', () => {
  it('commits a node selection through the shared gesture engine', () => {
    const tool = new LassoTool();
    const ctx = makeContext();
    freehandDrag(tool, ctx);

    expect(ctx.setSelection).toHaveBeenCalled();
    expect(ctx.announceSelection).toHaveBeenCalled();
    expect(ctx.setDraft).toHaveBeenLastCalledWith(null);
  });

  it('does not select anything when fewer than three points are captured', () => {
    const tool = new LassoTool();
    const ctx = makeContext();
    tool.onPointerDown(pointer(0, 0), ctx);
    tool.onPointerMove(pointer(10, 0), ctx);
    tool.onPointerUp(pointer(10, 0), ctx);

    expect(ctx.announceSelection).not.toHaveBeenCalled();
  });

  it('cancels a freehand gesture without committing', () => {
    const tool = new LassoTool();
    const ctx = makeContext();
    tool.onPointerDown(pointer(0, 0), ctx);
    tool.onPointerMove(pointer(10, 0), ctx);
    tool.onPointerCancel(pointer(10, 0), ctx);

    expect(ctx.announceSelection).not.toHaveBeenCalled();
    expect(ctx.setDraft).toHaveBeenLastCalledWith(null);
  });
});
