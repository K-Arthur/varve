/**
 * Bidirectional text layout — paragraph/run-level Unicode Bidirectional Algorithm.
 *
 * Research basis:
 * - Unicode Standard Annex #9: Unicode Bidirectional Algorithm (UAX #9)
 * - UTR #23: Unicode Character Property Model
 * - FriBidi / ICU4X BiDi reference implementations
 *
 * The public paragraph contract is now resolved by the conformance-tested
 * bidi-js adapter in bidiUax9.ts. The legacy classification helpers remain
 * exported for script itemization and compatibility; they are not the source
 * of truth for paragraph embedding levels.
 */

import type { BidiDirection, BidiParagraph, BidiRun } from './bidiTypes';
import { analyzeParagraphUax9 } from './bidiUax9';

export type { BidiDirection, BidiParagraph, BidiRun } from './bidiTypes';

export type BidiClass =
  | 'L'
  | 'R'
  | 'AL'
  | 'EN'
  | 'AN'
  | 'ES'
  | 'ET'
  | 'CS'
  | 'NSM'
  | 'BN'
  | 'B'
  | 'S'
  | 'WS'
  | 'ON';

/** Map a codepoint (not UTF-16 code unit) to its bidi class. */
export function bidiClassOf(code: number): BidiClass {
  // Boundary / separator
  if (code === 0x0009) return 'S';
  if (code === 0x000a || code === 0x000d || code === 0x001f || code === 0x0085) return 'B';
  if (code === 0x000b || code === 0x000c) return 'B';
  if (code === 0x001e || code === 0x001d) return 'S';
  // Whitespace
  if (
    code === 0x0020 ||
    code === 0x00a0 ||
    code === 0x1680 ||
    code === 0x2000 ||
    code === 0x2001 ||
    code === 0x2002 ||
    code === 0x2003 ||
    code === 0x2004 ||
    code === 0x2005 ||
    code === 0x2006 ||
    code === 0x2008 ||
    code === 0x2009 ||
    code === 0x200a ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  )
    return 'WS';
  if (inRanges(code, WS_RANGES)) return 'WS';
  // European number
  if (code >= 0x0030 && code <= 0x0039) return 'EN';
  // European separators / terminators
  if (code === 0x002b || code === 0x002d || code === 0x002f) return 'ES';
  if (code === 0x0025 || code === 0x00a2 || code === 0x00b0 || code === 0x00d7 || code === 0x00f7)
    return 'ET';
  if (code === 0x2030 || code === 0x2031 || code === 0x00a3 || code === 0x00a5) return 'ET';
  // Common separators
  if (code === 0x002c || code === 0x002e || code === 0x003a) return 'CS';
  // Arabic number
  if (inRanges(code, AN_RANGES)) return 'AN';
  // RTL scripts (Hebrew, Arabic, Syriac, etc.)
  if (inRanges(code, R_RANGES)) return 'R';
  // Arabic Letter
  if (inRanges(code, AL_RANGES)) return 'AL';
  // Combining mark (NSM)
  if (inRanges(code, COMBINING_RANGES)) return 'NSM';
  // Boundry neutral
  if (code === 0x0000 || code === 0x0001 || code === 0x00ad || code === 0xfeff) return 'BN';
  if (code >= 0x200b && code <= 0x200d) return 'BN';
  // If it's a known RTL char class that wasn't caught above
  if (inRanges(code, RTL_RANGES)) return 'R';
  // L is the default for Latin, Greek, Cyrillic, Devanagari, and most scripts
  if (
    (code >= 0x0041 && code <= 0x005a) || // Latin UC
    (code >= 0x0061 && code <= 0x007a) || // Latin LC
    (code >= 0x00c0 && code <= 0x024f) || // Latin Extended
    (code >= 0x0370 && code <= 0x03ff) || // Greek
    (code >= 0x0400 && code <= 0x04ff) || // Cyrillic
    (code >= 0x0900 && code <= 0x097f) || // Devanagari
    (code >= 0x0980 && code <= 0x09ff) || // Bengali
    (code >= 0x0a00 && code <= 0x0a7f) || // Gurmukhi
    (code >= 0x0a80 && code <= 0x0aff) || // Gujarati
    (code >= 0x0b00 && code <= 0x0b7f) || // Oriya
    (code >= 0x0b80 && code <= 0x0bff) || // Tamil
    (code >= 0x0c00 && code <= 0x0c7f) || // Telugu
    (code >= 0x0c80 && code <= 0x0cff) || // Kannada
    (code >= 0x0d00 && code <= 0x0d7f) || // Malayalam
    (code >= 0x0e00 && code <= 0x0e7f) || // Thai
    (code >= 0x0e80 && code <= 0x0eff) || // Lao
    (code >= 0x1000 && code <= 0x109f) || // Myanmar
    (code >= 0x10a0 && code <= 0x10ff) || // Georgian
    (code >= 0x1100 && code <= 0x11ff) || // Hangul Jamo
    (code >= 0x2070 && code <= 0x209f) || // Superscripts
    (code >= 0x20a0 && code <= 0x20cf) || // Currency
    (code >= 0x2100 && code <= 0x214f) || // Letterlike
    (code >= 0x2150 && code <= 0x218f) || // Number Forms
    (code >= 0x2190 && code <= 0x21ff) || // Arrows
    (code >= 0x2200 && code <= 0x22ff) || // Math Operators
    (code >= 0x2300 && code <= 0x23ff) || // Misc Technical
    (code >= 0x2400 && code <= 0x243f) || // Control Pictures
    (code >= 0x2440 && code <= 0x245f) || // OCR
    (code >= 0x2460 && code <= 0x24ff) || // Enclosed Alphanumerics
    (code >= 0x2500 && code <= 0x257f) || // Box Drawing
    (code >= 0x2580 && code <= 0x259f) || // Block Elements
    (code >= 0x25a0 && code <= 0x25ff) || // Geometric Shapes
    (code >= 0x2600 && code <= 0x26ff) || // Misc Symbols
    (code >= 0x2700 && code <= 0x27bf) || // Dingbats
    (code >= 0x27c0 && code <= 0x27ef) || // Misc Math Symbols-A
    (code >= 0x2980 && code <= 0x29ff) || // Misc Math Symbols-B
    (code >= 0x2b00 && code <= 0x2bff) || // Misc Symbols and Arrows
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Ext-A
    (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compat Ideographs
    (code >= 0x20000 && code <= 0x2fa1f) || // CJK + ideographs
    (code >= 0x3040 && code <= 0x309f) || // Hiragana
    (code >= 0x30a0 && code <= 0x30ff) || // Katakana
    (code >= 0xff00 && code <= 0xffef) // Halfwidth/Fullwidth
  )
    return 'L';
  // Default for unassigned / unknown → Other Neutral
  return 'ON';
}

function inRanges(code: number, ranges: Array<[number, number]>): boolean {
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    if (code >= range[0] && code <= range[1]) return true;
  }
  return false;
}

