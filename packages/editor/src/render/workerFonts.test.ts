// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adoptFontFaces,
  documentNeedsWorkerFonts,
  fontFaceSetKey,
  harvestDocumentFontFaces,
  type WorkerFontFace,
} from './workerFonts';

function withStyleSheets(sheets: Array<Partial<CSSStyleSheet>>): void {
  vi.spyOn(document, 'styleSheets', 'get').mockReturnValue(
    sheets as unknown as StyleSheetList & { [Symbol.iterator](): Iterator<CSSStyleSheet> },
  );
}

function fontFaceRule(declarations: Record<string, string>): {
  style: { getPropertyValue(name: string): string };
} {
  return {
    style: {
      getPropertyValue: (name: string) => declarations[name] ?? '',
    },
  };
}

function sheet(
  rules: Array<{ style: { getPropertyValue(name: string): string } }>,
  href: string | null = 'http://localhost/assets/fonts.css',
): Partial<CSSStyleSheet> {
  return { href, cssRules: rules as unknown as CSSRuleList };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('harvestDocumentFontFaces', () => {
  it('reads family, source, and descriptors from @font-face rules', () => {
    withStyleSheets([
      sheet([
        fontFaceRule({
          'font-family': '"Geist Variable"',
          src: 'url(https://cdn.test/geist.woff2) format("woff2")',
          'font-weight': '100 900',
          'font-style': 'normal',
        }),
      ]),
    ]);

    expect(harvestDocumentFontFaces()).toEqual([
      {
        family: 'Geist Variable',
        source: 'url(https://cdn.test/geist.woff2) format("woff2")',
        weight: '100 900',
        style: 'normal',
        stretch: undefined,
        unicodeRange: undefined,
      },
    ]);
  });

  it('resolves relative sources against the stylesheet that declared them', () => {
    // The worker resolves relative URLs against its own script URL, which is a
    // different directory — an unresolved one 404s and the family silently
    // stays unavailable in that realm.
    withStyleSheets([
      sheet(
        [fontFaceRule({ 'font-family': 'Plex', src: "url('./plex.woff2')" })],
        'http://localhost/assets/type/fonts.css',
      ),
    ]);

    expect(harvestDocumentFontFaces()[0]?.source).toBe(
      "url('http://localhost/assets/type/plex.woff2')",
    );
  });

  it('leaves absolute, data, and blob sources alone', () => {
    withStyleSheets([
      sheet([
        fontFaceRule({ 'font-family': 'A', src: 'url(data:font/woff2;base64,AAA)' }),
        fontFaceRule({ 'font-family': 'B', src: 'url(https://cdn.test/b.woff2)' }),
      ]),
    ]);
    const sources = harvestDocumentFontFaces().map((face) => face.source);
    expect(sources).toEqual(['url(data:font/woff2;base64,AAA)', 'url(https://cdn.test/b.woff2)']);
  });

  it('skips a cross-origin stylesheet instead of throwing', () => {
    const opaque = {
      href: 'https://other.test/fonts.css',
      get cssRules(): CSSRuleList {
        throw new DOMException('SecurityError');
      },
    };
    withStyleSheets([
      opaque as unknown as Partial<CSSStyleSheet>,
      sheet([fontFaceRule({ 'font-family': 'Local', src: 'url(/l.woff2)' })]),
    ]);
    expect(harvestDocumentFontFaces().map((f) => f.family)).toEqual(['Local']);
  });

  it('deduplicates identical faces declared in more than one sheet', () => {
    const rule = fontFaceRule({ 'font-family': 'Dup', src: 'url(/d.woff2)' });
    withStyleSheets([sheet([rule]), sheet([rule])]);
    expect(harvestDocumentFontFaces()).toHaveLength(1);
  });
});

describe('fontFaceSetKey', () => {
  const face: WorkerFontFace = { family: 'A', source: 'url(/a.woff2)' };

  it('is stable for the same set', () => {
    expect(fontFaceSetKey([face])).toBe(fontFaceSetKey([face]));
  });

  it('differs when the set differs', () => {
    expect(fontFaceSetKey([face])).not.toBe(
      fontFaceSetKey([face, { family: 'B', source: 'url(/b.woff2)' }]),
    );
    expect(fontFaceSetKey([face])).not.toBe(fontFaceSetKey([{ ...face, weight: '700' }]));
  });

  it('has a distinct identity for an empty set', () => {
    expect(fontFaceSetKey([])).toBe('fonts:none');
  });
});

describe('documentNeedsWorkerFonts', () => {
  const declared = new Set(['Geist Variable', 'Fraunces Variable']);

  const doc = (nodes: Record<string, Record<string, unknown>>) =>
    ({ nodes }) as Parameters<typeof documentNeedsWorkerFonts>[0];

  it('is false when nothing is declared', () => {
    expect(
      documentNeedsWorkerFonts(
        doc({ a: { kind: 'text', fontFamily: 'Geist Variable' } }),
        new Set(),
      ),
    ).toBe(false);
  });

  it('is false for text in a system family the worker also has', () => {
    expect(
      documentNeedsWorkerFonts(doc({ a: { kind: 'text', fontFamily: 'Arial' } }), declared),
    ).toBe(false);
  });

  it('is true for text in a declared web family', () => {
    expect(
      documentNeedsWorkerFonts(
        doc({ a: { kind: 'text', fontFamily: 'Geist Variable' } }),
        declared,
      ),
    ).toBe(true);
  });

  it('is true for a rich-text run in a declared family', () => {
    expect(
      documentNeedsWorkerFonts(
        doc({
          a: {
            kind: 'text',
            fontFamily: 'Arial',
            richText: {
              paragraphs: [{ runs: [{ text: 'x', format: { fontFamily: 'Fraunces Variable' } }] }],
            },
          },
        }),
        declared,
      ),
    ).toBe(true);
  });

  it('uses the default family when a legacy text node omits fontFamily', () => {
    expect(
      documentNeedsWorkerFonts(doc({ a: { kind: 'text' } }), new Set(['IBM Plex Sans Variable'])),
    ).toBe(true);
  });

  it('checks style and story-inherited rich text families', () => {
    expect(
      documentNeedsWorkerFonts(
        {
          nodes: {
            frame: {
              kind: 'text',
              styleId: 'body',
              storyBinding: { storyId: 'story-1' },
            },
          },
          styles: { body: { type: 'text', fontFamily: 'Fraunces Variable' } },
          stories: {
            'story-1': {
              content: {
                paragraphs: [
                  { runs: [{ text: 'story', format: { fontFamily: 'Geist Variable' } }] },
                ],
              },
            },
          },
        } as Parameters<typeof documentNeedsWorkerFonts>[0],
        declared,
      ),
    ).toBe(true);
  });

  it('ignores non-text nodes', () => {
    expect(
      documentNeedsWorkerFonts(
        doc({ a: { kind: 'shape', fontFamily: 'Geist Variable' } }),
        declared,
      ),
    ).toBe(false);
  });
});

describe('adoptFontFaces', () => {
  class FakeFontFace {
    constructor(
      readonly family: string,
      readonly source: string,
    ) {}
    async load(): Promise<FakeFontFace> {
      if (this.source.includes('broken')) throw new Error('undecodable');
      return this;
    }
  }

  function stubFontRealm(): unknown[] {
    const added: unknown[] = [];
    vi.stubGlobal('fonts', { add: (face: unknown) => added.push(face) });
    vi.stubGlobal('FontFace', FakeFontFace);
    return added;
  }

  it('adds each face that loads and does not abandon the batch on one failure', async () => {
    const added = stubFontRealm();

    const adopted = await adoptFontFaces([
      { family: 'Broken', source: 'url(/broken.woff2)' },
      { family: 'Good', source: 'url(/good.woff2)' },
    ]);

    expect(added).toHaveLength(1);
    expect((added[0] as FakeFontFace).family).toBe('Good');
    expect(adopted).toEqual(['Good']);
    vi.unstubAllGlobals();
  });

  it('withholds a family when any one of its faces failed', async () => {
    // Reporting a family whose bold payload failed would clear the worker to
    // draw bold text it can only synthesise.
    stubFontRealm();

    const adopted = await adoptFontFaces([
      { family: 'Plex', source: 'url(/plex-400.woff2)', weight: '400' },
      { family: 'Plex', source: 'url(/plex-broken-700.woff2)', weight: '700' },
      { family: 'Geist', source: 'url(/geist.woff2)' },
    ]);

    expect(adopted).toEqual(['Geist']);
    vi.unstubAllGlobals();
  });

  it('reports nothing when the realm has no FontFaceSet', async () => {
    vi.stubGlobal('fonts', undefined);
    await expect(adoptFontFaces([{ family: 'A', source: 'url(/a.woff2)' }])).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });
});
