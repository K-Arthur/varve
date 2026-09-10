import { createDocument, makeImageShapeNode } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { PerspectiveTool } from '../PerspectiveTool';
import type { ToolContext } from '../types';

function makeContext() {
  const document = createDocument('perspective-test', true);
  const image = makeImageShapeNode('image', {
    src: 'data:image/png;base64,AA',
    w: 200,
    h: 100,
  });
  document.nodes[image.id] = image;
  document.rootChildren = [image.id];
  return {
    document,
    selection: [image.id],
    getNode: (id: string) => document.nodes[id],
    setTool: vi.fn(),
    announce: vi.fn(),
  } as unknown as ToolContext;
}

describe('PerspectiveTool', () => {
  it('initializes an editable quad and publishes state changes', () => {
    const tool = new PerspectiveTool();
    const context = makeContext();
    const listener = vi.fn();
    tool.subscribe(listener);

    tool.onActivate(context);

    expect(tool.current?.quad).toEqual([
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
    ]);
    expect(listener).toHaveBeenCalledTimes(1);

    tool.setCorner(1, 220, 8);
    expect(tool.current?.quad[1]).toEqual([220, 8]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('rejects a crossed corner update instead of storing invalid geometry', () => {
    const tool = new PerspectiveTool();
    const context = makeContext();
    tool.onActivate(context);
    const before = tool.current?.quad;

    tool.setCorner(1, 0, 100);

    expect(tool.current?.quad).toEqual(before);
  });

  it('commits once and handles keyboard events in ToolManager order', () => {
    const tool = new PerspectiveTool();
    const context = makeContext();
    const commit = vi.fn();
    tool.setCommitHandler(commit);
    tool.onActivate(context);
    tool.setCorner(2, 220, 120);

    expect(tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }), context)).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(context.setTool).toHaveBeenCalledWith('select');
  });

  it('restores the activation snapshot without touching the document', () => {
    const tool = new PerspectiveTool();
    const context = makeContext();
    tool.onActivate(context);
    const original = tool.current?.quad;
    tool.setCorner(1, 240, 20);
    tool.restoreOriginal();

    expect(tool.current?.quad).toEqual(original);
  });
});
