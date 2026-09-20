import {
  ellipseLineWidthProfile,
  resolveTextGeometry,
  setTextAdvanceMeasurer,
} from '@varve/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTextLayoutSnapshot } from './textLayoutSnapshot';
import type { ShapedRun, TextShaping } from './types';

/**
 * The contour (balloon) contract: the scene geometry resolver in
 * `@varve/shared` and the canonical painter in the engine must break the same
 * logical text into the same lines when handed the same per-line width
 * profile. These tests exist so a future refactor cannot silently make
 * selection disagree with paint inside a balloon.
 */

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

const LINE_HEIGHT = 16 * 1.4;

afterEach(() => {
  setTextAdvanceMeasurer(null);
});

/**
 * Shared geometry measures through the installed advance backend; the engine
 * test shaping uses 10px per glyph, so the parity harness installs a matching
 * measurer. Without it the shared estimator would use different advances and
 * the comparison would be meaningless.
 */
function installMonospaceMeasurer(): void {
  setTextAdvanceMeasurer({
    measureAdvance: (text: string) => text.length * 10,
    revision: () => 'balloon-parity',
  });
}

function sharedLineTexts(text: string, w: number, h: number): string[] {
  return resolveTextGeometry({
    text,
    w,
    h,
    fontSize: 16,
    fontFamily: 'Test Sans',
    lineHeight: 1.4,
    textResizing: 'fixed',
    textWrapShape: 'ellipse',
  }).lines.map((line) => line.text.trimEnd());
}

function engineLineTexts(text: string, w: number, h: number): string[] {
  const snapshot = buildTextLayoutSnapshot(text, makeShaping(text), {
    maxWidth: w,
    lineWidths: ellipseLineWidthProfile({ width: w, height: h, lineHeight: LINE_HEIGHT }),
    lineHeight: LINE_HEIGHT,
  });
  return snapshot.lines.map((line) => text.slice(line.sourceStart, line.sourceEnd).trimEnd());
}

describe('balloon contour wrapping (engine)', () => {
  it('honours each line limit and moves whole words to a wider line', () => {
    const text = 'aaaa bbbb cccc dddd';
    const snapshot = buildTextLayoutSnapshot(text, makeShaping(text), {
      maxWidth: 120,
      lineWidths: [40, 120],
      lineHeight: LINE_HEIGHT,
    });
    const lines = snapshot.lines.map((line) =>
      text.slice(line.sourceStart, line.sourceEnd).trimEnd(),
    );
    expect(lines).toEqual(['aaaa', 'bbbb cccc', 'dddd']);
    expect(snapshot.identity.lineWidthsKey).toBe('40,120');
  });

  it('stays rectangular when no profile is supplied', () => {
    const text = 'aaaa bbbb cccc dddd';
    const snapshot = buildTextLayoutSnapshot(text, makeShaping(text), {
      maxWidth: 100,
      lineHeight: LINE_HEIGHT,
    });
    expect(snapshot.lines).toHaveLength(2);
    expect(snapshot.identity.lineWidthsKey).toBe('');
  });

  it('distinguishes profile and rectangle in the snapshot cache identity keys', () => {
    const text = 'aaaa bbbb cccc dddd';
    const shaped = makeShaping(text);
    const profiled = buildTextLayoutSnapshot(text, shaped, {
      maxWidth: 120,
      lineWidths: [40, 120],
    });
    const rectangular = buildTextLayoutSnapshot(text, shaped, { maxWidth: 120 });
    expect(profiled.identity.lineWidthsKey).not.toBe(rectangular.identity.lineWidthsKey);
  });
});

describe('balloon contour wrapping parity (shared geometry vs engine paint)', () => {
  it('breaks natural dialogue into identical lines', () => {
    installMonospaceMeasurer();
    const text =
      'Wait for me at the station. If the lights go out, take the east stairs and do not look back.';
    expect(engineLineTexts(text, 200, 160)).toEqual(sharedLineTexts(text, 200, 160));
  });

  it('agrees on a short paragraph where the profile barely bites', () => {
    installMonospaceMeasurer();
    const text = 'No, that is not what I meant at all.';
    expect(engineLineTexts(text, 240, 200)).toEqual(sharedLineTexts(text, 240, 200));
  });

  it('agrees when a localized replacement expands the same balloon', () => {
    installMonospaceMeasurer();
    const text =
      'Nein, das habe ich überhaupt nicht so gemeint — ich wollte nur sichergehen, dass wir uns verstehen.';
    expect(engineLineTexts(text, 220, 180)).toEqual(sharedLineTexts(text, 220, 180));
  });
});