// Range tables (ordered roughly by frequency for early match in inRanges)

const AL_RANGES: Array<[number, number]> = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0x0870, 0x089f],
  [0x08a0, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
  [0x1ec70, 0x1ecbf],
  [0x1ee00, 0x1eeff],
];

const R_RANGES: Array<[number, number]> = [
  [0x0590, 0x05ff],
  [0x0700, 0x074f],
  [0x0780, 0x07bf],
  [0x07c0, 0x07ff],
  [0x0800, 0x083f],
  [0x0840, 0x085f],
  [0x0860, 0x086f],
  [0xfb1d, 0xfb4f],
  [0x10800, 0x1083f],
  [0x10840, 0x1085f],
  [0x10880, 0x108af],
  [0x10900, 0x1091f],
  [0x10920, 0x1093f],
  [0x10d00, 0x10d3f],
  [0x10e80, 0x10ebf],
  [0x1e900, 0x1e95f],
];

const RTL_RANGES: Array<[number, number]> = [
  ...R_RANGES,
  ...AL_RANGES,
  [0x0700, 0x074f],
  [0x0780, 0x07bf],
  [0x07c0, 0x07ff],
];

const AN_RANGES: Array<[number, number]> = [
  [0x0660, 0x0669],
  [0x06f0, 0x06f9],
  [0x0966, 0x096f],
  [0x09e6, 0x09ef],
  [0x0f20, 0x0f29],
  [0x1040, 0x1049],
];

const WS_RANGES: Array<[number, number]> = [
  [0xfe00, 0xfe0f],
  [0x0021, 0x0021],
];

