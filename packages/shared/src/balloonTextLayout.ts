/**
 * Balloon-aware line-width profiles.
 *
 * A rectangle is the wrong interior model for a round balloon: a line that
 * fills the box collides with the curved wall, the first and last lines of a
 * stack sit in the widest part of the shape, and the text mass reads as a
 * block instead of following the balloon. Professional lettering narrows the
 * top and bottom lines so the type echoes the outline, keeping the longest
 * line near the vertical middle. (Nate Piekos documents the same intent as the
 * "94% line width" stacking guide; Blambot's grammar notes require the text to
 * sit off the border with even optical margins.)
 *
 * This module is pure and shared. The scene bounds resolver
 * (`@varve/scene` → `textBounds` → `@varve/shared` `resolveTextGeometry`) and
 * the engine painter (`@varve/engine` → `textLayoutSnapshot`) both derive
 * per-line widths from the same inputs through this function, so a contour
 * balloon breaks lines identically in selection, hit testing, editing, and
 * paint. The wrap shape is authored state; the profile is derived and never
 * serialized.
 */

export type TextWrapShape = 'rect' | 'ellipse';

export const TEXT_WRAP_SHAPES: readonly TextWrapShape[] = ['rect', 'ellipse'];

export interface BalloonLineWidthProfileOptions {
  /** Interior width available to text, in local px. */
  width: number;
  /** Interior height available to text, in local px. */
  height: number;
  /** Line box height in px (fontSize * lineHeight). */
  lineHeight: number;
  /**
   * Optical floor for a shaped line as a fraction of `width`. Lines whose
   * elliptical chord falls below this are still given this much room, so a
   * single long word is never squeezed into a one-character column.
   */
  minWidthRatio?: number;
  /** Hard cap on produced entries; keeps a pathological container bounded. */
  maxLines?: number;
}

const DEFAULT_MIN_WIDTH_RATIO = 0.34;
const DEFAULT_MAX_LINES = 512;

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Per-line maximum widths for a text stack inscribed in an ellipse.
 *
 * Entry `i` is the usable width of line `i` counted from the top, with the
 * widest entries near the vertical middle. Results are finite, positive, never
 * wider than `width`, and monotone across the top half / bottom half by
 * construction. Degenerate inputs (zero width, zero height, zero line height)
 * fall back to a single full-width entry rather than producing NaN.
 */
export function ellipseLineWidthProfile(options: BalloonLineWidthProfileOptions): number[] {
  const width = finitePositive(options.width, 1);
  const height = finitePositive(options.height, 0);
  const lineHeight = finitePositive(options.lineHeight, 1);
  const minRatio = Number.isFinite(options.minWidthRatio)
    ? Math.max(0, Math.min(1, options.minWidthRatio as number))
    : DEFAULT_MIN_WIDTH_RATIO;
  const maxLines = Math.max(
    1,
    Math.min(
      DEFAULT_MAX_LINES,
      Number.isFinite(options.maxLines)
        ? Math.floor(options.maxLines as number)
        : DEFAULT_MAX_LINES,
    ),
  );

  const countable = Math.max(1, Math.floor(height / lineHeight));
  const lineCount = Math.max(1, Math.min(maxLines, countable));
  if (lineCount === 1) return [width];

  const minWidth = width * minRatio;
  const halfHeight = height / 2;
  const widths: number[] = [];
  for (let index = 0; index < lineCount; index++) {
    // Center of the line box in local space. The +0.5 keeps the profile
    // symmetric about the balloon's midline instead of drifting upward.
    const centerY = (index + 0.5) * lineHeight;
    const normalized = halfHeight > 0 ? (centerY - halfHeight) / halfHeight : 0;
    const clamped = Math.max(-1, Math.min(1, normalized));
    const chord = width * Math.sqrt(Math.max(0, 1 - clamped * clamped));
    widths.push(Math.max(minWidth, Math.min(width, chord)));
  }
  return widths;
}

export interface ResolveTextWrapLineWidthsInput {
  wrapShape: TextWrapShape | undefined;
  width: number | undefined;
  height: number | undefined;
  lineHeight: number;
}

/**
 * The one derivation both `resolveTextGeometry` and the engine call.
 *
 * Returns `null` for the default rectangular wrap, a non-finite box, or a
 * vertical writing mode (vertical columns are a different geometry and are
 * deliberately left rectangular until column profiles are designed).
 */
export function resolveTextWrapLineWidths(
  input: ResolveTextWrapLineWidthsInput,
): readonly number[] | null {
  if (input.wrapShape !== 'ellipse') return null;
  const width = input.width;
  const height = input.height;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if ((width as number) <= 0 || (height as number) <= 0) return null;
  if (!Number.isFinite(input.lineHeight) || input.lineHeight <= 0) return null;
  return ellipseLineWidthProfile({
    width: width as number,
    height: height as number,
    lineHeight: input.lineHeight,
  });
}
