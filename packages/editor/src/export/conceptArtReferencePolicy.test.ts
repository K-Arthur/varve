import {
  addChild,
  addNode,
  createDocument,
  imageFill,
  makeGroupNode,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { documentForArtworkExport, prepareArtworkExport } from './conceptArtReferencePolicy';

function referenceNode(includeInExport = false) {
  const base = makeShapeNode('reference', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 });
  return {
    ...base,
    fills: [imageFill('data:image/png;base64,AA==')],
    conceptArtReference: {
      sourceFileName: 'forest.png',
      includeInSampling: false,
      includeInExport,
    },
  };
}

describe('concept-art reference export policy', () => {
  it('removes opted-out references from a disposable container snapshot', () => {
    const group = makeGroupNode('group', { children: [] });
    let document = addNode(createDocument('Artwork'), group);
    document = addChild(
      document,
      group.id,
      makeShapeNode('paint', { kind: 'rect', x: 0, y: 0, w: 8, h: 8 }),
    );
    document = addChild(document, group.id, referenceNode());

    const exportDocument = documentForArtworkExport(document);

    expect(exportDocument).not.toBe(document);
    expect(exportDocument.nodes.group).toMatchObject({ children: ['paint'] });
    expect(exportDocument.nodes.reference).toMatchObject({ visible: false });
    expect(document.nodes.group).toMatchObject({ children: ['paint', 'reference'] });
    expect(document.nodes.reference?.visible).toBe(true);
  });

  it('keeps explicitly included references and ordinary images in exported scenes', () => {
    const reference = referenceNode(true);
    const group = makeGroupNode('group', { children: [reference.id] });
    const document = addNode(addNode(createDocument('Artwork'), group), reference);

    expect(documentForArtworkExport(document)).toBe(document);
  });

  it('rejects exporting an excluded reference as the selected root', () => {
    const reference = referenceNode();
    const document = addNode(createDocument('Artwork'), reference);

    expect(() => prepareArtworkExport(reference, document)).toThrow(
      /excluded from artwork exports.*Include in artwork exports/,
    );
  });
});
