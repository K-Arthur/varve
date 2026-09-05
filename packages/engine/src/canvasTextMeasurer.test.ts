// @vitest-environment jsdom
import { measureAdvanceWidth, textMeasureRevision } from '@varve/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installCanvasTextMeasurer,
  invalidateCanvasTextMeasurements,
  resetCanvasTextMeasurer,
} from './canvasTextMeasurer';

const OPTIONS = { fontSize: 20, fontFamily: 'Test Sans' } as const;

/**
 * Stand in for a canvas context.
 *
 * `shaping: true` gives each glyph its own advance, the way a real text
 * engine does; `shaping: false` returns a per-character constant, which is
 * what jsdom's stub does and what the capability probe must reject.
 */
function installFakeCanvas(options: { shaping: boolean; onMeasure?: () => void }): void {
  let font = '';
  const glyphWidth = (ch: string): number => {
    if (!options.shaping) return 10;
    if (ch === 'i' || ch === 'l') return 4;
    if (ch === 'W' || ch === 'M') return 18;
    return 10;
  };
  const ctx = {
    get font() {
      return font;
    },
    set font(next: string) {
      font = next;
    },
    measureText(text: string) {
      options.onMeasure?.();
      const scale = font.includes('Wide Sans') ? 3 : 1;
      return { width: [...text].reduce((sum, ch) => sum + glyphWidth(ch) * scale, 0) };
    },
  };
  // `getContext` is overloaded for 2D, WebGL, and WebGPU; Vitest's inferred
  // overload can select the latter even though this fake only serves 2D.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ctx as unknown as never,
  );
  // Keep the document path in play; OffscreenCanvas would be preferred.
  vi.stubGlobal('OffscreenCanvas', undefined);
}

beforeEach(() => {
  resetCanvasTextMeasurer();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetCanvasTextMeasurer();
});

describe('canvas text measurer', () => {
  it('declines an environment whose measureText only counts characters', () => {
    // jsdom's stub returns length * 0.55 * size for every string. Feeding that
    // through as if it were shaping would dress an estimate up as a
    // measurement while making it less predictable than the estimate itself.
    installFakeCanvas({ shaping: false });
    installCanvasTextMeasurer();
    expect(measureAdvanceWidth('Hello', OPTIONS)).toBeCloseTo(5 * 20 * 0.6);
    expect(textMeasureRevision()).toBe('text-measure:estimated');
  });

  it('uses real advances once the environment measures glyphs', () => {
    installFakeCanvas({ shaping: true });
    installCanvasTextMeasurer();
    // H e l l o -> 10 + 10 + 4 + 4 + 10
    expect(measureAdvanceWidth('Hello', OPTIONS)).toBeCloseTo(38);
    expect(textMeasureRevision()).toContain('canvas-text:');
  });

  it('measures the same string differently in different families', () => {
    installFakeCanvas({ shaping: true });
    installCanvasTextMeasurer();
    const narrow = measureAdvanceWidth('Hello', OPTIONS);
    const wide = measureAdvanceWidth('Hello', { ...OPTIONS, fontFamily: 'Wide Sans' });
    expect(wide).toBeGreaterThan(narrow);
  });

  it('keys the cache by variation settings, not just the CSS shorthand', () => {
    let calls = 0;
    installFakeCanvas({
      shaping: true,
      onMeasure: () => {
        calls += 1;
      },
    });
    installCanvasTextMeasurer();
    measureAdvanceWidth('Hello', OPTIONS);
    const afterFirst = calls;
    measureAdvanceWidth('Hello', OPTIONS);
    expect(calls).toBe(afterFirst); // cached
    measureAdvanceWidth('Hello', { ...OPTIONS, variableAxes: { wght: 700 } });
    expect(calls).toBeGreaterThan(afterFirst); // a different face, re-measured
  });

  it('advances its revision and drops cached advances on invalidation', () => {
    let calls = 0;
    installFakeCanvas({
      shaping: true,
      onMeasure: () => {
        calls += 1;
      },
    });
    installCanvasTextMeasurer();
    measureAdvanceWidth('Hello', OPTIONS);
    const before = textMeasureRevision();
    const cachedCalls = calls;

    invalidateCanvasTextMeasurements();

    expect(textMeasureRevision()).not.toBe(before);
    measureAdvanceWidth('Hello', OPTIONS);
    expect(calls).toBeGreaterThan(cachedCalls);
  });
});