const COMBINING_RANGES: Array<[number, number]> = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x05bf, 0x05bf],
  [0x05c1, 0x05c2],
  [0x05c4, 0x05c5],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06dc],
  [0x06df, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x0711, 0x0711],
  [0x0730, 0x074a],
  [0x07a6, 0x07b0],
  [0x07eb, 0x07f3],
  [0x0816, 0x0819],
  [0x081b, 0x0823],
  [0x0825, 0x0827],
  [0x0829, 0x082d],
  [0x0859, 0x085b],
  [0x08d3, 0x08e1],
  [0x08e3, 0x0902],
  [0x093a, 0x093a],
  [0x093c, 0x093c],
  [0x0941, 0x0948],
  [0x094d, 0x094d],
  [0x0951, 0x0957],
  [0x0962, 0x0963],
  [0x0981, 0x0981],
  [0x09bc, 0x09bc],
  [0x09c1, 0x09c4],
  [0x09cd, 0x09cd],
  [0x09e2, 0x09e3],
  [0x0a01, 0x0a02],
  [0x0a3c, 0x0a3c],
  [0x0a41, 0x0a42],
  [0x0a47, 0x0a48],
  [0x0a4b, 0x0a4d],
  [0x0a51, 0x0a51],
  [0x0a70, 0x0a71],
  [0x0a75, 0x0a75],
  [0x0a81, 0x0a82],
  [0x0abc, 0x0abc],
  [0x0ac1, 0x0ac5],
  [0x0ac7, 0x0ac8],
  [0x0acd, 0x0acd],
  [0x0ae2, 0x0ae3],
  [0x0afa, 0x0aff],
  [0x0b01, 0x0b01],
  [0x0b3c, 0x0b3c],
  [0x0b3f, 0x0b3f],
  [0x0b41, 0x0b44],
  [0x0b4d, 0x0b4d],
  [0x0b56, 0x0b56],
  [0x0b62, 0x0b63],
  [0x0b82, 0x0b82],
  [0x0bc0, 0x0bc0],
  [0x0bcd, 0x0bcd],
  [0x0c00, 0x0c00],
  [0x0c3e, 0x0c40],
  [0x0c46, 0x0c48],
  [0x0c4a, 0x0c4d],
  [0x0c55, 0x0c56],
  [0x0c62, 0x0c63],
  [0x0c81, 0x0c81],
  [0x0cbc, 0x0cbc],
  [0x0cbf, 0x0cbf],
  [0x0cc6, 0x0cc6],
  [0x0ccc, 0x0ccd],
  [0x0ce2, 0x0ce3],
  [0x0d01, 0x0d01],
  [0x0d41, 0x0d44],
  [0x0d4d, 0x0d4d],
  [0x0d62, 0x0d63],
  [0x0dca, 0x0dca],
  [0x0dd2, 0x0dd4],
  [0x0dd6, 0x0dd6],
  [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a],
  [0x0e47, 0x0e4e],
  [0x0eb1, 0x0eb1],
  [0x0eb4, 0x0eb9],
  [0x0ebb, 0x0ebc],
  [0x0ec8, 0x0ecd],
  [0x0f18, 0x0f19],
  [0x0f35, 0x0f35],
  [0x0f37, 0x0f37],
  [0x0f39, 0x0f39],
  [0x0f71, 0x0f7e],
  [0x0f80, 0x0f84],
  [0x0f86, 0x0f87],
  [0x0f8d, 0x0f97],
  [0x0f99, 0x0fbc],
  [0x0fc6, 0x0fc6],
  [0x102d, 0x1030],
  [0x1032, 0x1037],
  [0x1039, 0x103a],
  [0x103d, 0x103e],
  [0x1058, 0x1059],
  [0x105e, 0x1060],
  [0x1071, 0x1074],
  [0x1082, 0x1082],
  [0x1085, 0x1086],
  [0x108d, 0x108d],
  [0x109d, 0x109d],
  [0x135d, 0x135f],
  [0x1712, 0x1714],
  [0x1732, 0x1734],
  [0x1752, 0x1753],
  [0x1772, 0x1773],
  [0x17b4, 0x17b5],
  [0x17b7, 0x17bd],
  [0x17c6, 0x17c6],
  [0x17c9, 0x17d3],
  [0x17dd, 0x17dd],
  [0x180b, 0x180d],
  [0x1885, 0x1886],
  [0x18a9, 0x18a9],
  [0x1920, 0x1922],
  [0x1927, 0x1928],
  [0x1932, 0x1932],
  [0x1939, 0x193b],
  [0x1a17, 0x1a18],
  [0x1a1b, 0x1a1b],
  [0x1a56, 0x1a56],
  [0x1a58, 0x1a5e],
  [0x1a60, 0x1a60],
  [0x1a62, 0x1a62],
  [0x1a65, 0x1a6c],
  [0x1a73, 0x1a7c],
  [0x1a7f, 0x1a7f],
  [0x1ab0, 0x1abe],
  [0x1b00, 0x1b03],
  [0x1b34, 0x1b34],
  [0x1b36, 0x1b3a],
  [0x1b3c, 0x1b3c],
  [0x1b42, 0x1b42],
  [0x1b6b, 0x1b73],
  [0x1b80, 0x1b81],
  [0x1ba2, 0x1ba5],
  [0x1ba8, 0x1ba9],
  [0x1bab, 0x1bad],
  [0x1be6, 0x1be6],
  [0x1be8, 0x1be9],
  [0x1bed, 0x1bed],
  [0x1bef, 0x1bf1],
  [0x1c2c, 0x1c33],
  [0x1c36, 0x1c37],
  [0x1cd0, 0x1cd2],
  [0x1cd4, 0x1ce0],
  [0x1ce2, 0x1ce8],
  [0x1ced, 0x1ced],
  [0x1cf4, 0x1cf4],
  [0x1cf8, 0x1cf9],
  [0x1dc0, 0x1df5],
  [0x1dfb, 0x1dff],
  [0x20d0, 0x20f0],
  [0x2cef, 0x2cf1],
  [0x2d7f, 0x2d7f],
  [0x2de0, 0x2dff],
  [0xa66f, 0xa672],
  [0xa674, 0xa67d],
  [0xa69e, 0xa69f],
  [0xa6f0, 0xa6f1],
  [0xa802, 0xa802],
  [0xa806, 0xa806],
  [0xa80b, 0xa80b],
  [0xa825, 0xa826],
  [0xa8c4, 0xa8c4],
  [0xa8e0, 0xa8f1],
  [0xa926, 0xa92d],
  [0xa947, 0xa951],
  [0xa980, 0xa982],
  [0xa9b3, 0xa9b3],
  [0xa9b6, 0xa9b9],
  [0xa9bc, 0xa9bc],
  [0xa9e5, 0xa9e5],
  [0xaa29, 0xaa2e],
  [0xaa31, 0xaa32],
  [0xaa35, 0xaa36],
  [0xaa43, 0xaa43],
  [0xaa4c, 0xaa4c],
  [0xaa7c, 0xaa7c],
  [0xaab0, 0xaab0],
  [0xaab2, 0xaab4],
  [0xaab7, 0xaab8],
  [0xaabe, 0xaabf],
  [0xaac1, 0xaac1],
  [0xaaec, 0xaaed],
  [0xaaf6, 0xaaf6],
  [0xabe5, 0xabe5],
  [0xabe8, 0xabe8],
  [0xabed, 0xabed],
  [0xfb1e, 0xfb1e],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
  [0x101fd, 0x101fd],
  [0x102e0, 0x102e0],
  [0x10376, 0x1037a],
  [0x10a01, 0x10a03],
  [0x10a05, 0x10a06],
  [0x10a0c, 0x10a0f],
  [0x10a38, 0x10a3a],
  [0x10a3f, 0x10a3f],
  [0x10ae5, 0x10ae6],
  [0x11001, 0x11001],
  [0x11038, 0x11046],
  [0x1107f, 0x11081],
  [0x110b3, 0x110b6],
  [0x110b9, 0x110ba],
  [0x11100, 0x11102],
  [0x11127, 0x1112b],
  [0x1112d, 0x11134],
  [0x11173, 0x11173],
  [0x11180, 0x11181],
  [0x111b6, 0x111be],
  [0x111ca, 0x111cc],
  [0x1122f, 0x11231],
  [0x11234, 0x11234],
  [0x11236, 0x11237],
  [0x1123e, 0x1123e],
  [0x112df, 0x112df],
  [0x112e3, 0x112ea],
  [0x11300, 0x11301],
  [0x1133c, 0x1133c],
  [0x11340, 0x11340],
  [0x11366, 0x1136c],
  [0x11370, 0x11374],
  [0x11438, 0x1143f],
  [0x11442, 0x11444],
  [0x11446, 0x11446],
  [0x114b3, 0x114b8],
  [0x114ba, 0x114ba],
  [0x114bf, 0x114c0],
  [0x114c2, 0x114c3],
  [0x115b2, 0x115b5],
  [0x115bc, 0x115bd],
  [0x115bf, 0x115c0],
  [0x115dc, 0x115dd],
  [0x11633, 0x1163a],
  [0x1163d, 0x1163d],
  [0x1163f, 0x11640],
  [0x116ab, 0x116ab],
  [0x116ad, 0x116ad],
  [0x116b0, 0x116b5],
  [0x116b7, 0x116b7],
  [0x1171d, 0x1171f],
  [0x11722, 0x11725],
  [0x11727, 0x1172b],
  [0x1182f, 0x11837],
  [0x11839, 0x1183a],
  [0x11a33, 0x11a38],
  [0x11a3b, 0x11a3e],
  [0x11a47, 0x11a47],
  [0x11a51, 0x11a56],
  [0x11a59, 0x11a5b],
  [0x11a8a, 0x11a96],
  [0x11a98, 0x11a99],
  [0x11c30, 0x11c36],
  [0x11c38, 0x11c3d],
  [0x11c3f, 0x11c3f],
  [0x11c92, 0x11ca7],
  [0x11caa, 0x11cb0],
  [0x11cb2, 0x11cb3],
  [0x11cb5, 0x11cb6],
  [0x11d31, 0x11d36],
  [0x11d3a, 0x11d3a],
  [0x11d3c, 0x11d3d],
  [0x11d3f, 0x11d45],
  [0x11d47, 0x11d47],
  [0x11d90, 0x11d91],
  [0x11d95, 0x11d95],
  [0x11d97, 0x11d97],
  [0x11ef3, 0x11ef4],
  [0x16af0, 0x16af4],
  [0x16b30, 0x16b36],
  [0x16f8f, 0x16f92],
  [0x1bc9d, 0x1bc9e],
  [0x1d167, 0x1d169],
  [0x1d17b, 0x1d182],
  [0x1d185, 0x1d18b],
  [0x1d1aa, 0x1d1ad],
  [0x1d242, 0x1d244],
  [0x1da00, 0x1da36],
  [0x1da3b, 0x1da6c],
  [0x1da75, 0x1da75],
  [0x1da84, 0x1da84],
  [0x1da9b, 0x1da9f],
  [0x1daa1, 0x1daaf],
  [0x1e000, 0x1e006],
  [0x1e008, 0x1e018],
  [0x1e01b, 0x1e021],
  [0x1e023, 0x1e024],
  [0x1e026, 0x1e02a],
  [0x1e8d0, 0x1e8d6],
  [0x1e944, 0x1e94a],
];

