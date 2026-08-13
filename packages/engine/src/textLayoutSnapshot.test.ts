import { describe, expect, it } from 'vitest';
import {
  buildTextLayoutSnapshot,
  hitTestTextLayout,
  selectionRects,
  TextLayoutSnapshotCache,
} from './textLayoutSnapshot';
import type { ShapedRun, TextShaping } from './types';

function makeShaping(text: string, width = 10): TextShaping {
  const run: ShapedRun = {
    fontFamily: 'Test Sans',
    fontSize: 16,
    fontWeight: 400,
    fontStyle: 'normal',
    direction: 'ltr',
    level: 0,
    script: 'latn',
    glyphs: [...text].map((_, index) => ({
      glyphId: index + 1,
      xAdvance: width,
      yAdvance: 0,
      xOffset: 0,
      yOffset: 0,
      clusterUtf16: index,
    })),
    width: [...text].length * width,
    ascent: 12,
    descent: 4,
  };
  return {
    runs: [run],
    visualRuns: [run],
    width: run.width,
    height: 16,
    baseDirection: 'ltr',
    direction: 'ltr',
  };
}

describe('TextLayoutSnapshot', () => {
  it('retains logical source text while producing line and caret geometry', () => {
    const snapshot = buildTextLayoutSnapshot('abcd', makeShaping('abcd'), {
      maxWidth: 25,
      sourceRevision: 'doc:1',
      fontRevision: 'font:1',
    });

    expect(snapshot.text).toBe('abcd');
    expect(snapshot.lines).toHaveLength(2);
    expect(snapshot.lines[0]?.width).toBe(20);
    expect(snapshot.lines[1]?.sourceStart).toBe(2);
    expect(snapshot.caretStops.some((stop) => stop.offset === 2 && stop.lineIndex === 1)).toBe(
      true,
    );
    expect(snapshot.diagnostics).toEqual([]);
  });

  it('uses cluster spans for selection and nearest caret hit testing', () => {
    const snapshot = buildTextLayoutSnapshot('abc', makeShaping('abc'), { maxWidth: 100 });
    expect(selectionRects(snapshot, 1, 3)).toEqual([
      { lineIndex: 0, x: 10, y: 0, width: 20, height: 16 },
    ]);
    expect(hitTestTextLayout(snapshot, 18, 4).offset).toBe(2);
  });

  it('bounds cache entries and refreshes least-recently-used order', () => {
    const cache = new TextLayoutSnapshotCache(2);
    const first = buildTextLayoutSnapshot('a', makeShaping('a'), { maxWidth: 100 });
    const second = buildTextLayoutSnapshot('b', makeShaping('b'), { maxWidth: 100 });
    const third = buildTextLayoutSnapshot('c', makeShaping('c'), { maxWidth: 100 });
    cache.set('first', first);
    cache.set('second', second);
    expect(cache.get('first')).toBe(first);
    cache.set('third', third);
    expect(cache.get('second')).toBeUndefined();
    expect(cache.size).toBe(2);
  });
});
