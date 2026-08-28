import { describe, expect, it } from 'vitest';
import type { ColorConfig, ManagedColor } from './colorManagement';
import {
  assignDocumentColorMode,
  type ColorConversionReport,
  convertDocumentColors,
} from './colorMode';
import type { Document } from './document';
import { emptyTableModel } from './table';

function rgb(r: number, g: number, b: number, a = 255): ManagedColor {
  return { space: 'rgb' as const, r, g, b, a };
}

function cmyk(c: number, m: number, y: number, k: number, a = 255): ManagedColor {
  return { space: 'cmyk' as const, c, m, y, k, a };
}

function lab(l: number, av: number, b: number, a = 255): ManagedColor {
  return { space: 'lab' as const, l, av, b, a };
}

function spot(name: string): ManagedColor {
  return { space: 'spot' as const, name, tint: 100, a: 255 };
}

const defaultColorConfig: ColorConfig = {
  mode: 'rgb' as const,
  bitDepth: 'uint8' as const,
  workingSpace: 'srgb' as const,
  rgbProfile: { id: 'srgb', name: 'sRGB' },
  cmykProfile: { id: 'fogra39', name: 'Fogra39' },
  blackGeneration: { mode: 'standard' as const, overprintBlack: false },
};

function makeDoc(fill: ManagedColor): Document {
  return {
    id: 'test-doc',
    name: 'Test',
    formatVersion: '2.14',
    rootChildren: ['n1'],
    nodes: {
      n1: {
        id: 'n1',
        kind: 'shape' as const,
        name: 'Shape 1',
        fill,
        index: 0,
        order: 'a0',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal' as const,
        rotation: 0,
        shape: { kind: 'rect' as const, x: 0, y: 0, w: 100, h: 100 },
        transform: [1, 0, 0, 1, 0, 0],
        strokes: [],
        effects: [],
      },
    },
    components: {},
    nextId: 2,
    colorConfig: defaultColorConfig,
  };
}

describe('assignDocumentColorMode', () => {
  it('changes only the document mode — stored values are untouched', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    const out = assignDocumentColorMode(doc, 'cmyk');
    expect(out.colorConfig?.mode).toBe('cmyk');
    expect((out.nodes.n1 as { fill: ManagedColor }).fill).toEqual(rgb(255, 0, 0));
  });

  it('returns the same document when the mode is unchanged', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    expect(assignDocumentColorMode(doc, 'rgb')).toBe(doc);
  });

  it('never mutates the source document', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    assignDocumentColorMode(doc, 'grayscale');
    expect(doc.colorConfig?.mode).toBe('rgb');
  });
});

