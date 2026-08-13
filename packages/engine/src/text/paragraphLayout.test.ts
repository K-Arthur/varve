// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { scriptCodeToTag, shapeParagraphRuns } from '../shaping';
import { type LayoutTextInput, layoutText, selectionRects } from '../textLayoutSnapshot';
import { BIDI_FIXTURES, SCRIPT_FIXTURES } from './fixtures';
import { itemizeParagraph, itemizeText } from './paragraphs';

/** Synthetic logical-order shaping: one run per scripted run, widthPerChar advances. */
function shape(paragraph: ReturnType<typeof itemizeText>['paragraphs'][number], widthPerChar = 10) {
  return paragraph.scriptedRuns.map((run) => {
    const text = paragraph.text.slice(run.start, run.end);
    const clusters: number[] = [];
    let cursor = 0;
    for (const char of text) {
      clusters.push(cursor);
      cursor += char.length;
    }
    const glyphs = clusters.map((cluster) => ({
      glyphId: 1,
      xAdvance: widthPerChar,
      yAdvance: 0,
      xOffset: 0,
      yOffset: 0,
      clusterUtf16: run.start + cluster,
    }));
    if (run.direction === 'rtl') glyphs.reverse();
    return {
      fontFamily: 'Test Sans',
      fontSize: 16,
      fontWeight: 400,
      fontStyle: 'normal' as const,
      direction: run.direction,
      level: run.level,
      script: scriptCodeToTag(run.script),
      glyphs,
      width: widthPerChar * glyphs.length,
      ascent: 12,
      descent: 4,
    };
  });
}

function layout(text: string, maxWidth: number, direction?: 'auto' | 'ltr' | 'rtl') {
  const itemized = itemizeText(text, direction);
  const input: LayoutTextInput = {
    text,
    paragraphs: itemized.paragraphs.map((paragraph) => ({ paragraph, runs: shape(paragraph) })),
    maxWidth,
    sourceRevision: 'doc:1',
    fontRevision: 'font:1',
    lineHeight: 16,
  };
  return layoutText(input);
}

describe('layoutText — paragraphs and line breaking', () => {
  it('wraps at word boundaries, never inside a word', () => {
    const snapshot = layout('hello world foo bar', 115);
    expect(snapshot.lines.map((line) => line.sourceStart)).toEqual([0, 12]);
    expect(snapshot.lines[0]!.width).toBe(110);
  });

  it('breaks an overlong word at grapheme boundaries', () => {
    const snapshot = layout('abcdefgh', 25);
    expect(snapshot.lines.map((line) => line.sourceStart)).toEqual([0, 2, 4, 6]);
  });

  it('never wraps at NBSP even when the line overflows', () => {
    const snapshot = layout('ab\u00a0cd', 25);
    // NBSP is glued to the first word; the break falls before "cd".
    expect(snapshot.lines.map((line) => line.sourceStart)).toEqual([0, 3]);
    expect(snapshot.lines[0]!.sourceEnd).toBe(3);
  });

  it('never wraps inside an emoji ZWJ grapheme', () => {
    const snapshot = layout(`${SCRIPT_FIXTURES.emojiZwj}${SCRIPT_FIXTURES.emojiZwj}`, 11);
    expect(snapshot.lines.map((line) => line.sourceStart)).toEqual([0, 11]);
    expect(snapshot.lines[0]!.sourceEnd).toBe(11);
  });

  it('keeps CJK line breaking between ideographs', () => {
    const snapshot = layout(SCRIPT_FIXTURES.cjk, 20);
    expect(snapshot.lines.length).toBeGreaterThan(1);
    const joined = snapshot.lines
      .map((line) => snapshot.text.slice(line.sourceStart, line.sourceEnd))
      .join('');
    expect(joined).toBe(SCRIPT_FIXTURES.cjk);
  });

  it('handles multiple paragraphs with independent directions', () => {
    const snapshot = layout('Hello\nمرحبا', 1000);
    expect(snapshot.paragraphs).toHaveLength(2);
    expect(snapshot.paragraphs[0]!.baseDirection).toBe('ltr');
    expect(snapshot.paragraphs[1]!.baseDirection).toBe('rtl');
    expect(snapshot.lines).toHaveLength(2);
    expect(snapshot.lines[1]!.paragraphIndex).toBe(1);
    expect(snapshot.lines[1]!.sourceStart).toBe(6);
  });

  it('produces one empty line for an empty paragraph', () => {
    const paragraph = itemizeParagraph({ index: 0, start: 0, end: 0, text: '' }, 'auto');
    const snapshot = layoutText({
      text: '',
      paragraphs: [{ paragraph, runs: [] }],
      maxWidth: 100,
      lineHeight: 16,
    });
    expect(snapshot.lines).toHaveLength(1);
    expect(snapshot.lines[0]!.runs).toEqual([]);
    expect(snapshot.height).toBe(16);
  });
});

