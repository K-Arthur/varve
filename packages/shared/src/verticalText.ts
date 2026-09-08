/**
 * Shared vertical-writing semantics.
 *
 * This module deliberately works on grapheme-cluster strings rather than
 * individual UTF-16 code units. The renderer and editor can therefore use the
 * same orientation decision without splitting combining sequences, emoji ZWJ
 * sequences, or other user-perceived characters.
 */

export type WritingMode = 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';
export type TextOrientation = 'mixed' | 'upright' | 'sideways';
export type VerticalGlyphOrientation = 'upright' | 'sideways';

export function isVerticalWritingMode(mode: WritingMode | undefined): boolean {
  return mode === 'vertical-rl' || mode === 'vertical-lr';
}

/** HarfBuzz/rustybuzz direction for the inline axis of a vertical paragraph. */
export function verticalShapingDirection(
  mode: WritingMode | undefined,
): 'ltr' | 'rtl' | 'ttb' | 'btt' {
  return isVerticalWritingMode(mode) ? 'ttb' : 'ltr';
}

/**
 * Resolve the CSS/UAX #50-style orientation for one extended grapheme
 * cluster. Unicode property escapes cover scripts and pictographs beyond a
 * small hand-maintained CJK/ASCII whitelist. Punctuation and symbols are
 * upright in the mixed fallback because their vertical forms are authored as
 * orientation-aware glyphs by the font; Latin, Greek, Cyrillic, and digits
 * remain sideways.
 */
export function verticalOrientationForCluster(
  cluster: string,
  orientation: TextOrientation = 'mixed',
): VerticalGlyphOrientation {
  if (orientation === 'upright') return 'upright';
  if (orientation === 'sideways') return 'sideways';
  if (cluster.length === 0) return 'upright';

  const base = cluster.replace(/^\p{M}+/u, '');
  if (base.length === 0) return 'upright';
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(base)) {
    return 'upright';
  }
  if (/^[\p{Extended_Pictographic}\p{P}\p{S}]$/u.test(base)) return 'upright';
  return 'sideways';
}
