import { describe, expect, it } from 'vitest';
import {
  collectIds,
  decodeEntities,
  extractPage,
  extractSections,
  findUndecodedEntities,
  htmlToText,
  normalizeRoute,
  slugifyHeading,
} from '../lib/search/extract';
import {
  boundedDamerauLevenshtein,
  fuzzyDistanceFor,
  normalizeText,
  prepareIndex,
  searchPrepared,
} from '../lib/search/rank';
import { SEARCH_INDEX_VERSION, type SearchIndex } from '../lib/search/types';

describe('decodeEntities', () => {
  it('decodes named, decimal, and hex entities', () => {
    expect(decodeEntities('CMYK &amp; PDF &#39;X&#39; &quot;press&quot;')).toBe(
      'CMYK & PDF \'X\' "press"',
    );
    expect(decodeEntities('&#x27;quoted&#x27;')).toBe("'quoted'");
  });

  it('leaves unknown entities alone', () => {
    expect(decodeEntities('a &colornotreal; b')).toBe('a &colornotreal; b');
  });

  it('decodes the named entities the site actually uses', () => {
    expect(decodeEntities('a &mdash; b &rarr; c')).toBe('a \u2014 b \u2192 c');
    expect(decodeEntities('&harr; &middot; &times; &rsaquo;')).toBe('\u2194 \u00B7 \u00D7 \u203A');
    expect(decodeEntities('&eacute; &hellip; &deg;')).toBe('\u00E9 \u2026 \u00B0');
  });

  it('keeps case-sensitive entity names distinct', () => {
    expect(decodeEntities('&Delta; &delta;')).toBe('\u0394 \u03B4');
  });
});

describe('htmlToText', () => {
  it('removes script, style, svg, and navigation content', () => {
    const html =
      '<nav>Home / Docs</nav><p>Visible</p><script>var x = 1;</script><svg><title>icon</title></svg><style>.a{}</style>';
    expect(htmlToText(html)).toBe('Visible');
  });

  it('keeps block boundaries as spaces and decodes text', () => {
    expect(htmlToText('<p>One &amp; two</p><p>Three</p>')).toBe('One & two Three');
  });

  it('collapses inline markup without fusing words', () => {
    expect(htmlToText('<h2>Use <code>clamp()</code> here</h2>')).toBe('Use clamp() here');
  });

  it('drops aria-hidden decorative copies but keeps screen-reader text', () => {
    const html =
      '<span class="status-pill"><span class="sr-only">Available</span><span aria-hidden="true">Available</span></span>';
    expect(htmlToText(html)).toBe('Available');
  });

  it('unwraps nested aria-hidden wrappers', () => {
    const html =
      '<div aria-hidden="true"><span aria-hidden="true">Decorative</span></div><p>Real</p>';
    expect(htmlToText(html)).toBe('Real');
  });
});

describe('findUndecodedEntities', () => {
  it('lists leftover named entities and ignores ampersand prose', () => {
    expect(findUndecodedEntities('a &nbsp; b &notreal; c & plain')).toEqual([
      '&nbsp;',
      '&notreal;',
    ]);
  });
});

describe('slugifyHeading', () => {
  it('lowercases, folds accents, and collapses punctuation', () => {
    expect(slugifyHeading('Creating Text')).toBe('creating-text');
    expect(slugifyHeading('CMYK & PDF/X Export')).toBe('cmyk-pdf-x-export');
    expect(slugifyHeading('Über Größe')).toBe('uber-große');
  });

  it('falls back for headings with no letters or digits', () => {
    expect(slugifyHeading('—')).toBe('section');
    expect(slugifyHeading('')).toBe('section');
  });
});