describe('convertDocumentColors', () => {
  it('rewrites process colors and reports counts', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    const { doc: out, report } = convertDocumentColors(doc, 'cmyk');
    expect((out.nodes.n1 as { fill: ManagedColor }).fill).toEqual(
      expect.objectContaining({ space: 'cmyk' }),
    );
    expect(report.converted).toBe(1);
    expect(report.spotsPreserved).toBe(0);
    expect(out.colorConfig?.mode).toBe('cmyk');
  });

  it('preserves spot references untouched and counts them', () => {
    const doc = makeDoc(spot('Pantone 185 C'));
    const { doc: out, report } = convertDocumentColors(doc, 'cmyk');
    expect((out.nodes.n1 as { fill: ManagedColor }).fill).toEqual(spot('Pantone 185 C'));
    expect(report.spotsPreserved).toBe(1);
    expect(report.converted).toBe(0);
  });

  it('leaves registration/unresolved colors alone and counts them as unsupported', () => {
    const reg: ManagedColor = { space: 'registration', a: 255 };
    const doc = makeDoc(reg);
    const { doc: out, report } = convertDocumentColors(doc, 'cmyk');
    expect((out.nodes.n1 as { fill: ManagedColor }).fill).toEqual(reg);
    expect(report.unsupported).toBe(1);
  });

  it('converts Lab fills through sRGB to the target mode', () => {
    const doc = makeDoc(lab(50, 20, 30));
    const { doc: out, report } = convertDocumentColors(doc, 'cmyk');
    const fill = (out.nodes.n1 as { fill: ManagedColor }).fill;
    expect(fill.space).toBe('cmyk');
    expect(report.converted).toBe(1);
    // Lab → sRGB → CMYK keeps alpha.
    expect(fill.a).toBe(255);
  });

  it('keeps CMYK values as-is when converting to cmyk', () => {
    const doc = makeDoc(cmyk(10, 20, 30, 40));
    const { doc: out, report } = convertDocumentColors(doc, 'cmyk');
    expect((out.nodes.n1 as { fill: ManagedColor }).fill).toEqual(cmyk(10, 20, 30, 40));
    expect(report.converted).toBe(0);
  });

  it('preserves uint16 precision and assigns the destination CMYK profile', () => {
    const source: ManagedColor = {
      space: 'rgb',
      bitDepth: 'uint16',
      r: 65535,
      g: 32768,
      b: 0,
      a: 65535,
      profile: 'display-p3',
    };
    const doc = {
      ...makeDoc(source),
      colorConfig: {
        ...defaultColorConfig,
        bitDepth: 'uint16' as const,
        cmykProfile: { id: 'fogra51', name: 'Fogra51', fingerprint: 'a'.repeat(64) },
      },
    };
    const { doc: out } = convertDocumentColors(doc, 'cmyk');
    const fill = (out.nodes.n1 as { fill: ManagedColor }).fill;
    expect(fill).toEqual(
      expect.objectContaining({
        space: 'cmyk',
        bitDepth: 'uint16',
        profile: 'fogra51',
        profileFingerprint: 'a'.repeat(64),
        a: 65535,
      }),
    );
    if (fill.space !== 'cmyk') return;
    expect(fill.m).toBeGreaterThan(255);
    expect(fill.y).toBe(65535);
  });

  it('uses the destination RGB profile instead of copying the CMYK source profile', () => {
    const source: ManagedColor = {
      space: 'cmyk',
      bitDepth: 'float32',
      c: 0.1,
      m: 0.2,
      y: 0.3,
      k: 0.4,
      a: 1,
      profile: 'fogra39',
    };
    const doc = {
      ...makeDoc(source),
      colorConfig: {
        ...defaultColorConfig,
        mode: 'cmyk' as const,
        bitDepth: 'float32' as const,
        rgbProfile: { id: 'display-p3', name: 'Display P3' },
      },
    };
    const { doc: out } = convertDocumentColors(doc, 'rgb');
    const fill = (out.nodes.n1 as { fill: ManagedColor }).fill;
    expect(fill).toEqual(
      expect.objectContaining({
        space: 'rgb',
        bitDepth: 'float32',
        profile: 'display-p3',
        a: 1,
      }),
    );
  });

  it('skips conversion when already in the target mode with a warning', () => {
    const doc = makeDoc(rgb(1, 2, 3));
    const { doc: out, report } = convertDocumentColors(doc, 'rgb');
    expect(out).toBe(doc);
    expect(report.warnings.some((w) => w.includes('already'))).toBe(true);
  });

  it('refuses ICC conversion without a converter and warns honestly', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    const { doc: out, report } = convertDocumentColors(doc, 'cmyk', { algorithm: 'icc' });
    expect(out).toBe(doc);
    expect(report.converted).toBe(0);
    expect(report.warnings.some((w) => w.includes('no ICC converter'))).toBe(true);
  });

  it('uses the supplied ICC converter when provided', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    const { doc: out, report } = convertDocumentColors(doc, 'cmyk', {
      algorithm: 'icc',
      iccConverter: (c) =>
        c.space === 'rgb' ? { space: 'cmyk', c: 0, m: 100, y: 100, k: 0, a: c.a } : null,
    });
    expect((out.nodes.n1 as { fill: ManagedColor }).fill).toEqual(cmyk(0, 100, 100, 0));
    expect(report.converted).toBe(0); // ICC path counts through the converter's report
  });

  it('labels analytical conversion as approximate in the report', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    const { report } = convertDocumentColors(doc, 'cmyk');
    expect(report.warnings.some((w) => w.includes('approximate'))).toBe(true);
  });

  it('returns a well-formed report shape', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    const { report } = convertDocumentColors(doc, 'grayscale');
    const expected: ColorConversionReport = expect.objectContaining({
      converted: expect.any(Number),
      spotsPreserved: expect.any(Number),
      unsupported: expect.any(Number),
      warnings: expect.any(Array),
    });
    expect(report).toEqual(expected);
  });

  it('converts nested color-bearing document properties without mutation', () => {
    const base = makeDoc(rgb(255, 0, 0));
    const gradient = {
      type: 'linear' as const,
      stops: [
        { position: 0, color: rgb(0, 255, 0) },
        { position: 1, color: rgb(0, 0, 255) },
      ],
    };
    const table = emptyTableModel();
    table.appearance = {
      ...table.appearance,
      headerFill: rgb(10, 20, 30),
      bodyText: rgb(40, 50, 60),
    };
    const nested = {
      ...base.nodes.n1,
      kind: 'text' as const,
      fills: [
        {
          type: 'gradient' as const,
          gradient,
          opacity: 1,
          blendMode: 'normal' as const,
          visible: true,
        },
      ],
      strokes: [
        {
          ...((base.nodes.n1 as { strokes: never[] }).strokes[0] ?? {
            color: rgb(0, 0, 0),
            weight: 1,
            align: 'center',
            dashPattern: [],
            dashOffset: 0,
            cap: 'butt',
            join: 'miter',
            miterLimit: 4,
            visible: true,
          }),
          color: rgb(1, 2, 3),
          gradient,
        },
      ],
      effects: [
        {
          type: 'glassMaterial' as const,
          blur: 2,
          tint: rgb(4, 5, 6),
          tintOpacity: 1,
          saturation: 1,
          brightness: 1,
          noise: 0,
          edgeHighlight: true,
          edgeHighlightWidth: 1,
          edgeHighlightColor: rgb(7, 8, 9),
          edgeHighlightOpacity: 1,
          visible: true,
        },
      ],
      richText: {
        paragraphs: [
          {
            format: { columnRuleColor: rgb(11, 12, 13) },
            runs: [{ text: 'nested', format: { color: rgb(14, 15, 16) } }],
          },
        ],
      },
    } as never;
    const originalNested = structuredClone(nested);
    const doc: Document = {
      ...base,
      nodes: {
        n1: nested,
        n2: { ...base.nodes.n1, kind: 'table', table } as never,
      },
      paints: {
        p1: {
          id: 'p1',
          name: 'Paint',
          fill: {
            type: 'solid',
            color: rgb(17, 18, 19),
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        },
      },
      styles: {
        s1: {
          id: 's1',
          name: 'Color',
          type: 'color',
          fill: {
            type: 'solid',
            color: rgb(20, 21, 22),
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        },
        s2: {
          id: 's2',
          name: 'Effect',
          type: 'effect',
          effects: [
            {
              type: 'dropShadow',
              x: 0,
              y: 0,
              blur: 1,
              spread: 0,
              color: rgb(23, 24, 25),
              opacity: 1,
              blendMode: 'normal',
              visible: true,
            },
          ],
        },
      },
      stories: {
        story: { id: 'story', name: 'Story', content: nested.richText, thread: ['n1'] },
      },
    };

    const { doc: out } = convertDocumentColors(doc, 'cmyk');
    const outNode = out.nodes.n1 as never as {
      fills: Array<{ gradient: { stops: Array<{ color: ManagedColor }> } }>;
      strokes: Array<{ gradient?: { stops: Array<{ color: ManagedColor }> } }>;
      effects: Array<{ tint?: ManagedColor; edgeHighlightColor?: ManagedColor }>;
      richText: {
        paragraphs: Array<{
          format?: { columnRuleColor?: ManagedColor };
          runs: Array<{ format?: { color?: ManagedColor } }>;
        }>;
      };
    };
    expect(outNode.fills[0]?.gradient.stops[0]?.color.space).toBe('cmyk');
    expect(outNode.strokes[0]?.gradient?.stops[1]?.color.space).toBe('cmyk');
    expect(outNode.effects[0]?.tint?.space).toBe('cmyk');
    expect(outNode.effects[0]?.edgeHighlightColor?.space).toBe('cmyk');
    expect(outNode.richText.paragraphs[0]?.format?.columnRuleColor?.space).toBe('cmyk');
    expect(outNode.richText.paragraphs[0]?.runs[0]?.format?.color?.space).toBe('cmyk');
    expect(
      out.nodes.n2 && 'table' in out.nodes.n2
        ? out.nodes.n2.table.appearance.headerFill.space
        : null,
    ).toBe('cmyk');
    expect(out.paints?.p1?.fill.color?.space).toBe('cmyk');
    expect(out.styles?.s1?.type === 'color' ? out.styles.s1.fill.color?.space : null).toBe('cmyk');
    expect(out.styles?.s2?.type === 'effect' ? out.styles.s2.effects[0]?.color.space : null).toBe(
      'cmyk',
    );
    expect(out.stories?.story?.content.paragraphs[0]?.runs[0]?.format?.color?.space).toBe('cmyk');
    expect(nested).toEqual(originalNested);
  });
});
