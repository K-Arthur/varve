import { describe, expect, it } from 'vitest';
import {
  isLegacyColorTuple,
  legacyColorTupleToManaged,
  migrateLegacyTextColorTuples,
} from './colorMigration';
import { migrateDocumentDetailed } from './version';

/** Minimal legacy 2.13 document with a text node carrying tuple colors. */
function legacyDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'd1',
    name: 'legacy',
    formatVersion: '2.13',
    rootChildren: ['t1'],
    components: {},
    nextId: 2,
    nodes: {
      t1: {
        id: 't1',
        kind: 'text',
        name: 'Text',
        transform: [1, 0, 0, 1, 0, 0],
        text: 'Hello',
        fontSize: 16,
        richText: {
          paragraphs: [
            {
              runs: [{ text: 'Hello ', format: { color: [255, 0, 0, 255] } }],
              format: { columnRuleColor: [0, 0, 255, 128] },
            },
            { runs: [{ text: 'World' }] },
          ],
        },
      },
      s1: {
        id: 's1',
        kind: 'shape',
        name: 'Rect',
        transform: [1, 0, 0, 1, 0, 0],
        shape: { kind: 'rect', w: 10, h: 10 },
        fill: { space: 'rgb', r: 1, g: 2, b: 3, a: 255 },
      },
    },
    ...overrides,
  };
}

describe('isLegacyColorTuple', () => {
  it('recognizes 4-number tuples', () => {
    expect(isLegacyColorTuple([1, 2, 3, 255])).toBe(true);
    expect(isLegacyColorTuple([1, 2, 3])).toBe(false);
    expect(isLegacyColorTuple([1, 2, 3, NaN])).toBe(false);
    expect(isLegacyColorTuple([1, 2, '3', 255])).toBe(false);
    expect(isLegacyColorTuple({ space: 'rgb', r: 1, g: 2, b: 3, a: 255 })).toBe(false);
    expect(isLegacyColorTuple(undefined)).toBe(false);
    expect(isLegacyColorTuple(null)).toBe(false);
  });
});

describe('legacyColorTupleToManaged', () => {
  it('preserves alpha and channel order', () => {
    expect(legacyColorTupleToManaged([10, 20, 30, 40])).toEqual({
      space: 'rgb',
      r: 10,
      g: 20,
      b: 30,
      a: 40,
    });
  });
});

describe('migrateLegacyTextColorTuples', () => {
  /** First paragraph of the t1 text node as a mutable record. */
  function firstParagraph(doc: Record<string, unknown>): {
    para: Record<string, unknown>;
    rich: Record<string, unknown>;
  } {
    const nodes = doc.nodes as Record<string, Record<string, unknown>>;
    const rich = nodes.t1!.richText as Record<string, unknown>;
    return { para: (rich.paragraphs as Array<Record<string, unknown>>)[0]!, rich };
  }

  it('converts run color and columnRuleColor tuples to ManagedColor', () => {
    const out = migrateLegacyTextColorTuples(legacyDoc());
    const { para } = firstParagraph(out);
    const fmt = (para.runs as Array<Record<string, unknown>>)[0]!.format as Record<string, unknown>;
    expect(fmt.color).toEqual({
      space: 'rgb',
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });
    expect((para.format as Record<string, unknown>).columnRuleColor).toEqual({
      space: 'rgb',
      r: 0,
      g: 0,
      b: 255,
      a: 128,
    });
    expect(out.formatVersion).toBe('2.14');
  });

  it('leaves already-migrated colors untouched', () => {
    const doc = legacyDoc();
    const { para } = firstParagraph(doc);
    (para.runs as Array<Record<string, unknown>>)[0]!.format = {
      color: { space: 'spot', name: 'Pantone 185 C', tint: 50, a: 255 },
    };
    const out = migrateLegacyTextColorTuples(doc);
    const { para: outPara } = firstParagraph(out);
    const outFmt = (outPara.runs as Array<Record<string, unknown>>)[0]!.format as Record<
      string,
      unknown
    >;
    expect(outFmt.color).toEqual({
      space: 'spot',
      name: 'Pantone 185 C',
      tint: 50,
      a: 255,
    });
  });

  it('does not touch non-text nodes', () => {
    const out = migrateLegacyTextColorTuples(legacyDoc());
    const nodes = out.nodes as Record<string, Record<string, unknown>>;
    expect(nodes.s1!.fill).toEqual({ space: 'rgb', r: 1, g: 2, b: 3, a: 255 });
  });

  it('handles missing richText and malformed runs', () => {
    const doc = legacyDoc();
    const nodes = doc.nodes as Record<string, Record<string, unknown>>;
    nodes.t1!.richText = undefined;
    const out = migrateLegacyTextColorTuples(doc);
    const outNodes = out.nodes as Record<string, Record<string, unknown>>;
    expect(outNodes.t1!.richText).toBeUndefined();
  });

  it('is idempotent when applied twice', () => {
    const once = migrateLegacyTextColorTuples(legacyDoc());
    const twice = migrateLegacyTextColorTuples(once);
    expect(twice).toEqual(once);
  });
});

