/**
 * PageTool (M6): click activates a page, drag moves it on the pasteboard,
 * corner drag resizes the trim without scaling content, pasteboard clicks
 * are inert.
 */
import type { Document } from '@varve/scene';
import { addPage, createDocument } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { cornerUnderPoint, MIN_PAGE_SIZE, PageTool } from '../PageTool';

function twoPageDoc(): Document {
  let doc = createDocument('page-tool', false);
  doc = addPage(doc, {});
  return {
    ...doc,
    pages: doc.pages!.map((p, i) => ({
      ...p,
      placement: { x: i * 2000, y: 0 },
    })),
  };
}

function makeCtx(doc: Document, overrides: Record<string, unknown> = {}) {
  return {
    document: doc,
    selection: [] as string[],
    zoom: 1,
    pan: { x: 0, y: 0 },
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerType: 'mouse' as const,
    pointerPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    tangentialPressure: 0,
    pointerWidth: 1,
    pointerHeight: 1,
    altitudeAngle: Math.PI / 2,
    azimuthAngle: 0,
    hasCoalescedEvents: false,
    hasPredictedEvents: false,
    sourceEvents: [],
    foregroundColor: [0, 0, 0, 255] as [number, number, number, number],
    maskPreviewMode: 'none' as const,
    setMaskPreviewMode: vi.fn(),
    snapEnabled: false,
    snapGrid: 8,
    isolatedNodeId: null,
    createShapeAt: vi.fn(),
    createTextNodeAt: vi.fn(),
    setSelection: vi.fn(),
    toggleSelection: vi.fn(),
    isSelected: vi.fn().mockReturnValue(false),
    setNodePosition: vi.fn(),
    setNodePositions: vi.fn(),
    updateNodes: vi.fn(),
    setNodeSize: vi.fn(),
    updateNode: vi.fn(),
    removeSelected: vi.fn(),
    duplicateSelected: vi.fn(),
    reparentNode: vi.fn(),
    setCamera: vi.fn(),
    setPan: vi.fn(),
    setZoom: vi.fn(),
    announce: vi.fn(),
    announceSelection: vi.fn(),
    announceOperation: vi.fn(),
    setDraft: vi.fn(),
    rootNodes: vi.fn().mockReturnValue([]),
    getNode: vi.fn(),
    canvasToWorld: vi.fn((cx: number, cy: number) => ({ x: cx, y: cy })),
    worldToCanvas: vi.fn((wx: number, wy: number) => ({ x: wx, y: wy })),
    canvasDeltaToWorld: vi.fn((dx: number, dy: number) => ({ dx, dy })),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    findContainingFrame: vi.fn().mockReturnValue(null),
    setDropTargetFrame: vi.fn(),
    nodeWorldBounds: vi.fn().mockReturnValue(null),
    engine: null,
    hitTest: vi.fn().mockReturnValue(null),
    canvasElement: null,
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    abortTransaction: vi.fn(),
    setTool: vi.fn(),
    nodeEditTargetId: null,
    setNodeEditTargetId: vi.fn(),
    setNodeEditSelectedAnchors: vi.fn(),
    setTextEditTargetId: vi.fn(),
    snapPosition: vi.fn((b: { x: number; y: number }) => ({ x: b.x, y: b.y, guides: [] })),
    createRasterLayer: vi.fn(() => null),
    touchMultiSelect: { active: false, suspended: false },
    setActivePage: vi.fn(),
    movePageOnPasteboard: vi.fn(),
    resizePage: vi.fn(),
    ...overrides,
  };
}

function pointer(clientX: number, clientY: number, pointerId = 1) {
  return {
    pointerId,
    clientX,
    clientY,
    pointerType: 'mouse',
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
  } as unknown as PointerEvent;
}

describe('cornerUnderPoint', () => {
  const bounds = { x: 0, y: 0, w: 100, h: 80 };

  it('resolves each trim corner within tolerance', () => {
    expect(cornerUnderPoint(bounds, { x: 1, y: 1 }, 10)).toEqual([-1, -1]);
    expect(cornerUnderPoint(bounds, { x: 99, y: 1 }, 10)).toEqual([1, -1]);
    expect(cornerUnderPoint(bounds, { x: 99, y: 79 }, 10)).toEqual([1, 1]);
    expect(cornerUnderPoint(bounds, { x: 1, y: 79 }, 10)).toEqual([-1, 1]);
  });

  it('returns null away from corners', () => {
    expect(cornerUnderPoint(bounds, { x: 50, y: 40 }, 10)).toBeNull();
  });
});

describe('PageTool gestures', () => {
  it('activates the page under a plain click', () => {
    const doc = twoPageDoc();
    const setActivePage = vi.fn();
    const ctx = makeCtx(doc, { setActivePage });
    const tool = new PageTool();

    tool.onPointerDown(pointer(2050, 210), ctx as never);
    tool.onPointerUp(pointer(2050, 210), ctx as never);

    expect(setActivePage).toHaveBeenCalledWith(doc.pages![1]!.id);
  });

  it('moves the page placement with the drag delta (content untouched)', () => {
    const doc = twoPageDoc();
    const movePageOnPasteboard = vi.fn();
    const ctx = makeCtx(doc, { movePageOnPasteboard });
    const tool = new PageTool();

    tool.onPointerDown(pointer(50, 50), ctx as never);
    tool.onPointerMove(pointer(70, 80), ctx as never);
    tool.onPointerUp(pointer(70, 80), ctx as never);

    expect(movePageOnPasteboard).toHaveBeenCalledWith(doc.pages![0]!.id, 20, 30);
  });

  it('resizes the active page from a corner drag without scaling content', () => {
    const doc = twoPageDoc();
    const resizePage = vi.fn();
    const ctx = makeCtx(doc, { resizePage });
    const tool = new PageTool();

    // Bottom-right corner of page 1's trim at (1920, 1080).
    tool.onPointerDown(pointer(1918, 1078), ctx as never);
    tool.onPointerMove(pointer(2020, 1180), ctx as never);
    tool.onPointerUp(pointer(2020, 1180), ctx as never);

    expect(resizePage).toHaveBeenCalledWith(doc.pages![0]!.id, 1920 + 102, 1080 + 102);
  });

  it('clamps the resize to a minimum page size', () => {
    const doc = twoPageDoc();
    const resizePage = vi.fn();
    const ctx = makeCtx(doc, { resizePage });
    const tool = new PageTool();

    // Top-left corner dragged far down-right shrinks below the minimum.
    tool.onPointerDown(pointer(0, 0), ctx as never);
    tool.onPointerMove(pointer(2000, 2000), ctx as never);
    tool.onPointerUp(pointer(2000, 2000), ctx as never);

    expect(resizePage).toHaveBeenCalledWith(doc.pages![0]!.id, MIN_PAGE_SIZE, MIN_PAGE_SIZE);
  });

  it('is inert on the pasteboard', () => {
    const doc = twoPageDoc();
    const setActivePage = vi.fn();
    const movePageOnPasteboard = vi.fn();
    const ctx = makeCtx(doc, { setActivePage, movePageOnPasteboard });
    const tool = new PageTool();

    // World (1950, 100) sits in the gap between the two pages.
    tool.onPointerDown(pointer(1950, 100), ctx as never);
    tool.onPointerMove(pointer(1960, 110), ctx as never);
    tool.onPointerUp(pointer(1960, 110), ctx as never);

    expect(setActivePage).not.toHaveBeenCalled();
    expect(movePageOnPasteboard).not.toHaveBeenCalled();
  });
});
