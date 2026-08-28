/**
 * Tests for SelectionBoundaryTool — interactive drag handles for
 * transforming the selection boundary itself.
 */

import { createAreaSelection } from '@varve/engine';
import { describe, expect, it, vi } from 'vitest';
import { SelectionBoundaryTool } from './SelectionBoundaryTool';
import type { ToolContext } from './types';

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    document: { nodes: {}, rootChildren: [], pages: [], activePageId: 'page-1' } as never,
    selection: [],
    zoom: 1,
    pan: { x: 0, y: 0 },
    touchMultiSelect: { active: false, suspended: false },
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerType: 'mouse',
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
    maskPreviewMode: 'none',
    areaSelection: null,
    setAreaSelection: vi.fn(),
    foregroundColor: [0, 0, 0, 255],
    snapEnabled: false,
    snapGrid: 1,
    canvasToWorld: (cx: number, cy: number) => ({ x: cx, y: cy }),
    worldToCanvas: (wx: number, wy: number) => ({ x: wx, y: wy }),
    canvasDeltaToWorld: (dx: number, dy: number) => ({ dx, dy }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    findContainingFrame: () => null,
    nodeWorldBounds: () => null,
    engine: null,
    hitTest: () => null,
    canvasElement: null,
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    abortTransaction: vi.fn(),
    setTool: vi.fn(),
    nodeEditTargetId: null,
    setNodeEditTargetId: vi.fn(),
    setNodeEditSelectedAnchors: vi.fn(),
    setTextEditTargetId: vi.fn(),
    setSelection: vi.fn(),
    toggleSelection: vi.fn(),
    isSelected: () => false,
    setNodePosition: vi.fn(),
    setNodePositions: vi.fn(),
    setNodeSize: vi.fn(),
    updateNode: vi.fn(),
    updateNodes: vi.fn(),
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
    setDropTargetFrame: vi.fn(),
    rootNodes: () => [],
    getNode: () => undefined,
    createShapeAt: vi.fn(),
    createTextNodeAt: vi.fn(),
    snapPosition: (b) => ({ x: b.x, y: b.y, guides: [] }),
    ...overrides,
  } as ToolContext;
}

describe('SelectionBoundaryTool', () => {
  it('has the correct id', () => {
    const tool = new SelectionBoundaryTool();
    expect(tool.id).toBe('selectionBoundary');
  });

  it('returns crosshair cursor', () => {
    const tool = new SelectionBoundaryTool();
    const cursor = tool.cursor('idle');
    expect(cursor.css).toBe('move');
  });

  it('refuses pointer-down when no selection is active', () => {
    const tool = new SelectionBoundaryTool();
    const ctx = createMockContext({ areaSelection: null });
    const e = new PointerEvent('pointerdown', { clientX: 100, clientY: 100 });
    const result = tool.onPointerDown!(e, ctx);
    expect(result.consumed).toBe(false);
  });

  it('moves only the area boundary and restores it exactly when cancelled', () => {
    const selection = createAreaSelection({
      kind: 'rectangle',
      x: 10,
      y: 20,
      w: 30,
      h: 40,
      feather: 0,
      antialias: false,
    })!;
    const setAreaSelection = vi.fn();
    const ctx = createMockContext({
      areaSelection: selection,
      setAreaSelection,
      lastPointerEvent: new PointerEvent('pointermove', { clientX: 26, clientY: 37 }),
    });
    const tool = new SelectionBoundaryTool();
    tool.onPointerDown!(new PointerEvent('pointerdown', { clientX: 16, clientY: 17 }), ctx);
    tool.onDragMove(ctx);

    const transformed = setAreaSelection.mock.calls[0]?.[0];
    expect(transformed).not.toBe(selection);
    // Node selection is untouched: the tool changes the AreaSelection only.
    expect((ctx.setSelection as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);

    tool.onDragCancel(ctx);
    expect(setAreaSelection.mock.calls.at(-1)?.[0]).toBe(selection);
  });
});
