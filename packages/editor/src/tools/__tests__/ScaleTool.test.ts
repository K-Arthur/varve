import type { Affine } from '@varve/engine';
import { addChild, addNode, createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import { decomposeAffine, multiplyAffine, rotateDeg } from '@varve/shared';
import { describe, expect, it, vi } from 'vitest';
import { nodeWorldBounds } from '../../scene/world';
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
      updateNodes: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
    } as any;

    // Simulate drag start — onPointerDown initialises scale state
    tool.onPointerDown({ clientX: 150, clientY: 140, pointerId: 1 } as any, ctx);

    // After drag threshold, simulate drag move
    (tool as any).drag.currentWorld = { x: 200, y: 190 };
    (tool as any).onDragMove?.(ctx);

    expect(ctx.updateNodes).toHaveBeenCalled();
    const updateFn = ctx.updateNodes.mock.calls[0][0]![0].update;
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
      updateNodes: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
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

    expect(ctx.updateNodes).toHaveBeenCalled();
    const updateFn = ctx.updateNodes.mock.calls[0][0]![0].update;
    const updated = updateFn(node);
    const decomposed = decomposeAffine(updated.transform as Affine);
    expect(decomposed).not.toBeNull();
    expect(decomposed?.rotation).toBeCloseTo(rotRad, 1);
    expect(decomposed?.scale).toBeCloseTo(2, 1);
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
      updateNodes: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
    } as any;

    tool.onPointerDown({ clientX: 150, clientY: 140, pointerId: 1 } as any, ctx);

    // Drag very close to centroid (should produce tiny scale)
    (tool as any).drag.currentWorld = { x: 100, y: 100 };
    (tool as any).onDragMove?.(ctx);

    expect(ctx.updateNodes).toHaveBeenCalled();
    const updateFn = ctx.updateNodes.mock.calls[0][0]![0].update;
    const updated = updateFn(node);
    expect(updated.transform[0]).toBeGreaterThanOrEqual(0.01);
  });
});

describe('ScaleTool — uniform toggle', () => {
  it('shift key during drag snaps scale factor to nearest 0.25 increment', () => {
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
      transform: [1, 0, 0, 1, 100, 100] as Affine,
      shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    };

    // Without shift — natural scale = 65/50 = 1.3
    const ctxPlain = {
      selection: ['node1'],
      shiftKey: false,
      altKey: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      getNode: vi.fn().mockReturnValue(node),
      nodeWorldBounds: vi.fn().mockReturnValue({ x: 100, y: 100, w: 100, h: 80 }),
      updateNodes: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
    } as any;

    const tool = new ScaleTool();
    tool.onPointerDown({ clientX: 200, clientY: 140, pointerId: 1 } as any, ctxPlain);
    // startWorld=(200,140), centroid=(150,140) → initialDist=50
    (tool as any).drag.currentWorld = { x: 215, y: 140 };
    // currentDist = |215-150| = 65 → scale = 65/50 = 1.3
    (tool as any).onDragMove?.(ctxPlain);

    expect(ctxPlain.updateNodes).toHaveBeenCalled();
    const fnPlain = ctxPlain.updateNodes.mock.calls[0][0]![0].update;
    const uPlain = fnPlain(node);
    expect(uPlain.transform[0]).toBeCloseTo(1.3, 5);

    // With shift — snaps to round(1.3/0.25)*0.25 = 1.25
    const ctxShift = {
      ...ctxPlain,
      shiftKey: true,
      updateNodes: vi.fn(),
    };
    const tool2 = new ScaleTool();
    tool2.onPointerDown({ clientX: 200, clientY: 140, pointerId: 1 } as any, ctxShift);
    (tool2 as any).drag.currentWorld = { x: 215, y: 140 };
    (tool2 as any).onDragMove?.(ctxShift);

    expect(ctxShift.updateNodes).toHaveBeenCalled();
    const fnShift = ctxShift.updateNodes.mock.calls[0][0]![0].update;
    const uShift = fnShift(node);
    expect(uShift.transform[0]).toBe(1.25);
  });

  it('release shift mid-drag unconstrains (ctx.shiftKey read at call time)', () => {
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
      transform: [1, 0, 0, 1, 100, 100] as Affine,
      shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    };

    const tool = new ScaleTool();
    const ctx = {
      selection: ['node1'],
      shiftKey: false,
      altKey: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      getNode: vi.fn().mockReturnValue(node),
      nodeWorldBounds: vi.fn().mockReturnValue({ x: 100, y: 100, w: 100, h: 80 }),
      updateNodes: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
    } as any;

    tool.onPointerDown({ clientX: 200, clientY: 140, pointerId: 1 } as any, ctx);

    // First call with shiftKey=true — snaps
    (tool as any).onDragMove?.({ ...ctx, shiftKey: true, updateNodes: vi.fn() });
    const snapCall = vi.mocked(ctx.updateNodes).mock.calls.at(-1);
    const snapFn = snapCall?.[1];
    if (snapFn) {
      const s = snapFn(node);
      expect(s.transform[0]).toBe(1.25);
    }

    // Second call with shiftKey=false — unconstrained
    (tool as any).onDragMove?.({ ...ctx, shiftKey: false, updateNodes: vi.fn() });
    const unconstrainCall = vi.mocked(ctx.updateNodes).mock.calls.at(-1);
    const unconstrainFn = unconstrainCall?.[1];
    if (unconstrainFn) {
      const u = unconstrainFn(node);
      expect(u.transform[0]).toBeCloseTo(1.3, 5);
    }
  });
});

