/**
 * CropTool tests — activation, Esc cancel, Enter commit.
 */
import { createDocument, makeImageShapeNode, makeShapeNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { CropTool } from '../CropTool';

function makeCtx(overrides: Record<string, unknown> = {}) {
  const doc = createDocument('t', true);
  const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA', w: 200, h: 100 });
  doc.nodes[img.id] = img;
  doc.rootChildren = [img.id];
  return {
    document: doc,
    selection: [img.id],
    zoom: 1,
    pan: { x: 0, y: 0 },
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerType: 'mouse' as const,
    pointerPressure: 0,
    snapEnabled: false,
    snapGrid: 8,
    isolatedNodeId: null,
    setTool: vi.fn(),
    announce: vi.fn(),
    getNode: (id: string) => doc.nodes[id],
    setSelection: vi.fn(),
    ...overrides,
  };
}

describe('CropTool', () => {
  it('initializes crop rect to full image on activate', () => {
    const tool = new CropTool();
    const ctx = makeCtx();
    tool.onActivate(ctx as never);
    expect(tool.getCropRect()).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(tool.getNodeId()).toBe('i1');
  });

  it('uses the placement default for legacy image fills without a fit mode', () => {
    const tool = new CropTool();
    const ctx = makeCtx();
    const node = ctx.document.nodes.i1;
    if (node?.kind !== 'shape') throw new Error('expected image shape');
    const image = node.fills?.[0]?.image;
    if (!image) throw new Error('expected image fill');
    const legacyImage: Partial<typeof image> = { ...image };
    delete legacyImage.fit;
    ctx.document.nodes.i1 = {
      ...node,
      fills: [{ ...node.fills![0]!, image: legacyImage as typeof image }],
    };

    tool.onActivate(ctx as never);

    expect(tool.getCropState()?.fillFit).toBe('fill');
  });

  it('re-enters an existing crop using the rendered fill placement', () => {
    const ctx = makeCtx();
    const node = ctx.document.nodes.i1;
    if (node?.kind !== 'shape') throw new Error('expected shape');
    const image = node.fills?.[0]?.image;
    if (!image) throw new Error('expected image fill');
    ctx.document.nodes.i1 = {
      ...node,
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
      fills: [
        {
          ...node.fills![0]!,
          image: {
            ...image,
            fit: 'fill',
            imageWidth: 400,
            imageHeight: 200,
            crop: { x: 100, y: 0, w: 100, h: 200 },
          },
        },
      ],
    };

    const tool = new CropTool();
    tool.onActivate(ctx as never);
    expect(tool.getCropRect()?.x).toBeCloseTo(0);
    expect(tool.getCropRect()?.y).toBeCloseTo(0);
    expect(tool.getCropRect()?.w).toBeCloseTo(50);
    expect(tool.getCropRect()?.h).toBeCloseTo(100);
  });

  it('Esc returns to select without commit', () => {
    const tool = new CropTool();
    const commit = vi.fn();
    tool.setCommitHandler(commit);
    const ctx = makeCtx();
    tool.onActivate(ctx as never);
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }), ctx as never);
    expect(ctx.setTool).toHaveBeenCalledWith('select');
    expect(commit).not.toHaveBeenCalled();
  });

  it('Enter commits crop state and returns to select', () => {
    const tool = new CropTool();
    const commit = vi.fn();
    tool.setCommitHandler(commit);
    const ctx = makeCtx();
    tool.onActivate(ctx as never);
    tool.setCropRect({ x: 10, y: 10, w: 80, h: 40 });
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }), ctx as never);
    expect(commit).toHaveBeenCalled();
    const called = commit.mock.calls[0]![0]!;
    expect(called.viewport).toEqual({ x: 10, y: 10, w: 80, h: 40 });
    expect(ctx.setTool).toHaveBeenCalledWith('select');
  });

  it('activates select when selection is empty', () => {
    const tool = new CropTool();
    const ctx = makeCtx({ selection: [] });
    tool.onActivate(ctx as never);
    expect(ctx.setTool).toHaveBeenCalledWith('select');
  });

  it('rejects multi-selection', () => {
    const tool = new CropTool();
    const ctx = makeCtx({ selection: ['i1', 'i2'] });
    tool.onActivate(ctx as never);
    expect(ctx.setTool).toHaveBeenCalledWith('select');
    expect(tool.getCropState()).toBeNull();
  });

  it('rejects a shape without an image fill', () => {
    const tool = new CropTool();
    const doc = createDocument('t', true);
    const rect = makeShapeNode('r1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 });
    doc.nodes.r1 = rect;
    doc.rootChildren = ['r1'];
    const ctx = makeCtx({
      document: doc,
      selection: ['r1'],
      getNode: (id: string) => doc.nodes[id],
    });
    tool.onActivate(ctx as never);
    expect(ctx.setTool).toHaveBeenCalledWith('select');
    expect(tool.getCropState()).toBeNull();
  });

  it('wheel zoom adjusts fill scale', () => {
    const tool = new CropTool();
    const ctx = makeCtx();
    tool.onActivate(ctx as never);
    const initial = tool.getCropState()!.fillScale;
    tool.setFillScale(initial! * 0.9);
    expect(tool.getCropState()!.fillScale).toBeCloseTo(initial! * 0.9);
  });

  it('cycleFitMode cycles through FIT_CYCLE', () => {
    const tool = new CropTool();
    const ctx = makeCtx();
    tool.onActivate(ctx as never);
    const f0 = tool.getCropState()!.fillFit;
    tool.cycleFitMode();
    expect(tool.getCropState()!.fillFit).not.toBe(f0);
  });

  it('nudges the crop window by one pixel with plain arrows and ten with Shift', () => {
    const tool = new CropTool();
    const ctx = makeCtx();
    tool.onActivate(ctx as never);
    tool.setCropRect({ x: 20, y: 20, w: 100, h: 50 });

    expect(tool.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }), ctx as never)).toBe(
      true,
    );
    expect(tool.getCropRect()).toEqual({ x: 21, y: 20, w: 100, h: 50 });

    tool.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true }),
      ctx as never,
    );
    expect(tool.getCropRect()).toEqual({ x: 21, y: 30, w: 100, h: 50 });
  });

  it('pans image content with Alt+arrows using fine and Shift-modified increments', () => {
    const tool = new CropTool();
    const ctx = makeCtx();
    tool.onActivate(ctx as never);

    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true }), ctx as never);
    expect(tool.getCropState()?.fillOffsetX).toBe(-1);

    tool.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, shiftKey: true }),
      ctx as never,
    );
    expect(tool.getCropState()?.fillOffsetY).toBe(-10);
  });

  it('sets absolute content offsets and rejects non-finite values', () => {
    const tool = new CropTool();
    const ctx = makeCtx();
    tool.onActivate(ctx as never);
    tool.setFillOffset(12, -8);
    expect(tool.getCropState()?.fillOffsetX).toBe(12);
    expect(tool.getCropState()?.fillOffsetY).toBe(-8);
    tool.setFillOffset(Number.NaN, 4);
    expect(tool.getCropState()?.fillOffsetX).toBe(12);
    expect(tool.getCropState()?.fillOffsetY).toBe(-8);
  });

  it('activates on ellipse shape with image fill', () => {
    const tool = new CropTool();
    const doc = createDocument('t', true);
    const img = makeImageShapeNode('e1', { src: 'data:image/png;base64,AA', w: 200, h: 100 });
    const ellipseNode = {
      ...img,
      shape: { kind: 'ellipse' as const, cx: 100, cy: 50, rx: 100, ry: 50 },
    };
    doc.nodes.e1 = ellipseNode;
    doc.rootChildren = ['e1'];
    const ctx = makeCtx({
      selection: ['e1'],
      document: doc,
      getNode: (id: string) => doc.nodes[id],
    });
    tool.onActivate(ctx as never);
    expect(tool.getNodeId()).toBe('e1');
    expect(tool.getCropRect()).toBeDefined();
  });
});
