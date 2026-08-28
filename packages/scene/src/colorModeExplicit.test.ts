import { describe, expect, it } from 'vitest';
import type { ColorConfig, ManagedColor } from './colorManagement';
import {
  assignDocumentColorMode,
  type ColorConversionReport,
  convertDocumentColors,
} from './colorMode';
import type { Document } from './document';

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
});
