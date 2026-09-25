import { addNode, createDocument, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { applyRenameProposal } from './controller';

function documentWithLayers() {
  let doc = createDocument('Plugin rename', true);
  doc = addNode(
    doc,
    makeShapeNode('one', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }, { name: 'Card' }),
  );
  doc = addNode(
    doc,
    makeShapeNode(
      'two',
      { kind: 'rect', x: 30, y: 0, w: 20, h: 20 },
      { name: 'Locked', locked: true },
    ),
  );
  return doc;
}

describe('plugin rename proposal', () => {
  it('applies only canonical node changes and keeps editable originals', () => {
    const doc = documentWithLayers();
    const changed = applyRenameProposal(doc, doc.id, [
      { id: 'one', expectedName: 'Card', name: '01 · Card' },
    ]);
    expect(changed).not.toBe(doc);
    expect(changed.nodes.one?.name).toBe('01 · Card');
    expect(changed.nodes.one?.nameMode).toBe('custom');
    expect(changed.nodes.two).toBe(doc.nodes.two);
  });

  it('rejects a stale document or target without partially renaming', () => {
    const doc = documentWithLayers();
    const proposal = [
      { id: 'one', expectedName: 'Card', name: '01 · Card' },
      { id: 'two', expectedName: 'Old', name: '02 · Locked' },
    ];
    expect(applyRenameProposal(doc, 'another-document', proposal)).toBe(doc);
    expect(applyRenameProposal(doc, doc.id, proposal)).toBe(doc);
  });

  it('never changes locked or absent layers', () => {
    const doc = documentWithLayers();
    expect(
      applyRenameProposal(doc, doc.id, [{ id: 'two', expectedName: 'Locked', name: 'Changed' }]),
    ).toBe(doc);
    expect(
      applyRenameProposal(doc, doc.id, [
        { id: 'missing', expectedName: 'Anything', name: 'Changed' },
      ]),
    ).toBe(doc);
  });
});