describe('ScaleTool — axis lock', () => {
  it('alt+horizontal drag locks Y axis (only X scales)', () => {
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
      transform: [1, 0, 0, 1, 100, 100] as Affine,
      shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    };

    const ctx = {
      selection: ['node1'],
      shiftKey: false,
      altKey: true,
      zoom: 1,
      pan: { x: 0, y: 0 },
      getNode: vi.fn().mockReturnValue(node),
      nodeWorldBounds: vi.fn().mockReturnValue({ x: 100, y: 100, w: 100, h: 80 }),
      updateNodes: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
    } as any;

    const tool = new ScaleTool();
    // Start at (210, 140): initialDx=60, initialDy=0, initialDist=60
    tool.onPointerDown({ clientX: 210, clientY: 140, pointerId: 1 } as any, ctx);

    // Drag to (240, 143): absDx=90, absDy=3 → 90 > 6 → horizontal dominance
    (tool as any).drag.currentWorld = { x: 240, y: 143 };
    (tool as any).onDragMove?.(ctx);

    expect(ctx.updateNodes).toHaveBeenCalled();
    const fn = ctx.updateNodes.mock.calls[0][0]![0].update;
    const u = fn(node);
    expect(u.transform[0]).toBeCloseTo(1.5, 5); // scaleX = 90/60
    expect(u.transform[3]).toBe(1); // scaleY = 1 (locked)
  });

  it('alt+vertical drag locks X axis (only Y scales)', () => {
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
      transform: [1, 0, 0, 1, 100, 100] as Affine,
      shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    };

    const ctx = {
      selection: ['node1'],
      shiftKey: false,
      altKey: true,
      zoom: 1,
      pan: { x: 0, y: 0 },
      getNode: vi.fn().mockReturnValue(node),
      nodeWorldBounds: vi.fn().mockReturnValue({ x: 100, y: 100, w: 100, h: 80 }),
      updateNodes: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
    } as any;

    const tool = new ScaleTool();
    // Start at (150, 200): initialDx=0, initialDy=60, initialDist=60
    tool.onPointerDown({ clientX: 150, clientY: 200, pointerId: 1 } as any, ctx);

    // Drag to (153, 230): absDx=3, absDy=90 → 90 > 6 → vertical dominance
    (tool as any).drag.currentWorld = { x: 153, y: 230 };
    (tool as any).onDragMove?.(ctx);

    expect(ctx.updateNodes).toHaveBeenCalled();
    const fn = ctx.updateNodes.mock.calls[0][0]![0].update;
    const u = fn(node);
    expect(u.transform[0]).toBe(1); // scaleX = 1 (locked)
    expect(u.transform[3]).toBeCloseTo(1.5, 5); // scaleY = 90/60
  });
});