describe('migration integration (2.13 → 2.14)', () => {
  it('migrates through migrateDocumentDetailed', () => {
    const result = migrateDocumentDetailed(legacyDoc());
    expect(result).not.toBeNull();
    expect(result!.toVersion).toBe('2.19');
    const docNodes = (result!.document as Record<string, unknown>).nodes as Record<
      string,
      Record<string, unknown>
    >;
    const rich = docNodes.t1!.richText as Record<string, unknown>;
    const para = (rich.paragraphs as Array<Record<string, unknown>>)[0]!;
    const fmt = (para.runs as Array<Record<string, unknown>>)[0]!.format as Record<string, unknown>;
    expect(fmt.color).toEqual({
      space: 'rgb',
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });
  });

  it('is idempotent across full migration runs', () => {
    const first = migrateDocumentDetailed(legacyDoc())!.document;
    const second = migrateDocumentDetailed(first)!.document;
    expect(second).toEqual(first);
  });

  it('preserves legacy tuple values across mixed old/new runs', () => {
    const doc = legacyDoc();
    const docNodes = doc.nodes as Record<string, Record<string, unknown>>;
    const rich = docNodes.t1!.richText as Record<string, unknown>;
    const paras = rich.paragraphs as Array<Record<string, unknown>>;
    paras[0]!.runs = [
      { text: 'a', format: { color: [1, 2, 3, 4] } },
      { text: 'b', format: { color: { space: 'lab', l: 50, av: 10, b: 20, a: 255 } } },
    ];
    const out = migrateLegacyTextColorTuples(doc);
    const outNodes = out.nodes as Record<string, Record<string, unknown>>;
    const outRich = outNodes.t1!.richText as Record<string, unknown>;
    const outRuns = (outRich.paragraphs as Array<Record<string, unknown>>)[0]!.runs as Array<
      Record<string, unknown>
    >;
    expect((outRuns[0]!.format as Record<string, unknown>).color).toEqual({
      space: 'rgb',
      r: 1,
      g: 2,
      b: 3,
      a: 4,
    });
    expect((outRuns[1]!.format as Record<string, unknown>).color).toEqual({
      space: 'lab',
      l: 50,
      av: 10,
      b: 20,
      a: 255,
    });
  });

  it('migrates plain tuples in documents created before profile metadata', () => {
    // v1.1-era document: no colorConfig, no profile — tuples still become
    // unprofiled rgb values (document working space applies at read time).
    const doc = legacyDoc({ formatVersion: '1.1' });
    const result = migrateDocumentDetailed(doc);
    expect(result!.toVersion).toBe('2.19');
    const docNodes = (result!.document as Record<string, unknown>).nodes as Record<
      string,
      Record<string, unknown>
    >;
    const rich = docNodes.t1!.richText as Record<string, unknown>;
    const para = (rich.paragraphs as Array<Record<string, unknown>>)[0]!;
    const fmt = (para.runs as Array<Record<string, unknown>>)[0]!.format as Record<string, unknown>;
    expect(fmt.color).toEqual({
      space: 'rgb',
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });
  });
});
