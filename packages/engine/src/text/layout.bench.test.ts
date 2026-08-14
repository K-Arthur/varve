/**
 * Canonical text layout pipeline — timing baseline.
 *
 * Measures the end-to-end `layoutText` path (itemization, line breaking,
 * per-line visual ordering, caret stops) at 100 / 1k / 10k characters for
 * Latin, Arabic (RTL + wrapping), and mixed-direction text, plus snapshot
 * cache hit cost. Asserts order-of-magnitude regressions only; absolute
 * numbers are machine-dependent. See `docs/architecture/text-pipeline.md`.
 *
 * Run standalone: npx vitest run packages/engine/src/text/layout.bench.test.ts
 */
import { describe, expect, it } from 'vitest';
import { scriptCodeToTag } from '../shaping';
import {
  layoutText,
  type TextLayoutSnapshot,
  TextLayoutSnapshotCache,
  textLayoutSnapshotCacheKey,
} from '../textLayoutSnapshot';
import type { ShapedRun } from '../types';
import { type ItemizedParagraph, itemizeText } from './paragraphs';

function shape(paragraph: ItemizedParagraph): ShapedRun[] {
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
      xAdvance: 10,
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
      width: glyphs.length * 10,
      ascent: 12,
      descent: 4,
    };
  });
}

const SAMPLES: Record<string, string> = {
  latin: 'The quick brown fox jumps over the lazy dog. ',
  arabic: 'العَرَبِيَّة هي لغة سامية يتكلمها أكثر من ٤٢٢ مليون نسمة. ',
  mixed: 'Varve مرحبا दुनिया ภาษาไทย — Version 2.5 الإصدار الجديد. ',
};

function textOf(kind: string, length: number): string {
  const sample = SAMPLES[kind] ?? SAMPLES.latin!;
  return sample.repeat(Math.max(1, Math.ceil(length / sample.length))).slice(0, length);
}

function timed(fn: () => unknown, runs = 7): number {
  fn(); // warm the JIT path
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

function makeInput(text: string, maxWidth: number) {
  const itemized = itemizeText(text);
  return {
    text,
    maxWidth,
    paragraphs: itemized.paragraphs.map((paragraph) => ({
      paragraph,
      runs: shape(paragraph),
    })),
  };
}

function glyphCount(snapshot: TextLayoutSnapshot): number {
  return snapshot.lines.reduce(
    (sum, line) => sum + line.runs.reduce((runSum, run) => runSum + run.glyphs.length, 0),
    0,
  );
}

describe('layoutText — timing baseline', () => {
  it('lays out 100 characters of Latin and Arabic well under a frame budget', () => {
    for (const kind of ['latin', 'arabic', 'mixed']) {
      const input = makeInput(textOf(kind, 100), 400);
      const snapshot = layoutText({ ...input, lineHeight: 16 });
      expect(snapshot.lines.length).toBeGreaterThan(0);
      const elapsed = timed(() => layoutText({ ...input, lineHeight: 16 }));
      expect(elapsed).toBeLessThan(16);
      expect(glyphCount(snapshot)).toBeGreaterThan(50);
    }
  });

  it('lays out 1,000 characters within interactive budget', () => {
    for (const kind of ['latin', 'arabic', 'mixed']) {
      const input = makeInput(textOf(kind, 1000), 400);
      const elapsed = timed(() => layoutText({ ...input, lineHeight: 16 }));
      expect(elapsed).toBeLessThan(50);
    }
  });

  it('lays out 10,000 characters without quadratic degradation', () => {
    const input = makeInput(textOf('latin', 10000), 400);
    const elapsed = timed(() => layoutText({ ...input, lineHeight: 16 }));
    expect(elapsed).toBeLessThan(500);
  });

  it('lays out 10,000 characters of wrapped RTL within budget', () => {
    const input = makeInput(textOf('arabic', 10000), 300);
    const elapsed = timed(() => layoutText({ ...input, lineHeight: 16 }));
    expect(elapsed).toBeLessThan(500);
  });

  it('serves cache hits much faster than full layout', () => {
    const cache = new TextLayoutSnapshotCache(64);
    const input = makeInput(textOf('mixed', 500), 400);
    const first = layoutText({
      ...input,
      lineHeight: 16,
      sourceRevision: 'r1',
      fontRevision: 'f1',
    });
    const key = textLayoutSnapshotCacheKey(first.text, first.identity);
    cache.set(key, first);
    expect(cache.get(key)).toBe(first);
    const cached = timed(() => cache.get(key));
    expect(cached).toBeLessThan(1);
  });

  it('reports diagnostics for unknown glyph IDs without failing', () => {
    const text = textOf('latin', 50);
    const itemized = itemizeText(text);
    const input = {
      text,
      maxWidth: 400,
      paragraphs: itemized.paragraphs.map((paragraph) => ({
        paragraph,
        runs: shape(paragraph).map((run) => ({
          ...run,
          glyphs: run.glyphs.map((glyph) => ({ ...glyph, glyphId: 0 })),
        })),
      })),
    };
    const snapshot = layoutText({ ...input, lineHeight: 16 });
    expect(snapshot.diagnostics.some((line) => line.includes('unknown glyph'))).toBe(true);
  });
});
