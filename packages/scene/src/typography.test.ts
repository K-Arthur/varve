import { describe, expect, it } from 'vitest';
import {
  type CharacterFormat,
  type CharacterStyle,
  mergeCharacterFormat,
  mergeParagraphFormat,
  type Paragraph,
  type ParagraphFormat,
  type ParagraphStyle,
  plainTextToRichText,
  resolveCharacterFormat,
  resolveParagraphFormat,
  resolveStyleChain,
  richTextToPlainText,
  type TextRun,
} from './typography';

describe('plainTextToRichText', () => {
  it('converts single line to one paragraph with one run', () => {
    const rich = plainTextToRichText('Hello');
    expect(rich.paragraphs).toHaveLength(1);
    expect(rich.paragraphs[0]?.runs).toHaveLength(1);
    expect(rich.paragraphs[0]?.runs[0]?.text).toBe('Hello');
  });

  it('converts multi-line text to multiple paragraphs', () => {
    const rich = plainTextToRichText('Line 1\nLine 2\nLine 3');
    expect(rich.paragraphs).toHaveLength(3);
    expect(rich.paragraphs[0]?.runs[0]?.text).toBe('Line 1');
    expect(rich.paragraphs[2]?.runs[0]?.text).toBe('Line 3');
  });

  it('handles empty string', () => {
    const rich = plainTextToRichText('');
    expect(rich.paragraphs).toHaveLength(1);
    expect(rich.paragraphs[0]?.runs[0]?.text).toBe('');
  });
});

describe('richTextToPlainText', () => {
  it('converts single paragraph back to plain text', () => {
    const rich = plainTextToRichText('Hello');
    expect(richTextToPlainText(rich)).toBe('Hello');
  });

  it('converts multi-paragraph back to plain text with newlines', () => {
    const rich = plainTextToRichText('A\nB\nC');
    expect(richTextToPlainText(rich)).toBe('A\nB\nC');
  });

  it('joins multiple runs in a paragraph', () => {
    const rich = {
      paragraphs: [{ runs: [{ text: 'Hel' }, { text: 'lo' }] }],
    };
    expect(richTextToPlainText(rich)).toBe('Hello');
  });
});

describe('mergeCharacterFormat', () => {
  it('overrides base values with non-undefined override values', () => {
    const base: CharacterFormat = { fontFamily: 'Inter', fontSize: 16 };
    const override: CharacterFormat = { fontSize: 24 };
    const merged = mergeCharacterFormat(base, override);
    expect(merged.fontFamily).toBe('Inter');
    expect(merged.fontSize).toBe(24);
  });

  it('keeps base values when override is undefined', () => {
    const base: CharacterFormat = { fontFamily: 'Inter', fontWeight: 400 };
    const override: CharacterFormat = { fontFamily: undefined };
    const merged = mergeCharacterFormat(base, override);
    expect(merged.fontFamily).toBe('Inter');
    expect(merged.fontWeight).toBe(400);
  });

  it('merges openTypeFeatures by override (not deep merge)', () => {
    const base: CharacterFormat = {
      openTypeFeatures: { liga: true, kern: true },
    };
    const override: CharacterFormat = {
      openTypeFeatures: { dlig: true },
    };
    const merged = mergeCharacterFormat(base, override);
    expect(merged.openTypeFeatures?.dlig).toBe(true);
    expect(merged.openTypeFeatures?.liga).toBeUndefined();
  });
});

describe('mergeParagraphFormat', () => {
  it('overrides base values with non-undefined override values', () => {
    const base: ParagraphFormat = { textAlign: 'left', lineHeight: 1.4 };
    const override: ParagraphFormat = { textAlign: 'center' };
    const merged = mergeParagraphFormat(base, override);
    expect(merged.textAlign).toBe('center');
    expect(merged.lineHeight).toBe(1.4);
  });
});

describe('resolveCharacterFormat', () => {
  it('uses paragraph default as base', () => {
    const run: TextRun = { text: 'test' };
    const paraDefault: CharacterFormat = { fontFamily: 'Inter', fontSize: 16 };
    const resolved = resolveCharacterFormat(run, {}, paraDefault);
    expect(resolved.fontFamily).toBe('Inter');
    expect(resolved.fontSize).toBe(16);
  });

  it('applies character style on top of paragraph default', () => {
    const run: TextRun = { text: 'bold', characterStyleId: 'cs1' };
    const styles: Record<string, CharacterStyle> = {
      cs1: {
        id: 'cs1',
        type: 'character',
        name: 'Bold',
        format: { fontWeight: 700 },
      },
    };
    const paraDefault: CharacterFormat = { fontFamily: 'Inter', fontSize: 16 };
    const resolved = resolveCharacterFormat(run, styles, paraDefault);
    expect(resolved.fontFamily).toBe('Inter');
    expect(resolved.fontWeight).toBe(700);
  });

  it('run format overrides character style', () => {
    const run: TextRun = {
      text: 'test',
      characterStyleId: 'cs1',
      format: { fontWeight: 900 },
    };
    const styles: Record<string, CharacterStyle> = {
      cs1: {
        id: 'cs1',
        type: 'character',
        name: 'Bold',
        format: { fontWeight: 700 },
      },
    };
    const resolved = resolveCharacterFormat(run, styles, {});
    expect(resolved.fontWeight).toBe(900);
  });
});

