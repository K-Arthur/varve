import { describe, expect, it, vi } from 'vitest';
import { ScaleTool } from '../ScaleTool';

describe('ScaleTool', () => {
  it('computes scale factor from distance ratio', () => {
    const tool = new ScaleTool();
    const node = {
      id: 'node1',
      kind: 'shape' as const,
      name: 'Rect',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: 0,
      fill: [57, 208, 198, 255] as [number, number, number, number],
      strokes: [] as [],
      effects: [] as [],
      transform: [1, 0, 0, 1, 100, 100] as [number, number, number, number, number, number],
      shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    };

    const ctx = {
      selection: ['node1'],
      shiftKey: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      getNode: vi.fn().mockReturnValue(node),
      nodeWorldBounds: vi.fn().mockReturnValue({ x: 100, y: 100, w: 100, h: 80 }),
      updateNode: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    } as any;

    // Simulate drag start — onPointerDown initialises scale state
    tool.onPointerDown({ clientX: 150, clientY: 140, pointerId: 1 } as any, ctx);

    // After drag threshold, simulate drag move
    (tool as any).drag.currentWorld = { x: 200, y: 190 };
    (tool as any).onDragMove?.(ctx);

    expect(ctx.updateNode).toHaveBeenCalled();
    const updateFn = ctx.updateNode.mock.calls[0][1];
    const updated = updateFn(node);
    expect(updated.transform[0]).not.toBe(1);
    expect(updated.transform[0]).toBeGreaterThan(0);
  });

  it('clamps scale to minimum 0.01', () => {
    const tool = new ScaleTool();
    const node = {
      id: 'node1',
      kind: 'shape' as const,
      name: 'Rect',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: 0,
      fill: [57, 208, 198, 255] as [number, number, number, number],
      strokes: [] as [],
      effects: [] as [],
      transform: [1, 0, 0, 1, 100, 100] as [number, number, number, number, number, number],
      shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    };

    const ctx = {
      selection: ['node1'],
      shiftKey: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      getNode: vi.fn().mockReturnValue(node),
      nodeWorldBounds: vi.fn().mockReturnValue({ x: 100, y: 100, w: 100, h: 80 }),
      updateNode: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    } as any;

    tool.onPointerDown({ clientX: 150, clientY: 140, pointerId: 1 } as any, ctx);

    // Drag very close to centroid (should produce tiny scale)
    (tool as any).drag.currentWorld = { x: 100, y: 100 };
    (tool as any).onDragMove?.(ctx);

    expect(ctx.updateNode).toHaveBeenCalled();
    const updateFn = ctx.updateNode.mock.calls[0][1];
    const updated = updateFn(node);
    expect(updated.transform[0]).toBeGreaterThanOrEqual(0.01);
  });
});
