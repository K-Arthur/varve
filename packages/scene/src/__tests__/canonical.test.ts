/**
 * Canonical serialization tests (ADR-0027).
 *
 * - schema-driven property ordering
 * - stable map ordering; authored-order arrays preserved
 * - number policy (-0 → 0, NaN/Infinity rejected)
 * - payload exclusion (dataUrl → asset:<id> references)
 * - idempotence and parse→reserialize stability
 * - canonical hash stability and content sensitivity
 */
import { describe, expect, it } from 'vitest';
import {
  CanonicalizationError,
  canonicalHash,
  canonicalHistoryHash,
  canonicalizeDocument,
} from '../canonical';
import type { Document } from '../document';
import {
  addNode,
  createDocument,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
} from '../document';
import { solidFill } from '../fills';

function richDocument(): Document {
  let doc = createDocument('canonical', { flat: true });
  const frame = makeFrameNode('f1', {
    w: 800,
    h: 600,
    children: ['n1', 'n2'],
    clipContent: true,
  });
  doc = addNode(doc, frame);
  const rect = makeShapeNode('n1', { kind: 'rect', x: 10, y: 20, w: 100, h: 50 });
  doc = addNode(doc, rect);
  const text = makeTextNode('n2', 'hello', { fontSize: 24, fontWeight: 700 });
  doc = addNode(doc, text);
  const group = makeGroupNode('n3', { children: ['n4'] });
  doc = addNode(doc, group);
  const circle = makeShapeNode('n4', { kind: 'circle', cx: 5, cy: 5, r: 5 });
  doc = addNode(doc, circle);
  // style + paint + asset
  doc = {
    ...doc,
    styles: {
      s1: {
        id: 's1',
        type: 'color',
        name: 'Teal',
        fill: solidFill({ space: 'rgb', r: 57, g: 208, b: 198, a: 255 }),
      },
    },
    assets: {
      'asset-abc': {
        id: 'asset-abc',
        storage: 'embedded',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        naturalWidth: 1,
        naturalHeight: 1,
        byteLength: 12,
        hash: 'abc',
      },
    },
  } as Document;
  return doc;
}