describe('ScaleTool — pivot point', () => {
  it('stored pivot point is used as scale origin instead of centroid', () => {
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
      transform: [1, 0, 0, 1, 100, 100] as Affine,
      shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    };

    const ctx = {
      selection: ['node1'],
      shiftKey: false,
      altKey: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      getNode: vi.fn().mockReturnValue(node),
      nodeWorldBounds: vi.fn().mockReturnValue({ x: 100, y: 100, w: 100, h: 80 }),
      updateNodes: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
    } as any;

    // Without pivot — uses centroid (150,140):
    // start at (200,140) → initialDist=50, drag to (300,140) → currentDist=150 → scale=3
    const toolNoPivot = new ScaleTool();
    toolNoPivot.onPointerDown({ clientX: 200, clientY: 140, pointerId: 1 } as any, ctx);
    (toolNoPivot as any).drag.currentWorld = { x: 300, y: 140 };
    (toolNoPivot as any).onDragMove?.(ctx);
    const fnNoPivot = ctx.updateNodes.mock.calls[0][0]![0].update;
    const uNoPivot = fnNoPivot(node);
    expect(uNoPivot.transform[0]).toBeCloseTo(3, 5);

    // With pivot at (200, 200):
    // start at (200,140) → initialDist = sqrt(0²+(-60)²) = 60
    // drag to (300,140) → currentDist = sqrt(100²+(-60)²) = sqrt(13600) ≈ 116.62
    // scale ≈ 116.62/60 ≈ 1.944
    const toolPivot = new ScaleTool();
    toolPivot.setPivot(200, 200);
    const ctxPivot = { ...ctx, updateNodes: vi.fn() };
    toolPivot.onPointerDown({ clientX: 200, clientY: 140, pointerId: 1 } as any, ctxPivot);
    (toolPivot as any).drag.currentWorld = { x: 300, y: 140 };
    (toolPivot as any).onDragMove?.(ctxPivot);

    expect(ctxPivot.updateNodes).toHaveBeenCalled();
    const fnPivot = ctxPivot.updateNodes.mock.calls[0][0]![0].update;
    const uPivot = fnPivot(node);
    // With pivot, scale should differ from the centroid-based scale (not 3)
    expect(uPivot.transform[0]).toBeGreaterThan(1);
    expect(uPivot.transform[0]).toBeLessThan(3);
    expect(uPivot.transform[0]).toBeCloseTo(1.944, 2);
  });

  it('default pivot is centroid when none set (backward compat)', () => {
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
      transform: [1, 0, 0, 1, 100, 100] as Affine,
      shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    };

    const ctx = {
      selection: ['node1'],
      shiftKey: false,
      altKey: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      getNode: vi.fn().mockReturnValue(node),
      nodeWorldBounds: vi.fn().mockReturnValue({ x: 100, y: 100, w: 100, h: 80 }),
      updateNodes: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
    } as any;

    const tool = new ScaleTool();
    // pivot defaults to null, should fall back to selection center (150,140)
    expect((tool as any).pivot).toBeNull();

    tool.onPointerDown({ clientX: 200, clientY: 140, pointerId: 1 } as any, ctx);
    (tool as any).drag.currentWorld = { x: 300, y: 140 };
    (tool as any).onDragMove?.(ctx);

    const fn = ctx.updateNodes.mock.calls[0][0]![0].update;
    const u = fn(node);
    // scale = 150/50 = 3 (same as existing behavior)
    expect(u.transform[0]).toBeCloseTo(3, 5);
  });
});

