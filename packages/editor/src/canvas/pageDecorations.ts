/**
 * Page decorations for the shared multipage canvas (ADR-0144/0145):
 * per-page drop shadow, trim fill, active-page accent ring, and the label
 * band (display page number / page name) below each page.
 *
 * Drawn on the content canvas between the board fill and content replay so
 * the trim fill sits under authored content while shadows and labels stay
 * outside the trim. All geometry is world coordinates — the caller provides
 * a context with the camera transform already applied (and, on the
 * partial-redraw path, the dirty-region clip installed).
 *
 * Decoration pixels only change when page placement, page size, page
 * number/name, or the active page change; `dirtyRegion.ts` contributes the
 * affected page bounds (expanded by {@link PAGE_LABEL_BAND}) for exactly
 * those events, so retained pixels outside the dirty rects stay valid.
 *
 * This module must stay free of hub-file imports: CanvasArea calls it through
 * one thin import, and everything it needs lives here or in @varve/scene.
 */

import type { Document } from '@varve/scene';
import { pagesVisibleInWorldRect } from '@varve/scene';
import type { EditorCameraState } from './cameraState';
import { viewportWorldRect } from './cameraState';

/** Vertical space (world px) reserved below each page for the label band. */
export const PAGE_LABEL_BAND = 26;

const LABEL_FONT = `11px ${['system-ui', '-apple-system', 'Segoe UI', 'Inter', 'sans-serif'].join(', ')}`;

interface DecorationColors {
  /** Page trim fill (paper). */
  pageFill: string;
  /** Page trim border. */
  border: string;
  /** Label text. */
  label: string;
  /** Active-page accent ring. */
  accent: string;
  /** Drop shadow. */
  shadow: string;
}

const FALLBACK_COLORS: DecorationColors = {
  pageFill: '#ffffff',
  border: '#d3d3d7',
  label: '#6b6b73',
  accent: '#1fa2b0',
  shadow: 'rgba(0, 0, 0, 0.28)',
};

let cachedRevision = -1;
let cachedColors: DecorationColors = FALLBACK_COLORS;

/**
 * Resolve decoration colors from design tokens, cached per theme revision
 * (the same pattern CanvasArea uses for the board color, so per-frame
 * `getComputedStyle` recalc is never paid).
 */
export function decorationColors(themeRevision: number): DecorationColors {
  if (themeRevision === cachedRevision) return cachedColors;
  cachedRevision = themeRevision;
  if (typeof document === 'undefined') {
    cachedColors = FALLBACK_COLORS;
    return cachedColors;
  }
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string => {
    const value = cs.getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  };
  cachedColors = {
    pageFill: read('--color-surface-raised', FALLBACK_COLORS.pageFill),
    border: read('--color-border-subtle', FALLBACK_COLORS.border),
    label: read('--color-text-subtle', FALLBACK_COLORS.label),
    accent: read('--color-accent-primary', FALLBACK_COLORS.accent),
    shadow: FALLBACK_COLORS.shadow,
  };
  return cachedColors;
}

export interface PageDecorationOptions {
  themeRevision: number;
  /** Active page id — draws the accent ring and bolds its label. */
  activePageId?: string | null;
  /** Disable label rendering (used by thumbnails/export previews). */
  hideLabels?: boolean;
}

/**
 * Draw page decorations (shadow, trim fill, accent ring, labels) for every
 * page visible in the viewport. The context must have the camera transform
 * applied. Pure drawing: never reads editor state, never mutates the doc.
 */
export function drawPageDecorations(
  ctx: CanvasRenderingContext2D,
  doc: Document,
  camera: EditorCameraState,
  viewport: { width: number; height: number },
  options: PageDecorationOptions,
): void {
  const colors = decorationColors(options.themeRevision);
  const worldRect = viewportWorldRect(camera, viewport);
  const visible = pagesVisibleInWorldRect(doc, worldRect);
  const zoom = camera.zoom;
  if (visible.length === 0) return;

  ctx.save();
  try {
    // Pass 1 — shadows + trim fills under every page (later pages over
    // earlier ones, matching document paint order).
    for (const placed of visible) {
      const b = placed.bounds;
      ctx.save();
      ctx.shadowColor = colors.shadow;
      ctx.shadowBlur = 18 / zoom;
      ctx.shadowOffsetY = 6 / zoom;
      ctx.fillStyle = colors.pageFill;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.restore();
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1 / zoom;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    }

    // Pass 2 — active page accent ring (drawn over neighboring content so it
    // stays visible when pages overlap).
    if (options.activePageId) {
      const active = visible.find((p) => p.page.id === options.activePageId);
      if (active) {
        const b = active.bounds;
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 2 / zoom;
        ctx.strokeRect(b.x - 1 / zoom, b.y - 1 / zoom, b.w + 2 / zoom, b.h + 2 / zoom);
      }
    }

    // Pass 3 — label band below each visible page.
    if (!options.hideLabels) {
      ctx.fillStyle = colors.label;
      ctx.font = LABEL_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const bandTop = worldRect.y;
      const bandBottom = worldRect.y + worldRect.h;
      for (const placed of visible) {
        const b = placed.bounds;
        const labelY = b.y + b.h + 6 / zoom;
        // Cull labels whose band is entirely outside the viewport.
        if (labelY > bandBottom || labelY + PAGE_LABEL_BAND / zoom < bandTop) continue;
        const text = placed.pageNumber.length > 0 ? placed.pageNumber : placed.page.name;
        ctx.fillText(text, b.x + b.w / 2, labelY);
      }
    }
  } finally {
    ctx.restore();
  }
}
