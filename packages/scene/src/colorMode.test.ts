import { describe, expect, it } from 'vitest';
import type { ColorConfig, ManagedColor } from './colorManagement';
import {
  setDocumentBitDepth,
  setDocumentGradientInterpolation,
  setDocumentWorkingSpace,
  switchColorMode,
} from './colorMode';
import type { Document } from './document';

function rgb(r: number, g: number, b: number, a = 255): ManagedColor {
  return { space: 'rgb' as const, r, g, b, a };
}

function cmyk(c: number, m: number, y: number, k: number, a = 255): ManagedColor {
  return { space: 'cmyk' as const, c, m, y, k, a };
}

function gray(v: number, a = 255): ManagedColor {
  return { space: 'gray' as const, v, a };
}

const defaultColorConfig: ColorConfig = {
  mode: 'rgb' as const,
  bitDepth: 'uint8' as const,
  workingSpace: 'srgb' as const,
  rgbProfile: { id: 'srgb', name: 'sRGB' },
  cmykProfile: { id: 'fogra39', name: 'Fogra39' },
  blackGeneration: { mode: 'standard' as const, overprintBlack: false },
};

function makeDoc(color: ManagedColor): Document {
  return {
    id: 'test-doc',
    name: 'Test',
    formatVersion: '1.0',
    rootChildren: ['n1'],
    nodes: {
      n1: {
        id: 'n1',
        kind: 'shape' as const,
        name: 'Shape 1',
        fill: color,
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

describe('switchColorMode', () => {
  it('converts RGB to CMYK', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    const result = switchColorMode(doc, 'cmyk');
    expect(result.colorConfig?.mode).toBe('cmyk');
    const n = result.nodes.n1;
    expect(n?.fill.space).toBe('cmyk');
  });

  it('converts CMYK to RGB', () => {
    const cmkyCfg: ColorConfig = { ...defaultColorConfig, mode: 'cmyk' };
    const doc = makeDoc(cmyk(0, 100, 100, 0));
    const docWithMode = { ...doc, colorConfig: cmkyCfg };
    const result = switchColorMode(docWithMode, 'rgb');
    expect(result.colorConfig?.mode).toBe('rgb');
    const n = result.nodes.n1;
    expect(n?.fill.space).toBe('rgb');
  });

  it('converts RGB to grayscale', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    const result = switchColorMode(doc, 'grayscale');
    expect(result.colorConfig?.mode).toBe('grayscale');
    const n = result.nodes.n1;
    expect(n?.fill.space).toBe('gray');
  });

  it('converts CMYK to grayscale', () => {
    const cmkyCfg: ColorConfig = { ...defaultColorConfig, mode: 'cmyk' };
    const doc = makeDoc(cmyk(0, 100, 100, 0));
    const docWithMode = { ...doc, colorConfig: cmkyCfg };
    const result = switchColorMode(docWithMode, 'grayscale');
    expect(result.colorConfig?.mode).toBe('grayscale');
    const n = result.nodes.n1;
    expect(n?.fill.space).toBe('gray');
  });

  it('converts grayscale to RGB', () => {
    const grayCfg: ColorConfig = { ...defaultColorConfig, mode: 'grayscale' };
    const doc = makeDoc(gray(128));
    const docWithMode = { ...doc, colorConfig: grayCfg };
    const result = switchColorMode(docWithMode, 'rgb');
    expect(result.colorConfig?.mode).toBe('rgb');
    const n = result.nodes.n1;
    expect(n?.fill.space).toBe('rgb');
  });

  it('converts grayscale to CMYK', () => {
    const grayCfg: ColorConfig = { ...defaultColorConfig, mode: 'grayscale' };
    const doc = makeDoc(gray(128));
    const docWithMode = { ...doc, colorConfig: grayCfg };
    const result = switchColorMode(docWithMode, 'cmyk');
    expect(result.colorConfig?.mode).toBe('cmyk');
    const n = result.nodes.n1;
    expect(n?.fill.space).toBe('cmyk');
  });

  it('converts colors in strokes', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    const node = doc.nodes.n1;
    if (node && 'strokes' in node) {
      node.strokes = [
        {
          color: rgb(0, 255, 0),
          weight: 1,
          align: 'center',
          dashPattern: [],
          dashOffset: 0,
          cap: 'round',
          join: 'miter',
          miterLimit: 4,
          visible: true,
        },
      ];
    }
    const result = switchColorMode(doc, 'cmyk');
    const n = result.nodes.n1;
    if (n && 'strokes' in n) {
      const stroke = n.strokes[0];
      expect(stroke?.color.space).toBe('cmyk');
    }
  });

  it('converts colors in effects', () => {
    const doc = makeDoc(rgb(128, 128, 128));
    const node = doc.nodes.n1;
    if (node && 'effects' in node) {
      (node as { effects: import('./types').Effect[] }).effects = [
        {
          type: 'dropShadow' as const,
          x: 2,
          y: 2,
          blur: 4,
          spread: 0,
          color: rgb(0, 0, 0),
          opacity: 0.5,
          blendMode: 'normal' as const,
          visible: true,
        },
      ];
    }
    const result = switchColorMode(doc, 'cmyk');
    const n = result.nodes.n1;
    if (n && 'effects' in n && n.effects.length > 0) {
      const effect = n.effects[0]!;
      if (effect.type === 'dropShadow') {
        expect(effect.color.space).toBe('cmyk');
      }
    }
  });

  it('converts gradient stop colors', () => {
    const doc = makeDoc(rgb(255, 255, 255));
    const node = doc.nodes.n1;
    if (node && 'fills' in node) {
      node.fills = [
        {
          type: 'gradient',
          gradient: {
            type: 'linear',
            stops: [
              { position: 0, color: rgb(255, 0, 0) },
              { position: 1, color: rgb(0, 0, 255) },
            ],
          },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ];
    }
    const result = switchColorMode(doc, 'cmyk');
    const n = result.nodes.n1;
    if (n && 'fills' in n && n.fills?.[0]?.gradient) {
      for (const stop of n.fills[0].gradient.stops) {
        expect(stop.color.space).toBe('cmyk');
      }
    }
  });

  it('RGB to CMYK preserves alpha', () => {
    const doc = makeDoc(rgb(100, 150, 200, 128));
    const result = switchColorMode(doc, 'cmyk');
    const n = result.nodes.n1;
    if (!n) throw new Error('Expected migrated node n1');
    expect(n?.fill.space).toBe('cmyk');
    expect((n.fill as { a: number }).a).toBe(128);
  });

  it('returns document unchanged when mode is already same', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    const result = switchColorMode(doc, 'rgb');
    expect(result).toBe(doc);
  });

  // A freshly created document has no colorConfig at all — document.ts only
  // sets one when a colorMode is explicitly passed at creation time (not the
  // normal path). Switching modes on such a document must still persist the
  // requested mode, not silently leave colorConfig undefined.
  it('sets colorConfig.mode to grayscale when the document had no colorConfig at all', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    const docWithoutConfig = { ...doc, colorConfig: undefined };
    const result = switchColorMode(docWithoutConfig, 'grayscale');
    expect(result.colorConfig?.mode).toBe('grayscale');
    const n = result.nodes.n1;
    expect(n?.fill.space).toBe('gray');
  });

  it('sets colorConfig.mode to cmyk when the document had no colorConfig at all', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    const docWithoutConfig = { ...doc, colorConfig: undefined };
    const result = switchColorMode(docWithoutConfig, 'cmyk');
    expect(result.colorConfig?.mode).toBe('cmyk');
  });
});