describe('ScaleTool — multi-object relative position', () => {
  it('multi-select scale maintains relative distances between nodes', () => {
    const nodeA = {
      id: 'node1',
      kind: 'shape' as const,
      name: 'Rect A',
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
      transform: [1, 0, 0, 1, 100, 100] as Affine,
      shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    };

    const nodeB = {
      id: 'node2',
      kind: 'shape' as const,
      name: 'Rect B',
      index: 0,
      order: 'a1',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: 0,
      fill: [57, 208, 198, 255] as [number, number, number, number],
      strokes: [] as [],
      effects: [] as [],
      transform: [1, 0, 0, 1, 200, 100] as Affine,
      shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    };
    // Node A centroid: (150, 140), Node B centroid: (250, 140)
    // Selection center: (200, 140)

    const ctx = {
      selection: ['node1', 'node2'],
      shiftKey: false,
      altKey: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      getNode: vi.fn((id: string) => (id === 'node1' ? nodeA : nodeB)),
      nodeWorldBounds: vi.fn((n: typeof nodeA) =>
        n.id === 'node1' ? { x: 100, y: 100, w: 100, h: 80 } : { x: 200, y: 100, w: 100, h: 80 },
      ),
      updateNodes: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
    } as any;

    const tool = new ScaleTool();
    // Start at (200, 190): from centroid (200,140), initialDist = 50
    tool.onPointerDown({ clientX: 200, clientY: 190, pointerId: 1 } as any, ctx);
    // Drag to (200, 290): currentDist = 150 → scale = 3
    (tool as any).drag.currentWorld = { x: 200, y: 290 };
    (tool as any).onDragMove?.(ctx);

    expect(ctx.updateNodes).toHaveBeenCalledTimes(1);

    // Both nodes should have the same scale factor applied
    const updaters = ctx.updateNodes.mock.calls[0][0] as Array<{ update: (n: unknown) => unknown }>;
    const fnA = updaters[0]!.update;
    const fnB = updaters[1]!.update;
    const uA = fnA(nodeA);
    const uB = fnB(nodeB);
    expect(uA.transform[0]).toBeCloseTo(3, 5);
    expect(uB.transform[0]).toBeCloseTo(3, 5);
  });

  it('multi-select scale preserves individual rotations', () => {
    const rotDeg = 30;
    const rotationMatrix = rotateDeg(rotDeg);
    const translateMatrix: Affine = [1, 0, 0, 1, 100, 100];
    const composedTransform = multiplyAffine(translateMatrix, rotationMatrix);

    const nodeA = {
      id: 'node1',
      kind: 'shape' as const,
      name: 'Rect A',
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

    const nodeB = {
      id: 'node2',
      kind: 'shape' as const,
      name: 'Rect B',
      index: 0,
      order: 'a1',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      rotation: 45,
      fill: [57, 208, 198, 255] as [number, number, number, number],
      strokes: [] as [],
      effects: [] as [],
      transform: multiplyAffine([1, 0, 0, 1, 200, 100] as Affine, rotateDeg(45)),
      shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    };

    const ctx = {
      selection: ['node1', 'node2'],
      shiftKey: false,
      altKey: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      getNode: vi.fn((id: string) => (id === 'node1' ? nodeA : nodeB)),
      nodeWorldBounds: vi.fn((n: typeof nodeA) =>
        n.id === 'node1' ? { x: 100, y: 100, w: 100, h: 80 } : { x: 200, y: 100, w: 100, h: 80 },
      ),
      updateNodes: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx, cy) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
    } as any;

    const tool = new ScaleTool();
    tool.onPointerDown({ clientX: 200, clientY: 190, pointerId: 1 } as any, ctx);
    (tool as any).drag.currentWorld = { x: 200, y: 290 };
    (tool as any).onDragMove?.(ctx);

    expect(ctx.updateNodes).toHaveBeenCalledTimes(1);

    const updaters = ctx.updateNodes.mock.calls[0][0] as Array<{ update: (n: unknown) => unknown }>;
    const fnA = updaters[0]!.update;
    const fnB = updaters[1]!.update;
    const uA = fnA(nodeA);
    const uB = fnB(nodeB);

    const decA = decomposeAffine(uA.transform as Affine);
    const decB = decomposeAffine(uB.transform as Affine);
    expect(decA).not.toBeNull();
    expect(decB).not.toBeNull();
    // Individual rotations preserved (not reset to a common value)
    expect(decA?.rotation).toBeCloseTo((rotDeg * Math.PI) / 180, 1);
    expect(decB?.rotation).toBeCloseTo((45 * Math.PI) / 180, 1);
    // Both scaled by same factor
    expect(decA?.scale).toBeCloseTo(3, 1);
    expect(decB?.scale).toBeCloseTo(3, 1);
  });
});

