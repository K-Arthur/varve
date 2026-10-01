import {
  addNode,
  createDocument,
  createPatternDefinitionFromSelection,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { compilePatternPreview } from './compilePatternPreview';

describe('compilePatternPreview', () => {
  it('exports copied vector source as a transparent, dimensioned SVG tile', () => {
    const motif = makeShapeNode(
      'motif',
      { kind: 'rect', x: 0, y: 0, w: 18, h: 12 },
      {
        name: 'Leaf mark',
        transform: [1, 0, 0, 1, 4, 3],
      },
    );
    const doc = addNode(createDocument('Pattern preview', true), motif);
    const created = createPatternDefinitionFromSelection(doc, [motif.id], {
      id: 'leaf-tile',
      name: 'Leaf tile',
    });

    const preview = compilePatternPreview(created.document, created.definition);
    const svg = decodeURIComponent(preview.slice(preview.indexOf(',') + 1));
    const nestedHref = /href="(data:image\/svg\+xml;charset=utf-8,[^"]+)"/.exec(svg)?.[1];
    const nestedSvg = nestedHref
      ? decodeURIComponent(nestedHref.slice(nestedHref.indexOf(',') + 1))
      : '';

    expect(preview).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 12"');
    expect(nestedSvg).toContain('<rect x="0" y="0" width="18" height="12"');
    expect(svg).not.toContain('<rect width="100%" height="100%" fill="#ffffff"');
  });

  it('carries vector motifs across the cell edge using the authored half-drop basis', () => {
    const motif = makeShapeNode('overhanging motif', {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 16,
      h: 16,
    });
    const doc = addNode(createDocument('Pattern edge', true), motif);
    const created = createPatternDefinitionFromSelection(doc, [motif.id], {
      id: 'edge-tile',
      name: 'Edge tile',
      repeat: { arrangement: 'half-drop', columnShift: 0.5 },
    });
    if (created.definition.source.kind !== 'vector') throw new Error('expected vector source');
    const rootId = created.definition.source.rootIds[0]!;
    const root = created.definition.source.nodes[rootId]!;
    const shifted = {
      ...created.definition,
      source: {
        ...created.definition.source,
        nodes: {
          ...created.definition.source.nodes,
          [rootId]: {
            ...root,
            transform: [1, 0, 0, 1, -4, 0] as [number, number, number, number, number, number],
          },
        },
      },
    };

    const preview = compilePatternPreview(created.document, shifted);
    const svg = decodeURIComponent(preview.slice(preview.indexOf(',') + 1));
    const placements = [...svg.matchAll(/<image\b([^>]*)\/>/g)].map((match) => match[1] ?? '');

    expect(placements.length).toBeGreaterThan(1);
    expect(placements.some((placement) => placement.includes('matrix(1 0 0 1 16 8)'))).toBe(true);
  });
});
