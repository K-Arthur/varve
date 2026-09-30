import { createEngine } from '@varve/engine';
import {
  addChild,
  addNode,
  createDocument,
  imageFill,
  makeGroupNode,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import {
  exportNodeAsPdf,
  exportNodeAsPdfX,
  exportNodeAsRaster,
  exportNodeToSvgMarkup,
} from './export';

function createReference() {
  const base = makeShapeNode('reference', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 });
  return {
    ...base,
    fills: [imageFill('data:image/png;base64,REFERENCE_ONLY')],
    conceptArtReference: {
      sourceFileName: 'forest.png',
      includeInSampling: false,
      includeInExport: false,
    },
  };
}

function createReferenceScene() {
  const group = makeGroupNode('artwork', { children: [] });
  let document = addNode(createDocument('Reference export'), group);
  document = addChild(
    document,
    group.id,
    makeShapeNode('paint', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
  );
  document = addChild(document, group.id, createReference());
  return { document, group };
}

describe('concept-art reference artwork exports', () => {
  it('omits a reference from raster and SVG subtree exports by default', async () => {
    const { document, group } = createReferenceScene();
    const engine = await createEngine('stub');
    const buildIr = vi.spyOn(engine, 'buildIr');

    await exportNodeAsRaster(group, document, engine, { format: 'image/png', scale: 1 });
    const renderedIds = buildIr.mock.calls[0]?.[0].nodes.map((node) => node.id);
    expect(renderedIds).toContain('paint');
    expect(renderedIds).not.toContain('reference');

    const svg = await exportNodeToSvgMarkup(group, document, engine);
    expect(svg).not.toContain('REFERENCE_ONLY');
  });

  it('refuses a direct export of an opted-out reference with a recovery instruction', async () => {
    const reference = createReference();
    const document = addNode(createDocument('Reference export'), reference);
    const engine = await createEngine('stub');

    await expect(
      exportNodeAsRaster(reference, document, engine, { format: 'image/png', scale: 1 }),
    ).rejects.toThrow(/excluded from artwork exports.*Include in artwork exports/);
    await expect(exportNodeToSvgMarkup(reference, document, engine)).rejects.toThrow(
      /excluded from artwork exports/,
    );
    await expect(exportNodeAsPdf(reference, document, 1, engine)).rejects.toThrow(
      /excluded from artwork exports/,
    );
    await expect(exportNodeAsPdfX(reference, document, 'pdf-x4')).rejects.toThrow(
      /excluded from artwork exports/,
    );
  });
});
