import {
  addNode,
  createDocument,
  createEmbeddedAsset,
  makeShapeNode,
  type PatternDefinition,
  patternFill,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { exportDocumentToSvgAdvanced, exportNodeToSvg, svgTargetGaps } from './index';

function patternDocument(arrangement: 'grid' | 'half-drop' | 'brick' = 'grid') {
  const motif = makeShapeNode('motif:unsafe/id', { kind: 'rect', x: 1, y: 2, w: 4, h: 5 });
  const pattern: PatternDefinition = {
    id: 'pattern:unsafe/id',
    name: 'Pattern',
    revision: 1,
    cell: { x: 0, y: 0, width: 16, height: 12 },
    repeat: {
      arrangement,
      gapX: 2,
      gapY: 3,
      rowShift: arrangement === 'grid' ? 0 : 0.5,
      columnShift: 0,
      mirrorX: false,
      mirrorY: false,
      originX: 0,
      originY: 0,
    },
    source: {
      kind: 'vector',
      rootIds: [motif.id],
      nodes: { [motif.id]: motif },
      assetIds: [],
      styleIds: [],
      componentIds: [],
    },
  };
  const target = {
    ...makeShapeNode('target:panel', { kind: 'rect', x: 10, y: 20, w: 120, h: 80 }),
    fills: [
      patternFill('', {
        definitionId: pattern.id,
        imageWidth: 20,
        imageHeight: 10,
        offsetX: -2.5,
        offsetY: 1.25,
        rotation: 30,
        opacity: 0.4,
      }),
    ],
  };
  let doc = addNode(createDocument('Pattern SVG', true), target);
  doc = { ...doc, patternDefinitions: { [pattern.id]: pattern } };
  return { doc, target, pattern };
}

describe('SVG pattern fill export', () => {
  it('emits a reusable user-space SVG pattern for an editable vector definition', () => {
    const { doc } = patternDocument();

    const svg = exportDocumentToSvgAdvanced(doc, {}, { x: 0, y: 0, w: 200, h: 150 });

    expect(svg).toContain('patternUnits="userSpaceOnUse"');
    expect(svg).toContain('patternContentUnits="userSpaceOnUse"');
    expect(svg).toContain('x="7.5" y="21.25" width="22" height="13"');
    expect(svg).toContain('fill="url(#varve-pattern-');
    expect(svg).toContain('fill-opacity="0.4"');
    expect(svg).toContain('patternTransform="rotate(30 70 60)"');
    expect(svg).toContain('matrix(1.25 0 0 0.833333333333');
    expect(svg).toContain('<rect x="1" y="2" width="4" height="5"');
    expect(svg).not.toContain('id="pattern:unsafe/id"');
  });

  it('emits the same pattern fill and dependencies through single-node SVG export', () => {
    const { doc, target } = patternDocument();

    const svg = exportNodeToSvg(target, doc, { background: 'transparent' });

    expect(svg).toContain('<pattern');
    expect(svg).toContain('fill="url(#varve-pattern-');
    expect(svg).toContain('<rect x="1" y="2" width="4" height="5"');
  });

  it('shares one safe source group when multiple fills use the same definition', () => {
    const { doc, pattern } = patternDocument();
    const second = {
      ...makeShapeNode('second-target', { kind: 'circle', cx: 20, cy: 20, r: 10 }),
      fills: [patternFill('', { definitionId: pattern.id })],
    };
    const expanded = addNode(doc, second);

    const svg = exportDocumentToSvgAdvanced(expanded, {}, { x: 0, y: 0, w: 200, h: 150 });

    expect(svg.match(/<pattern id="varve-pattern-/g)).toHaveLength(2);
    expect(svg.match(/<g id="varve-pattern-source-/g)).toHaveLength(1);
    expect(svg.match(/<use href="#varve-pattern-source-/g)).toHaveLength(2);
  });

  it('embeds raster definition bytes in a native SVG pattern', () => {
    const { doc, pattern } = patternDocument();
    const dataUrl = 'data:image/png;base64,AAECAw==';
    const asset = createEmbeddedAsset({
      dataUrl,
      mimeType: 'image/png',
      naturalWidth: 16,
      naturalHeight: 12,
    });
    const rasterPattern: PatternDefinition = {
      ...pattern,
      source: { kind: 'raster', assetId: asset.id, width: 16, height: 12 },
    };
    const withAsset = {
      ...doc,
      assets: { [asset.id]: asset },
      patternDefinitions: { [pattern.id]: rasterPattern },
    };

    const svg = exportDocumentToSvgAdvanced(withAsset, {}, { x: 0, y: 0, w: 200, h: 150 });

    expect(svg).toContain(`href="${dataUrl}"`);
    expect(svg).toContain('patternUnits="userSpaceOnUse"');
  });

  it('reports unsupported staggered repeats and does not claim a faithful pattern export', () => {
    const { doc, target } = patternDocument('half-drop');

    const gaps = svgTargetGaps(target, doc);
    const svg = exportDocumentToSvgAdvanced(doc, {}, { x: 0, y: 0, w: 200, h: 150 });

    expect(gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          feature: 'pattern fill',
          severity: 'warning',
          fallback: expect.stringMatching(/grid repeat/i),
        }),
      ]),
    );
    expect(svg).not.toContain('<pattern');
  });

  it('warns when document alignment cannot be retained by the object-space SVG fill', () => {
    const { doc, target, pattern } = patternDocument();
    const targetWithDocumentAlignment = {
      ...target,
      fills: [patternFill('', { definitionId: pattern.id, alignment: 'document' })],
    };
    const alignedDoc = {
      ...doc,
      nodes: { ...doc.nodes, [target.id]: targetWithDocumentAlignment },
    };

    const gaps = svgTargetGaps(targetWithDocumentAlignment, alignedDoc);
    const svg = exportDocumentToSvgAdvanced(alignedDoc, {}, { x: 0, y: 0, w: 200, h: 150 });

    expect(gaps[0]?.fallback).toMatch(/document-aligned/i);
    expect(svg).toContain('SVG pattern export skipped');
    expect(svg).not.toContain('<pattern');
  });

  it('warns and falls back when a linked definition is missing', () => {
    const { doc, target } = patternDocument();
    const orphan = {
      ...target,
      fills: [patternFill('', { definitionId: 'missing-pattern' })],
    };

    const gaps = svgTargetGaps(orphan, doc);
    const svg = exportNodeToSvg(orphan, doc, { background: 'transparent' });

    expect(gaps[0]?.fallback).toMatch(/missing/i);
    expect(svg).toContain('pattern export skipped');
    expect(svg).not.toContain('<pattern');
  });
});
