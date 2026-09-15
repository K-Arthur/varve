// @ts-nocheck
/**
 * Tests for selection → quick-bar profile resolution.
 */
import { createDocument, makeImageShapeNode, makeShapeNode, makeTextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { type ResolveQuickBarInput, resolveQuickBarProfile } from './resolveQuickBarProfile';

function baseInput(overrides: Partial<ResolveQuickBarInput> = {}): ResolveQuickBarInput {
  const doc = createDocument('test', true);
  return {
    document: doc,
    selection: [],
    tool: 'select',
    textEditTargetId: null,
    showOriginalBgNodeId: null,
    bgRemovalPending: false,
    suppressForVariant: false,
    ...overrides,
  };
}

const openPath = {
  kind: 'path' as const,
  points: [
    { x: 0, y: 0, handleIn: null, handleOut: null },
    { x: 10, y: 10, handleIn: null, handleOut: null },
    { x: 20, y: 0, handleIn: null, handleOut: null },
  ],
  closed: false,
};

describe('resolveQuickBarProfile', () => {
  it('returns null for empty selection', () => {
    expect(resolveQuickBarProfile(baseInput())).toBeNull();
  });

  it('returns null for a plain rect', () => {
    let doc = createDocument('test', true);
    const rect = makeShapeNode('r1', { kind: 'rect', x: 0, y: 0, w: 40, h: 40 }, { name: 'Rect' });
    doc = { ...doc, nodes: { ...doc.nodes, [rect.id]: rect }, rootChildren: [rect.id] };
    expect(resolveQuickBarProfile(baseInput({ document: doc, selection: [rect.id] }))).toBeNull();
  });

  it('returns image profile for isImageShape', () => {
    let doc = createDocument('test', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA', w: 100, h: 80 });
    doc = { ...doc, nodes: { ...doc.nodes, [img.id]: img }, rootChildren: [img.id] };
    const profile = resolveQuickBarProfile(baseInput({ document: doc, selection: [img.id] }));
    expect(profile?.kind).toBe('image');
    const ids = profile!.actions.map((a) => a.id);
    expect(ids).toContain('crop');
    expect(ids).toContain('removeBg');
    expect(ids).toContain('upscale');
    expect(ids).toContain('vectorize');
    expect(ids).toContain('flipH');
    expect(ids).toContain('flipV');
  });

  it('puts fitCycle in moreActions for images', () => {
    let doc = createDocument('test', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA' });
    doc = { ...doc, nodes: { ...doc.nodes, [img.id]: img }, rootChildren: [img.id] };
    const profile = resolveQuickBarProfile(baseInput({ document: doc, selection: [img.id] }));
    expect(profile?.moreActions?.map((a) => a.id)).toContain('fitCycle');
  });

  it('adds refineMask / showOriginal when backgroundRemoval present', () => {
    let doc = createDocument('test', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA' });
    const withBg = {
      ...img,
      backgroundRemoval: {
        method: 'quick' as const,
        maskDataUrl: 'data:image/png;base64,MASK',
        confidence: 0.9,
        appliedAt: Date.now(),
      },
    };
    doc = { ...doc, nodes: { ...doc.nodes, [withBg.id]: withBg }, rootChildren: [withBg.id] };
    const profile = resolveQuickBarProfile(baseInput({ document: doc, selection: [withBg.id] }));
    const more = profile?.moreActions?.map((a) => a.id) ?? [];
    expect(more).toContain('refineMask');
    expect(more).toContain('showOriginal');
  });

  it('adds cancelBg in more when bgRemovalPending', () => {
    let doc = createDocument('test', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA' });
    doc = { ...doc, nodes: { ...doc.nodes, [img.id]: img }, rootChildren: [img.id] };
    const profile = resolveQuickBarProfile(
      baseInput({ document: doc, selection: [img.id], bgRemovalPending: true }),
    );
    expect(profile?.moreActions?.map((a) => a.id)).toContain('cancelBg');
  });

  it('returns path profile for path shapes', () => {
    let doc = createDocument('test', true);
    const path = makeShapeNode('p1', openPath, { name: 'Path' });
    doc = { ...doc, nodes: { ...doc.nodes, [path.id]: path }, rootChildren: [path.id] };
    const profile = resolveQuickBarProfile(baseInput({ document: doc, selection: [path.id] }));
    expect(profile?.kind).toBe('path');
    const ids = profile!.actions.map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining(['editNodes', 'simplify', 'flipH', 'flipV', 'closePath']),
    );
    expect(ids).not.toContain('openPath');
  });

  it('offers openPath when path is closed', () => {
    let doc = createDocument('test', true);
    const path = makeShapeNode(
      'p1',
      {
        kind: 'path',
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: null },
          { x: 10, y: 0, handleIn: null, handleOut: null },
        ],
        closed: true,
      },
      {},
    );
    doc = { ...doc, nodes: { ...doc.nodes, [path.id]: path }, rootChildren: [path.id] };
    const profile = resolveQuickBarProfile(baseInput({ document: doc, selection: [path.id] }));
    expect(profile!.actions.map((a) => a.id)).toContain('openPath');
    expect(profile!.actions.map((a) => a.id)).not.toContain('closePath');
  });

  it('returns text profile when text selected and not editing', () => {
    let doc = createDocument('test', true);
    const text = makeTextNode('t1', 'Hi', { name: 'Text' });
    doc = { ...doc, nodes: { ...doc.nodes, [text.id]: text }, rootChildren: [text.id] };
    const profile = resolveQuickBarProfile(baseInput({ document: doc, selection: [text.id] }));
    expect(profile?.kind).toBe('text');
    expect(profile!.actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(['editText', 'flipH', 'flipV']),
    );
  });

  it('returns null while text is being edited', () => {
    let doc = createDocument('test', true);
    const text = makeTextNode('t1', 'Hi');
    doc = { ...doc, nodes: { ...doc.nodes, [text.id]: text }, rootChildren: [text.id] };
    expect(
      resolveQuickBarProfile(
        baseInput({ document: doc, selection: [text.id], textEditTargetId: 't1' }),
      ),
    ).toBeNull();
  });

  it('returns multi profile for 2+ nodes with group', () => {
    let doc = createDocument('test', true);
    const a = makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const b = makeShapeNode('b', { kind: 'ellipse', cx: 0, cy: 0, rx: 5, ry: 5 });
    doc = {
      ...doc,
      nodes: { ...doc.nodes, [a.id]: a, [b.id]: b },
      rootChildren: [a.id, b.id],
    };
    const profile = resolveQuickBarProfile(baseInput({ document: doc, selection: [a.id, b.id] }));
    expect(profile?.kind).toBe('multi');
    expect(profile!.actions.map((a) => a.id)).toContain('group');
    expect(profile!.actions.map((a) => a.id)).toEqual(
      expect.arrayContaining([
        'booleanUnion',
        'booleanSubtract',
        'booleanIntersect',
        'booleanExclude',
      ]),
    );
  });

  it('omits boolean actions when multi includes non-shape nodes', () => {
    let doc = createDocument('test', true);
    const a = makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const t = makeTextNode('t', 'x');
    doc = {
      ...doc,
      nodes: { ...doc.nodes, [a.id]: a, [t.id]: t },
      rootChildren: [a.id, t.id],
    };
    const profile = resolveQuickBarProfile(baseInput({ document: doc, selection: [a.id, t.id] }));
    expect(profile?.kind).toBe('multi');
    expect(profile!.actions.map((a) => a.id)).toContain('group');
    expect(profile!.actions.map((a) => a.id)).not.toContain('booleanUnion');
  });

  it('omits Boolean actions when a selection includes an open centreline path', () => {
    let doc = createDocument('test', true);
    const filled = makeShapeNode('filled', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const open = makeShapeNode('open', openPath);
    doc = {
      ...doc,
      nodes: { ...doc.nodes, [filled.id]: filled, [open.id]: open },
      rootChildren: [filled.id, open.id],
    };

    const profile = resolveQuickBarProfile(
      baseInput({ document: doc, selection: [filled.id, open.id] }),
    );
    expect(profile?.kind).toBe('multi');
    expect(profile!.actions.map((action) => action.id)).not.toContain('booleanUnion');
  });

  it('returns null during nodeEdit tool', () => {
    let doc = createDocument('test', true);
    const path = makeShapeNode('p1', openPath);
    doc = { ...doc, nodes: { ...doc.nodes, [path.id]: path }, rootChildren: [path.id] };
    expect(
      resolveQuickBarProfile(baseInput({ document: doc, selection: [path.id], tool: 'nodeEdit' })),
    ).toBeNull();
  });

  it('returns null during crop tool', () => {
    let doc = createDocument('test', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA' });
    doc = { ...doc, nodes: { ...doc.nodes, [img.id]: img }, rootChildren: [img.id] };
    expect(
      resolveQuickBarProfile(baseInput({ document: doc, selection: [img.id], tool: 'crop' })),
    ).toBeNull();
  });

  it('returns null for drawing tools', () => {
    let doc = createDocument('test', true);
    const img = makeImageShapeNode('i1', { src: 'data:image/png;base64,AA' });
    doc = { ...doc, nodes: { ...doc.nodes, [img.id]: img }, rootChildren: [img.id] };
    expect(
      resolveQuickBarProfile(baseInput({ document: doc, selection: [img.id], tool: 'pen' })),
    ).toBeNull();
  });

  it('returns null when suppressForVariant is true', () => {
    let doc = createDocument('test', true);
    const path = makeShapeNode('p1', openPath);
    doc = { ...doc, nodes: { ...doc.nodes, [path.id]: path }, rootChildren: [path.id] };
    expect(
      resolveQuickBarProfile(
        baseInput({ document: doc, selection: [path.id], suppressForVariant: true }),
      ),
    ).toBeNull();
  });
});
