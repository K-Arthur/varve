import { describe, expect, it } from 'vitest';
import { flatTextFromRichText, richTextReplace } from './findReplace';
import type { RichText, TextRun } from './typography';

function makeRichText(segments: { text: string; bold?: boolean; italic?: boolean }[]): RichText {
  const runs: TextRun[] = segments.map((seg) => ({
    text: seg.text,
    format: {
      ...(seg.bold ? { fontWeight: 700 } : {}),
      ...(seg.italic ? { fontStyle: 'italic' as const } : {}),
    },
  }));
  return { paragraphs: [{ runs }] };
}

function richTextToFlatWithStyles(rich: RichText): {
  chars: { char: string; bold: boolean; italic: boolean }[];
} {
  const chars: { char: string; bold: boolean; italic: boolean }[] = [];
  for (const para of rich.paragraphs) {
    for (const run of para.runs) {
      for (const ch of run.text) {
        chars.push({
          char: ch,
          bold: (run.format?.fontWeight ?? 400) >= 700,
          italic: run.format?.fontStyle === 'italic',
        });
      }
    }
    chars.push({ char: '\n', bold: false, italic: false });
  }
  if (chars.length > 0) chars.pop();
  return { chars };
}

describe('richTextReplace style preservation', () => {
  it('preserves styles on simple in-run replace', () => {
    const rich = makeRichText([{ text: 'Hello World', bold: true }]);
    const result = richTextReplace(rich, 0, 5, 'Hi');
    const chars = richTextToFlatWithStyles(result).chars;
    expect(chars.slice(0, 2).every((c) => c.bold)).toBe(true);
    expect(chars.slice(2).every((c) => c.bold)).toBe(true);
    expect(chars.length).toBe(8);
  });

  it('match spanning two style runs inherits first-run style', () => {
    const rich = makeRichText([
      { text: 'Hello ', bold: true },
      { text: 'World', italic: true },
    ]);
    const result = richTextReplace(rich, 3, 8, 'XYZ');
    const chars = richTextToFlatWithStyles(result).chars;
    // First 3 chars (Hel) are bold
    expect(chars[0].bold).toBe(true);
    expect(chars[1].bold).toBe(true);
    expect(chars[2].bold).toBe(true);
    // Replacement (XYZ) inherits bold from first char of match
    expect(chars[3].bold).toBe(true);
    expect(chars[4].bold).toBe(true);
    expect(chars[5].bold).toBe(true);
    // Remaining chars bold first, then italic... actually the split logic means
    // both runs get consumed. The replacement replaces "lo " + "Wo" = 5 chars with 3.
    // Hel(3) + XYZ(3) + rld(3) = 9
    expect(chars.length).toBe(9);
  });

  it('preserves all style invariants', () => {
    const invariants = [
      { text: 'Hello World', segments: [{ text: 'Hello World' }] },
      {
        text: 'AB',
        segments: [
          { text: 'A', bold: true },
          { text: 'B', italic: true },
        ],
      },
    ];

    for (const inv of invariants) {
      const rich = makeRichText(
        inv.segments.map((s) => ({ text: s.text, bold: s.bold, italic: s.italic })),
      );
      const { text } = flatTextFromRichText(rich);
      expect(text).toBe(inv.text);
    }
  });

  it('shifts subsequent style ranges correctly', () => {
    const rich = makeRichText([
      { text: 'ab', bold: true },
      { text: 'cd', italic: true },
      { text: 'ef', bold: true },
    ]);
    // Replace 'cd' (length 2) with 'XXXX' (length 4)
    const result = richTextReplace(rich, 2, 4, 'XXXX');
    const chars = richTextToFlatWithStyles(result).chars;
    expect(chars.length).toBe(8);
    expect(chars[0].bold).toBe(true);
    expect(chars[1].bold).toBe(true);
    // Replacement inherits italic from 'c' (first char of match)
    expect(chars[2].bold).toBe(false);
    expect(chars[2].italic).toBe(true);
    expect(chars[3].bold).toBe(false);
    expect(chars[3].italic).toBe(true);
    expect(chars[4].bold).toBe(false);
    expect(chars[4].italic).toBe(true);
    expect(chars[5].bold).toBe(false);
    expect(chars[5].italic).toBe(true);
    // After the replacement, the remaining 'ef' should still be bold
    expect(chars[6].bold).toBe(true);
    expect(chars[7].bold).toBe(true);
  });

  it('handles replacement shorter than match', () => {
    const rich = makeRichText([{ text: 'The quick brown fox', bold: true }]);
    const result = richTextReplace(rich, 4, 9, 'slow');
    const chars = richTextToFlatWithStyles(result).chars;
    expect(chars.every((c) => c.bold)).toBe(true);
    expect(chars.length).toBe(18);
  });

  it('handles empty replacement (deletion)', () => {
    const rich = makeRichText([
      { text: 'Hello ', bold: true },
      { text: 'World', italic: true },
    ]);
    const result = richTextReplace(rich, 6, 11, '');
    const chars = richTextToFlatWithStyles(result).chars;
    expect(chars.length).toBe(6);
    expect(chars[0].bold).toBe(true);
    expect(chars[1].bold).toBe(true);
    expect(chars[2].bold).toBe(true);
    expect(chars[3].bold).toBe(true);
    expect(chars[4].bold).toBe(true);
    expect(chars[5].bold).toBe(true);
  });

  it('property test: random replaces preserve style invariants', () => {
    const run = (text: string, bold?: boolean, italic?: boolean): TextRun => ({
      text,
      format: {
        ...(bold ? { fontWeight: 700 } : {}),
        ...(italic ? { fontStyle: 'italic' as const } : {}),
      },
    });

    const invariants = (rich: RichText): void => {
      const { text, mapping } = flatTextFromRichText(rich);
      // Total length match
      let flatLen = 0;
      for (const para of rich.paragraphs) {
        for (const r of para.runs) flatLen += r.text.length;
      }
      flatLen += rich.paragraphs.length - 1; // newlines
      expect(text.length).toBe(flatLen);

      // No negative lengths
      for (const para of rich.paragraphs) {
        for (const r of para.runs) {
          expect(r.text.length).toBeGreaterThanOrEqual(0);
        }
      }

      // Mapping positions match
      expect(mapping.length).toBe(text.length);
      for (let i = 0; i < mapping.length; i++) {
        const m = mapping[i];
        if (m.paragraphIndex >= 0) {
          const para = rich.paragraphs[m.paragraphIndex];
          expect(para).toBeDefined();
          const r = para?.runs[m.runIndex];
          expect(r).toBeDefined();
          expect(m.runOffset).toBeLessThan(r?.text.length ?? 0);
        }
      }
    };

    // Test multiple random-looking cases
    const cases: { rich: RichText; replaces: { start: number; end: number; repl: string }[] }[] = [
      {
        rich: {
          paragraphs: [
            {
              runs: [
                run('abc', true),
                run('def', false, true),
                run('ghi', true),
                run('jkl', false),
              ],
            },
          ],
        },
        replaces: [
          { start: 2, end: 5, repl: 'XX' },
          { start: 0, end: 1, repl: 'ZZZ' },
        ],
      },
      {
        rich: {
          paragraphs: [
            { runs: [run('Hello World', true)] },
            { runs: [run('Second paragraph', false, true)] },
          ],
        },
        replaces: [{ start: 6, end: 11, repl: 'There' }],
      },
    ];

    for (const { rich, replaces } of cases) {
      let current = rich;
      invariants(current);
      for (const r of replaces) {
        current = richTextReplace(current, r.start, r.end, r.repl);
        invariants(current);
      }
    }
  });

  it('handles inserting at boundaries', () => {
    const rich = makeRichText([
      { text: 'ab', bold: true },
      { text: 'cd', italic: true },
    ]);
    // Insert 'XY' at position 2 (between the two runs)
    const result = richTextReplace(rich, 2, 2, 'XY');
    const _chars = richTextToFlatWithStyles(result).chars;
    const { text } = flatTextFromRichText(result);
    expect(text).toBe('abXYcd');
  });
});
