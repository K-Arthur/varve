import {
  addNode,
  createDocument,
  createEmbeddedAsset,
  createPatternDefinitionFromSelection,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  exportPatternDefinitionSupertileSvg,
  exportPatternDefinitionTileSvg,
  patternDefinitionSupertileGeometry,
} from './patternTileSvg';

describe('exportPatternDefinitionTileSvg', () => {
  it('exports copied vector source as a self-contained SVG tile with logical cell bounds', () => {
    const motif = makeShapeNode('motif', { kind: 'rect', x: 2, y: 3, w: 8, h: 5 });
    const document = addNode(createDocument('Pattern source', true), motif);
    const { document: withPattern, definition } = createPatternDefinitionFromSelection(
      document,
      [motif.id],
      { id: 'vector-pattern', name: 'Vector pattern' },
    );

    const svg = exportPatternDefinitionTileSvg(withPattern, definition);

    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain(`viewBox="0 0 ${definition.cell.width} ${definition.cell.height}"`);
    expect(svg).toContain('<image');
    expect(svg).toContain('data:image/svg+xml');
    expect(svg).not.toMatch(/(?:href|xlink:href)="(?:https?:|file:|\/\/)/i);
  });

  it('embeds raster source bytes in the exported tile instead of referencing document paths', () => {
    const dataUrl = 'data:image/png;base64,AAECAw==';
    const asset = createEmbeddedAsset({
      dataUrl,
      mimeType: 'image/png',
      naturalWidth: 7,
      naturalHeight: 5,
    });
    const definition = {
      id: 'raster-pattern',
      name: 'Raster',
      revision: 1,
      cell: { x: 0, y: 0, width: 7, height: 5 },
      repeat: {
        arrangement: 'grid' as const,
        gapX: 0,
        gapY: 0,
        rowShift: 0,
        mirrorX: false,
        mirrorY: false,
        originX: 0,
        originY: 0,
      },
      source: { kind: 'raster' as const, assetId: asset.id, width: 7, height: 5 },
    };
    const document = {
      ...createDocument('Raster pattern', true),
      assets: { [asset.id]: asset },
      patternDefinitions: { [definition.id]: definition },
    };

    const svg = exportPatternDefinitionTileSvg(document, definition);

    expect(svg).toContain('viewBox="0 0 7 5"');
    expect(svg).toContain(`href="${dataUrl}"`);
    expect(svg).toContain('width="7" height="5"');
  });

  it('rejects non-finite or non-positive tile dimensions', () => {
    const definition = {
      id: 'bad-pattern',
      name: 'Bad',
      revision: 1,
      cell: { x: 0, y: 0, width: 0, height: Number.NaN },
      repeat: {
        arrangement: 'grid' as const,
        gapX: 0,
        gapY: 0,
        rowShift: 0,
        mirrorX: false,
        mirrorY: false,
        originX: 0,
        originY: 0,
      },
      source: { kind: 'raster' as const, assetId: 'missing', width: 1, height: 1 },
    };

    expect(() => exportPatternDefinitionTileSvg(createDocument('Bad', true), definition)).toThrow(
      /positive and finite/,
    );
  });

  it('exports the full half-drop period as a clipped rectangular supertile', () => {
    const asset = createEmbeddedAsset({
      dataUrl: 'data:image/png;base64,AAECAw==',
      mimeType: 'image/png',
      naturalWidth: 7,
      naturalHeight: 5,
    });
    const definition = {
      id: 'half-drop-pattern',
      name: 'Half drop',
      revision: 1,
      cell: { x: 0, y: 0, width: 7, height: 5 },
      repeat: {
        arrangement: 'half-drop' as const,
        gapX: 2,
        gapY: 1,
        rowShift: 0,
        columnShift: 0.5,
        mirrorX: false,
        mirrorY: false,
        originX: -2.5,
        originY: 3.25,
      },
      source: { kind: 'raster' as const, assetId: asset.id, width: 7, height: 5 },
    };
    const document = {
      ...createDocument('Half drop', true),
      assets: { [asset.id]: asset },
      patternDefinitions: { [definition.id]: definition },
    };

    const svg = exportPatternDefinitionSupertileSvg(document, definition);

    expect(patternDefinitionSupertileGeometry(definition)).toEqual({ width: 18, height: 6 });
    expect(svg).toContain('viewBox="0 0 18 6"');
    expect(svg).toContain('clip-path="url(#pattern-supertile-clip)"');
    expect((svg.match(/<image /g) ?? []).length).toBeGreaterThan(2);
    expect(svg).toContain(encodeURIComponent('data:image/png;base64,AAECAw=='));
  });

  it('accounts for mirror parity and rejects unsupported custom stagger fractions', () => {
    const definition = {
      id: 'brick-pattern',
      name: 'Brick',
      revision: 1,
      cell: { x: 0, y: 0, width: 10, height: 6 },
      repeat: {
        arrangement: 'brick' as const,
        gapX: 0,
        gapY: 0,
        rowShift: 0.5,
        mirrorX: true,
        mirrorY: false,
        originX: 0,
        originY: 0,
      },
      source: { kind: 'raster' as const, assetId: 'missing', width: 10, height: 6 },
    };
    expect(patternDefinitionSupertileGeometry(definition)).toEqual({ width: 20, height: 24 });
    expect(() =>
      patternDefinitionSupertileGeometry({
        ...definition,
        repeat: { ...definition.repeat, rowShift: 0.37 },
      }),
    ).toThrow(/custom stagger/);
  });
});
