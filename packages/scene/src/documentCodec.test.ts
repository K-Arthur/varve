import { describe, expect, it } from 'vitest';
import {
  addNode,
  addPage,
  createDocument,
  makeGroupNode,
  makeShapeNode,
  validateDocument,
} from './document';
import { DocumentCodec } from './documentCodec';
import type { Page } from './types';
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

  it('repairs stale page ownership and active page references', () => {
    let doc = createDocument('Broken pages');
    doc = addPage(doc);
    const first = doc.pages?.[0] as Page;
    const second = doc.pages?.[1] as Page;
    doc = {
      ...doc,
      activePageId: 'missing-page',
      pages: [
        { ...first, contentRoot: 'missing-root' },
        { ...second, backgrounds: ['missing-background'] },
      ],
    };

    const result = DocumentCodec.normalize(doc);

    expect(result.document.pages?.map((p) => p.id)).toEqual([first.id, second.id]);
    expect(result.document.activePageId).toBe(first.id);
    expect(result.document.nodes['missing-root']?.kind).toBe('group');
    expect(result.document.rootChildren).toContain('missing-root');
    expect(result.document.pages?.[1]?.backgrounds).toEqual([]);
    expect(validateDocument(result.document).valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('document.page-content-root-missing');
    expect(result.warnings.map((w) => w.code)).toContain('document.page-background-missing');
    expect(result.warnings.map((w) => w.code)).toContain('document.active-page-normalized');
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
