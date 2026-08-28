import { readFileSync } from 'node:fs';
import { DocumentCodec, validateDocument } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  createFigmaParser,
  decodeFigmaNativeSource,
  decodeFigmaSource,
  isFigmaJsonSource,
  isFigmaNativeSource,
} from './figma';
import { ImportService } from './service';

function nativeFixture(): Uint8Array {
  return new Uint8Array(readFileSync(new URL('../test-fixtures/OpenFigs.fig', import.meta.url)));
}

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
                  style: {
                    fontFamily: 'Inter',
                    fontSize: 20,
                    fontWeight: 700,
                    lineHeightPx: 24,
                    textAutoResize: 'HEIGHT',
                  },
                  fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 }, opacity: 1 }],
                  layoutSizingHorizontal: 'FILL',
                },
                {
                  id: '1:3',
                  type: 'RECTANGLE',
                  name: 'Accent',
                  absoluteBoundingBox: { x: 36, y: 82, width: 260, height: 48 },
                  rectangleCornerRadii: [8, 8, 8, 8],
                  fills: [
                    {
                      type: 'GRADIENT_LINEAR',
                      gradientStops: [
                        { position: 0, color: { r: 0, g: 0.8, b: 0.7 } },
                        { position: 1, color: { r: 0.1, g: 0.2, b: 0.8 } },
                      ],
                    },
                  ],
                  strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }],
                  strokeWeight: 2,
                  effects: [
                    {
                      type: 'DROP_SHADOW',
                      offset: { x: 0, y: 4 },
                      radius: 8,
                      color: { r: 0, g: 0, b: 0, a: 0.2 },
                    },
                  ],
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
      'var:1': {
        name: 'Spacing / Small',
        type: 'FLOAT',
        variableCollectionId: 'col:1',
        collectionName: 'Theme',
        modes: ['Light', 'Dark'],
        activeMode: 'Light',
        valuesByMode: { Light: 8, Dark: 8 },
      },
    },
  });
}

function nextFuzzValue(state: { value: number }): number {
  state.value = (state.value * 1_664_525 + 1_013_904_223) >>> 0;
  return state.value;
}

function malformedFigmaCorpusEntry(seed: number): string {
  const state = { value: seed >>> 0 };
  const random = () => nextFuzzValue(state);
  const pageChildren = Array.from({ length: random() % 5 }, (_, index) => ({
    id: index % 2 === 0 ? `fuzz:${seed}:${index}` : null,
    type: index % 3 === 0 ? 'FRAME' : index % 3 === 1 ? 'UNKNOWN_FUTURE_NODE' : 42,
    name: index % 2 === 0 ? `fuzz-${random()}` : { invalid: true },
    children: index % 2 === 0 ? [] : random() % 3 === 0 ? null : [{ type: 'RECTANGLE' }],
    opacity: random() % 4 === 0 ? 'not-a-number' : random() / 0xffffffff,
    absoluteBoundingBox: random() % 3 === 0 ? { x: Infinity, width: -1 } : undefined,
  }));
  return JSON.stringify({
    name: `fuzz-${seed}`,
    document: {
      type: seed % 7 === 0 ? 'DOCUMENT' : seed % 7 === 1 ? 'BROKEN_DOCUMENT' : null,
      children:
        seed % 5 === 0
          ? [{ type: 'CANVAS', id: `page:${seed}`, children: pageChildren }]
          : seed % 5 === 1
            ? pageChildren
            : null,
    },
    variables: seed % 4 === 0 ? { [`var:${seed}`]: { type: 'UNKNOWN', valuesByMode: null } } : null,
  });
}

