import { describe, expect, it } from 'vitest';
import { createDocument, makeGroupNode, makeShapeNode, makeTextNode } from './document';
import { addMask, canBeClipMaskSource, canBeMatteSource, resolveMask } from './masks';

describe('live matte sources', () => {
  it('allows editable text as an external alpha matte without widening clip eligibility', () => {
    const group = makeGroupNode('group', { children: ['target'] });
    const target = makeShapeNode('target', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const text = makeTextNode('text', 'VARVE', { w: 200, h: 80 });
    const doc = {
      ...createDocument('live matte'),
      rootChildren: ['group', 'text'],
      nodes: { group, target, text },
    };

    expect(canBeClipMaskSource(text)).toBe(false);
    expect(canBeMatteSource(text)).toBe(true);
    const masked = addMask(doc, 'group', undefined, 'alpha', {
      matteSource: { kind: 'scene-node', nodeId: 'text' },
      hideMaskSource: true,
    });
    expect(resolveMask(masked.nodes.group!, masked)).toMatchObject({
      type: 'alpha',
      matteSource: { kind: 'scene-node', nodeId: 'text' },
    });
  });

  it('allows a group to be a live luminance matte while retaining its children', () => {
    const matteGroup = makeGroupNode('matte-group', { children: ['matte-shape'] });
    const matteShape = makeShapeNode('matte-shape', {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 80,
      h: 80,
    });
    const targetShape = makeShapeNode('target-shape', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const target = makeGroupNode('target', { children: ['target-shape'] });
    const doc = {
      ...createDocument('group matte'),
      rootChildren: ['matte-group', 'target'],
      nodes: {
        'matte-group': matteGroup,
        'matte-shape': matteShape,
        target,
        'target-shape': targetShape,
      },
    };
    const masked = addMask(doc, 'target', undefined, 'luminance', {
      matteSource: { kind: 'scene-node', nodeId: 'matte-group' },
    });
    expect(masked.nodes.target?.mask?.matteSource).toEqual({
      kind: 'scene-node',
      nodeId: 'matte-group',
    });
  });
});