// ── Paragraph direction detection ──

/**
 * Auto-detect paragraph base direction from the first strong directional
 * character (UAX #9 P2/P3). Falls back to LTR if no strong char is found.
 */
export function autoParagraphDirection(text: string): BidiDirection {
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i)!;
    const cls = bidiClassOf(code);
    if (cls === 'L') return 'ltr';
    if (cls === 'R' || cls === 'AL') return 'rtl';
    if (code > 0xffff) i++; // skip low surrogate
  }
  return 'ltr';
}

// ── Run segmentation ──

/**
 * Segment a paragraph into runs of uniform direction, resolving weak and
 * neutral types per UAX #9 W1–W7, N1–N2.
 */
export function segmentRuns(text: string, baseLevel: number): BidiRun[] {
  if (text.length === 0) return [];

  const classes: BidiClass[] = [];
  const cpOffsets: number[] = []; // UTF-16 offset per codepoint
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i)!;
    cpOffsets.push(i);
    classes.push(bidiClassOf(code));
    if (code > 0xffff) i++;
  }
  cpOffsets.push(text.length);

  // Resolve weak types (W1–W7)
  resolveWeakTypes(classes);
  // Resolve neutrals (N1–N2)
  resolveNeutrals(classes, baseLevel);

  // Build runs from resolved classes
  const runs: BidiRun[] = [];
  let runStartCodepoint = 0;
  let runDir = classToDirection(classes[0]!, baseLevel);

  for (let i = 1; i < classes.length; i++) {
    const dir = classToDirection(classes[i]!, baseLevel);
    if (dir !== runDir) {
      runs.push({
        start: cpOffsets[runStartCodepoint]!,
        end: cpOffsets[i]!,
        direction: runDir,
        level: runDir === 'rtl' ? 1 : 0,
      });
      runStartCodepoint = i;
      runDir = dir;
    }
  }
  runs.push({
    start: cpOffsets[runStartCodepoint] ?? 0,
    end: cpOffsets[classes.length] ?? text.length,
    direction: runDir,
    level: runDir === 'rtl' ? 1 : 0,
  });

  // Assign proper embedding levels
  assignLevels(runs, baseLevel);
  return runs;
}