describe('Figma JSON importer', () => {
  it('recognizes official REST file JSON without misclassifying native .fig bytes as JSON', () => {
    expect(isFigmaJsonSource(fixture())).toBe(true);
    expect(isFigmaJsonSource(new Uint8Array([0x46, 0x49, 0x47, 0x00]))).toBe(false);
  });

  it('decodes and converts an actual native .fig archive into editable Varve nodes', () => {
    const data = nativeFixture();
    expect(isFigmaNativeSource(data)).toBe(true);

    const source = decodeFigmaNativeSource(data);
    expect(source.pages.map((page) => page.name)).toEqual(['Page 1']);
    expect(source.pages[0]?.children).toHaveLength(1);
    expect(source.pages[0]?.children[0]?.type).toBe('FRAME');
    expect(source.pages[0]?.children[0]?.children[0]?.type).toBe('VECTOR');
    expect(source.pages[0]?.children[0]?.transform).toEqual([1, 0, 0, 1, 0, 0]);

    const result = createFigmaParser().parse(data);
    const nodes = Object.values(result.document.nodes);
    expect(result.nodeIds).toHaveLength(1);
    expect(result.document.pages?.[0]?.name).toBe('Page 1');
    expect(nodes.some((node) => node.name === 'WhiteOpenFigOutlinedIcon')).toBe(true);
    expect(nodes.some((node) => node.kind === 'shape' && node.shape?.kind === 'path')).toBe(true);
    expect(result.warnings).not.toContain(expect.stringMatching(/opaque native/i));
    expect(validateDocument(result.document).valid).toBe(true);
  });

  it('reports malformed native archives as a failed import without nodes', () => {
    const data = nativeFixture();
    const endSignature = [0x50, 0x4b, 0x05, 0x06];
    let endOffset = -1;
    for (let offset = data.length - 22; offset >= 0; offset -= 1) {
      if (endSignature.every((byte, index) => data[offset + index] === byte)) {
        endOffset = offset;
        break;
      }
    }
    expect(endOffset).toBeGreaterThanOrEqual(0);
    const malformed = data.slice();
    new DataView(malformed.buffer, malformed.byteOffset, malformed.byteLength).setUint32(
      endOffset + 12,
      1,
      true,
    );

    const result = createFigmaParser().parse(malformed);
    expect(result.nodeIds).toEqual([]);
    expect(result.unsupportedFeatures).toContain('native .fig decoding');
    expect(result.warnings[0]).toMatch(/could not be decoded safely/i);
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
    expect(card).toMatchObject({
      kind: 'frame',
      layoutStyle: { mode: 'flex', direction: 'column', gap: 12, padding: [16, 16, 16, 16] },
    });
    expect(title).toMatchObject({
      kind: 'text',
      text: 'Hello Varve',
      fontFamily: 'Inter',
      fontWeight: 700,
    });
    expect(accent).toMatchObject({
      kind: 'shape',
      cornerRadius: [8, 8, 8, 8],
      strokes: [{ weight: 2 }],
      effects: [{ type: 'dropShadow' }],
    });
    expect(mark).toMatchObject({ kind: 'shape', shape: { kind: 'path', closed: true } });
    expect(validateDocument(result.document).valid).toBe(true);
    expect(DocumentCodec.normalize(result.document).document.pages).toHaveLength(1);
  });

  it('preserves normalized Figma gradient handles as an affine field', () => {
    const input = JSON.parse(fixture()) as Record<string, any>;
    const accent = input.document.children[0].children[0].children[1];
    accent.fills[0].gradientHandlePositions = [
      { x: 0.2, y: 0.3 },
      { x: 0.9, y: 0.45 },
      { x: 0.35, y: 0.95 },
    ];
    const result = createFigmaParser().parse(JSON.stringify(input));
    const imported = Object.values(result.document.nodes).find((node) => node.name === 'Accent');
    const transform = imported?.fills?.[0]?.gradient?.transform;
    expect(transform).toBeDefined();
    expect(transform).toHaveLength(6);
    transform?.forEach((value, index) => {
      expect(value).toBeCloseTo([182, 7.2, -104, 55.2, 104, -13.2][index]!, 12);
    });
    expect(imported?.fills?.[0]?.gradient?.rotation).toBeUndefined();
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
    children.push({
      id: '1:5',
      type: 'BOOLEAN_OPERATION',
      name: 'Union',
      absoluteBoundingBox: { x: 0, y: 0, width: 20, height: 20 },
      booleanOperation: 'UNION',
      children: [],
    });
    children.push({
      id: '1:6',
      type: 'RECTANGLE',
      name: 'Photo',
      absoluteBoundingBox: { x: 0, y: 0, width: 20, height: 20 },
      fills: [{ type: 'IMAGE', imageRef: 'missing' }],
    });
    const result = createFigmaParser().parse(JSON.stringify(input));
    expect(result.nodeIds).toHaveLength(1);
    expect(result.warnings.join('\n')).toMatch(/image reference/i);
    expect(result.unsupportedFeatures).toEqual(
      expect.arrayContaining(['image paints without embedded bytes']),
    );
    expect(result.unsupportedFeatures?.some((value) => value.includes('Boolean operation'))).toBe(
      true,
    );
  });

  it('fails safely on excessive nesting', () => {
    let node: Record<string, unknown> = { id: 'deep', type: 'GROUP', name: 'deep', children: [] };
    for (let index = 0; index < 300; index += 1)
      node = { id: `deep-${index}`, type: 'GROUP', name: 'deep', children: [node] };
    const data = JSON.stringify({
      document: {
        type: 'DOCUMENT',
        children: [{ id: 'page', type: 'CANVAS', name: 'Page', children: [node] }],
      },
    });
    expect(() => decodeFigmaSource(data)).toThrow(/depth/i);
  });

  it('survives a deterministic malformed JSON corpus without non-error escapes', () => {
    for (let seed = 0; seed < 256; seed += 1) {
      const data = malformedFigmaCorpusEntry(seed);
      expect(() => isFigmaJsonSource(data)).not.toThrow();
      try {
        decodeFigmaSource(data);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    }
  });

  it('routes through ImportService with a partial fidelity report', async () => {
    const report = await ImportService.importFiles([
      { name: 'fixture.fig', text: fixture(), source: 'file-picker' },
    ]);
    const file = report.files[0]!;
    expect(file.nodeCount).toBeGreaterThanOrEqual(0);
    expect(file.format).not.toBe('unknown');
  });

  it('preserves component sets, grid/export metadata, masks and unknown children', () => {
    const input = JSON.parse(fixture()) as Record<string, unknown>;
    const document = input.document as Record<string, unknown>;
    const page = (document.children as Array<Record<string, unknown>>)[0]!;
    const children = page.children as Array<Record<string, unknown>>;
    children.push({
      id: 'set:1',
      type: 'COMPONENT_SET',
      name: 'Button',
      absoluteBoundingBox: { x: 20, y: 240, width: 120, height: 48 },
      componentPropertyDefinitions: {
        Size: { type: 'VARIANT', defaultValue: 'Small' },
      },
      children: [
        {
          id: 'component:small',
          type: 'COMPONENT',
          name: 'Size=Small',
          componentSetId: 'set:1',
          variantProperties: { Size: 'Small' },
          absoluteBoundingBox: { x: 20, y: 240, width: 120, height: 48 },
        },
      ],
    });
    children.push({
      id: 'instance:1',
      type: 'INSTANCE',
      name: 'Button instance',
      componentId: 'component:small',
      absoluteBoundingBox: { x: 180, y: 240, width: 120, height: 48 },
    });
    children.push({
      id: 'grid:1',
      type: 'FRAME',
      name: 'Grid frame',
      layoutMode: 'GRID',
      layoutGrids: [{ pattern: 'COLUMNS', count: 4, gutterSize: 16, sectionSize: 80 }],
      exportSettings: [{ format: 'PNG', suffix: '@2x', constraint: { type: 'SCALE', value: 2 } }],
      absoluteBoundingBox: { x: 20, y: 320, width: 360, height: 200 },
      children: [],
    });
    children.push({
      id: 'mask:frame',
      type: 'FRAME',
      name: 'Masked frame',
      absoluteBoundingBox: { x: 400, y: 240, width: 100, height: 100 },
      children: [
        {
          id: 'mask:shape',
          type: 'ELLIPSE',
          name: 'Mask',
          isMask: true,
          absoluteBoundingBox: { x: 400, y: 240, width: 100, height: 100 },
        },
        {
          id: 'mask:content',
          type: 'RECTANGLE',
          name: 'Masked content',
          absoluteBoundingBox: { x: 400, y: 240, width: 100, height: 100 },
        },
      ],
    });
    children.push({
      id: 'unknown:container',
      type: 'NEW_FIGMA_CONTAINER',
      name: 'Future container',
      absoluteBoundingBox: { x: 520, y: 240, width: 100, height: 100 },
      children: [
        {
          id: 'unknown:child',
          type: 'RECTANGLE',
          name: 'Future child',
          absoluteBoundingBox: { x: 520, y: 240, width: 20, height: 20 },
        },
      ],
    });
    input.components = {
      ...(input.components as Record<string, unknown>),
      'component:small': { name: 'Size=Small', componentSetId: 'set:1' },
    };
    input.componentSets = { 'set:1': { name: 'Button' } };

    const result = createFigmaParser().parse(JSON.stringify(input));
    const nodes = Object.values(result.document.nodes);
    const grid = nodes.find((node) => node.name === 'Grid frame');
    const mask = nodes.find((node) => node.name === 'Masked frame');
    const future = nodes.find((node) => node.name === 'Future container');
    expect(grid).toMatchObject({
      kind: 'frame',
      layoutStyle: { mode: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' },
      presets: [{ format: 'png', scale: { type: 'factor', value: 2 } }],
    });
    expect(result.document.gridSettings?.layoutGrids).toBeDefined();
    expect(mask).toMatchObject({ mask: { hideMaskSource: true, type: 'alpha' } });
    expect(future).toMatchObject({ kind: 'group', children: [expect.any(String)] });
    expect(Object.values(result.document.components)[0]?.variants).toEqual([
      expect.objectContaining({ name: 'Size=Small', propertyValues: { Size: 'Small' } }),
    ]);
  });

  it('applies import scale at the page-content boundary', () => {
    const result = createFigmaParser().parse(fixture(), { scale: 2 });
    expect(result.document.pages?.[0]?.width).toBe(1280);
    const contentRoot = result.document.pages?.[0]?.contentRoot;
    expect(contentRoot && result.document.nodes[contentRoot]?.transform).toEqual([
      2, 0, 0, 2, 0, 0,
    ]);
  });
});
