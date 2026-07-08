import { describe, expect, it } from 'vitest';
import { addNode, createDocument, makeGroupNode, makeShapeNode } from './document';
import { DocumentCodec } from './documentCodec';
import { CURRENT_DOCUMENT_VERSION } from './version';

describe('DocumentCodec', () => {
  it('decodes, migrates, and validates serialized documents', () => {
    const legacy = {
      id: 'doc-legacy',
      name: 'Legacy',
      formatVersion: '1.0',
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
    };

    const result = DocumentCodec.decode(JSON.stringify(legacy));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
    expect(result.document.name).toBe('Legacy');
    expect(result.warnings.some((w) => w.code === 'document.migrated')).toBe(true);
  });

  it('normalizes broken root and child references without throwing', () => {
    let doc = createDocument('Broken', true);
    doc = addNode(
      doc,
      makeGroupNode('n1', {
        name: 'Group',
        children: ['missing-child'],
      }),
    );
    doc = {
      ...doc,
      rootChildren: ['missing-root', 'n1'],
      nextId: 1,
    };

    const result = DocumentCodec.normalize(doc);

    expect(result.document.rootChildren).toEqual(['n1']);
    expect(result.document.nodes.n1?.kind).toBe('group');
    expect((result.document.nodes.n1 as { children: string[] }).children).toEqual([]);
    expect(result.document.nextId).toBeGreaterThan(1);
    expect(result.warnings.map((w) => w.code)).toContain('document.orphan-root');
    expect(result.warnings.map((w) => w.code)).toContain('document.orphan-child');
  });

  it('collects the full dependency closure for imported subtrees', () => {
    let doc = createDocument('Closure', true);
    doc = addNode(
      doc,
      makeGroupNode('g1', {
        children: ['s1'],
      }),
    );
    doc = addNode(doc, makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));

    const closure = DocumentCodec.collectNodeClosure(doc, ['g1']);

    expect([...closure.nodeIds]).toEqual(['g1', 's1']);
    expect(Object.keys(closure.nodes)).toEqual(['g1', 's1']);
  });
});
