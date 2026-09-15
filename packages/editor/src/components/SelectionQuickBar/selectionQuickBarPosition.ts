/**
 * Horizontal placement for the selection-anchored quick bar.
 *
 * The bar is centred on the selection (`translateX(-50%)`), which is correct in
 * the middle of the canvas. Near an edge it is not: `.editor-canvas` is
 * `overflow: hidden`, so an unclamped bar is clipped by the canvas box and its
 * *leading* actions — the ones a user reaches for first — become unclickable
 * rather than merely off-centre. That is how "Crop" disappeared behind the left
 * sidebar when the selection sat at the canvas's left edge.
 *
 * The rule is deliberately conservative: keep both edges of the bar inside the
 * canvas box. When the bar is wider than the box (a long action profile on a
 * small window), pin the leading edge to the margin so the first actions stay
 * reachable and the inner strip scrolls for the rest; a trailing-only fix would
 * hide the first actions instead, which is the bug being fixed.
 */

/** Default inset from the canvas edge, in CSS px. */
export const QUICK_BAR_EDGE_MARGIN = 8;

/**
 * Width estimate for the first paint, before the bar has been measured. Only
 * affects the frame in which the bar mounts.
 */
export const QUICK_BAR_ESTIMATED_WIDTH = 320;

/**
 * Resolve the bar's `left` (its centre, because the CSS applies
 * `translateX(-50%)`) so the bar never leaves the canvas box horizontally.
 *
 * Pure and side-effect free so the geometry can be tested without layout.
 */
export function clampQuickBarLeft(
  centerX: number,
  barWidth: number,
  containerWidth: number,
  margin: number = QUICK_BAR_EDGE_MARGIN,
): number {
  if (!Number.isFinite(centerX)) return margin;
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    // No geometry to clamp against (e.g. a detached render): leave it centred.
    return centerX;
  }
  const safeMargin = Math.max(0, margin);
  const usableWidth = Math.max(0, containerWidth - 2 * safeMargin);
  const width = Number.isFinite(barWidth) && barWidth > 0 ? barWidth : 0;
  if (width === 0) {
    // Unmeasured first paint: clamp with the estimate so the bar does not start
    // off-canvas for a frame.
    const estimate = Math.min(QUICK_BAR_ESTIMATED_WIDTH, usableWidth);
    return clampCenter(centerX, estimate, containerWidth, safeMargin);
  }
  if (width >= usableWidth) {
    // Wider than the canvas: pin the leading edge, let the inner strip scroll.
    return safeMargin + width / 2;
  }
  return clampCenter(centerX, width, containerWidth, safeMargin);
}

function clampCenter(
  centerX: number,
  width: number,
  containerWidth: number,
  margin: number,
): number {
  const half = width / 2;
  const lower = margin + half;
  const upper = containerWidth - margin - half;
  if (upper < lower) return lower;
  return Math.min(Math.max(centerX, lower), upper);
}

/**
 * Band of the canvas occupied by chrome pinned to one edge, which the bar must
 * not overlap. The floating tool palette is deliberately one z-level above the
 * quick bar (`z-index: calc(var(--elevation-z-raised) + 1)`) so it stays the
 * reachable tool surface; the quick bar therefore yields to it instead of
 * covering it. The palette can be user-placed at the canvas top or bottom
 * (`View > Toolbar at Top`), so the occupied edge is derived from the rects
 * rather than assumed, and any palette size (compact, touch, responsive
 * overflow) is respected without duplicating its geometry tokens.
 */
export interface QuickBarPadReserve {
  /** Height reserved at the canvas top. */
  top: number;
  /** Height reserved at the canvas bottom. */
  bottom: number;
}

export function padReserveFromRects(
  canvas: { top: number; bottom: number; height?: number } | null | undefined,
  palette: { top: number; bottom?: number; height?: number } | null | undefined,
): QuickBarPadReserve {
  const none: QuickBarPadReserve = { top: 0, bottom: 0 };
  if (!canvas || !palette) return none;
  if (!Number.isFinite(canvas.top) || !Number.isFinite(canvas.bottom)) return none;
  if (!Number.isFinite(palette.top)) return none;
  if (palette.height !== undefined && !(palette.height > 0)) return none;

  const canvasHeight =
    canvas.height !== undefined && Number.isFinite(canvas.height)
      ? canvas.height
      : canvas.bottom - canvas.top;
  if (!(canvasHeight > 0)) return none;

  const paletteTop = Math.max(0, Math.min(canvasHeight, palette.top - canvas.top));
  const paletteBottom = Math.max(
    paletteTop,
    Math.min(
      canvasHeight,
      (palette.bottom !== undefined && Number.isFinite(palette.bottom)
        ? palette.bottom
        : palette.top + (palette.height ?? 0)) - canvas.top,
    ),
  );
  const bandHeight = paletteBottom - paletteTop;
  if (bandHeight <= 0) return none;

  // The palette occupies one edge: whichever half its band sits in.
  const occupiesTop = paletteTop + bandHeight / 2 <= canvasHeight / 2;
  return occupiesTop
    ? { top: paletteBottom, bottom: 0 }
    : { top: 0, bottom: canvasHeight - paletteTop };
}

export interface QuickBarVerticalPlacement {
  /** Canvas-local top edge for the bar. */
  top: number;
  /** True when the bar had to sit above the selection instead of below it. */
  flipped: boolean;
}

/**
 * Vertical placement. Preference order: below the selection, above the
 * selection, then as high as possible — never inside a reserved edge band.
 */
export function resolveQuickBarTop(params: {
  selectionTop: number;
  selectionBottom: number;
  barHeight: number;
  containerHeight: number;
  /** Chrome pinned to the canvas top (see padReserveFromRects). */
  reservedTop?: number;
  /** Chrome pinned to the canvas bottom (see padReserveFromRects). */
  reservedBottom?: number;
  margin?: number;
}): QuickBarVerticalPlacement {
  const margin = Math.max(0, params.margin ?? QUICK_BAR_EDGE_MARGIN);
  const clampReserve = (value: number | undefined): number =>
    Number.isFinite(value) ? Math.max(0, Math.min(value!, params.containerHeight)) : 0;
  const usableTop = Math.max(margin, clampReserve(params.reservedTop));
  const usableBottom = Math.max(
    usableTop,
    params.containerHeight - clampReserve(params.reservedBottom),
  );
  const height = params.barHeight > 0 ? params.barHeight : 0;

  const belowTop = params.selectionBottom + margin;
  const aboveTop = params.selectionTop - margin - height;
  const fitsBelow = belowTop >= usableTop && belowTop + height <= usableBottom;
  const flipped = !fitsBelow;
  const preferred = fitsBelow ? belowTop : Math.max(usableTop, aboveTop);
  // Never enter a reserved band, and never leave the canvas top.
  const highestAllowed = Math.max(usableTop, usableBottom - height);
  const top = Math.max(usableTop, Math.min(preferred, highestAllowed));
  return { top, flipped };
}