describe('canonicalizeDocument', () => {
  it('orders document keys per schema and sorts map keys', () => {
    const doc = richDocument();
    const text = canonicalizeDocument(doc);
    // id, formatVersion, name before content collections
    const idIndex = text.indexOf('"id"');
    const versionIndex = text.indexOf('"formatVersion"');
    const nodesIndex = text.indexOf('"nodes"');
    expect(idIndex).toBeGreaterThanOrEqual(0);
    expect(versionIndex).toBeGreaterThan(idIndex);
    expect(nodesIndex).toBeGreaterThan(versionIndex);
  });

  it('preserves authored order of children arrays', () => {
    const doc = richDocument();
    const text = canonicalizeDocument(doc);
    // children of f1: ["n1","n2"] — authored order must survive
    expect(text).toContain('["n1","n2"]');
  });

  it('orders node keys: id, kind, name first; kind-specific fields after base', () => {
    const doc = richDocument();
    const text = canonicalizeDocument(doc);
    // A shape node serializes id,kind,name before shape geometry
    const m = /"kind":"shape".{0,2000}"shape":\{/.exec(text);
    expect(m).not.toBeNull();
    // id precedes kind for the same node
    const idAt = text.indexOf('"id":"n1"');
    const kindAt = text.indexOf('"kind":"shape"', idAt);
    expect(kindAt).toBeGreaterThan(idAt);
  });

  it('is idempotent: canonicalize(canonicalize(doc)) === canonicalize(doc)', () => {
    const doc = richDocument();
    const once = canonicalizeDocument(doc);
    const twice = canonicalizeDocument(JSON.parse(once) as Document);
    expect(twice).toBe(once);
  });

  it('is stable under object key insertion order changes', () => {
    const doc = richDocument();
    const a = canonicalizeDocument(doc);
    // Deep-copy with shuffled top-level key order
    const shuffled: Record<string, unknown> = {};
    const keys = Object.keys(doc).sort((x, y) => (x < y ? 1 : -1));
    for (const k of keys) shuffled[k] = (doc as unknown as Record<string, unknown>)[k];
    const b = canonicalizeDocument(shuffled as unknown as Document);
    expect(b).toBe(a);
  });

  it('normalizes -0 and rejects NaN/Infinity', () => {
    const doc = richDocument();
    const withNegZero = {
      ...doc,
      canvasWidth: -0,
    } as Document;
    const parsed = JSON.parse(canonicalizeDocument(withNegZero)) as { canvasWidth: number };
    expect(Object.is(parsed.canvasWidth, -0)).toBe(false);
    expect(parsed.canvasWidth).toBe(0);

    const withNan = { ...doc, canvasWidth: Number.NaN } as Document;
    expect(() => canonicalizeDocument(withNan)).toThrow(CanonicalizationError);
    const withInf = { ...doc, canvasWidth: Number.POSITIVE_INFINITY } as Document;
    expect(() => canonicalizeDocument(withInf)).toThrow(CanonicalizationError);
  });

  it('excludes binary payloads in favor of content references', () => {
    const doc = richDocument();
    const text = canonicalizeDocument(doc);
    expect(text).not.toContain('data:image/png');
    expect(text).toContain('"dataUrl":"asset:asset-abc"');
  });

  it('includes payloads when requested', () => {
    const doc = richDocument();
    const text = canonicalizeDocument(doc, { excludePayloads: false });
    expect(text).toContain('data:image/png;base64,iVBORw0KGgo=');
  });

  it('does not Unicode-normalize authored strings', () => {
    const doc = { ...richDocument(), name: 'caf\u00e9' } as Document;
    const text = canonicalizeDocument(doc);
    expect(text).toContain('caf\u00e9');
  });

  it('omits undefined and preserves null', () => {
    const doc = {
      ...richDocument(),
      canvasWidth: undefined,
      dpi: null,
    } as unknown as Document;
    const text = canonicalizeDocument(doc);
    expect(text).not.toContain('"canvasWidth"');
    expect(text).toContain('"dpi":null');
  });

  it('serializes compound path contours in authored order', () => {
    const doc = {
      ...richDocument(),
      nodes: {
        ...richDocument().nodes,
        compound: makeShapeNode('compound', {
          kind: 'path',
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: null },
            { x: 10, y: 0, handleIn: null, handleOut: null },
            { x: 10, y: 10, handleIn: null, handleOut: null },
          ],
          contours: [
            [
              { x: 0, y: 0, handleIn: null, handleOut: null },
              { x: 10, y: 0, handleIn: null, handleOut: null },
              { x: 10, y: 10, handleIn: null, handleOut: null },
            ],
            [
              { x: 2, y: 2, handleIn: null, handleOut: null },
              { x: 4, y: 2, handleIn: null, handleOut: null },
              { x: 4, y: 4, handleIn: null, handleOut: null },
            ],
          ],
          closed: true,
          tolerance: 1,
          holes: [],
          fillRule: 'evenodd',
        }),
      },
      rootChildren: [...richDocument().rootChildren, 'compound'],
    } as Document;
    const text = canonicalizeDocument(doc);
    expect(text).toContain('"contours"');
    expect(text.indexOf('"contours"')).toBeLessThan(text.indexOf('"holes"'));
  });
});

describe('canonicalHash', () => {
  it('is a 64-hex sha256 of the canonical bytes', () => {
    const doc = richDocument();
    const hash = canonicalHash(doc);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const hash2 = canonicalHash(JSON.parse(canonicalizeDocument(doc)) as Document);
    expect(hash2).toBe(hash);
  });

  it('changes when authored content changes', () => {
    const doc = richDocument();
    const before = canonicalHash(doc);
    const renamed = { ...doc, name: 'renamed' } as Document;
    const after = canonicalHash(renamed);
    expect(after).not.toBe(before);
  });

  it('keeps derived nextId out of the history content hash', () => {
    const doc = richDocument();
    const advanced = { ...doc, nextId: doc.nextId + 100 } as Document;
    expect(canonicalHash(advanced)).not.toBe(canonicalHash(doc));
    expect(canonicalHistoryHash(advanced)).toBe(canonicalHistoryHash(doc));
  });

  it('is stable across repeated serialization', () => {
    const doc = richDocument();
    const a = canonicalizeDocument(doc);
    const b = canonicalizeDocument(doc);
    expect(b).toBe(a);
  });
});
