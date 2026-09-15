/**
 * Print overlay rendering — bleed guides, safe area, slug, and trim marks.
 *
 * Renders SVG overlays positioned over the canvas to guide print production.
 * Values arrive in document pixels (resolved via the canonical print
 * geometry resolver — see PagePrintOverlays), scaled by pxPerUnit to screen
 * pixels at the current zoom.
 *
 * Visual contract:
 *  - bleed bounds: dashed accent rect + a very subtle accent-tinted band
 *    between the trim edge and the bleed boundary (the production region)
 *  - trim: solid page outline comes from drawPageDecorations (content
 *    canvas); the L-shaped corner marks here reinforce where the sheet is
 *    cut
 *  - safe area: dashed success-tinted rect (inside trim)
 *  - slug: dashed info-tinted rect (outside bleed)
 * Line style (dash patterns, not hue alone) differentiates the guides so
 * they stay legible in light, dark and high-contrast themes.
 */
import type { BleedConfig, SafeAreaConfig, SlugConfig } from '@varve/scene';

import './PrintOverlays.css';

export interface PrintOverlaysProps {
  pageWidth: number;
  pageHeight: number;
  zoom: number;
  bleed?: BleedConfig;
  safeArea?: SafeAreaConfig;
  slug?: SlugConfig;
  pxPerUnit: number;
  /** Screen-space offset of the page origin (world->screen). */
  offsetX?: number;
  offsetY?: number;
}

/** Convert a value in document pixels to screen pixels at pxPerUnit. */
function toPx(value: number, pxPerUnit: number): number {
  return value * pxPerUnit;
}

const TRIM_MARK_LENGTH_MM = 5;
const MM_PER_INCH = 25.4;
const CSS_DPI = 96;

export function PrintOverlays({
  pageWidth,
  pageHeight,
  zoom,
  bleed,
  safeArea,
  slug,
  pxPerUnit,
  offsetX = 0,
  offsetY = 0,
}: PrintOverlaysProps) {
  const pw = pageWidth * pxPerUnit;
  const ph = pageHeight * pxPerUnit;

  const hasBleed =
    bleed && (bleed.top > 0 || bleed.right > 0 || bleed.bottom > 0 || bleed.left > 0);
  const hasSafeArea = safeArea?.enabled === true;
  const hasSlug = slug?.enabled === true;

  if (!hasBleed && !hasSafeArea && !hasSlug) return null;

  const bleedL = hasBleed ? toPx(bleed?.left, pxPerUnit) : 0;
  const bleedT = hasBleed ? toPx(bleed?.top, pxPerUnit) : 0;
  const bleedR = hasBleed ? toPx(bleed?.right, pxPerUnit) : 0;
  const bleedB = hasBleed ? toPx(bleed?.bottom, pxPerUnit) : 0;

  const safeL = hasSafeArea ? toPx(safeArea?.left, pxPerUnit) : 0;
  const safeT = hasSafeArea ? toPx(safeArea?.top, pxPerUnit) : 0;
  const safeR = hasSafeArea ? toPx(safeArea?.right, pxPerUnit) : 0;
  const safeB = hasSafeArea ? toPx(safeArea?.bottom, pxPerUnit) : 0;

  const slugL = hasSlug ? toPx(slug?.left, pxPerUnit) : 0;
  const slugT = hasSlug ? toPx(slug?.top, pxPerUnit) : 0;
  const slugR = hasSlug ? toPx(slug?.right, pxPerUnit) : 0;
  const slugB = hasSlug ? toPx(slug?.bottom, pxPerUnit) : 0;

  const trimMarkLen = (TRIM_MARK_LENGTH_MM / MM_PER_INCH) * CSS_DPI * pxPerUnit;

  // Bleed band: the ring between the trim edge and the bleed boundary,
  // drawn as an evenodd donut so the page interior stays untouched.
  const bandPath = hasBleed
    ? [
        `M ${-bleedL} ${-bleedT} h ${pw + bleedL + bleedR} v ${ph + bleedT + bleedB} h ${-(pw + bleedL + bleedR)} z`,
        `M 0 0 h ${pw} v ${ph} h ${-pw} z`,
      ].join(' ')
    : '';

  return (
    <svg
      className="print-overlays"
      aria-hidden
      role="presentation"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      <g transform={`translate(${offsetX}, ${offsetY})`}>
        {/* Bleed band — subtle production-region tint between trim and bleed */}
        {hasBleed && (
          <path className="print-bleed-band" d={bandPath} fillRule="evenodd" stroke="none" />
        )}

        {/* Bleed guide rect (accent dashed) — the outer production extent */}
        {hasBleed && (
          <rect
            className="print-bleed-rect print-bleed-guide"
            x={-bleedL}
            y={-bleedT}
            width={pw + bleedL + bleedR}
            height={ph + bleedT + bleedB}
            fill="none"
            strokeWidth={1 / zoom}
            strokeDasharray={`${4 / zoom}, ${4 / zoom}`}
          />
        )}

        {/* Safe area guide rect (success dashed, inside trim) */}
        {hasSafeArea && (
          <rect
            className="print-safe-area-rect print-safe-area-guide"
            x={safeL}
            y={safeT}
            width={pw - safeL - safeR}
            height={ph - safeT - safeB}
            fill="none"
            strokeWidth={1 / zoom}
            strokeDasharray={`${4 / zoom}, ${4 / zoom}`}
          />
        )}

        {/* Slug area rect (info dashed, outside bleed) */}
        {hasSlug && (
          <rect
            className="print-slug-rect print-slug-guide"
            x={-bleedL - slugL}
            y={-bleedT - slugT}
            width={pw + bleedL + bleedR + slugL + slugR}
            height={ph + bleedT + bleedB + slugT + slugB}
            fill="none"
            strokeWidth={1 / zoom}
            strokeDasharray={`${2 / zoom}, ${4 / zoom}`}
          />
        )}

        {/* Trim corner marks — L-shaped lines at 4 corners (where the sheet is cut) */}
        {/* Top-left */}
        <path
          className="print-trim-mark"
          d={`M 0,${-trimMarkLen} L 0,0 L ${-trimMarkLen},0`}
          fill="none"
          strokeWidth={1 / zoom}
        />
        <path
          className="print-trim-mark"
          d={`M ${pw},${-trimMarkLen} L ${pw},0 L ${pw + trimMarkLen},0`}
          fill="none"
          strokeWidth={1 / zoom}
        />
        <path
          className="print-trim-mark"
          d={`M 0,${ph + trimMarkLen} L 0,${ph} L ${-trimMarkLen},${ph}`}
          fill="none"
          strokeWidth={1 / zoom}
        />
        <path
          className="print-trim-mark"
          d={`M ${pw},${ph + trimMarkLen} L ${pw},${ph} L ${pw + trimMarkLen},${ph}`}
          fill="none"
          strokeWidth={1 / zoom}
        />
      </g>
    </svg>
  );
}