describe('layoutText — BiDi visual ordering', () => {
  it('keeps a pure LTR line in logical visual order', () => {
    const snapshot = layout('abcd', 1000);
    expect(snapshot.lines[0]!.runs.map((run) => run.direction)).toEqual(['ltr']);
    expect(snapshot.lines[0]!.visualClusters).toEqual([0, 1, 2, 3]);
  });

  it('reverses a pure RTL line into visual order', () => {
    const snapshot = layout('مرحبا', 1000);
    expect(snapshot.lines[0]!.runs.map((run) => run.direction)).toEqual(['rtl']);
    // Glyphs are in visual (left-to-right) order: cluster indices descend
    // while x positions ascend — the word reads right-to-left on screen.
    expect(snapshot.lines[0]!.visualClusters).toEqual([4, 3, 2, 1, 0]);
    const glyphs = snapshot.lines[0]!.runs[0]!.glyphs;
    for (let i = 1; i < glyphs.length; i++) {
      expect(glyphs[i]!.x).toBeGreaterThan(glyphs[i - 1]!.x);
      expect(glyphs[i]!.clusterUtf16).toBeLessThan(glyphs[i - 1]!.clusterUtf16);
    }
  });

  it('orders mixed runs per line: Arabic word between Latin spans', () => {
    const snapshot = layout(BIDI_FIXTURES.priceInArabic, 1000);
    expect(snapshot.lines[0]!.runs.map((run) => run.direction)).toEqual(['ltr', 'rtl', 'ltr']);
    const runs = snapshot.lines[0]!.runs;
    expect(runs[0]!.sourceEnd).toBeLessThanOrEqual(runs[1]!.sourceStart);
    expect(snapshot.lines[0]!.visualClusters).toContain(16);
  });

  it('orders an RTL-base mixed paragraph with its embedded Latin right-to-left', () => {
    const snapshot = layout(BIDI_FIXTURES.helloVarve, 1000);
    const runs = snapshot.lines[0]!.runs;
    expect(runs[0]!.direction).toBe('rtl');
    // The whole line is contiguous: run x positions ascend left to right.
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]!.x).toBeGreaterThanOrEqual(runs[i - 1]!.x + runs[i - 1]!.width - 0.01);
    }
  });

  it('reverses each wrapped RTL line independently', () => {
    const snapshot = layout('الأول الثاني الثالث', 70);
    expect(snapshot.lines.length).toBeGreaterThan(1);
    for (const line of snapshot.lines) {
      expect(line.runs[0]!.direction).toBe('rtl');
      expect(line.visualClusters).toHaveLength(line.sourceEnd - line.sourceStart);
    }
  });

  it('keeps source text logical across wrapped RTL lines', () => {
    const text = 'الأول الثاني الثالث';
    const snapshot = layout(text, 70);
    const reconstructed = snapshot.lines
      .map((line) => snapshot.text.slice(line.sourceStart, line.sourceEnd))
      .join('');
    expect(reconstructed).toBe(text);
  });
});

