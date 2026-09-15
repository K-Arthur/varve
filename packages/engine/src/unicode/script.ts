/**
 * Unicode script detection for per-script font fallback.
 *
 * Research basis:
 * - Unicode Standard Annex #24: Unicode Script Property
 * - ISO 15924 script codes
 * - OpenType script tags (init, medi, fina, isol → Arab, Deva, Thai, ...)
 *
 * Maps a codepoint to its ISO 15924 script code. Used by the font resolver
 * to pick appropriate fallback fonts when a text span contains characters
 * outside the current font's script coverage (e.g. Arabic words inside a
 * Latin paragraph).
 */

/** ISO 15924 4-letter script codes + special values. */
export type ScriptCode =
  | 'Latn'
  | 'Arab'
  | 'Hebr'
  | 'Syrc'
  | 'Thaa'
  | 'Nkoo'
  | 'Deva'
  | 'Beng'
  | 'Guru'
  | 'Gujr'
  | 'Orya'
  | 'Taml'
  | 'Telu'
  | 'Knda'
  | 'Mlym'
  | 'Sinh'
  | 'Thai'
  | 'Laoo'
  | 'Tibt'
  | 'Mymr'
  | 'Geor'
  | 'Hang'
  | 'Ethi'
  | 'Cher'
  | 'Cans'
  | 'Ogam'
  | 'Runr'
  | 'Khmr'
  | 'Mong'
  | 'Hira'
  | 'Kana'
  | 'Bopo'
  | 'Hans'
  | 'Hant'
  | 'Yiii'
  | 'Vaii'
  | 'Bali'
  | 'Sund'
  | 'Lepc'
  | 'Olck'
  | 'Cyrs'
  | 'Glag'
  | 'Tfng'
  | 'Hani'
  | 'Buhd'
  | 'Tagb'
  | 'Goth'
  | 'Zyyy' // Common (punctuation, digits, symbols)
  | 'Zzzz'; // Unknown (unassigned)

interface ScriptRange {
  start: number;
  end: number;
  script: ScriptCode;
}