function classToDirection(cls: BidiClass, baseLevel: number): BidiDirection {
  switch (cls) {
    case 'L':
      return 'ltr';
    case 'R':
      return 'rtl';
    case 'AL':
      return 'rtl';
    case 'EN':
    case 'AN':
      // Numbers follow context; default to base direction
      return baseLevel % 2 === 1 ? 'rtl' : 'ltr';
    default:
      return baseLevel % 2 === 1 ? 'rtl' : 'ltr';
  }
}

function resolveWeakTypes(classes: BidiClass[]): void {
  // W1: NSM → preceding char's class (or ON if at start after R/AL)
  for (let i = 0; i < classes.length; i++) {
    if (classes[i] === 'NSM') {
      if (i === 0) {
        classes[i] = 'ON';
      } else {
        const prev = classes[i - 1];
        classes[i] = prev === 'R' || prev === 'AL' || prev === 'L' ? prev : 'ON';
      }
    }
  }
  // W2: EN → AN if preceded by AL
  for (let i = 1; i < classes.length; i++) {
    if (classes[i] === 'EN' && classes[i - 1] === 'AL') {
      classes[i] = 'AN';
    }
  }
  // W3: AL → R
  for (let i = 0; i < classes.length; i++) {
    if (classes[i] === 'AL') classes[i] = 'R';
  }
  // W4: CS between two EN → EN; CS between two AN → AN
  for (let i = 1; i < classes.length - 1; i++) {
    if (classes[i] === 'CS') {
      const prev = classes[i - 1];
      const next = classes[i + 1];
      if (prev === 'EN' && next === 'EN') classes[i] = 'EN';
      else if (prev === 'AN' && next === 'AN') classes[i] = 'AN';
    }
  }
  // W5: ET adjacent to EN → EN
  for (let i = 0; i < classes.length; i++) {
    if (classes[i] === 'ET') {
      const prev = i > 0 ? classes[i - 1] : undefined;
      const next = i < classes.length - 1 ? classes[i + 1] : undefined;
      if (prev === 'EN' || next === 'EN') classes[i] = 'EN';
    }
  }
  // W6: ES/CS/ET between two same-direction weak chars → that direction
  for (let i = 1; i < classes.length - 1; i++) {
    const cls = classes[i];
    if (cls === 'ES' || cls === 'CS' || cls === 'ET') {
      const a = classes[i - 1];
      const b = classes[i + 1];
      if (a === b && (a === 'EN' || a === 'AN')) classes[i] = a;
    }
  }
  // W7: EN preceded by L → L
  for (let i = 1; i < classes.length; i++) {
    if (classes[i] === 'EN' && classes[i - 1] === 'L') classes[i] = 'L';
  }
}

