import { getFontRegistry } from '@varve/engine';
import { createDocument, makeShapeNode, nextNodeId } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import * as spatialIndex from '../../scene/spatialIndex';
import { HitTestEngine } from '..';

vi.mock('../../scene/spatialIndex', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../scene/spatialIndex')>();
  return { ...original, buildSpatialIndex: vi.fn(original.buildSpatialIndex) };
});

describe('HitTestEngine font-dependent structure reuse', () => {
  it('rebuilds the spatial index after a font change, since text bounds follow font metrics', async () => {
    let doc = createDocument('fonts', true);
    const { id, doc: withId } = nextNodeId(doc);
    doc = {
      ...withId,
      nodes: {
        ...withId.nodes,
        [id]: makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      },
      rootChildren: [id],
    };
    const builds = vi.mocked(spatialIndex.buildSpatialIndex);
    builds.mockClear();

    new HitTestEngine(doc).hitTest({ x: 5, y: 5 });
    new HitTestEngine(doc).hitTest({ x: 5, y: 5 });
    expect(builds).toHaveBeenCalledTimes(1);

    getFontRegistry().register({
      family: 'Fluidity Test Face',
      weight: 400,
      style: 'normal',
      source: 'user',
    });
    new HitTestEngine(doc).hitTest({ x: 5, y: 5 });
    expect(builds).toHaveBeenCalledTimes(2);
  });
});
