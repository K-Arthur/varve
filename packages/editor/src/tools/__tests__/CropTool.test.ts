/**
 * CropTool tests — activation, Esc cancel, Enter commit.
 */
import { createDocument, makeImageShapeNode } from '@strata/scene';
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

  it('Enter commits crop and returns to select', () => {
    const tool = new CropTool();
    const commit = vi.fn();
    tool.setCommitHandler(commit);
    const ctx = makeCtx();
    tool.onActivate(ctx as never);
    tool.setCropRect({ x: 10, y: 10, w: 80, h: 40 });
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }), ctx as never);
    expect(commit).toHaveBeenCalledWith({ x: 10, y: 10, w: 80, h: 40 });
    expect(ctx.setTool).toHaveBeenCalledWith('select');
  });

  it('activates select when selection is empty', () => {
    const tool = new CropTool();
    const ctx = makeCtx({ selection: [] });
    tool.onActivate(ctx as never);
    expect(ctx.setTool).toHaveBeenCalledWith('select');
  });
});