describe('resolveParagraphFormat', () => {
  it('uses document default as base', () => {
    const para: Paragraph = { runs: [{ text: 'test' }] };
    const docDefault: ParagraphFormat = { textAlign: 'left' };
    const resolved = resolveParagraphFormat(para, {}, docDefault);
    expect(resolved.textAlign).toBe('left');
  });

  it('applies paragraph style on top of document default', () => {
    const para: Paragraph = { runs: [{ text: 'test' }], paragraphStyleId: 'ps1' };
    const styles: Record<string, ParagraphStyle> = {
      ps1: {
        id: 'ps1',
        type: 'paragraph',
        name: 'Heading',
        format: { textAlign: 'center', lineHeight: 1.6 },
      },
    };
    const resolved = resolveParagraphFormat(para, styles, { textAlign: 'left' });
    expect(resolved.textAlign).toBe('center');
    expect(resolved.lineHeight).toBe(1.6);
  });

  it('paragraph format overrides paragraph style', () => {
    const para: Paragraph = {
      runs: [{ text: 'test' }],
      paragraphStyleId: 'ps1',
      format: { textAlign: 'right' },
    };
    const styles: Record<string, ParagraphStyle> = {
      ps1: {
        id: 'ps1',
        type: 'paragraph',
        name: 'Heading',
        format: { textAlign: 'center' },
      },
    };
    const resolved = resolveParagraphFormat(para, styles, {});
    expect(resolved.textAlign).toBe('right');
  });
});

describe('resolveStyleChain', () => {
  it('returns single-element chain for style with no parent', () => {
    const styles = {
      s1: { id: 's1', type: 'character' as const, name: 'Base', format: {} as CharacterFormat },
    };
    const chain = resolveStyleChain('s1', styles);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.id).toBe('s1');
  });

  it('follows parentId chain', () => {
    const styles: Record<string, ParagraphStyle> = {
      s3: {
        id: 's3',
        type: 'paragraph',
        name: 'Child',
        format: { textAlign: 'right' },
        parentId: 's2',
      },
      s2: { id: 's2', type: 'paragraph', name: 'Mid', format: { lineHeight: 2 }, parentId: 's1' },
      s1: { id: 's1', type: 'paragraph', name: 'Root', format: { textAlign: 'left' } },
    };
    const chain = resolveStyleChain('s3', styles);
    expect(chain).toHaveLength(3);
    expect(chain[0]?.id).toBe('s1');
    expect(chain[1]?.id).toBe('s2');
    expect(chain[2]?.id).toBe('s3');
  });

  it('detects circular references and returns empty chain', () => {
    const styles: Record<string, ParagraphStyle> = {
      s1: { id: 's1', type: 'paragraph', name: 'A', format: {}, parentId: 's2' },
      s2: { id: 's2', type: 'paragraph', name: 'B', format: {}, parentId: 's1' },
    };
    const chain = resolveStyleChain('s1', styles);
    expect(chain).toHaveLength(0);
  });

  it('merges formats along the chain: root → child', () => {
    const run = { text: 'test', characterStyleId: 's3' };
    const styles: Record<string, CharacterStyle> = {
      s3: {
        id: 's3',
        type: 'character',
        name: 'Child',
        format: { fontSize: 24, fontWeight: 700 },
        parentId: 's1',
      },
      s1: {
        id: 's1',
        type: 'character',
        name: 'Root',
        format: { fontFamily: 'Georgia', fontSize: 16 },
      },
    };
    const resolved = resolveCharacterFormat(run, styles, {});
    // Chain: s1 → s3. Root sets fontFamily=Georgia, fontSize=16. Child overrides fontSize=24, adds fontWeight=700.
    expect(resolved.fontFamily).toBe('Georgia');
    expect(resolved.fontSize).toBe(24);
    expect(resolved.fontWeight).toBe(700);
  });
});
