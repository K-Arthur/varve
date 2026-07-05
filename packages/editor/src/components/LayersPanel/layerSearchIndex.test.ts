import {
  addNode,
  createDocument,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
  nextNodeId,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { createSearchIndex, removeFromIndex, searchIndex, updateIndex } from './layerSearchIndex';

describe('layerSearchIndex', () => {
  it('creates index from document', () => {
    let doc = createDocument();
    const { id: n1, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const rect = makeShapeNode(n1, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Header' });
    doc = addNode(doc, rect);

    const { id: n2, doc: d3 } = nextNodeId(doc);
    doc = d3;
    const circle = makeShapeNode(n2, { kind: 'circle', cx: 0, cy: 0, r: 5 }, { name: 'Avatar' });
    doc = addNode(doc, circle);

    const index = createSearchIndex(doc);

    expect(index.wordIndex.size).toBeGreaterThan(0);
    expect(index.nodeWords.has(n1)).toBe(true);
    expect(index.nodeWords.has(n2)).toBe(true);
    expect(index.nodeKinds.get(n1)).toBe('shape');
    expect(index.nodeKinds.get(n2)).toBe('shape');
  });

  it('extracts words from camelCase names', () => {
    let doc = createDocument();
    const { id: n1, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const node = makeShapeNode(
      n1,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'myButtonPrimary' },
    );
    doc = addNode(doc, node);

    const index = createSearchIndex(doc);
    const results = searchIndex(index, 'button');

    expect(results).toContain(n1);
  });

  it('extracts words from kebab-case names', () => {
    let doc = createDocument();
    const { id: n1, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const node = makeShapeNode(
      n1,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'user-avatar-icon' },
    );
    doc = addNode(doc, node);

    const index = createSearchIndex(doc);
    const results = searchIndex(index, 'avatar');

    expect(results).toContain(n1);
  });

  it('extracts words from snake_case names', () => {
    let doc = createDocument();
    const { id: n1, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const node = makeShapeNode(
      n1,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'footer_section_primary' },
    );
    doc = addNode(doc, node);

    const index = createSearchIndex(doc);
    const results = searchIndex(index, 'section');

    expect(results).toContain(n1);
  });

  it('finds exact match', () => {
    let doc = createDocument();
    const { id: n1, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const node = makeShapeNode(n1, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'NavBar' });
    doc = addNode(doc, node);

    const index = createSearchIndex(doc);
    const results = searchIndex(index, 'navbar');

    expect(results).toContain(n1);
  });

  it('finds multi-term AND search', () => {
    let doc = createDocument();
    const { id: n1, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const headerImg = makeShapeNode(
      n1,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Header Image' },
    );
    doc = addNode(doc, headerImg);

    const { id: n2, doc: d3 } = nextNodeId(doc);
    doc = d3;
    const footerImg = makeShapeNode(
      n2,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Footer Image' },
    );
    doc = addNode(doc, footerImg);

    const { id: n3, doc: d4 } = nextNodeId(doc);
    doc = d4;
    const headerText = makeTextNode(n3, 'Hi', { name: 'Header Text', fontSize: 16 });
    doc = addNode(doc, headerText);

    const index = createSearchIndex(doc);
    const results = searchIndex(index, 'header image');

    expect(results).toContain(n1);
    expect(results).not.toContain(n2);
    expect(results).not.toContain(n3);
  });

  it('finds prefix match', () => {
    let doc = createDocument();
    const { id: n1, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const node = makeShapeNode(
      n1,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'BackgroundImage' },
    );
    doc = addNode(doc, node);

    const index = createSearchIndex(doc);
    const results = searchIndex(index, 'back');

    expect(results).toContain(n1);
  });

  it('finds nodes by kind prefix', () => {
    let doc = createDocument();
    const { id: n1, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const rect = makeShapeNode(n1, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Box' });
    doc = addNode(doc, rect);

    const { id: n2, doc: d3 } = nextNodeId(doc);
    doc = d3;
    const circle = makeTextNode(n2, 'Hi', { name: 'Label' });
    doc = addNode(doc, circle);

    const index = createSearchIndex(doc);
    const results = searchIndex(index, 'kind:text');

    expect(results).toContain(n2);
  });

  it('returns empty array for empty query', () => {
    const doc = createDocument();
    const index = createSearchIndex(doc);
    const results = searchIndex(index, '');
    expect(results).toEqual([]);
  });

  it('returns empty array for whitespace-only query', () => {
    const doc = createDocument();
    const index = createSearchIndex(doc);
    const results = searchIndex(index, '   ');
    expect(results).toEqual([]);
  });

  it('updates index when node name changes', () => {
    let doc = createDocument();
    const { id: n1, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const node = makeShapeNode(n1, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'OldName' });
    doc = addNode(doc, node);

    const index = createSearchIndex(doc);

    let results = searchIndex(index, 'oldname');
    expect(results).toContain(n1);

    const renamed = { ...node, name: 'NewName' };
    updateIndex(index, n1, renamed);

    results = searchIndex(index, 'oldname');
    expect(results).not.toContain(n1);

    results = searchIndex(index, 'newname');
    expect(results).toContain(n1);
  });

  it('removes node from index', () => {
    let doc = createDocument();
    const { id: n1, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const node = makeShapeNode(
      n1,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'DeleteMe' },
    );
    doc = addNode(doc, node);

    const index = createSearchIndex(doc);
    expect(searchIndex(index, 'deleteme')).toContain(n1);

    removeFromIndex(index, n1);
    expect(searchIndex(index, 'deleteme')).not.toContain(n1);
    expect(index.nodeWords.has(n1)).toBe(false);
    expect(index.nodeKinds.has(n1)).toBe(false);
  });

  it('returns empty index for empty document', () => {
    const doc = createDocument();
    const index = createSearchIndex(doc);

    expect(index.wordIndex.size).toBeGreaterThanOrEqual(0);
    expect(searchIndex(index, 'anything')).toEqual([]);
  });

  it('handles special characters in names', () => {
    let doc = createDocument();
    const { id: n1, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const node = makeShapeNode(
      n1,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Layer #1 (copy) @ 2x' },
    );
    doc = addNode(doc, node);

    const index = createSearchIndex(doc);
    const results = searchIndex(index, 'copy');
    expect(results).toContain(n1);
  });

  it('orders results by relevance with exact match first', () => {
    let doc = createDocument();
    const { id: n1, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const exact = makeShapeNode(n1, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Button' });
    doc = addNode(doc, exact);

    const { id: n2, doc: d3 } = nextNodeId(doc);
    doc = d3;
    const prefix = makeShapeNode(
      n2,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'ButtonSecondary' },
    );
    doc = addNode(doc, prefix);

    const index = createSearchIndex(doc);
    const results = searchIndex(index, 'button');

    expect(results.length).toBe(2);
    expect(results[0]).toBe(n1);
    expect(results[1]).toBe(n2);
  });

  it('updates kind when node kind changes', () => {
    let doc = createDocument();
    const { id: n1, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const node = makeShapeNode(n1, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Shape' });
    doc = addNode(doc, node);

    const index = createSearchIndex(doc);
    expect(index.nodeKinds.get(n1)).toBe('shape');

    const group = makeGroupNode(n1, { name: 'Shape' });
    updateIndex(index, n1, group);

    expect(index.nodeKinds.get(n1)).toBe('group');
  });

  it('indexes text nodes', () => {
    let doc = createDocument();
    const { id: n1, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const text = makeTextNode(n1, 'Welcome', { name: 'Heading 1', fontSize: 24 });
    doc = addNode(doc, text);

    const index = createSearchIndex(doc);

    expect(index.nodeKinds.get(n1)).toBe('text');
    expect(searchIndex(index, 'heading')).toContain(n1);
  });
});