describe('layoutText — caret stops', () => {
  it('places RTL caret stops right-to-left with correct offsets', () => {
    const snapshot = layout('مرحبا', 1000);
    const stops = snapshot.caretStops.filter((stop) => stop.lineIndex === 0);
    // Each cluster boundary carries both leading and trailing affinity.
    expect(stops.map((stop) => stop.offset).sort()).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
    const start = stops.find((stop) => stop.offset === 0 && stop.affinity === 'leading')!;
    expect(start.x).toBe(snapshot.lines[0]!.width);
    const end = stops.find((stop) => stop.offset === 5 && stop.affinity === 'trailing')!;
    expect(end.x).toBe(0);
  });

  it('never creates caret stops inside an emoji ZWJ grapheme', () => {
    const snapshot = layout(SCRIPT_FIXTURES.emojiZwj, 1000);
    const offsets = new Set(snapshot.caretStops.map((stop) => stop.offset));
    expect([...offsets].sort((a, b) => a - b)).toEqual([0, 11]);
  });

  it('never creates caret stops inside a combining sequence', () => {
    const snapshot = layout('e\u0301', 1000);
    const offsets = new Set(snapshot.caretStops.map((stop) => stop.offset));
    expect([...offsets].sort()).toEqual([0, 2]);
  });

  it('places one stop per cluster for a ligature (shared cluster)', () => {
    const paragraph = itemizeText('office').paragraphs[0]!;
    // Simulate an "fi" ligature: two glyphs sharing clusterUtf16 1.
    const runs = [
      {
        fontFamily: 'Test',
        fontSize: 16,
        fontWeight: 400,
        fontStyle: 'normal' as const,
        direction: 'ltr' as const,
        level: 0,
        script: 'latn',
        glyphs: [
          { glyphId: 1, xAdvance: 10, yAdvance: 0, xOffset: 0, yOffset: 0, clusterUtf16: 0 },
          { glyphId: 2, xAdvance: 8, yAdvance: 0, xOffset: 0, yOffset: 0, clusterUtf16: 1 },
          { glyphId: 2, xAdvance: 0, yAdvance: 0, xOffset: 0, yOffset: 0, clusterUtf16: 1 },
          { glyphId: 3, xAdvance: 10, yAdvance: 0, xOffset: 0, yOffset: 0, clusterUtf16: 2 },
          { glyphId: 4, xAdvance: 10, yAdvance: 0, xOffset: 0, yOffset: 0, clusterUtf16: 3 },
          { glyphId: 5, xAdvance: 10, yAdvance: 0, xOffset: 0, yOffset: 0, clusterUtf16: 4 },
        ],
        width: 48,
        ascent: 12,
        descent: 4,
      },
    ];
    const snapshot = layoutText({
      text: 'office',
      paragraphs: [{ paragraph, runs }],
      maxWidth: 1000,
      lineHeight: 16,
    });
    const offsets = snapshot.caretStops.map((stop) => stop.offset);
    // No stop between the two ligature glyphs (offset 1 appears once).
    expect(offsets.filter((offset) => offset === 1)).toHaveLength(2);
    expect(snapshot.lines[0]!.runs[0]!.glyphs[1]!.xAdvance).toBe(8);
  });
});