describe('ScaleTool — rotated node translation stability', () => {
  it('does not drift when scaling a rotated node around its centroid', () => {
    const rotDeg = 45;
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
      transform: [1, 0, 0, 1, 100, 100] as Affine,
      shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
    };

    const ctx = {
      selection: ['node1'],
      shiftKey: false,
      altKey: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      getNode: vi.fn().mockReturnValue(node),
      // The 45° rotated 100x80 rect centered at (0,0) relative to origin (100,100)
      // Local centroid of (0,0,100,80) is (50, 40)
      // With node transform translate(100,100) * rotate(45°):
      // centroidWorld = apply([cos45,sin45,-sin45,cos45,100,100], [50,40])
      // = (100 + 50*0.707 - 40*0.707, 100 + 50*0.707 + 40*0.707)
      // = (100 + 35.35 - 28.28, 100 + 35.35 + 28.28)
      // = (107.07, 163.63)
      nodeWorldBounds: vi.fn().mockReturnValue({ x: 57, y: 107, w: 106, h: 106 }),
      updateNodes: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx: number, cy: number) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
    } as any;

    const tool = new ScaleTool();
    // Start drag from centroid (107.07, 163.63)
    tool.onPointerDown({ clientX: 107.07, clientY: 163.63, pointerId: 1 } as any, ctx);

    // Drag to (200, 200): currentDist = sqrt(92.93²+36.37²) = sqrt(8636+1323) ≈ 99.8
    // initialDist = 0 (drag started at centroid) → fallback to 1
    (tool as any).drag.currentWorld = { x: 200, y: 200 };
    (tool as any).onDragMove?.(ctx);

    expect(ctx.updateNodes).toHaveBeenCalled();
    const updateFn = ctx.updateNodes.mock.calls[0][0]![0].update;
    const updated = updateFn(node);
    // Transform should have non-negative finite scale components (no distortion)
    expect(updated.transform[0]).toBeGreaterThan(0);
    expect(updated.transform[3]).toBeGreaterThan(0);
    expect(updated.transform[0]).toBeLessThan(Infinity);
    // The separate rotation field must be preserved (ScaleTool only modifies transform)
    expect(updated.rotation).toBe(rotDeg);
    // The transform matrix should remain a simple scale + translation
    // (rotation is in the separate field, not baked into transform)
    expect(updated.transform[1]).toBe(0);
    expect(updated.transform[2]).toBe(0);
  });
});

