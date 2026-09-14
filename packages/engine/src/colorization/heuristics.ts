/**
 * Small, explainable colour heuristics used by the deterministic colorize
 * operations.
 *
 * These are deliberately conservative and incomplete. They exist to soften an
 * operation's effect on tones a user is most likely to care about; they are
 * not segmentation, person recognition, or a claim that a specific tone is
 * "correct" skin. A user-authored mask always remains the authoritative scope.
 */

/**
 * Whether a CIELAB pixel falls inside a broad skin-like band.
 *
 * The band is a hue interval with a chroma gate rather than a universal RGB
 * threshold: hue 20-70 degrees is where skin tones from light to deep sit in
 * Lab when they carry chroma, and the chroma bounds exclude neutrals and
 * highly saturated non-skin hues (for example pure red objects). Warm wood and
 * leather can fall inside the band; callers must keep this a softening factor
 * and never an exclusion.
 */
export function isSkinLikeLab(a: number, b: number): boolean {
  const chroma = Math.hypot(a, b);
  if (chroma < 8 || chroma > 60) return false;
  const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return hue >= 20 && hue <= 70;
}

/**
 * Whether a CIELAB pixel is near-neutral authored chroma (not pure grayscale).
 * Pure grayscale is intentionally excluded: introducing chroma into a neutral
 * image is the primary tint use case.
 */
export function isNearNeutralLab(a: number, b: number): boolean {
  const chroma = Math.hypot(a, b);
  return chroma > 0.01 && chroma < 8;
}
