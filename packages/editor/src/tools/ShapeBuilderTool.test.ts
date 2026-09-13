import { addNode, createDocument, makeShapeNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { ShapeBuilderTool } from './ShapeBuilderTool';
import type { ToolContext } from './types';

const identity = [1, 0, 0, 1, 0, 0] as const;

function makeDocument() {
  let document = createDocument('shape-builder-tool', true);
  document = addNode(
    document,
    makeShapeNode('left', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }, { transform: identity }),
  );
  document = addNode(
    document,
    makeShapeNode('right', { kind: 'rect', x: 50, y: 0, w: 100, h: 100 }, { transform: identity }),
  );
  return document;
}

function pointer(
  clientX: number,
  pointerId: number,
  pointerType: string,
  modifiers: Partial<Pick<PointerEvent, 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>> = {},
): PointerEvent {
  return {
    button: 0,
    buttons: 1,
    clientX,
    clientY: 50,
    pointerId,
    pointerType,
    ...modifiers,
  } as PointerEvent;
}

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  const document = makeDocument();
  return {
    document,
    selection: ['left', 'right'],
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
    foregroundColor: [0, 0, 0, 255],
    snapEnabled: false,
    snapGrid: 8,
    createShapeAt: vi.fn(),
    createTextNodeAt: vi.fn(),
    setSelection: vi.fn(),
    toggleSelection: vi.fn(),
    isSelected: vi.fn(() => false),
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
    rootNodes: vi.fn(() => []),
    getNode: vi.fn(),
    canvasToWorld: (x, y) => ({ x, y }),
    worldToCanvas: (x, y) => ({ x, y }),
    canvasDeltaToWorld: (dx, dy) => ({ dx, dy }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    findContainingFrame: vi.fn(() => null),
    nodeWorldBounds: vi.fn(() => null),
    hitTest: vi.fn(() => null),
    canvasElement: null,
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    abortTransaction: vi.fn(),
    setTool: vi.fn(),
    nodeEditTargetId: null,
    setNodeEditTargetId: vi.fn(),
    setNodeEditSelectedAnchors: vi.fn(),
    setTextEditTargetId: vi.fn(),
    snapPosition: vi.fn((bounds) => ({ x: bounds.x, y: bounds.y, guides: [] })),
    ...overrides,
  };
}

function latestDraft(ctx: ToolContext) {
  const setDraft = ctx.setDraft as ReturnType<typeof vi.fn>;
  return setDraft.mock.calls.at(-1)?.[0] as { selectedFaceIds: readonly string[] };
}

describe('ShapeBuilderTool', () => {
  it('uses the touch multi-select toggle for tap-to-toggle region selection', () => {
    const ctx = context({ touchMultiSelect: { active: true, suspended: false } });
    const tool = new ShapeBuilderTool();
    tool.onActivate(ctx);

    tool.onPointerDown(pointer(25, 1, 'touch'), ctx);
    tool.onPointerUp(pointer(25, 1, 'touch'), ctx);
    const first = latestDraft(ctx);
    expect(first.selectedFaceIds).toHaveLength(1);

    tool.onPointerDown(pointer(75, 2, 'touch'), ctx);
    tool.onPointerUp(pointer(75, 2, 'touch'), ctx);
    const second = latestDraft(ctx);
    expect(second.selectedFaceIds).toHaveLength(2);

    tool.onPointerDown(pointer(75, 3, 'touch'), ctx);
    tool.onPointerUp(pointer(75, 3, 'touch'), ctx);
    expect(latestDraft(ctx).selectedFaceIds).toEqual(first.selectedFaceIds);
  });

  it('restores the staged region set when a pointer gesture is canceled', () => {
    const ctx = context();
    const tool = new ShapeBuilderTool();
    tool.onActivate(ctx);
    tool.onPointerDown(pointer(25, 1, 'mouse'), ctx);
    tool.onPointerUp(pointer(25, 1, 'mouse'), ctx);
    const before = [...latestDraft(ctx).selectedFaceIds];

    tool.onPointerDown(pointer(75, 2, 'mouse'), ctx);
    tool.onPointerCancel(pointer(75, 2, 'mouse'), ctx);
    expect(latestDraft(ctx).selectedFaceIds).toEqual(before);
  });
});