function resolveNeutrals(classes: BidiClass[], baseLevel: number): void {
  // N1: neutrals between same strong direction → that direction
  for (let i = 1; i < classes.length - 1; i++) {
    const cls = classes[i];
    if (cls === 'B' || cls === 'S' || cls === 'WS' || cls === 'ON') {
      // Find bounding strong type before
      let bi = i - 1;
      while (bi > 0 && isNeutralClass(classes[bi]!)) bi--;
      const before = classes[bi]!;
      // Find bounding strong type after
      let ai = i + 1;
      while (ai < classes.length - 1 && isNeutralClass(classes[ai]!)) ai++;
      const after = classes[ai]!;
      if (before === 'L' && after === 'L') {
        classes[i] = 'L';
      } else if (before === 'R' && after === 'R') {
        classes[i] = 'R';
      }
    }
  }
  // N2: remaining neutrals → base direction
  for (let i = 0; i < classes.length; i++) {
    const cls = classes[i]!;
    if (cls === 'B' || cls === 'S' || cls === 'WS' || cls === 'ON') {
      classes[i] = baseLevel % 2 === 1 ? 'R' : 'L';
    }
  }
}

function isNeutralClass(cls: BidiClass): boolean {
  return cls === 'B' || cls === 'S' || cls === 'WS' || cls === 'ON';
}

