/**
 * Parity: the fast local line reorder must match the reference algorithm.
 *
 * Reference = bidi-js's line-local L1.4 + L2 semantics with its sub-range
 * reset-index bug fixed (bidi-js writes `lineLevels[i]` instead of
 * `lineLevels[i - lineStart]`, so its L1.4 reset silently no-ops for any
 * line that does not start at 0). The full-paragraph path (lineStart 0) is
 * bug-free, so an exhaustive BMP sweep also asserts our trailing-type
 * classification matches bidi-js's effective table there.
 */

import bidiFactory from 'bidi-js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BIDI_FIXTURES } from '../text/fixtures';
import { itemizeText } from '../text/paragraphs';
import { reorderLineIndices } from './bidiUax9';

const bidi = bidiFactory();

/** Reference line reorder: bidi-js L1.4 + L2 with the slice-index fix. */
function referenceLineOrder(
  text: string,
  levels: readonly number[],
  baseLevel: number,
  lineStart: number,
  lineEnd: number,
): number[] {
  if (text.length === 0 || lineEnd <= lineStart) return [];
  const lineLength = lineEnd - lineStart;
  const lineLevels = levels.slice(lineStart, lineEnd);
  for (let i = lineLength - 1; i >= 0 && isTrailing(text.charCodeAt(lineStart + i)); i--) {
    lineLevels[i] = baseLevel;
  }
  const indices: number[] = [];
  for (let i = 0; i < lineLength; i++) indices.push(lineStart + i);
  let maxLevel = 0;
  let minOddLevel = Infinity;
  for (const level of lineLevels) {
    if (level > maxLevel) maxLevel = level;
    const odd = level | 1;
    if (odd < minOddLevel) minOddLevel = odd;
  }
  for (let level = maxLevel; level >= minOddLevel; level--) {
    let i = 0;
    while (i < lineLength) {
      if (lineLevels[i]! >= level) {
        let j = i + 1;
        while (j < lineLength && lineLevels[j]! >= level) j++;
        let left = i;
        let right = j - 1;
        while (left < right) {
          const swap = indices[left]!;
          indices[left] = indices[right]!;
          indices[right] = swap;
          left++;
          right--;
        }
        i = j;
      } else {
        i++;
      }
    }
  }
  return indices;
}

