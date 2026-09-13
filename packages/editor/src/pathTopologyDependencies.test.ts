import type { Document, SceneNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { findPathTopologyDependency, pathTopologyBlockMessage } from './pathTopologyDependencies';

function documentWith(nodes: Record<string, SceneNode>, extra: Record<string, unknown> = {}) {
  return {
    nodes,
    components: {},
    rootChildren: Object.keys(nodes),
    nextId: Object.keys(nodes).length + 1,
    ...extra,
  } as unknown as Document;
}

const pathNode = (id = 'path') =>
  ({
    id,
    kind: 'shape',
    shape: { kind: 'path', points: [], closed: true },
  }) as unknown as SceneNode;

describe('findPathTopologyDependency', () => {
  it('protects text-on-path references', () => {
    const dependency = findPathTopologyDependency(
      documentWith({
        path: pathNode(),
        text: { id: 'text', kind: 'text', pathId: 'path' } as unknown as SceneNode,
      }),
      'path',
    );
    expect(dependency).toMatchObject({ ownerId: 'text', reason: 'text-on-path' });
    expect(pathTopologyBlockMessage(dependency!)).toContain('Detach or convert');
  });

  it('protects motion and mask references', () => {
    const motionDependency = findPathTopologyDependency(
      documentWith({ path: pathNode() }, { timelines: { main: { tracks: [{ nodeId: 'path' }] } } }),
      'path',
    );
    expect(motionDependency?.reason).toBe('timeline or motion-path data');

    const maskDependency = findPathTopologyDependency(
      documentWith({
        path: pathNode(),
        image: {
          id: 'image',
          kind: 'shape',
          mask: { sourceNodeId: 'path' },
        } as unknown as SceneNode,
      }),
      'path',
    );
    expect(maskDependency?.reason).toBe('mask or clipping relationship');
  });

  it('allows an unreferenced editable path', () => {
    expect(findPathTopologyDependency(documentWith({ path: pathNode() }), 'path')).toBeNull();
  });
});