function assignLevels(runs: BidiRun[], baseLevel: number): void {
  for (const run of runs) {
    run.level =
      run.direction === 'rtl'
        ? baseLevel % 2 === 1
          ? baseLevel
          : baseLevel + 1
        : baseLevel % 2 === 0
          ? baseLevel
          : baseLevel + 1;
  }
}

// ── Reordering ──

/**
 * Reorder runs for visual display (UAX #9 L2): from highest level to lowest
 * odd level, reverse contiguous runs at that level or higher.
 */
export function reorderRuns(runs: BidiRun[]): BidiRun[] {
  if (runs.length <= 1) return [...runs];

  // Find max level
  let maxLevel = 0;
  for (const r of runs) if (r.level > maxLevel) maxLevel = r.level;

  const result = [...runs];
  // Process from highest level down to 1 (odd levels only for reversal)
  for (let level = maxLevel; level >= 1; level -= 2) {
    let i = 0;
    while (i < result.length) {
      // Find contiguous block of runs at >= level
      if (result[i]!.level >= level) {
        let j = i;
        while (j < result.length && result[j]!.level >= level) j++;
        // Reverse [i, j)
        const block = result.splice(i, j - i);
        result.splice(i, 0, ...block.reverse());
        i = i + block.length;
      } else {
        i++;
      }
    }
  }
  return result;
}

// ── High-level API ──

/**
 * Analyze a paragraph: detect direction, segment runs, reorder for display.
 */
export function analyzeParagraph(text: string, explicitDirection?: BidiDirection): BidiParagraph {
  return analyzeParagraphUax9(text, explicitDirection);
}

/**
 * Map a logical (text) UTF-16 index to a visual position index.
 * In LTR paragraphs, visual position 0 = leftmost character.
 * In RTL paragraphs, visual position 0 = rightmost character.
 */
export function logicalToVisual(
  para: BidiParagraph,
  logicalUtf16Index: number,
): { visualIndex: number; runIndex: number } {
  if (para.visualOrder) {
    const visualIndex = para.visualOrder.indexOf(logicalUtf16Index);
    if (visualIndex >= 0) {
      const run = para.visualRuns.findIndex(
        (candidate) => logicalUtf16Index >= candidate.start && logicalUtf16Index < candidate.end,
      );
      return { visualIndex, runIndex: Math.max(0, run) };
    }
  }
  const isRTL = para.baseLevel % 2 === 1;

  if (!isRTL) {
    return logicalToVisualLTR(para, logicalUtf16Index);
  }
  return logicalToVisualRTL(para, logicalUtf16Index);
}

function logicalToVisualLTR(
  para: BidiParagraph,
  logicalUtf16Index: number,
): { visualIndex: number; runIndex: number } {
  // Find which run contains the logical index
  let runIdx = 0;
  for (let i = 0; i < para.runs.length; i++) {
    const r = para.runs[i]!;
    if (logicalUtf16Index >= r.start && logicalUtf16Index < r.end) {
      runIdx = i;
      break;
    }
    if (i === para.runs.length - 1) runIdx = i;
  }
  const run = para.runs[runIdx]!;
  const offsetInRun = logicalUtf16Index - run.start;
  const runLength = run.end - run.start;

  let visualRunOrder = 0;
  for (let i = 0; i < para.visualRuns.length; i++) {
    if (para.visualRuns[i] === run) {
      visualRunOrder = i;
      break;
    }
  }

  let visualIndex = 0;
  for (let i = 0; i < visualRunOrder; i++) {
    const vr = para.visualRuns[i]!;
    visualIndex += vr.end - vr.start;
  }
  if (run.direction === 'rtl') {
    visualIndex += runLength - offsetInRun - 1;
  } else {
    visualIndex += offsetInRun;
  }
  return { visualIndex, runIndex: visualRunOrder };
}

