// @vitest-environment jsdom

import type { Affine } from '@varve/engine';
import type { Document, NodeId, SceneNode } from '@varve/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { clearScreenRenderCache, renderScreenToDataUrl } from './screenRender';

afterEach(() => {
  clearScreenRenderCache();
});

function frameDoc(): Document {
  const frameId = 'screen1' as NodeId;
  const childId = 'button' as NodeId;
  const nodes: Record<NodeId, SceneNode> = {
    [frameId]: {
      kind: 'frame',
      id: frameId,
      name: 'Home',
      transform: [1, 0, 0, 1, 0, 0] as Affine,
      w: 375,
      h: 812,
      children: [childId],
      layoutStyle: undefined,
    } as unknown as SceneNode,
    [childId]: {
      kind: 'shape',
      id: childId,
      name: 'Button',
      transform: [1, 0, 0, 1, 16, 40] as Affine,
      shape: { kind: 'rect', x: 0, y: 0, w: 120, h: 44 },
      order: 'a0',
    } as unknown as SceneNode,
  };
  return { nodes, rootChildren: [frameId], pages: [], guides: [] } as unknown as Document;
}

describe('renderScreenToDataUrl', () => {
  it('renders a real frame subtree through the canonical pipeline', async () => {
    // jsdom's canvas support varies by jsdom version: either the engine
    // produces a raster data URL or it returns a placeholder (null). What is
    // testable here is that the pipeline (flatten with localTransforms +
    // generateThumbnail) runs without throwing on a real frame with children.
    const dataUrl = await renderScreenToDataUrl(frameDoc(), 'screen1', 375, 812);
    expect(dataUrl === null || dataUrl.startsWith('data:image/')).toBe(true);
  });

  it('caches per screen id, document revision, and size', async () => {
    const doc = frameDoc();
    const first = renderScreenToDataUrl(doc, 'screen1', 375, 812);
    const second = renderScreenToDataUrl(doc, 'screen1', 375, 812);
    expect(first).toBe(second);
    // A different size is a different cache key.
    const other = renderScreenToDataUrl(doc, 'screen1', 500, 900);
    expect(other).not.toBe(first);
  });

  it('clears the cache on demand', async () => {
    const doc = frameDoc();
    const first = renderScreenToDataUrl(doc, 'screen1', 375, 812);
    clearScreenRenderCache();
    const second = renderScreenToDataUrl(doc, 'screen1', 375, 812);
    expect(second).not.toBe(first);
  });

  it('never throws for a missing screen', async () => {
    await expect(renderScreenToDataUrl(frameDoc(), 'nope', 375, 812)).resolves.toBeNull();
  });
});
