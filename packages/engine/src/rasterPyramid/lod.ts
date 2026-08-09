/**
 * Raster pyramid — LOD selection.
 *
 * The level is chosen from the *effective device-space scale* — how many
 * device pixels one source pixel occupies after camera zoom x DPR x node
 * affine — not from raw editor zoom (ADR-0214 D6). Under rotation/skew and
 * non-uniform scale the image-plane scale varies; the conservative bound is
 * the maximum |scale| along the axes, which never undersamples.
 *
 * Hysteresis (ADR-0214 D6, brief §7): a level persists while the continuous
 * log2 scale stays within a dead zone of one level around it; switching
 * requires crossing the level boundary by the hysteresis amount, so
 * oscillating around a boundary (pinch hover, trackpad jitter) does not
 * thrash the level.
 */

/**
 * Hysteresis width in log2 levels on each side of a level boundary. Level L
 * sits at f = -log2(scale) in [L - 0.5, L + 0.5); the level persists while f
 * stays within [L - 1, L + 1] of it — i.e. switching requires crossing the
 * boundary (at L ± 0.5) by the full hysteresis amount, leaving a dead zone of
 * 2 * LOD_HYSTERESIS around every boundary where oscillation cannot thrash.
 */
export const LOD_HYSTERESIS = 0.5;

/**
 * Effective device-space scale: device pixels per source pixel.
 * `max(|sx|, |sy|)` covers rotation, skew, and negative (flipped) scales
 * conservatively: the axis needing the most source texels wins.
 */
export function effectiveDeviceScale(
  zoom: number,
  dpr: number,
  nodeScaleX: number,
  nodeScaleY: number,
): number {
  const s = zoom * dpr * Math.max(Math.abs(nodeScaleX), Math.abs(nodeScaleY));
  return s > 0 ? s : 0;
}

/**
 * Ideal level without hysteresis: level L such that one texel is one device
 * pixel, i.e. L = round(-log2(scale)), clamped to [0, maxLevel].
 */
export function idealLod(scale: number, maxLevel: number): number {
  if (scale <= 0) return 0;
  return Math.max(0, Math.min(maxLevel, Math.round(-Math.log2(scale))));
}

/**
 * Level with hysteresis. `currentLevel` null means no prior state: return the
 * ideal. Otherwise step one level at a time in the direction of travel: up
 * (finer) when f >= current + 1, down (coarser) when f <= current - 1. A
 * fast pinch zoom steps one level per selection, which tracks 60 fps input
 * comfortably and never overshoots the ideal.
 */
export function selectLod(scale: number, currentLevel: number | null, maxLevel: number): number {
  const ideal = idealLod(scale, maxLevel);
  if (currentLevel === null || ideal === currentLevel) return ideal;
  const f = -Math.log2(scale);
  const up = f >= currentLevel + 0.5 + LOD_HYSTERESIS;
  const down = f <= currentLevel - 0.5 - LOD_HYSTERESIS;
  if (up) return Math.min(maxLevel, currentLevel + 1);
  if (down) return Math.max(0, currentLevel - 1);
  return currentLevel;
}

/** Clamp an externally chosen level to the available range. */
export function clampLod(level: number, maxLevel: number): number {
  return Math.max(0, Math.min(maxLevel, level));
}
