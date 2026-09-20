/**
 * Balloon-aware line-width profiles.
 *
 * A rectangle is the wrong interior model for a round balloon: a line that
 * fills the box collides with the curved wall, and the first and last lines of
 * a stack sit in the widest part of the shape. Professional lettering narrows
 * the top and bottom lines so the type echoes the outline, keeping the longest
 * line near the vertical middle. (Nate Piekos documents the same intent as the
 * "94% line width" stacking guide; Blambot's grammar notes require the text to
 * sit off the border with even optical margins.)
 *
 * The profile is expressed over the number of lines the text actually forms,
 * not over the container height. A tall, mostly empty balloon must not squeeze
 * its first line into a sliver just because the box is tall; a one-line
 * caption must stay (nearly) full width; and a five-line speech balloon gets
 * the diamond. Callers derive the line count with a plain rectangular pass,
 * then re-lay out with the profile, iterating until the count is stable.
 *
 * The widest chord is held at 94% of the interior measure so no line kisses
 * the padding edge — the optical inset letterers keep by hand.
 *
 * This module is pure and shared. The scene bounds resolver
 * (`@varve/scene` → `textBounds` → `@varve/shared` `resolveTextGeometry`) and
 * the engine painter (`@varve/engine` → `textLayoutSnapshot`) both derive the
 * same per-line widths through this function, so a contour balloon breaks
 * lines identically in selection, hit testing, editing, and paint. The wrap
 * shape is authored state; the profile is derived and never serialized.
 */

export type TextWrapShape = 'rect' | 'ellipse';

export const TEXT_WRAP_SHAPES: readonly TextWrapShape[] = ['rect', 'ellipse'];

export interface BalloonLineWidthProfileOptions {
  /** Interior width available to text, in local px. */
  width: number;
  /** Number of lines the text forms in this box. At least one. */
  lineCount: number;
  /**
   * Optical floor for a shaped line as a fraction of `width`. Lines whose
   * elliptical chord falls below this still get this much room, so a single
   * long word is never squeezed into a one-character column.
   */
  minWidthRatio?: number;
}

const DEFAULT_MIN_WIDTH_RATIO = 0.34;
/**
 * The widest line of a stack is held just inside the full interior measure
 * (the lettering "94% line width" convention), so no line ever kisses the
 * padding edge and a fit keeps an optical margin.
 */
const MAX_LINE_FRACTION = 0.94;

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Per-line maximum widths for a text stack inscribed in an ellipse.
 *
 * Entry `i` is the usable width of line `i` counted from the top, with the
 * widest entries near the vertical middle. Results are finite, positive, never
 * wider than `width`, and symmetric by construction. Degenerate inputs fall
 * back to a single full-width entry rather than producing NaN.
 */
export function ellipseLineWidthProfile(options: BalloonLineWidthProfileOptions): number[] {
  const interior = finitePositive(options.width, 1);
  const width = interior * MAX_LINE_FRACTION;
  const lineCount = Math.max(
    1,
    Math.min(512, Number.isFinite(options.lineCount) ? Math.floor(options.lineCount) : 1),
  );
  const minRatio = Number.isFinite(options.minWidthRatio)
    ? Math.max(0, Math.min(1, options.minWidthRatio as number))
    : DEFAULT_MIN_WIDTH_RATIO;
  if (lineCount === 1) return [width];

  const minWidth = width * minRatio;
  const widths: number[] = [];
  for (let index = 0; index < lineCount; index++) {
    // Center of line index in [0,1]; the +0.5 keeps the profile symmetric
    // about the vertical midline instead of drifting upward.
    const normalized = ((index + 0.5) / lineCount) * 2 - 1;
    const clamped = Math.max(-1, Math.min(1, normalized));
    const chord = width * Math.sqrt(Math.max(0, 1 - clamped * clamped));
    widths.push(Math.max(minWidth, Math.min(width, chord)));
  }
  return widths;
}

/** Width cap for one line index; lines past the end reuse the final entry. */
export function lineWidthAt(
  lineWidths: readonly number[] | null | undefined,
  maxWidth: number,
  lineIndex: number,
): number {
  if (!lineWidths || lineWidths.length === 0) return maxWidth;
  const entry = lineWidths[Math.min(lineIndex, lineWidths.length - 1)];
  const width = Number.isFinite(entry) ? (entry as number) : maxWidth;
  return Math.max(0, Math.min(maxWidth, width));
}