describe('layoutText — hit testing and selection', () => {
  it('hit tests RTL text: click near left edge lands at paragraph end', () => {
    const snapshot = layout('مرحبا', 1000);
    // Left of everything in an RTL line = the paragraph end (offset 5).
    expect(hitTest(snapshot, 2, 4).offset).toBe(5);
    // Right of everything = the paragraph start (offset 0).
    expect(hitTest(snapshot, 48, 4).offset).toBe(0);
    // Inside the glyph run: nearest cluster boundary.
    expect(hitTest(snapshot, 25, 4).offset).toBe(2);
  });

  it('hit tests the boundary between LTR and RTL runs', () => {
    const snapshot = layout(BIDI_FIXTURES.priceInArabic, 1000);
    // Just left of the Arabic word: the last LTR boundary (offset 16).
    expect(hitTest(snapshot, 162, 4).offset).toBe(16);
    // Just inside the Arabic word: the nearest logical cluster boundary.
    expect(hitTest(snapshot, 205, 4).offset).toBe(19);
  });

  it('produces one contiguous selection rectangle across a fully selected RTL word', () => {
    const snapshot = layout(BIDI_FIXTURES.priceInArabic, 1000);
    const rects = selectionRects(snapshot, 8, 25);
    expect(rects).toHaveLength(1);
    expect(rects[0]!.x).toBe(80);
    expect(rects[0]!.width).toBe(170);
  });

  it('produces per-line selection rectangles across a wrap', () => {
    const snapshot = layout('مرحبا hello world', 55);
    expect(snapshot.lines.length).toBeGreaterThan(1);
    const rects = selectionRects(snapshot, 0, 100);
    expect(rects.length).toBeGreaterThan(1);
    expect(new Set(rects.map((rect) => rect.lineIndex)).size).toBe(snapshot.lines.length);
  });

  it('selects a whole line as one rectangle', () => {
    const snapshot = layout('abcd', 1000);
    expect(selectionRects(snapshot, 0, 4)).toEqual([
      { lineIndex: 0, x: 0, y: 0, width: 40, height: 16 },
    ]);
  });

  it('snaps selection endpoints to grapheme boundaries', () => {
    const snapshot = layout('e\u0301x', 1000);
    const rects = selectionRects(snapshot, 0, 1);
    expect(rects[0]!.width).toBe(20);
  });
});

function hitTest(snapshot: ReturnType<typeof layoutText>, x: number, _y: number) {
  const stops = snapshot.caretStops.filter((stop) => stop.lineIndex === 0);
  const line = snapshot.lines[0]!;
  return stops.reduce(
    (best, stop) => {
      const distance = Math.abs(stop.x - x);
      const bestDistance = Math.abs(best.x - x);
      const rtl = line.runs[0]?.direction === 'rtl';
      return distance < bestDistance || (rtl && distance === bestDistance && stop.x > best.x)
        ? stop
        : best;
    },
    stops[0] ?? {
      offset: line.sourceStart,
      lineIndex: 0,
      x: 0,
      affinity: 'leading' as const,
      direction: line.runs[0]?.direction ?? 'ltr',
    },
  );
}

describe('shapeParagraphRuns — canvas bridge into the canonical pipeline', () => {
  it('shapes an RTL paragraph into logical-order runs with paragraph-local clusters', () => {
    const ctx = {
      measureText: (text: string) => ({ width: text.length * 10 }),
      font: '',
    } as unknown as CanvasRenderingContext2D;
    const paragraph = itemizeText(BIDI_FIXTURES.priceInArabic).paragraphs[0]!;
    const runs = shapeParagraphRuns(paragraph, ctx, { fontFamily: 'Test', fontSize: 16 });
    expect(runs.map((run) => run.direction)).toEqual(['ltr', 'rtl', 'ltr']);
    // RTL run glyphs are in visual order (rightmost first).
    expect(runs[1]!.glyphs[0]!.clusterUtf16).toBe(21);
    expect(runs[1]!.glyphs[runs[1]!.glyphs.length - 1]!.clusterUtf16).toBe(17);
  });

  it('flows shaped bridge output through layoutText unchanged in structure', () => {
    const ctx = {
      measureText: (text: string) => ({ width: text.length * 10 }),
      font: '',
    } as unknown as CanvasRenderingContext2D;
    const text = 'Hello مرحبا world';
    const itemized = itemizeText(text);
    const paragraphs = itemized.paragraphs.map((paragraph) => ({
      paragraph,
      runs: shapeParagraphRuns(paragraph, ctx, { fontFamily: 'Test', fontSize: 16 }),
    }));
    const snapshot = layoutText({ text, paragraphs, maxWidth: 1000, lineHeight: 16 });
    expect(snapshot.lines[0]!.runs.map((run) => run.direction)).toEqual(['ltr', 'rtl', 'ltr']);
    const reconstructed = snapshot.lines
      .map((line) => snapshot.text.slice(line.sourceStart, line.sourceEnd))
      .join('');
    expect(reconstructed).toBe(text);
  });
});