// Script ranges. Must be sorted by start for binary search (sorted at init).
const _SCRIPT_RANGES: ScriptRange[] = [
  // Latin blocks
  { start: 0x0041, end: 0x005a, script: 'Latn' }, // Basic Latin UC
  { start: 0x0061, end: 0x007a, script: 'Latn' }, // Basic Latin LC
  { start: 0x00c0, end: 0x00d6, script: 'Latn' }, // Latin-1 Supplement letters
  { start: 0x00d8, end: 0x00f6, script: 'Latn' },
  { start: 0x00f8, end: 0x024f, script: 'Latn' }, // Latin Extended-A/B
  { start: 0x0250, end: 0x02af, script: 'Latn' }, // IPA
  { start: 0x1e00, end: 0x1eff, script: 'Latn' }, // Latin Extended Additional
  { start: 0x2c60, end: 0x2c7f, script: 'Latn' }, // Latin Extended-C
  { start: 0xa720, end: 0xa7ff, script: 'Latn' }, // Latin Extended-D
  // Common (ASCII punctuation, digits 0x41–0x7A handled above, others below)
  { start: 0x0030, end: 0x0039, script: 'Zyyy' }, // Digits
  { start: 0x0000, end: 0x0020, script: 'Zyyy' }, // C0 controls
  // Cyrillic (check before Latin Extended which might overlap)
  { start: 0x0400, end: 0x04ff, script: 'Cyrs' },
  { start: 0x0500, end: 0x052f, script: 'Cyrs' }, // Cyrillic Supplement
  { start: 0x2de0, end: 0x2dff, script: 'Cyrs' },
  // Greek
  { start: 0x0370, end: 0x03ff, script: 'Latn' }, // Greek & Coptic → treat as needed
  // Hebrew
  { start: 0x0590, end: 0x05ff, script: 'Hebr' },
  { start: 0xfb1d, end: 0xfb4f, script: 'Hebr' }, // Hebrew Presentation Forms
  // Arabic
  { start: 0x0600, end: 0x06ff, script: 'Arab' },
  { start: 0x0750, end: 0x077f, script: 'Arab' }, // Arabic Supplement
  { start: 0x0870, end: 0x089f, script: 'Arab' }, // Arabic Extended-B
  { start: 0x08a0, end: 0x08ff, script: 'Arab' }, // Arabic Extended-A
  { start: 0xfb50, end: 0xfdff, script: 'Arab' }, // Arabic Presentation Forms-A
  { start: 0xfe70, end: 0xfeff, script: 'Arab' }, // Arabic Presentation Forms-B
  { start: 0x1ec70, end: 0x1ecbf, script: 'Arab' }, // Arabic Extended-C
  { start: 0x1ee00, end: 0x1eeff, script: 'Arab' }, // Arabic Math
  // Syriac
  { start: 0x0700, end: 0x074f, script: 'Syrc' },
  // Thaana
  { start: 0x0780, end: 0x07bf, script: 'Thaa' },
  // NKo
  { start: 0x07c0, end: 0x07ff, script: 'Nkoo' },
  // Devanagari
  { start: 0x0900, end: 0x097f, script: 'Deva' },
  { start: 0xa8e0, end: 0xa8ff, script: 'Deva' }, // Devanagari Extended
  // Bengali
  { start: 0x0980, end: 0x09ff, script: 'Beng' },
  // Gurmukhi
  { start: 0x0a00, end: 0x0a7f, script: 'Guru' },
  // Gujarati
  { start: 0x0a80, end: 0x0aff, script: 'Gujr' },
  // Oriya
  { start: 0x0b00, end: 0x0b7f, script: 'Orya' },
  // Tamil
  { start: 0x0b80, end: 0x0bff, script: 'Taml' },
  // Telugu
  { start: 0x0c00, end: 0x0c7f, script: 'Telu' },
  // Kannada
  { start: 0x0c80, end: 0x0cff, script: 'Knda' },
  // Malayalam
  { start: 0x0d00, end: 0x0d7f, script: 'Mlym' },
  // Sinhala
  { start: 0x0d80, end: 0x0dff, script: 'Sinh' },
  // Thai
  { start: 0x0e00, end: 0x0e7f, script: 'Thai' },
  // Lao
  { start: 0x0e80, end: 0x0eff, script: 'Laoo' },
  // Tibetan
  { start: 0x0f00, end: 0x0fff, script: 'Tibt' },
  // Myanmar
  { start: 0x1000, end: 0x109f, script: 'Mymr' },
  // Georgian
  { start: 0x10a0, end: 0x10ff, script: 'Geor' },
  // Hangul Jamo
  { start: 0x1100, end: 0x11ff, script: 'Hang' },
  // Ethiopic
  { start: 0x1200, end: 0x137f, script: 'Ethi' },
  { start: 0x1380, end: 0x139f, script: 'Ethi' }, // Ethiopic Supplement
  { start: 0x2d80, end: 0x2ddf, script: 'Ethi' }, // Ethiopic Extended
  { start: 0xab00, end: 0xab2f, script: 'Ethi' }, // Ethiopic Extended-A
  // Cherokee
  { start: 0x13a0, end: 0x13ff, script: 'Cher' },
  // Canadian Aboriginal
  { start: 0x1400, end: 0x167f, script: 'Cans' },
  // Ogham
  { start: 0x1680, end: 0x169f, script: 'Ogam' },
  // Runic
  { start: 0x16a0, end: 0x16ff, script: 'Runr' },
  // Khmer
  { start: 0x1780, end: 0x17ff, script: 'Khmr' },
  { start: 0x19e0, end: 0x19ff, script: 'Khmr' }, // Khmer Symbols
  // Mongolian
  { start: 0x1800, end: 0x18af, script: 'Mong' },
  // Hiragana
  { start: 0x3040, end: 0x309f, script: 'Hira' },
  // Katakana
  { start: 0x30a0, end: 0x30ff, script: 'Kana' },
  // Bopomofo
  { start: 0x3100, end: 0x312f, script: 'Bopo' },
  { start: 0x31a0, end: 0x31bf, script: 'Bopo' }, // Bopomofo Extended
  // CJK Unified Ideographs
  { start: 0x4e00, end: 0x9fff, script: 'Hani' },
  { start: 0x3400, end: 0x4dbf, script: 'Hani' }, // CJK Ext-A
  { start: 0x20000, end: 0x2a6df, script: 'Hani' }, // CJK Ext-B
  { start: 0x2a700, end: 0x2b73f, script: 'Hani' }, // CJK Ext-C
  { start: 0x2b740, end: 0x2b81f, script: 'Hani' }, // CJK Ext-D
  { start: 0x2b820, end: 0x2ceaf, script: 'Hani' }, // CJK Ext-E
  { start: 0xf900, end: 0xfaff, script: 'Hani' }, // CJK Compatibility Ideographs
  // CJK Compatibility / Halfwidth
  { start: 0xff00, end: 0xffef, script: 'Hani' },
  // Yi
  { start: 0xa000, end: 0xa48f, script: 'Yiii' },
  { start: 0xa490, end: 0xa4cf, script: 'Yiii' }, // Yi Radicals
  // Vai
  { start: 0xa500, end: 0xa63f, script: 'Vaii' },
  // Tifinagh
  { start: 0x2d30, end: 0x2d7f, script: 'Tfng' },
];

