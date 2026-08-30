import { addChild, createDocument, makeShapeNode, nextNodeId } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  createPageCommand,
  deletePageCommand,
  renamePageCommand,
  reorderPagesCommand,
} from './pageCommands';

describe('page command adapters', () => {
  it('creates and renames pages through validated page operations', () => {
    let doc = createDocument('commands');
    doc = createPageCommand(doc, { name: 'Cover', width: 400, height: 300 });
    const page = doc.pages?.[1];
    expect(page?.name).toBe('Cover');

    if (!page) throw new Error('page was not created');
    doc = renamePageCommand(doc, { pageId: page.id, name: '  Front cover  ' });
    expect(doc.pages?.[1]?.name).toBe('Front cover');
  });

  it('ignores stale reorder and delete payloads without changing the document', () => {
    const doc = createDocument('stale commands');
    expect(reorderPagesCommand(doc, ['missing'])).toBe(doc);
    expect(deletePageCommand(doc, 'missing')).toBe(doc);
  });

  it('preserves content when deleting the final page', () => {
    let doc = createDocument('last page');
    const page = doc.pages![0]!;
    const allocation = nextNodeId(doc);
    doc = addChild(
      allocation.doc,
      page.contentRoot,
      makeShapeNode(allocation.id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
    );

    doc = deletePageCommand(doc, page.id, 'move-to-pasteboard');
    expect(doc.pages).toEqual([]);
    expect(doc.rootChildren).toContain(allocation.id);
    expect(doc.nodes[allocation.id]).toBeDefined();
  });
});
