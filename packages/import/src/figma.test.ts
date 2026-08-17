import { DocumentCodec, validateDocument } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { createFigmaParser, decodeFigmaSource, isFigmaJsonSource } from './figma';
import { ImportService } from './service';

function fixture(): string {
  return JSON.stringify({
    name: 'Figma UI fixture',
    version: '42',
    document: {
      id: '0:0',
      type: 'DOCUMENT',
      children: [
        {
          id: '0:1',
          type: 'CANVAS',
          name: 'Design',
          absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 480 },
          children: [
            {
              id: '1:1',
              type: 'FRAME',
              name: 'Card',
              absoluteBoundingBox: { x: 20, y: 30, width: 300, height: 180 },
              layoutMode: 'VERTICAL',
              itemSpacing: 12,
              paddingTop: 16,
              paddingRight: 16,
              paddingBottom: 16,
              paddingLeft: 16,
              primaryAxisAlignItems: 'MIN',
              counterAxisAlignItems: 'STRETCH',
              fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }],
              children: [
                {
                  id: '1:2',
                  type: 'TEXT',
                  name: 'Title',
                  absoluteBoundingBox: { x: 36, y: 46, width: 260, height: 24 },
                  characters: 'Hello Varve',
                  style: { fontFamily: 'Inter', fontSize: 20, fontWeight: 700, lineHeightPx: 24, textAutoResize: 'HEIGHT' },
                  fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 }, opacity: 1 }],
                  layoutSizingHorizontal: 'FILL',
                },
                {
                  id: '1:3',
                  type: 'RECTANGLE',
                  name: 'Accent',
                  absoluteBoundingBox: { x: 36, y: 82, width: 260, height: 48 },
                  rectangleCornerRadii: [8, 8, 8, 8],
                  fills: [{ type: 'GRADIENT_LINEAR', gradientStops: [{ position: 0, color: { r: 0, g: 0.8, b: 0.7 } }, { position: 1, color: { r: 0.1, g: 0.2, b: 0.8 } }] }],
                  strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }],
                  strokeWeight: 2,
                  effects: [{ type: 'DROP_SHADOW', offset: { x: 0, y: 4 }, radius: 8, color: { r: 0, g: 0, b: 0, a: 0.2 } }],
                },
              ],
            },
            {
              id: '1:4',
              type: 'VECTOR',
              name: 'Mark',
              absoluteBoundingBox: { x: 400, y: 40, width: 100, height: 100 },
              fillGeometry: [{ path: 'M 0 0 L 100 0 L 50 100 Z', windingRule: 'NONZERO' }],
              fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.7, b: 0.6 } }],
            },
          ],
        },
      ],
    },
    components: {
      '1:10': { name: 'Button', componentSetId: '1:11' },
    },
    variables: {
      'var:1': { name: 'Spacing / Small', type: 'FLOAT', variableCollectionId: 'col:1', collectionName: 'Theme', modes: ['Light', 'Dark'], activeMode: 'Light', valuesByMode: { Light: 8, Dark: 8 } },
    },
  });
}

describe('Figma JSON importer', () => {
  it('recognizes official REST file JSON but not opaque binary .fig bytes', () => {
    expect(isFigmaJsonSource(fixture())).toBe(true);
    expect(isFigmaJsonSource(new Uint8Array([0x46, 0x49, 0x47, 0x00]))).toBe(false);
  });

  it('converts pages, auto layout, editable text, gradients, effects and paths', () => {
    const result = createFigmaParser().parse(fixture());
    expect(result.nodeIds).toHaveLength(1);
    expect(result.document.pages?.[0]?.name).toBe('Design');
    const nodes = Object.values(result.document.nodes);
    const card = nodes.find((node) => node.name === 'Card');
    const title = nodes.find((node) => node.name === 'Title');
    const accent = nodes.find((node) => node.name === 'Accent');
    const mark = nodes.find((node) => node.name === 'Mark');
    expect(card).toMatchObject({ kind: 'frame', layoutStyle: { mode: 'flex', direction: 'column', gap: 12, padding: [16, 16, 16, 16] } });
    expect(title).toMatchObject({ kind: 'text', text: 'Hello Varve', fontFamily: 'Inter', fontWeight: 700 });
    expect(accent).toMatchObject({ kind: 'shape', cornerRadius: [8, 8, 8, 8], strokes: [{ weight: 2 }], effects: [{ type: 'dropShadow' }] });
    expect(mark).toMatchObject({ kind: 'shape', shape: { kind: 'path', closed: true } });
    expect(validateDocument(result.document).valid).toBe(true);
    expect(DocumentCodec.normalize(result.document).document.pages).toHaveLength(1);
  });

  it('keeps source ids out of the native scene identity domain', () => {
    const result = createFigmaParser().parse(fixture());
    expect(Object.keys(result.document.nodes)).not.toContain('1:1');
    expect(Object.values(result.document.nodes).some((node) => node.id === node.name)).toBe(false);
  });

  it('reports missing image bytes and unsupported boolean semantics without aborting siblings', () => {
    const input = JSON.parse(fixture()) as Record<string, unknown>;
    const document = input.document as Record<string, unknown>;
    const page = (document.children as Array<Record<string, unknown>>)[0]!;
    const children = page.children as Array<Record<string, unknown>>;
    children.push({ id: '1:5', type: 'BOOLEAN_OPERATION', name: 'Union', absoluteBoundingBox: { x: 0, y: 0, width: 20, height: 20 }, booleanOperation: 'UNION', children: [] });
    children.push({ id: '1:6', type: 'RECTANGLE', name: 'Photo', absoluteBoundingBox: { x: 0, y: 0, width: 20, height: 20 }, fills: [{ type: 'IMAGE', imageRef: 'missing' }] });
    const result = createFigmaParser().parse(JSON.stringify(input));
    expect(result.nodeIds).toHaveLength(1);
    expect(result.warnings.join('\n')).toMatch(/image reference/i);
    expect(result.unsupportedFeatures).toEqual(expect.arrayContaining(['image paints without embedded bytes']));
    expect(result.unsupportedFeatures?.some((value) => value.includes('Boolean operation'))).toBe(true);
  });

  it('fails safely on excessive nesting', () => {
    let node: Record<string, unknown> = { id: 'deep', type: 'GROUP', name: 'deep', children: [] };
    for (let index = 0; index < 300; index += 1) node = { id: `deep-${index}`, type: 'GROUP', name: 'deep', children: [node] };
    const data = JSON.stringify({ document: { type: 'DOCUMENT', children: [{ id: 'page', type: 'CANVAS', name: 'Page', children: [node] }] } });
    expect(() => decodeFigmaSource(data)).toThrow(/depth/i);
  });

  it('routes through ImportService with a partial fidelity report', async () => {
    const report = await ImportService.importFiles([{ name: 'fixture.fig', text: fixture(), source: 'file-picker' }]);
    const file = report.files[0]!;
    expect(file.nodeCount).toBeGreaterThanOrEqual(0);
    expect(file.format).not.toBe('unknown');
  });
});
