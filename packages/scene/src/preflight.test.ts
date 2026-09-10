import { describe, expect, it } from 'vitest';
import { DEFAULT_BLEED, defaultCmykColorConfig, defaultRgbColorConfig } from './colorManagement';
import type { Document } from './document';
import { createDocument } from './document';
import { runCombinedPreflight } from './preflight';
import type { TextNode } from './types';

function makePrintDoc(overrides: Partial<Document> = {}): Document {
  return {
    ...createDocument('print-test'),
    colorConfig: defaultCmykColorConfig(),
    documentUnit: 'mm',
    physicalWidth: 210,
    physicalHeight: 297,
    dpi: 300,
    bleed: { ...DEFAULT_BLEED },
    ...overrides,
  };
}

function textNode(overrides: Partial<TextNode> = {}): TextNode {
  return {
    id: 't1',
    kind: 'text',
    name: 'Text',
    fontFamily: 'Inter',
    fontSize: 12,
    text: 'Hello',
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0],
    ...overrides,
  } as TextNode;
}

describe('runCombinedPreflight', () => {
  it('is ready with no issues for a clean CMYK document', () => {
    const doc = makePrintDoc();
    const result = runCombinedPreflight(doc);
    expect(result.ready).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it('merges print and typography issues with a source tag', () => {
    const doc = makePrintDoc({
      bleed: undefined,
      textChains: {
        chain1: { id: 'chain1', name: 'Chain', frameIds: ['missing-frame'] },
      },
    });
    const result = runCombinedPreflight(doc);
    const printIssue = result.issues.find((i) => i.source === 'print' && i.category === 'bleed');
    const typographyIssue = result.issues.find(
      (i) => i.source === 'typography' && i.category === 'broken-chain',
    );
    expect(printIssue).toBeDefined();
    expect(typographyIssue).toBeDefined();
  });

  it('marks missing-font check unavailable and suppresses false-positive font issues when no font data is supplied', () => {
    const doc = makePrintDoc({ nodes: { t1: textNode({ fontFamily: 'SomeFont' }) } });
    const result = runCombinedPreflight(doc);
    const fontCheck = result.checks.find((c) => c.id === 'missing-font');
    expect(fontCheck?.status).toBe('unavailable');
    expect(result.issues.some((i) => i.category === 'missing-font')).toBe(false);
  });

  it('marks missing-font check verified and reports real missing fonts when font data is supplied', () => {
    const doc = makePrintDoc({ nodes: { t1: textNode({ fontFamily: 'NonExistentFont' }) } });
    const result = runCombinedPreflight(doc, { availableFonts: new Set(['Inter', 'Arial']) });
    const fontCheck = result.checks.find((c) => c.id === 'missing-font');
    expect(fontCheck?.status).toBe('verified');
    const fontIssue = result.issues.find((i) => i.category === 'missing-font');
    expect(fontIssue).toBeDefined();
    expect(fontIssue?.nodeId).toBe('t1');
  });

  it('does not report a missing font when it is in the available set', () => {
    const doc = makePrintDoc({ nodes: { t1: textNode({ fontFamily: 'Inter' }) } });
    const result = runCombinedPreflight(doc, { availableFonts: new Set(['Inter', 'Arial']) });
    expect(result.issues.some((i) => i.category === 'missing-font')).toBe(false);
  });

  it('marks the rgb-in-cmyk check verified only for CMYK documents', () => {
    const cmykDoc = makePrintDoc();
    const rgbDoc = makePrintDoc({ colorConfig: defaultRgbColorConfig() });
    expect(runCombinedPreflight(cmykDoc).checks.find((c) => c.id === 'rgb-in-cmyk')?.status).toBe(
      'verified',
    );
    expect(runCombinedPreflight(rgbDoc).checks.find((c) => c.id === 'rgb-in-cmyk')?.status).toBe(
      'unavailable',
    );
  });

  it('always marks overset-text and safe-area checks unavailable', () => {
    const result = runCombinedPreflight(makePrintDoc());
    expect(result.checks.find((c) => c.id === 'overset-text')?.status).toBe('unavailable');
    expect(result.checks.find((c) => c.id === 'safe-area')?.status).toBe('unavailable');
  });

  it('is not ready when there is at least one error-level issue', () => {
    const doc = makePrintDoc({ bleed: undefined });
    const result = runCombinedPreflight(doc);
    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.ready).toBe(false);
  });
});