function logicalToVisualRTL(
  para: BidiParagraph,
  logicalUtf16Index: number,
): { visualIndex: number; runIndex: number } {
  // RTL: visual position 0 = rightmost = where caret starts.
  // All logically-later runs are painted first (further right).
  // Within an RTL run, the first logical char paints first (rightmost).
  // Within an LTR run embedded in RTL, the last logical char paints first.
  let runIdx = 0;
  for (let i = 0; i < para.runs.length; i++) {
    const r = para.runs[i]!;
    if (logicalUtf16Index >= r.start && logicalUtf16Index < r.end) {
      runIdx = i;
      break;
    }
    if (i === para.runs.length - 1) runIdx = i;
  }
  const run = para.runs[runIdx]!;
  const offsetInRun = logicalUtf16Index - run.start;
  const runLength = run.end - run.start;

  let visualIndex = 0;
  // Runs after this one in logical order are painted before it (further right = lower visual index).
  for (let i = runIdx + 1; i < para.runs.length; i++) {
    visualIndex += para.runs[i]!.end - para.runs[i]!.start;
  }
  // Within the run:
  if (run.direction === 'rtl') {
    // RTL run: first logical char (offset 0) paints first = rightmost = visual 0 within run.
    visualIndex += offsetInRun;
  } else {
    // LTR run embedded in RTL: last logical char paints first.
    visualIndex += runLength - offsetInRun - 1;
  }
  return { visualIndex, runIndex: runIdx };
}

/**
 * Map a visual position index back to a logical (text) UTF-16 index.
 */
export function visualToLogical(
  para: BidiParagraph,
  visualIndex: number,
): { logicalIndex: number; runIndex: number } {
  if (para.visualOrder && para.visualOrder.length > 0) {
    const clamped = Math.min(Math.max(0, Math.trunc(visualIndex)), para.visualOrder.length - 1);
    const logicalIndex = para.visualOrder[clamped] ?? 0;
    const runIndex = para.visualRuns.findIndex(
      (candidate) => logicalIndex >= candidate.start && logicalIndex < candidate.end,
    );
    return { logicalIndex, runIndex: Math.max(0, runIndex) };
  }
  const isRTL = para.baseLevel % 2 === 1;
  if (!isRTL) {
    return visualToLogicalLTR(para, visualIndex);
  }
  return visualToLogicalRTL(para, visualIndex);
}

function visualToLogicalLTR(
  para: BidiParagraph,
  visualIndex: number,
): { logicalIndex: number; runIndex: number } {
  let remaining = visualIndex;
  for (let vi = 0; vi < para.visualRuns.length; vi++) {
    const run = para.visualRuns[vi]!;
    const runLen = run.end - run.start;
    if (remaining < runLen) {
      const offsetInRun = run.direction === 'rtl' ? runLen - remaining - 1 : remaining;
      return { logicalIndex: run.start + offsetInRun, runIndex: vi };
    }
    remaining -= runLen;
  }
  const lastRun = para.visualRuns[para.visualRuns.length - 1]!;
  return { logicalIndex: lastRun.end, runIndex: para.visualRuns.length - 1 };
}

function visualToLogicalRTL(
  para: BidiParagraph,
  visualIndex: number,
): { logicalIndex: number; runIndex: number } {
  // RTL: visual 0 = rightmost = where caret starts.
  // Processing order: last logical run first (rightmost), then earlier.
  // Within RTL run: visual offset 0 → logical offset 0 (first logical char is rightmost).
  // Within LTR run embedded in RTL: visual offset 0 → logical offset (runLen-1).
  let remaining = visualIndex;
  for (let i = para.runs.length - 1; i >= 0; i--) {
    const run = para.runs[i]!;
    const runLen = run.end - run.start;
    if (remaining < runLen) {
      const offsetInRun = run.direction === 'rtl' ? remaining : runLen - 1 - remaining;
      return { logicalIndex: run.start + offsetInRun, runIndex: i };
    }
    remaining -= runLen;
  }
  const firstRun = para.runs[0]!;
  return { logicalIndex: firstRun.start, runIndex: 0 };
}