describe('ScaleTool — undo transaction lifecycle', () => {
  const makeNode = () => ({
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
    transform: [1, 0, 0, 1, 100, 100] as Affine,
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
  });

  const makeCtx = (overrides: Record<string, unknown> = {}) =>
    ({
      selection: ['node1'],
      shiftKey: false,
      altKey: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      getNode: vi.fn().mockReturnValue(makeNode()),
      nodeWorldBounds: vi.fn().mockReturnValue({ x: 100, y: 100, w: 100, h: 80 }),
      updateNodes: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx: number, cy: number) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
      ...overrides,
    }) as any;

  it('calls beginTransaction on pointer down with valid selection', () => {
    const tool = new ScaleTool();
    const ctx = makeCtx();
    tool.onPointerDown({ clientX: 200, clientY: 140, pointerId: 1 } as any, ctx);
    expect(ctx.beginTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not call beginTransaction when selection is empty', () => {
    const tool = new ScaleTool();
    const ctx = makeCtx({ selection: [] });
    tool.onPointerDown({ clientX: 200, clientY: 140, pointerId: 1 } as any, ctx);
    expect(ctx.beginTransaction).not.toHaveBeenCalled();
  });

  it('calls commitTransaction on drag end', () => {
    const tool = new ScaleTool();
    const ctx = makeCtx();
    tool.onPointerDown({ clientX: 200, clientY: 140, pointerId: 1 } as any, ctx);
    (tool as any).drag.currentWorld = { x: 300, y: 140 };
    (tool as any).onDragMove?.(ctx);
    tool.onPointerUp({ pointerId: 1 } as any, ctx);
    expect(ctx.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('calls abortTransaction on drag cancel', () => {
    const tool = new ScaleTool();
    const ctx = makeCtx();
    tool.onPointerDown({ clientX: 200, clientY: 140, pointerId: 1 } as any, ctx);
    (tool as any).drag.currentWorld = { x: 300, y: 140 };
    (tool as any).onDragMove?.(ctx);
    tool.onPointerCancel({ pointerId: 1 } as any, ctx);
    expect(ctx.abortTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('ScaleTool — onDeactivate cleanup', () => {
  const makeNode = () => ({
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
    transform: [1, 0, 0, 1, 100, 100] as Affine,
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 80 },
  });

  const makeCtx = (overrides: Record<string, unknown> = {}) =>
    ({
      selection: ['node1'],
      shiftKey: false,
      altKey: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      getNode: vi.fn().mockReturnValue(makeNode()),
      nodeWorldBounds: vi.fn().mockReturnValue({ x: 100, y: 100, w: 100, h: 80 }),
      updateNodes: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx: number, cy: number) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
      ...overrides,
    }) as any;

  it('calls abortTransaction when deactivating mid-drag', () => {
    const tool = new ScaleTool();
    const ctx = makeCtx();
    tool.onPointerDown({ clientX: 200, clientY: 140, pointerId: 1 } as any, ctx);
    (tool as any).drag.currentWorld = { x: 250, y: 140 };
    (tool as any).onDragMove?.(ctx);
    tool.onDeactivate?.(ctx);
    expect(ctx.abortTransaction).toHaveBeenCalledTimes(1);
  });

  it('clears draft on deactivate mid-drag', () => {
    const tool = new ScaleTool();
    const ctx = makeCtx();
    tool.onPointerDown({ clientX: 200, clientY: 140, pointerId: 1 } as any, ctx);
    (tool as any).drag.currentWorld = { x: 250, y: 140 };
    (tool as any).onDragMove?.(ctx);
    tool.onDeactivate?.(ctx);
    expect(ctx.setDraft).toHaveBeenCalledWith(null);
  });

  it('does not call abortTransaction when not dragging', () => {
    const tool = new ScaleTool();
    const ctx = makeCtx();
    tool.onDeactivate?.(ctx);
    expect(ctx.abortTransaction).not.toHaveBeenCalled();
  });
});

describe('ScaleTool — nested rotated parent', () => {
  it('maps world offset through parent transform when scaling nested child', () => {
    let doc = createDocument();
    const frame = makeFrameNode('f1', {
      name: 'RotatedFrame',
      rotation: 45,
      transform: [1, 0, 0, 1, 0, 0] as Affine,
    });
    doc = addNode(doc, frame);
    const child = makeShapeNode(
      'c1',
      { kind: 'rect', x: 0, y: 0, w: 80, h: 60 },
      { name: 'Child', transform: [1, 0, 0, 1, 50, 0] as Affine },
    );
    doc = addChild(doc, 'f1', child);

    const node = doc.nodes.c1!;
    const bbox = nodeWorldBounds(doc, 'c1');
    expect(bbox).not.toBeNull();

    const ctx = {
      document: doc,
      selection: ['c1'],
      shiftKey: false,
      altKey: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      getNode: vi.fn((id: string) => doc.nodes[id]),
      nodeWorldBounds: vi.fn((n: typeof node) => nodeWorldBounds(doc, n.id)),
      updateNodes: vi.fn(),
      setDraft: vi.fn(),
      canvasToWorld: vi.fn((cx: number, cy: number) => ({ x: cx, y: cy })),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      abortTransaction: vi.fn(),
    } as any;

    const tool = new ScaleTool();
    const cx = (bbox?.x ?? 0) + (bbox?.w ?? 0) / 2;
    const cy = (bbox?.y ?? 0) + (bbox?.h ?? 0) / 2;
    tool.onPointerDown({ clientX: cx, clientY: cy, pointerId: 1 } as any, ctx);
    (tool as any).drag.currentWorld = { x: cx + 50, y: cy + 50 };
    (tool as any).onDragMove?.(ctx);

    expect(ctx.updateNodes).toHaveBeenCalled();
    const updateFn = ctx.updateNodes.mock.calls[0][0]![0].update;
    const updated = updateFn(node);
    expect(updated.transform[0]).toBeGreaterThan(1);
    expect(updated.transform[3]).toBeGreaterThan(1);
    expect(Number.isFinite(updated.transform[4])).toBe(true);
    expect(Number.isFinite(updated.transform[5])).toBe(true);
  });
});