/** WS / S / B / directional-formatting trailing classes (shared classifier). */
function isTrailing(code: number): boolean {
  return (
    code === 0x0009 ||
    code === 0x000a ||
    code === 0x000b ||
    code === 0x000c ||
    code === 0x000d ||
    code === 0x001c ||
    code === 0x001d ||
    code === 0x001e ||
    code === 0x001f ||
    code === 0x0020 ||
    code === 0x0085 ||
    code === 0x00a0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

function checkParity(text: string): void {
  const paragraph = itemizeText(text).paragraphs[0];
  if (!paragraph) return;
  const { text: paraText, levels, baseLevel } = paragraph;
  const splits = new Set<number>([0, paraText.length]);
  for (let i = 0; i < paraText.length; i++) {
    if (paraText[i] === ' ') splits.add(i + 1);
  }
  for (let i = 1; i < 8; i++) splits.add(Math.floor((paraText.length * i) / 8));
  for (const lineStart of [...splits].sort((a, b) => a - b)) {
    const lineEnd = Math.min(paraText.length, lineStart + 7);
    if (lineEnd <= lineStart) continue;
    const expected = referenceLineOrder(paraText, levels, baseLevel, lineStart, lineEnd);
    expect(reorderLineIndices(paraText, levels, baseLevel, lineStart, lineEnd)).toEqual(expected);
  }
}

describe('line reorder parity with the reference algorithm', () => {
  it('matches the reference on every BiDi corpus fixture', () => {
    for (const fixture of Object.values(BIDI_FIXTURES)) {
      checkParity(fixture);
    }
    checkParity('مرحبا (عالم)');
    checkParity('\u2066Hello \u2069 ثم \u2067مرحبا\u2069!');
    checkParity('مرحبا Varve 2026!');
  });

  it('matches the reference on wrapped RTL lines of every length', () => {
    for (const text of ['الأول الثاني الثالث', 'مرحبا Varve 2026!', 'a ب ج d ه و f']) {
      const paragraph = itemizeText(text).paragraphs[0]!;
      for (let lineStart = 0; lineStart < text.length; lineStart += 3) {
        const lineEnd = Math.min(text.length, lineStart + 5);
        const expected = referenceLineOrder(
          text,
          paragraph.levels,
          paragraph.baseLevel,
          lineStart,
          lineEnd,
        );
        expect(
          reorderLineIndices(text, paragraph.levels, paragraph.baseLevel, lineStart, lineEnd),
        ).toEqual(expected);
      }
    }
  });

  it('matches the reference under a mixed-direction property sweep', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.constantFrom(
              'a',
              'b',
              ' ',
              'مر',
              'ح',
              'ب',
              '١',
              '2',
              '(',
              ')',
              '\u200e',
              '\u200f',
              '\u2066',
              '\u2069',
              '\t',
            ),
          ),
          {
            minLength: 1,
            maxLength: 24,
          },
        ),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 1, max: 6 }),
        (chars, lineStart, lineLength) => {
          const text = chars.join('');
          const paragraph = itemizeText(text).paragraphs[0];
          if (!paragraph) return;
          const end = Math.min(text.length, lineStart + lineLength);
          if (end <= lineStart) return;
          const expected = referenceLineOrder(
            paragraph.text,
            paragraph.levels,
            paragraph.baseLevel,
            lineStart,
            end,
          );
          expect(
            reorderLineIndices(
              paragraph.text,
              paragraph.levels,
              paragraph.baseLevel,
              lineStart,
              end,
            ),
          ).toEqual(expected);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('matches the reference for every BMP code point in trailing positions', () => {
    const contexts: Array<(c: string) => string> = [
      (c) => `مب${c}و`,
      (c) => `ab${c}`,
      (c) => `\u2066a${c}`,
      (c) => `ab ${c}`,
    ];
    const failures: string[] = [];
    for (let cp = 0; cp <= 0xffff; cp++) {
      const char = String.fromCharCode(cp);
      for (const make of contexts) {
        const paragraph = itemizeText(make(char)).paragraphs[0];
        if (!paragraph) continue;
        // Use the paragraph-local string: newline code points split the text.
        const text = paragraph.text;
        for (const [lineStart, lineEnd] of [
          [0, text.length],
          [1, text.length],
          [0, text.length - 1],
        ] as const) {
          if (lineEnd <= lineStart) continue;
          const expected = referenceLineOrder(
            paragraph.text,
            paragraph.levels,
            paragraph.baseLevel,
            lineStart,
            lineEnd,
          );
          const actual = reorderLineIndices(
            paragraph.text,
            paragraph.levels,
            paragraph.baseLevel,
            lineStart,
            lineEnd,
          );
          if (actual.length !== expected.length || actual.some((v, i) => v !== expected[i])) {
            failures.push(
              `cp=0x${cp.toString(16)} ctx=${make('X')} line=[${lineStart},${lineEnd}] ` +
                `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
            );
            if (failures.length >= 5) break;
          }
        }
        if (failures.length >= 5) break;
      }
      if (failures.length >= 5) break;
    }
    expect(failures).toEqual([]);
  });

  it('matches real bidi-js on the bug-free full-paragraph path for every BMP char', () => {
    // bidi-js's L1.4 reset is correct when the range starts at 0; this sweep
    // pins our trailing-type classification to its effective table.
    const failures: string[] = [];
    for (let cp = 0; cp <= 0xffff; cp++) {
      const paragraph = itemizeText(`ab ${String.fromCharCode(cp)}`).paragraphs[0];
      if (!paragraph) continue;
      const text = paragraph.text;
      const result = {
        levels: Uint8Array.from(paragraph.levels),
        paragraphs: [{ start: 0, end: text.length - 1, level: paragraph.baseLevel }],
      };
      const fromBidiJs = bidi.getReorderedIndices(text, result, 0, text.length - 1);
      const mine = referenceLineOrder(
        paragraph.text,
        paragraph.levels,
        paragraph.baseLevel,
        0,
        paragraph.text.length,
      );
      if (mine.length !== fromBidiJs.length || mine.some((v, i) => v !== fromBidiJs[i])) {
        failures.push(
          `cp=0x${cp.toString(16)} text=${JSON.stringify(text)} ` +
            `bidi-js=${JSON.stringify(fromBidiJs)} mine=${JSON.stringify(mine)}`,
        );
        if (failures.length >= 5) break;
      }
    }
    expect(failures).toEqual([]);
  });
});