describe('extractSections', () => {
  const main = [
    '<p class="docs-intro">Intro copy.</p>',
    '<h2>Creating Text</h2>',
    '<p>Draw a text frame.</p>',
    '<h3 id="hand-written">Existing Anchor</h3>',
    '<p>Keep this id.</p>',
    '<h2>Creating Text</h2>',
    '<p>Duplicate heading.</p>',
    '<h2><code>clamp()</code> behavior</h2>',
    '<p>Nested markup in a heading.</p>',
  ].join('\n');

  it('injects ids and preserves pre-existing ones', () => {
    const { html, sections } = extractSections(main, new Set());
    expect(html).toContain('<h2 id="creating-text">Creating Text</h2>');
    expect(html).toContain('<h3 id="hand-written">Existing Anchor</h3>');
    expect(html).toContain('<h2 id="creating-text-2">Creating Text</h2>');
    expect(html).toContain('<h2 id="clamp-behavior">');
    expect(sections.map((section) => section.anchor)).toEqual([
      '',
      'creating-text',
      'hand-written',
      'creating-text-2',
      'clamp-behavior',
    ]);
  });

  it('captures intro and per-heading body text', () => {
    const { sections } = extractSections(main, new Set());
    expect(sections[0]).toMatchObject({ heading: '', text: 'Intro copy.' });
    expect(sections[1]?.text).toBe('Draw a text frame.');
    expect(sections[2]?.text).toBe('Keep this id.');
  });

  it('never reuses an id reserved elsewhere in the document', () => {
    const { html } = extractSections('<h2>Overview</h2>', new Set(['overview']));
    expect(html).toContain('id="overview-2"');
  });
});

describe('extractPage', () => {
  const document = [
    '<!doctype html><html><head>',
    '<meta name="description" content="Install Varve on Linux, macOS, or Windows." />',
    '<title>Getting Started — Varve Docs</title>',
    '</head><body>',
    '<main id="main-content" class="site-main"><h1>Getting Started</h1>',
    '<h2>Install</h2><p>Download the package.</p>',
    '</main></body></html>',
  ].join('');

  it('extracts title, description, sections, and rewritten HTML', () => {
    const extracted = extractPage(document, '/docs/getting-started/');
    expect(extracted).not.toBeNull();
    expect(extracted?.page.url).toBe('/docs/getting-started');
    expect(extracted?.page.title).toBe('Getting Started');
    expect(extracted?.page.description).toBe('Install Varve on Linux, macOS, or Windows.');
    expect(extracted?.page.sections.map((section) => section.heading)).toEqual(['', 'Install']);
    expect(extracted?.html).toContain('<h2 id="install">Install</h2>');
  });

  it('falls back to the trimmed <title> when main has no h1', () => {
    const html = document.replace(/<h1>Getting Started<\/h1>/, '');
    expect(extractPage(html, '/docs/getting-started')?.page.title).toBe('Getting Started');
  });

  it('falls back to <title> when the h1 is an unreliable animation headline', () => {
    const html = document.replace(
      /<h1>Getting Started<\/h1>/,
      '<h1><span>Design locally. </span><span>One canvas.</span><span>One canvas.</span><span>One canvas.</span></h1>',
    );
    expect(extractPage(html, '/')?.page.title).toBe('Getting Started');
  });

  it('returns null for output without a main region', () => {
    expect(extractPage('<html><body><p>endpoint</p></body></html>', '/robots.txt')).toBeNull();
  });
});

describe('normalizeRoute', () => {
  it('drops trailing slashes but keeps the root', () => {
    expect(normalizeRoute('/docs/')).toBe('/docs');
    expect(normalizeRoute('/')).toBe('/');
    expect(normalizeRoute('')).toBe('/');
  });
});

describe('boundedDamerauLevenshtein', () => {
  it('measures edits within the bound and rejects beyond it', () => {
    expect(boundedDamerauLevenshtein('color', 'colour', 1)).toBe(1);
    expect(boundedDamerauLevenshtein('form', 'from', 1)).toBe(1);
    expect(boundedDamerauLevenshtein('color', 'completely', 1)).toBe(-1);
    expect(boundedDamerauLevenshtein('', 'ab', 1)).toBe(-1);
  });

  it('allows two edits for long terms only', () => {
    expect(fuzzyDistanceFor('typo')).toBe(1);
    expect(fuzzyDistanceFor('typography')).toBe(2);
  });
});

