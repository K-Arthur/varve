import { addChild, createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { buildSelectionContext, buildSelectionHierarchy } from './selectionContext';

describe('buildSelectionContext', () => {
  it('filters stale and duplicate IDs and repairs a stale primary', () => {
    const doc = createDocument('selection');
    const shape = makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });

    const next = addChild(doc, doc.pages?.[0]?.contentRoot ?? '', shape);
    const model = buildSelectionContext(next, ['missing', shape.id, shape.id], 'missing');

    expect(model.ids).toEqual([shape.id]);
    expect(model.nodes).toEqual([next.nodes[shape.id]]);
    expect(model.kind).toBe('single');
    expect(model.primaryId).toBe(shape.id);
    expect(model.primaryNode).toBe(next.nodes[shape.id]);
  });

  it('uses the active container as hierarchy context with no selection', () => {
    let doc = createDocument('selection');
    const frame = makeFrameNode('frame', { name: 'Hero Frame', w: 200, h: 120 });
    doc = addChild(doc, doc.pages?.[0]?.contentRoot ?? '', frame);

    const model = buildSelectionContext(doc, [], null, frame.id);

    expect(model.kind).toBe('empty');
    expect(model.primaryId).toBeNull();
    expect(model.hierarchy.map((entry) => entry.name)).toEqual(['Hero Frame']);
  });
});

describe('buildSelectionHierarchy', () => {
  it('omits the page content root but keeps every user-facing ancestor', () => {
    let doc = createDocument('selection');
    const pageRoot = doc.pages?.[0]?.contentRoot;
    if (!pageRoot) throw new Error('default page missing');
    const frame = makeFrameNode('frame', { name: 'Hero Frame', w: 200, h: 120 });
    const group = {
      ...makeFrameNode('group', { name: 'CTA Group', w: 100, h: 40 }),
      kind: 'group' as const,
    };
    const shape = makeShapeNode(
      'button',
      { kind: 'rect', x: 0, y: 0, w: 40, h: 20 },
      { name: 'button' },
    );
    doc = addChild(doc, pageRoot, frame);
    doc = addChild(doc, frame.id, group);
    doc = addChild(doc, group.id, shape);

    const hierarchy = buildSelectionHierarchy(doc, shape.id);

    expect(hierarchy.map((entry) => entry.name)).toEqual(['Hero Frame', 'CTA Group', 'button']);
    expect(hierarchy.map((entry) => entry.isContainer)).toEqual([true, true, false]);
  });

  it('classifies export regions as non-containers', () => {
    let doc = createDocument('selection');
    const pageRoot = doc.pages?.[0]?.contentRoot;
    if (!pageRoot) throw new Error('default page missing');
    const region = makeFrameNode('region', {
      name: 'Social Export',
      w: 100,
      h: 100,
      frameRole: 'exportRegion',
    });
    doc = addChild(doc, pageRoot, region);

    const [entry] = buildSelectionHierarchy(doc, region.id);

    expect(entry?.kind).toBe('exportRegion');
    expect(entry?.isContainer).toBe(false);
  });
});
