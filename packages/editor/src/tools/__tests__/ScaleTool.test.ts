import { multiplyAffine, rotateDeg, decomposeAffine } from '@strata/shared';
import type { Affine } from '@strata/engine';
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
      setDraft: vi.fn(),
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

  it('preserves rotation when scaling a rotated node', () => {
    const tool = new ScaleTool();
    const rotDeg = 45;
    const rotRad = (rotDeg * Math.PI) / 180;
    const rotationMatrix = rotateDeg(rotDeg);
    const translateMatrix: Affine = [1, 0, 0, 1, 100, 50];
    const composedTransform = multiplyAffine(translateMatrix, rotationMatrix);
    const node = {
      id: 'node1',
      kind: 'shape' as const,
      name: 'Rotated Rect',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: rotDeg,
      fill: [57, 208, 198, 255] as [number, number, number, number],
      strokes: [] as [],
      effects: [] as [],
      transform: composedTransform,
      shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    };

    const ctx = {
      selection: ['node1'],
      shiftKey: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      getNode: vi.fn().mockReturnValue(node),
      nodeWorldBounds: vi.fn().mockReturnValue({ x: 100, y: 50, w: 100, h: 80 }),
      updateNode: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    } as any;

    // Simulate drag start at (160, 110) relative to canvas
    tool.onPointerDown({ clientX: 160, clientY: 110, pointerId: 1 } as any, ctx);

    // The node's world centroid is at (150, 90):
    //   bbox = { x: 100, y: 50, w: 100, h: 80 }
    //   centroid = (100+50, 50+40) = (150, 90)
    // Initial pointer at (160, 110) → initialDist = √(10²+20²) ≈ 22.36
    // Drag to (170, 130) → currentDist = √(20²+40²) ≈ 44.72 → scale ≈ 2
    (tool as any).drag.currentWorld = { x: 170, y: 130 };
    (tool as any).onDragMove?.(ctx);

    expect(ctx.updateNode).toHaveBeenCalled();
    const updateFn = ctx.updateNode.mock.calls[0][1];
    const updated = updateFn(node);
    const decomposed = decomposeAffine(updated.transform as Affine);
    expect(decomposed).not.toBeNull();
    expect(decomposed!.rotation).toBeCloseTo(rotRad, 1);
    expect(decomposed!.scale).toBeCloseTo(2, 1);
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
      setDraft: vi.fn(),
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
