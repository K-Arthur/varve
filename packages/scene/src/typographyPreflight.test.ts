import { describe, expect, it } from 'vitest';
import { addNode, createDocument, makeTextNode } from './document';
import { DEFAULT_ARTWORK_FONT_FAMILY } from './fontDefaults';
import { createChain, detectOverset } from './textFlow';
import { plainTextToRichText } from './typography';
import { runTypographyPreflight, validateContrast, validateRichText } from './typographyPreflight';

describe('runTypographyPreflight', () => {
  it('returns no issues for empty document', () => {
    const doc = createDocument();
    const result = runTypographyPreflight(doc);
    expect(result.issues).toHaveLength(0);
    expect(result.errorCount).toBe(0);
  });

  it('detects missing fonts', () => {
    let doc = createDocument();
    const node = makeTextNode('t1', 'Hello', { fontFamily: 'MissingFont' });
    doc = addNode(doc, node);
    const result = runTypographyPreflight(doc, {
      availableFonts: new Set(['Inter', 'Arial']),
    });
    expect(result.errorCount).toBe(1);
    expect(result.issues[0]?.category).toBe('missing-font');
    expect(result.issues[0]?.nodeId).toBe('t1');
  });

  it('does not flag available fonts', () => {
    let doc = createDocument();
    const node = makeTextNode('t1', 'Hello', { fontFamily: 'Inter' });
    doc = addNode(doc, node);
    const result = runTypographyPreflight(doc, {
      availableFonts: new Set(['Inter']),
    });
    expect(result.errorCount).toBe(0);
  });

  it('detects overset text', () => {
    let doc = createDocument();
    const node = makeTextNode('t1', 'Hello');
    doc = addNode(doc, node);
    const chain = createChain('c1', 'Story', ['t1']);
    const overset = detectOverset(chain, 't1', 3, 10);
    const oversetMap = new Map();
    if (overset) oversetMap.set('t1', overset);
    const result = runTypographyPreflight(doc, {
      availableFonts: new Set([DEFAULT_ARTWORK_FONT_FAMILY]),
      oversetMap,
    });
    expect(result.warningCount).toBe(1);
    expect(result.issues[0]?.category).toBe('overflow');
  });

  it('detects broken chains referencing missing frames', () => {
    const doc = createDocument();
    const chain = createChain('c1', 'Story', ['nonexistent']);
    const chains = new Map();
    chains.set('c1', chain);
    const result = runTypographyPreflight(doc, { chains });
    expect(result.errorCount).toBe(1);
    expect(result.issues[0]?.category).toBe('broken-chain');
  });

  it('detects orphaned styles', () => {
    let doc = createDocument();
    const node = makeTextNode('t1', 'Hello');
    doc = addNode(doc, node);
    doc = {
      ...doc,
      styles: {
        s1: { id: 's1', type: 'text', name: 'unused', fontSize: 16 },
      },
    };
    const result = runTypographyPreflight(doc, {
      availableFonts: new Set([DEFAULT_ARTWORK_FONT_FAMILY]),
    });
    expect(result.infoCount).toBe(1);
    expect(result.issues[0]?.category).toBe('orphaned-style');
  });
});

describe('runTypographyPreflight advanced checks', () => {
  it('detects unsupported variable axes', () => {
    let doc = createDocument();
    const node = makeTextNode('t1', 'Hello', { fontFamily: 'Inter', variableAxes: { wxyz: 500 } });
    doc = addNode(doc, node);
    const supportedAxes = new Map<string, Set<string>>();
    supportedAxes.set('Inter', new Set(['wght']));
    const result = runTypographyPreflight(doc, {
      availableFonts: new Set(['Inter']),
      supportedAxes,
    });
    expect(result.warningCount).toBe(1);
    expect(result.issues[0]?.category).toBe('style-conflict');
  });

  it('detects private-use characters as potentially unsupported glyphs', () => {
    let doc = createDocument();
    const node = makeTextNode('t1', '\uE000', { fontFamily: 'Inter' });
    doc = addNode(doc, node);
    const fontMetadata = new Map<string, { glyphCount: number }>();
    fontMetadata.set('Inter', { glyphCount: 256 });
    const result = runTypographyPreflight(doc, {
      availableFonts: new Set(['Inter']),
      fontMetadata,
    });
    expect(result.warningCount).toBe(1);
    expect(result.issues[0]?.category).toBe('unsupported-glyph');
  });

  it('detects missing fonts in rich text runs during preflight', () => {
    let doc = createDocument();
    const node = makeTextNode('t1', 'Hello', {
      fontFamily: 'Inter',
      richText: {
        paragraphs: [
          {
            runs: [{ text: 'Hello', format: { fontFamily: 'MissingFont' } }],
          },
        ],
      },
    });
    doc = addNode(doc, node);
    const result = runTypographyPreflight(doc, { availableFonts: new Set(['Inter']) });
    expect(result.errorCount).toBe(1);
    expect(result.issues[0]?.category).toBe('missing-font');
    expect(result.issues[0]?.nodeId).toBe('t1');
  });
});

describe('validateRichText', () => {
  it('returns no issues when all fonts available', () => {
    const rich = plainTextToRichText('Hello');
    const issues = validateRichText(rich, new Set(['Inter']));
    expect(issues).toHaveLength(0);
  });

  it('detects missing font in rich text runs', () => {
    const rich = {
      paragraphs: [
        {
          runs: [{ text: 'Hello', format: { fontFamily: 'MissingFont' } }],
        },
      ],
    };
    const issues = validateRichText(rich, new Set(['Inter']));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.category).toBe('missing-font');
  });
});

describe('validateContrast', () => {
  it('passes AAA for black on white', () => {
    const result = validateContrast([0, 0, 0, 255], [255, 255, 255, 255]);
    expect(result.passes).toBe(true);
    expect(result.level).toBe('AAA');
    expect(result.ratio).toBeGreaterThan(7);
  });

  it('fails for low contrast', () => {
    const result = validateContrast([200, 200, 200, 255], [255, 255, 255, 255]);
    expect(result.passes).toBe(false);
    expect(result.level).toBe('fail');
  });

  it('passes AA for sufficient contrast', () => {
    const result = validateContrast([0, 0, 0, 255], [200, 200, 200, 255]);
    expect(result.passes).toBe(true);
    expect(result.ratio).toBeGreaterThanOrEqual(4.5);
  });
});