// Sorted copy of the script ranges (initialized once).
let SCRIPT_RANGES_SORTED: ScriptRange[] | null = null;

function getSortedRanges(): ScriptRange[] {
  if (!SCRIPT_RANGES_SORTED) {
    SCRIPT_RANGES_SORTED = [..._SCRIPT_RANGES].sort((a, b) => a.start - b.start);
  }
  return SCRIPT_RANGES_SORTED;
}

// Binary search over sorted ranges
export function detectScript(code: number): ScriptCode {
  // Fast path for common cases
  if (
    (code >= 0x0041 && code <= 0x007a) ||
    (code >= 0x00c0 && code <= 0x024f) ||
    (code >= 0x1e00 && code <= 0x1eff) ||
    (code >= 0x2c60 && code <= 0x2c7f)
  )
    return 'Latn';

  if (code >= 0x4e00 && code <= 0x9fff) return 'Hani';

  const ranges = getSortedRanges();
  // Binary search over sorted ranges
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid]!;
    if (code < r.start) hi = mid - 1;
    else if (code > r.end) lo = mid + 1;
    else return r.script;
  }

  // Common fallback for unassigned in BMP common/symbol area
  if (
    code <= 0x002f ||
    (code >= 0x003a && code <= 0x0040) ||
    (code >= 0x005b && code <= 0x0060) ||
    (code >= 0x007b && code <= 0x00bf)
  ) {
    return 'Zyyy';
  }

  return 'Zzzz';
}

/**
 * Detect the dominant script in a text span. Returns Common ('Zyyy') if
 * no strong script is found.
 */
export function dominantScript(text: string): ScriptCode {
  const counts: Partial<Record<ScriptCode, number>> = {};
  let maxCount = 0;
  let maxScript: ScriptCode = 'Zyyy';

  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i)!;
    if (code === 0x0020) continue; // skip ASCII space
    const script = detectScript(code);
    if (script === 'Zyyy') continue; // skip common
    const c = (counts[script] ?? 0) + 1;
    counts[script] = c;
    if (c > maxCount) {
      maxCount = c;
      maxScript = script;
    }
    if (code > 0xffff) i++;
  }
  return maxScript;
}

/**
 * Split text into contiguous runs of the same script.
 * Used by the font resolver for per-run font fallback.
 */
export interface ScriptRun {
  start: number;
  end: number;
  script: ScriptCode;
}

export function segmentByScript(text: string): ScriptRun[] {
  if (text.length === 0) return [];
  const runs: ScriptRun[] = [];
  let runStart = 0;
  let runScript = detectScript(text.codePointAt(0)!);

  for (let i = 1; i < text.length; i++) {
    const code = text.codePointAt(i)!;
    const script = detectScript(code);
    if (script !== runScript && script !== 'Zyyy' && runScript !== 'Zyyy') {
      if (script !== runScript) {
        runs.push({ start: runStart, end: i, script: runScript });
        runStart = i;
        runScript = script;
      }
    }
    if (code > 0xffff) i++;
  }
  runs.push({ start: runStart, end: text.length, script: runScript });
  return runs;
}
