import { describe, expect, it } from 'vitest';
import { createEmbeddedAsset } from './assets';
import {
  addNode,
  addPage,
  createDocument,
  makeGroupNode,
  makeShapeNode,
  validateDocument,
} from './document';
import { DocumentCodec } from './documentCodec';
import { imageFill } from './fills';
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

  it('repairs dangling and unsupported clipping relationships without losing children', () => {
    const content = makeShapeNode('content', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 });
    const group = makeGroupNode('clip', { children: ['content'] });
    group.mask = { type: 'clip', sourceNodeId: 'missing', visible: true };
    const doc = {
      ...createDocument('Broken mask', true),
      nodes: { clip: group, content },
      rootChildren: ['clip'],
    };

    const normalized = DocumentCodec.normalize(doc);

    expect(normalized.document.nodes.clip?.mask).toBeUndefined();
    expect(normalized.document.nodes.content).toEqual(content);
    expect(normalized.warnings).toContainEqual(
      expect.objectContaining({
        code: 'document.invalid-structural-mask',
        path: 'clip.mask',
      }),
    );

    const decoded = DocumentCodec.decode(JSON.stringify(doc));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.document.nodes.clip?.mask).toBeUndefined();
    expect(decoded.document.nodes.content).toBeDefined();
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

  describe('document-level image assets', () => {
    const DATA_URL = 'data:image/png;base64,aGVsbG8=';

    function docWithAsset() {
      const asset = createEmbeddedAsset({
        dataUrl: DATA_URL,
        mimeType: 'image/png',
        naturalWidth: 10,
        naturalHeight: 10,
      });
      let doc = createDocument('Assets', true);
      const shape = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
      shape.fills = [imageFill(DATA_URL, { assetId: asset.id })];
      doc = addNode(doc, shape);
      doc = { ...doc, assets: { [asset.id]: asset } };
      return { doc, asset };
    }

    it('rejects a malformed assets shape', () => {
      const raw = { ...createDocument('Bad', true), assets: 'not-an-object' };
      const result = DocumentCodec.decode(JSON.stringify(raw));
      expect(result.ok).toBe(false);
    });

    it('round-trips a document with an embedded image asset', () => {
      const { doc } = docWithAsset();
      const decoded = DocumentCodec.decode(DocumentCodec.encode(doc));
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      const shape = decoded.document.nodes.s1;
      const image = shape?.kind === 'shape' ? shape.fills?.[0]?.image : undefined;
      expect(image?.src).toBe(DATA_URL);
      expect(decoded.document.assets?.[image?.assetId as string]?.dataUrl).toBe(DATA_URL);
    });

    it('serializes the asset payload once, not once per referencing fill', () => {
      const { doc: base, asset } = docWithAsset();
      const shape2 = makeShapeNode('s2', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
      shape2.fills = [imageFill(DATA_URL, { assetId: asset.id })];
      const doc = addNode(base, shape2);

      const json = DocumentCodec.encode(doc);
      const occurrences = json.split(DATA_URL.slice('data:image/png;base64,'.length)).length - 1;
      expect(occurrences).toBe(1);
    });

    it('drops an invalid asset entry with a warning but keeps the document valid', () => {
      const raw = {
        ...createDocument('Invalid asset', true),
        assets: { bad: { id: 'bad', storage: 'embedded', mimeType: 'image/png' } },
      };
      const result = DocumentCodec.decode(JSON.stringify(raw));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.document.assets?.bad).toBeUndefined();
      expect(result.warnings.some((w) => w.code === 'document.invalid-image-asset')).toBe(true);
    });

    it('prunes assets no longer referenced by any node', () => {
      const { doc, asset } = docWithAsset();
      const withoutFill = {
        ...doc,
        nodes: {
          ...doc.nodes,
          s1: { ...doc.nodes.s1!, fills: [] },
        },
      };
      const normalized = DocumentCodec.normalize(withoutFill as typeof doc);
      expect(normalized.document.assets?.[asset.id]).toBeUndefined();
    });

    it('includes referenced assets in the copy/paste dependency closure', () => {
      const { doc, asset } = docWithAsset();
      const closure = DocumentCodec.collectNodeClosure(doc, ['s1']);
      expect(closure.assets?.[asset.id]).toEqual(asset);
    });
  });
});
