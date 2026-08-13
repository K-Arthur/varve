/**
 * High-precision color numerical regression suite.
 *
 * Screenshots cannot prove >8-bit precision. These tests assert, with
 * numbers, that the canonical document representation survives:
 *  - uint16 values that collapse to the same 8-bit value stay distinct;
 *  - float32 channel values survive save/reopen without drift;
 *  - CMYK channels and their bit depth survive save/reopen;
 *  - legacy RGBA8 migration is exact at boundary values;
 *  - repeated save/reopen cycles are deterministic (no progressive loss).
 *
 * A "save/reopen cycle" is serializeDocument → migrateDocumentJson, the
 * canonical persistence path (JSON numbers; floats are exact in IEEE-754
 * doubles, and integer channels are never rounded by the codec).
 */

import { describe, expect, it } from 'vitest';
import type { ColorConfig, ManagedColor } from './colorManagement';
import { migrateDocumentJson, serializeDocument } from './version';

function rgb(
  r: number,
  g: number,
  b: number,
  a: number,
  bitDepth?: ColorConfig['bitDepth'],
): ManagedColor {
  return { space: 'rgb', r, g, b, a, ...(bitDepth ? { bitDepth } : {}) } as ManagedColor;
}

function cmyk(
  c: number,
  m: number,
  y: number,
  k: number,
  a: number,
  bitDepth?: ColorConfig['bitDepth'],
): ManagedColor {
  return { space: 'cmyk', c, m, y, k, a, ...(bitDepth ? { bitDepth } : {}) } as ManagedColor;
}

const defaultColorConfig: ColorConfig = {
  mode: 'rgb',
  bitDepth: 'uint8',
  workingSpace: 'srgb',
  rgbProfile: { id: 'srgb', name: 'sRGB' },
  cmykProfile: { id: 'fogra39', name: 'Fogra39' },
  blackGeneration: { mode: 'standard', overprintBlack: false },
};