const fixture: SearchIndex = {
  version: SEARCH_INDEX_VERSION,
  pages: [
    {
      url: '/docs/tools/typography',
      title: 'Typography',
      description: 'Fonts, OpenType features, and variable axes.',
      sections: [
        { heading: '', anchor: '', text: 'Typography tools overview.' },
        {
          heading: 'Variable Fonts',
          anchor: 'variable-fonts',
          text: 'Adjust weight and optical size axes on variable fonts.',
        },
      ],
    },
    {
      url: '/docs/tools/color',
      title: 'Color & Effects',
      description: 'Color management and print-safe CMYK workflows.',
      sections: [
        {
          heading: 'CMYK and print',
          anchor: 'cmyk-and-print',
          text: 'Convert documents to CMYK for press output with soft proofing.',
        },
      ],
    },
    {
      url: '/docs/keyboard-shortcuts',
      title: 'Keyboard Shortcuts',
      description: 'Every editable shortcut and how to remap it.',
      sections: [
        {
          heading: 'Tools',
          anchor: 'tools',
          text: 'Press V for select, P for pen, and B for the brush.',
        },
      ],
    },
    {
      url: '/docs/image-trace',
      title: 'Image Trace',
      description: 'Raster to vector tracing.',
      sections: [
        {
          heading: 'Background removal',
          anchor: 'background-removal',
          text: 'Remove a background before tracing.',
        },
      ],
    },
  ],
};

describe('searchPrepared', () => {
  const prepared = prepareIndex(fixture);

  it('finds an exact page title first', () => {
    const results = searchPrepared(prepared, 'typography');
    expect(results[0]?.url).toBe('/docs/tools/typography');
  });

  it('finds section content and links to the section anchor', () => {
    const results = searchPrepared(prepared, 'cmyk');
    expect(results[0]?.url).toBe('/docs/tools/color#cmyk-and-print');
    expect(results[0]?.heading).toBe('CMYK and print');
  });

  it('matches a token prefix', () => {
    const results = searchPrepared(prepared, 'shortc');
    expect(results[0]?.url).toBe('/docs/keyboard-shortcuts');
  });

  it('tolerates a typo in a title or heading token', () => {
    const results = searchPrepared(prepared, 'typorgaphy');
    expect(results.some((result) => result.url === '/docs/tools/typography')).toBe(true);
  });

  it('does not fuzzy-match short terms into unrelated pages', () => {
    expect(searchPrepared(prepared, 'wxyz')).toEqual([]);
  });

  it('requires every term to match somewhere (AND semantics)', () => {
    const both = searchPrepared(prepared, 'variable fonts');
    expect(both[0]?.url).toBe('/docs/tools/typography#variable-fonts');
    expect(searchPrepared(prepared, 'variable zebra')).toEqual([]);
  });

  it('keeps a phrase hit above scattered terms', () => {
    const results = searchPrepared(prepared, 'background removal');
    expect(results[0]?.url).toBe('/docs/image-trace#background-removal');
  });

  it('returns a snippet around the match', () => {
    const result = searchPrepared(prepared, 'soft proofing')[0];
    expect(result?.snippet).toContain('soft proofing');
    expect(result?.snippet.length).toBeLessThanOrEqual(240);
  });

  it('returns nothing for an empty query and respects the limit', () => {
    expect(searchPrepared(prepared, '   ')).toEqual([]);
    expect(searchPrepared(prepared, 'the', 1)).toHaveLength(1);
  });

  it('normalizes noisy casing and diacritics in queries', () => {
    expect(normalizeText('  CMÝK  ')).toBe('  cmyk  ');
    expect(searchPrepared(prepared, 'CMyK')).toHaveLength(1);
  });
});

describe('extract -> rank integration', () => {
  it('ranks a real docs page for a real query', () => {
    const html = [
      '<html><head><title>Print Export — Varve Docs</title>',
      '<meta name="description" content="PDF/X and CMYK output." /></head><body>',
      '<main id="main-content"><h1>Print Export</h1>',
      '<h2>PDF/X output</h2><p>Emit distinct MediaBox, BleedBox, and TrimBox values.</p>',
      '<h2>Raster formats</h2><p>PNG and JPEG export the visual bounds only.</p>',
      '</main></body></html>',
    ].join('');
    const extracted = extractPage(html, '/docs/tools/export');
    expect(extracted).not.toBeNull();
    const index: SearchIndex = {
      version: SEARCH_INDEX_VERSION,
      pages: extracted ? [extracted.page] : [],
    };
    const results = searchPrepared(prepareIndex(index), 'trimbox');
    expect(results[0]?.url).toBe('/docs/tools/export#pdf-x-output');
  });
});

describe('collectIds', () => {
  it('gathers every existing id', () => {
    expect([...collectIds('<div id="a"></div><p id="b"></p>')]).toEqual(['a', 'b']);
  });
});