describe('setDocumentBitDepth', () => {
  it('updates the document default bit depth without touching values', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    const next = setDocumentBitDepth(doc, 'uint16');
    expect(next.colorConfig?.bitDepth).toBe('uint16');
    // Node values untouched.
    expect(next.nodes.n1?.fill).toEqual(doc.nodes.n1?.fill);
  });

  it('is a no-op when the depth is already set', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    expect(setDocumentBitDepth(doc, 'uint8')).toBe(doc);
  });

  it('fills missing colorConfig with defaults first', () => {
    const bare = { ...makeDoc(rgb(255, 0, 0)), colorConfig: undefined };
    const next = setDocumentBitDepth(bare, 'float32');
    expect(next.colorConfig?.bitDepth).toBe('float32');
    expect(next.colorConfig?.mode).toBe('rgb');
  });
});

describe('setDocumentWorkingSpace', () => {
  it('updates the working space', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    const next = setDocumentWorkingSpace(doc, 'linear');
    expect(next.colorConfig?.workingSpace).toBe('linear');
    expect(next.nodes.n1?.fill).toEqual(doc.nodes.n1?.fill);
  });

  it('is a no-op when unchanged', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    expect(setDocumentWorkingSpace(doc, 'srgb')).toBe(doc);
  });
});

describe('setDocumentGradientInterpolation', () => {
  it('persists the document default without rewriting authored colors', () => {
    const doc = makeDoc(rgb(255, 0, 0));
    const next = setDocumentGradientInterpolation(doc, 'oklch');
    expect(next.colorConfig?.defaultGradientInterpolation).toBe('oklch');
    expect(next.nodes.n1?.fill).toEqual(doc.nodes.n1?.fill);
  });

  it('fills missing color configuration and is a no-op when unchanged', () => {
    const doc = { ...makeDoc(rgb(255, 0, 0)), colorConfig: undefined };
    const next = setDocumentGradientInterpolation(doc, 'linear-srgb');
    expect(next.colorConfig?.defaultGradientInterpolation).toBe('linear-srgb');
    const same = setDocumentGradientInterpolation(next, 'linear-srgb');
    expect(same).toBe(next);
  });
});