function makeDoc(color: ManagedColor): Record<string, unknown> {
  return {
    id: 'reg-doc',
    name: 'Regression',
    formatVersion: '1.0',
    rootChildren: ['n1'],
    nodes: {
      n1: {
        id: 'n1',
        kind: 'shape',
        name: 'Shape 1',
        fill: color,
        index: 0,
        order: 'a0',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        rotation: 0,
        shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
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

/** One save → reopen cycle. Returns the reopened fill color. */
function saveReopen(doc: Record<string, unknown>): ManagedColor {
  const json = serializeDocument(doc);
  const reopened = migrateDocumentJson(json);
  expect(reopened).not.toBeNull();
  const nodes = (reopened as { nodes: Record<string, unknown> }).nodes;
  const node = nodes.n1 as { fill: ManagedColor };
  return node.fill;
}

describe('high-precision color persistence', () => {
  it('adjacent uint16 values stay distinct through save/reopen', () => {
    // 32768 and 32769 collapse to the same 8-bit value (128) — they must
    // remain distinguishable in canonical storage.
    const a = saveReopen(makeDoc(rgb(32768, 40951, 47923, 65535, 'uint16')));
    const b = saveReopen(makeDoc(rgb(32769, 40951, 47923, 65535, 'uint16')));
    expect(a.space).toBe('rgb');
    expect(b.space).toBe('rgb');
    if (a.space === 'rgb' && b.space === 'rgb') {
      expect(a.r).toBe(32768);
      expect(b.r).toBe(32769);
      expect(a.r).not.toBe(b.r);
    }
  });

  it('float32 channel values survive save/reopen exactly', () => {
    const reopened = saveReopen(makeDoc(rgb(0.500015, 0.624817, 0.731232, 0.5, 'float32')));
    expect(reopened.space).toBe('rgb');
    if (reopened.space === 'rgb') {
      expect(reopened.r).toBeCloseTo(0.500015, 12);
      expect(reopened.g).toBeCloseTo(0.624817, 12);
      expect(reopened.b).toBeCloseTo(0.731232, 12);
      expect(reopened.a).toBeCloseTo(0.5, 12);
      expect(reopened.bitDepth).toBe('float32');
    }
  });

  it('more than 256 distinct normalized levels survive a working pass', () => {
    // 512 levels in a float document: serialize the full ramp, reopen, and
    // count distinct values.
    const doc = makeDoc(rgb(0, 0, 0, 1, 'float32'));
    const nodes = doc.nodes as Record<string, { fill: ManagedColor }>;
    const levels = 512;
    const distinct = new Set<number>();
    for (let i = 0; i < levels; i++) {
      const v = i / (levels - 1);
      nodes.n1!.fill = rgb(v, v, v, 1, 'float32');
      const reopened = saveReopen(doc);
      if (reopened.space === 'rgb') distinct.add(reopened.r);
    }
    expect(distinct.size).toBe(levels);
  });

  it('uint16 CMYK channels survive save/reopen', () => {
    const reopened = saveReopen(makeDoc(cmyk(0, 0, 0, 65535, 65535, 'uint16')));
    expect(reopened.space).toBe('cmyk');
    if (reopened.space === 'cmyk') {
      expect(reopened.c).toBe(0);
      expect(reopened.m).toBe(0);
      expect(reopened.y).toBe(0);
      expect(reopened.k).toBe(65535);
      expect(reopened.a).toBe(65535);
      expect(reopened.bitDepth).toBe('uint16');
    }
  });

  it('float CMYK channels survive save/reopen', () => {
    const reopened = saveReopen(makeDoc(cmyk(0.25, 0.5, 0.75, 1, 0.5, 'float32')));
    expect(reopened.space).toBe('cmyk');
    if (reopened.space === 'cmyk') {
      expect(reopened.c).toBeCloseTo(0.25, 12);
      expect(reopened.m).toBeCloseTo(0.5, 12);
      expect(reopened.y).toBeCloseTo(0.75, 12);
      expect(reopened.k).toBeCloseTo(1, 12);
    }
  });

  it('repeated save/reopen cycles do not progressively quantize', () => {
    const original = rgb(32768, 32769, 65535, 65535, 'uint16');
    let doc = makeDoc(original);
    for (let cycle = 0; cycle < 5; cycle++) {
      const fill = saveReopen(doc);
      doc = {
        ...doc,
        nodes: {
          ...(doc.nodes as object),
          n1: { ...(doc.nodes as Record<string, Record<string, unknown>>).n1, fill },
        },
      };
    }
    const final = (doc.nodes as Record<string, { fill: ManagedColor }>).n1!.fill;
    expect(final.space).toBe('rgb');
    if (final.space === 'rgb') {
      expect(final.r).toBe(32768);
      expect(final.g).toBe(32769);
      expect(final.b).toBe(65535);
    }
  });

  it('zero-alpha RGB components are preserved (nondestructive storage)', () => {
    const reopened = saveReopen(makeDoc(rgb(128, 200, 50, 0, 'uint16')));
    expect(reopened.space).toBe('rgb');
    if (reopened.space === 'rgb') {
      expect(reopened.r).toBe(128);
      expect(reopened.g).toBe(200);
      expect(reopened.b).toBe(50);
      expect(reopened.a).toBe(0);
    }
  });

  it('very small alpha survives in float documents', () => {
    const reopened = saveReopen(makeDoc(rgb(0.1, 0.2, 0.3, 0.0001, 'float32')));
    expect(reopened.space).toBe('rgb');
    if (reopened.space === 'rgb') {
      expect(reopened.a).toBeCloseTo(0.0001, 12);
    }
  });
});

describe('legacy RGBA8 migration exactness', () => {
  it('boundary values migrate without shifting', () => {
    const boundaries = [0, 1, 127, 128, 254, 255];
    for (const v of boundaries) {
      const reopened = saveReopen(
        makeDoc({ space: 'rgb', r: v, g: v, b: v, a: 255 } as ManagedColor),
      );
      expect(reopened.space).toBe('rgb');
      if (reopened.space === 'rgb') {
        expect(reopened.r).toBe(v);
        expect(reopened.g).toBe(v);
        expect(reopened.b).toBe(v);
      }
    }
  });

  it('legacy appearance stays stable: open → save → reopen is lossless', () => {
    const doc = makeDoc(rgb(255, 0, 0, 255)); // uint8 default (legacy-style)
    const reopened = saveReopen(doc);
    const again = saveReopen({
      ...doc,
      nodes: {
        n1: { ...(doc.nodes as Record<string, Record<string, unknown>>).n1, fill: reopened },
      },
    });
    expect(again.space).toBe('rgb');
    if (again.space === 'rgb') {
      expect(again.r).toBe(255);
      expect(again.g).toBe(0);
      expect(again.b).toBe(0);
      expect(again.a).toBe(255);
    }
  });
});
