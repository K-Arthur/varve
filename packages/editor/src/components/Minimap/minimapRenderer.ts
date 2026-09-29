/**
 * Minimap Canvas2D renderer — draws the minimap scene to a canvas context.
 *
 * Separated from the React component for testability and to support
 * offscreen rendering (e.g., for thumbnails or WebWorker preparation).
 *
 * Drawing contract (2026-09-29)
 * -----------------------------
 * The overview is a *shape* map, not a legible document. Its marks are 1–2
 * CSS px, so:
 *
 * - **Form carries the distinction; hue is supplementary.** Frames are
 *   outlined containers with a wash, leaves are solid masses, adjustment
 *   nodes are bars. Kind hue (minimap-ink-*) only reinforces that, because a
 *   2 px mark cannot carry a colour-only cue (WCAG 1.4.1).
 * - **Every ink clears 3:1 against the backplate** in all three themes, with
 *   margin, enforced by `MINIMAP_OVERVIEW_CONTRAST_PAIRS` in `@varve/ui`.
 *   Before this contract the renderer reused `--color-border-subtle` for
 *   shape/text/group ink, which measures 1.19:1 in Light: the artwork was
 *   invisible in the default theme.
 * - **Text is drawn only when it can be legible** (≥ 7 CSS px). Below that it
 *   is omitted rather than rendered as unreadable mush; the accessible name
 *   on the map carries the same orientation information as text.
 * - **The viewport rectangle is never smaller than `MIN_VIEWFINDER_CSS_PX`**,
 *   and the panel hit-tests the same inflated polygon that is drawn here, so
 *   what a user sees as grabbable is grabbable.
 * - Group outlines are **not** painted. A group's bounds are the union of its
 *   painted children, so drawing both double-draws the same edge and adds a
 *   rectangle that corresponds to no visible object.
 *
 * Rendering order: backplate → page trim → entries → labels → selection →
 * exceptional-scale markers → viewport rectangle.
 */

import type {
  MinimapEntry,
  MinimapFootprint,
  MinimapPage,
  MinimapScene,
  MinimapTransform,
} from './minimapLayout';
import {
  clipFootprintToStage,
  inflateFootprintToMinimum,
  MIN_VIEWFINDER_CSS_PX,
  worldRectToMinimap,
} from './minimapLayout';

/* -------------------------------------------------------------------------- */
/*  Color tokens (resolved from CSS vars at render time)                      */
/* -------------------------------------------------------------------------- */

export interface MinimapColors {
  /** Recessed pasteboard well behind everything else. */
  backplate: string;
  /** Page / design-canvas paper. */
  pageFill: string;
  /** Placed-page trim outline. */
  pageStroke: string;
  /** Active page trim outline. */
  activePageStroke: string;
  /** Frame container wash and outline. */
  frameInk: string;
  /** Vector leaf mass. */
  shapeInk: string;
  /** Text mass. */
  textInk: string;
  /** Raster / image mass. */
  imageInk: string;
  /** Adjustment-node bar. */
  adjustmentInk: string;
  /** Selection outline (theme-stable; drawn over arbitrary artwork). */
  selectionStroke: string;
  /** Viewport rectangle outline. */
  viewfinderStroke: string;
  /**
   * Contrast ring under the viewport outline.
   *
   * Uses the theme's strongest surface contrast (`text-primary`, 15.8–21:1 on
   * the backplate) rather than the canvas handle core, which is white-on-white
   * in Light and so added nothing over the map. The double band — strong ring,
   * accent core — is also what keeps the viewfinder distinguishable from a
   * selected object's single accent outline: the two are the same accent token
   * in every theme, so colour alone can never separate them.
   */
  viewfinderRing: string;
  /** Exceptional-scale marker. */
  outlierInk: string;
  /** Frame and page label ink. */
  labelInk: string;
  /** Hidden-node ghost ink, always drawn at `HIDDEN_ENTRY_ALPHA`. */
  hiddenInk: string;
}

/**
 * Resolve minimap colors from CSS custom properties.
 *
 * Every name here is a token with an enforced contrast pairing; see
 * `MINIMAP_OVERVIEW_CONTRAST_PAIRS` in `@varve/ui/src/tokens/color.ts`. The
 * fallbacks mirror the Light values and exist for non-DOM/test rendering.
 */
export function resolveMinimapColors(
  getVar: (name: string, fallback: string) => string,
): MinimapColors {
  return {
    backplate: getVar('--color-surface-sunken', 'oklch(0.95 0.008 260)'),
    pageFill: getVar('--color-surface-base', 'oklch(0.97 0.008 260)'),
    pageStroke: getVar('--color-border-strong', 'oklch(0.5699 0.0308 260.28)'),
    activePageStroke: getVar('--color-canvas-selection', 'oklch(0.4452 0.0693 190.9)'),
    frameInk: getVar('--color-minimap-ink-frame', 'oklch(0.5741 0.1309 252.23)'),
    shapeInk: getVar('--color-minimap-ink-shape', 'oklch(0.6042 0.1298 57.3)'),
    textInk: getVar('--color-minimap-ink-text', 'oklch(0.5052 0.1304 148.06)'),
    imageInk: getVar('--color-minimap-ink-image', 'oklch(0.6173 0.18 330)'),
    adjustmentInk: getVar('--color-minimap-ink-adjustment', 'oklch(0.6125 0.16 30)'),
    selectionStroke: getVar('--color-canvas-selection', 'oklch(0.4452 0.0693 190.9)'),
    viewfinderStroke: getVar('--color-canvas-selection', 'oklch(0.4452 0.0693 190.9)'),
    viewfinderRing: getVar('--color-text-primary', 'oklch(0.1956 0.0217 263.87)'),
    outlierInk: getVar('--color-feedback-danger', 'oklch(0.5763 0.1773 22.78)'),
    labelInk: getVar('--color-text-muted', 'oklch(0.43 0.032 262)'),
    hiddenInk: getVar('--color-text-disabled', 'oklch(0.58 0.025 261)'),
  };
}

/* -------------------------------------------------------------------------- */
/*  Drawing constants                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Hidden nodes are drawn as ghosts, deliberately *below* the ink contrast
 * floor: absence is the information, and a fully legible hidden node would
 * defeat the point of hiding it. Only reachable when the scene is built with
 * `includeHidden`.
 */
const HIDDEN_ENTRY_ALPHA = 0.15;
/** Frame body wash. The 1 px ink outline above it carries the contrast. */
const FRAME_WASH_ALPHA = 0.16;
/** Smallest legible label size, in CSS px. Below this, labels are omitted. */
const LABEL_MIN_PX = 7;
/** Largest label size, in CSS px — a miniature must stay miniature. */
const LABEL_MAX_PX = 10;
/** Exceptional-scale corner tick length, in CSS px. */
const OUTLIER_TICK_PX = 5;
/** Rough average glyph advance as a fraction of font size (body sans). */
const GLYPH_ADVANCE_RATIO = 0.58;

/** Viewfinder interaction state. Hover and drag must be visible states. */
export type MinimapViewfinderState = 'idle' | 'hover' | 'drag';

export interface MinimapRenderOptions {
  /** Device pixel ratio for the backing store. Defaults to 1. */
  dpr?: number;
  /** CSS font stack for frame and page labels. */
  labelFont?: string;
  /** Viewfinder interaction state; strengthens the outline on hover/drag. */
  viewfinder?: MinimapViewfinderState;
}

/* -------------------------------------------------------------------------- */
/*  Drawing primitives                                                        */
/* -------------------------------------------------------------------------- */

function withEntryVisibility(
  ctx: CanvasRenderingContext2D,
  entry: MinimapEntry,
  draw: () => void,
): void {
  ctx.save();
  if (!entry.visible) ctx.globalAlpha *= HIDDEN_ENTRY_ALPHA;
  draw();
  ctx.restore();
}

/** Fill a leaf mass (vector shape, text, or raster) with its kind ink. */
function drawLeafEntry(
  ctx: CanvasRenderingContext2D,
  entry: MinimapEntry,
  tf: MinimapTransform,
  ink: string,
  colors: MinimapColors,
): void {
  const mm = worldRectToMinimap(entry.bounds, tf);
  withEntryVisibility(ctx, entry, () => {
    ctx.fillStyle = entry.visible ? ink : colors.hiddenInk;
    ctx.fillRect(mm.x, mm.y, mm.w, mm.h);
  });
}

/** Frames are containers: a wash plus a 1 px ink outline. */
function drawFrameEntry(
  ctx: CanvasRenderingContext2D,
  entry: MinimapEntry,
  tf: MinimapTransform,
  colors: MinimapColors,
): void {
  const mm = worldRectToMinimap(entry.bounds, tf);
  withEntryVisibility(ctx, entry, () => {
    if (!entry.visible) {
      ctx.strokeStyle = colors.hiddenInk;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.strokeRect(mm.x, mm.y, mm.w, mm.h);
      return;
    }
    ctx.save();
    ctx.globalAlpha *= FRAME_WASH_ALPHA;
    ctx.fillStyle = colors.frameInk;
    ctx.fillRect(mm.x, mm.y, mm.w, mm.h);
    ctx.restore();
    ctx.strokeStyle = colors.frameInk;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    // Half-pixel inset keeps a 1 px outline crisp instead of straddling two
    // device pixels; the frame is the map's primary structural edge.
    ctx.strokeRect(mm.x + 0.5, mm.y + 0.5, Math.max(0, mm.w - 1), Math.max(0, mm.h - 1));
  });
}

/** Ellipses and circles are drawn as their silhouette, not their bounding box. */
function drawEllipseEntry(
  ctx: CanvasRenderingContext2D,
  entry: MinimapEntry,
  tf: MinimapTransform,
  ink: string,
  colors: MinimapColors,
): void {
  const mm = worldRectToMinimap(entry.bounds, tf);
  if (typeof ctx.ellipse !== 'function') {
    drawLeafEntry(ctx, entry, tf, ink, colors);
    return;
  }
  withEntryVisibility(ctx, entry, () => {
    ctx.fillStyle = entry.visible ? ink : colors.hiddenInk;
    ctx.beginPath();
    ctx.ellipse(
      mm.x + mm.w / 2,
      mm.y + mm.h / 2,
      Math.max(mm.w / 2, 0.5),
      Math.max(mm.h / 2, 0.5),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.closePath();
  });
}

/** Adjustment nodes have no artwork of their own: a thin full-width bar. */
function drawAdjustmentEntry(
  ctx: CanvasRenderingContext2D,
  entry: MinimapEntry,
  tf: MinimapTransform,
  colors: MinimapColors,
): void {
  const mm = worldRectToMinimap(entry.bounds, tf);
  withEntryVisibility(ctx, entry, () => {
    ctx.fillStyle = entry.visible ? colors.adjustmentInk : colors.hiddenInk;
    ctx.fillRect(mm.x, mm.y, mm.w, Math.max(mm.h, 2));
  });
}

function drawSelectionHighlight(
  ctx: CanvasRenderingContext2D,
  entry: MinimapEntry,
  tf: MinimapTransform,
  colors: MinimapColors,
): void {
  const mm = worldRectToMinimap(entry.bounds, tf);
  ctx.strokeStyle = colors.selectionStroke;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeRect(mm.x - 1, mm.y - 1, mm.w + 2, mm.h + 2);
}

/**
 * Draw a label only when it can actually be read.
 *
 * The previous implementation shrank text to 5 px to force it to fit, which
 * produced grey mush that cost bytes and attention without conveying a name.
 * A label is now omitted unless it clears `LABEL_MIN_PX` in a box that is
 * also tall enough to hold the line.
 */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  boxW: number,
  boxH: number,
  ink: string,
  labelFont: string,
): boolean {
  if (!text.trim()) return false;
  const available = Math.max(0, boxW - 4);
  const textWidthAt = (size: number): number => {
    ctx.font = `${size}px ${labelFont}`;
    const measured = ctx.measureText?.(text)?.width;
    if (typeof measured === 'number' && Number.isFinite(measured) && measured > 0) return measured;
    return text.length * size * GLYPH_ADVANCE_RATIO;
  };

  const ideal = Math.min(LABEL_MAX_PX, boxH - 2);
  if (ideal < LABEL_MIN_PX) return false;
  let size = ideal;
  if (textWidthAt(size) > available) {
    size = Math.min(size, (size * available) / textWidthAt(size));
  }
  if (size < LABEL_MIN_PX) return false;

  ctx.font = `${size}px ${labelFont}`;
  ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 1, y + 1, Math.max(0, boxW - 2), Math.max(0, boxH - 2));
  ctx.clip();
  ctx.fillText(text, x + 2, y + 2);
  ctx.restore();
  return true;
}

function drawPage(
  ctx: CanvasRenderingContext2D,
  page: MinimapPage,
  tf: MinimapTransform,
  colors: MinimapColors,
  options: MinimapRenderOptions,
): void {
  const mm = worldRectToMinimap(page.bounds, tf);
  ctx.fillStyle = colors.pageFill;
  ctx.fillRect(mm.x, mm.y, mm.w, mm.h);
  ctx.strokeStyle = page.active ? colors.activePageStroke : colors.pageStroke;
  ctx.lineWidth = 1;
  ctx.setLineDash(page.active ? [] : [3, 2]);
  ctx.strokeRect(mm.x + 0.5, mm.y + 0.5, Math.max(0, mm.w - 1), Math.max(0, mm.h - 1));
  ctx.setLineDash([]);

  if (page.name) {
    drawLabel(
      ctx,
      page.name,
      mm.x,
      mm.y,
      mm.w,
      mm.h,
      colors.labelInk,
      options.labelFont ?? 'sans-serif',
    );
  }
}

/** One short tick per corner: visible, quiet, and not a glyph to decipher. */
function drawOutlierMarker(
  ctx: CanvasRenderingContext2D,
  entry: MinimapEntry,
  tf: MinimapTransform,
  colors: MinimapColors,
): void {
  const mm = worldRectToMinimap(entry.bounds, tf);
  const tick = Math.max(3, Math.min(OUTLIER_TICK_PX, mm.w, mm.h));
  ctx.strokeStyle = colors.outlierInk;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  const x = mm.x + 0.5;
  const y = mm.y + 0.5;
  const right = mm.x + mm.w - 0.5;
  const bottom = mm.y + mm.h - 0.5;
  ctx.beginPath();
  ctx.moveTo(x, y + tick);
  ctx.lineTo(x, y);
  ctx.lineTo(x + tick, y);
  ctx.moveTo(right - tick, y);
  ctx.lineTo(right, y);
  ctx.lineTo(right, y + tick);
  ctx.moveTo(right, bottom - tick);
  ctx.lineTo(right, bottom);
  ctx.lineTo(right - tick, bottom);
  ctx.moveTo(x + tick, bottom);
  ctx.lineTo(x, bottom);
  ctx.lineTo(x, bottom - tick);
  ctx.stroke();
}

/**
 * The viewport rectangle — the one mark a user must always be able to find —
 * is drawn at its true projected quad but never smaller than
 * `MIN_VIEWFINDER_CSS_PX`, clipped to the map stage, and outlined with a
 * contrasting ring beneath the accent so it reads over artwork of either tone.
 *
 * There is deliberately **no interior wash**. It was compositing the accent
 * over every ink beneath it, which pulled the measured 3.5:1 ink contrast back
 * down toward 2:1 wherever the camera saw most of the document; the dual-tone
 * outline carries the same information without touching a single ink pixel.
 */
function drawViewfinder(
  ctx: CanvasRenderingContext2D,
  footprint: MinimapFootprint | null,
  tf: MinimapTransform,
  colors: MinimapColors,
  state: MinimapViewfinderState,
): void {
  if (!footprint || footprint.points.length < 3) return;
  const drawn = clipFootprintToStage(
    inflateFootprintToMinimum(footprint, MIN_VIEWFINDER_CSS_PX),
    tf.mmWidth,
    tf.mmHeight,
  );

  ctx.setLineDash([]);
  ctx.lineJoin = 'round';

  if (!drawn) {
    // The viewport is entirely off the map — the user has panned past their
    // own document. Say where it is rather than leaving a map with no
    // marker, which reads as a broken one.
    drawOffStagePointer(ctx, tf, footprint, colors, state);
    ctx.lineJoin = 'miter';
    return;
  }

  ctx.beginPath();
  ctx.moveTo(drawn.points[0]![0], drawn.points[0]![1]);
  for (const point of drawn.points.slice(1)) ctx.lineTo(point[0], point[1]);
  ctx.closePath();

  // Two bands on one path: a strong contrast ring, then the accent core. The
  // accent is what `canvas-selection` uses, so a single-line viewfinder would
  // be pixel-for-pixel the same cue as a selected object's outline.
  ctx.strokeStyle = colors.viewfinderRing;
  ctx.lineWidth = state === 'idle' ? 4.5 : 5.5;
  ctx.stroke();
  ctx.strokeStyle = colors.viewfinderStroke;
  ctx.lineWidth = state === 'idle' ? 1.75 : 2.5;
  ctx.stroke();
  ctx.lineJoin = 'miter';
}

/**
 * A chevron on the nearest map edge, pointing outward toward where the
 * off-stage viewport sits. Keeps "where did my view go" answerable from the
 * map itself instead of leaving a markerless panel that reads as broken.
 */
function drawOffStagePointer(
  ctx: CanvasRenderingContext2D,
  tf: MinimapTransform,
  footprint: MinimapFootprint,
  colors: MinimapColors,
  state: MinimapViewfinderState,
): void {
  const width = tf.mmWidth;
  const height = tf.mmHeight;
  const centerX = footprint.bounds.x + footprint.bounds.w / 2;
  const centerY = footprint.bounds.y + footprint.bounds.h / 2;
  const dx = centerX - width / 2;
  const dy = centerY - height / 2;
  const size = Math.max(4, Math.min(9, width / 3, height / 3));
  const horizontal = Math.abs(dx) / Math.max(1, width) >= Math.abs(dy) / Math.max(1, height);
  const outX = horizontal ? (dx > 0 ? width - 4 : 4) : clamp(centerX, size, width - size);
  const outY = horizontal ? clamp(centerY, size, height - size) : dy > 0 ? height - 4 : 4;

  ctx.save();
  ctx.strokeStyle = colors.viewfinderStroke;
  ctx.lineWidth = state === 'idle' ? 2 : 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (horizontal) {
    const dir = dx > 0 ? 1 : -1;
    ctx.moveTo(outX - dir * size, outY - size);
    ctx.lineTo(outX, outY);
    ctx.lineTo(outX - dir * size, outY + size);
  } else {
    const dir = dy > 0 ? 1 : -1;
    ctx.moveTo(outX - size, outY - dir * size);
    ctx.lineTo(outX, outY);
    ctx.lineTo(outX + size, outY - dir * size);
  }
  ctx.stroke();
  ctx.restore();
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), Math.max(max, min));
}

/* -------------------------------------------------------------------------- */
/*  Main render function                                                      */
/* -------------------------------------------------------------------------- */

/** Render the minimap scene to a canvas context. */
export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  scene: MinimapScene,
  tf: MinimapTransform,
  viewportFootprint: MinimapFootprint | null,
  colors: MinimapColors,
  options: MinimapRenderOptions = {},
): void {
  renderMinimapDocument(ctx, scene, tf, colors, options);
  // Draw the viewport indicator last (on top of everything). It sets every
  // context property it uses, so it does not depend on the document pass.
  drawViewfinder(ctx, viewportFootprint, tf, colors, options.viewfinder ?? 'idle');
}

/** Everything except the viewport indicator: independent of the camera. */
function renderMinimapDocument(
  ctx: CanvasRenderingContext2D,
  scene: MinimapScene,
  tf: MinimapTransform,
  colors: MinimapColors,
  options: MinimapRenderOptions,
): void {
  const { mmWidth, mmHeight } = tf;
  const dpr = options.dpr ?? 1;

  // Clear and fill the recessed pasteboard well.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, mmWidth, mmHeight);
  ctx.fillStyle = colors.backplate;
  ctx.fillRect(0, 0, mmWidth, mmHeight);

  // Page trim is the backplate for the shared pasteboard. Content remains
  // separately simplified so page gaps and empty pages stay visible.
  for (const page of scene.pages) drawPage(ctx, page, tf, colors, options);

  // Draw entries back-to-front (last entries are on top in paint order)
  for (let i = scene.entries.length - 1; i >= 0; i--) {
    const entry = scene.entries[i]!;

    // Skip zero-bounds entries (adjustment nodes without geometry)
    if (entry.bounds.w === 0 && entry.bounds.h === 0 && entry.paint !== 'frame') {
      continue;
    }

    switch (entry.paint) {
      case 'frame':
        drawFrameEntry(ctx, entry, tf, colors);
        break;
      // Groups contribute to content bounds but are not painted: their
      // children already carry the same edge, so an outline here would be a
      // second, redundant rectangle over no visible object.
      case 'group':
        break;
      case 'text':
        drawLeafEntry(ctx, entry, tf, colors.textInk, colors);
        break;
      case 'image':
        drawLeafEntry(ctx, entry, tf, colors.imageInk, colors);
        break;
      case 'ellipse':
        drawEllipseEntry(ctx, entry, tf, colors.shapeInk, colors);
        break;
      case 'adjustment':
        drawAdjustmentEntry(ctx, entry, tf, colors);
        break;
      default:
        drawLeafEntry(ctx, entry, tf, colors.shapeInk, colors);
        break;
    }
  }

  // Draw frame labels (only for top-level frames with a name worth reading)
  const labelFont = options.labelFont ?? 'sans-serif';
  for (const entry of scene.entries) {
    if (!entry.isFrame || entry.depth > 1 || !entry.labelWorthy) continue;
    const mm = worldRectToMinimap(entry.bounds, tf);
    drawLabel(ctx, entry.name, mm.x, mm.y, mm.w, mm.h, colors.labelInk, labelFont);
  }

  // Draw selection highlights on top
  for (const entry of scene.entries) {
    if (entry.selected) drawSelectionHighlight(ctx, entry, tf, colors);
  }

  // Draw exceptional-scale markers
  for (const outlier of scene.outliers) drawOutlierMarker(ctx, outlier, tf, colors);
}

interface MinimapDocumentLayer {
  scene: MinimapScene;
  tf: MinimapTransform;
  colors: MinimapColors;
  dpr: number;
  labelFont: string;
  layer: HTMLCanvasElement;
}

/**
 * The document pass, kept per minimap canvas. A pan or zoom changes only the
 * viewport indicator, so it copies this layer instead of redrawing every
 * entry (10,000 shapes per wheel event on a large document). The viewfinder
 * state is deliberately not part of the key: hovering must not invalidate the
 * document pixels.
 */
const documentLayers = new WeakMap<HTMLCanvasElement, MinimapDocumentLayer>();

function documentLayerFor(
  canvas: HTMLCanvasElement,
  scene: MinimapScene,
  tf: MinimapTransform,
  colors: MinimapColors,
  dpr: number,
  labelFont: string,
): HTMLCanvasElement | null {
  const cached = documentLayers.get(canvas);
  if (
    cached &&
    cached.scene === scene &&
    cached.tf === tf &&
    cached.colors === colors &&
    cached.dpr === dpr &&
    cached.labelFont === labelFont &&
    cached.layer.width === canvas.width &&
    cached.layer.height === canvas.height
  ) {
    return cached.layer;
  }
  const layer = cached?.layer ?? canvas.ownerDocument.createElement('canvas');
  layer.width = canvas.width;
  layer.height = canvas.height;
  const layerCtx = layer.getContext('2d');
  if (!layerCtx) return null;
  renderMinimapDocument(layerCtx, scene, tf, colors, { dpr, labelFont });
  documentLayers.set(canvas, { scene, tf, colors, dpr, labelFont, layer });
  return layer;
}

/** Render at a specific DPR. Handles canvas sizing. */
export function renderMinimapToCanvas(
  canvas: HTMLCanvasElement,
  scene: MinimapScene,
  tf: MinimapTransform,
  viewportFootprint: MinimapFootprint | null,
  colors: MinimapColors,
  options: MinimapRenderOptions = {},
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const view = canvas.ownerDocument.defaultView;
  const rawDpr = options.dpr ?? view?.devicePixelRatio ?? 1;
  const dpr = Number.isFinite(rawDpr) && rawDpr > 0 ? rawDpr : 1;
  const labelFont = options.labelFont ?? 'sans-serif';
  const width = Math.max(1, Math.round(tf.mmWidth * dpr));
  const height = Math.max(1, Math.round(tf.mmHeight * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const cssWidth = `${tf.mmWidth}px`;
  const cssHeight = `${tf.mmHeight}px`;
  if (canvas.style.width !== cssWidth) canvas.style.width = cssWidth;
  if (canvas.style.height !== cssHeight) canvas.style.height = cssHeight;

  const layer = documentLayerFor(canvas, scene, tf, colors, dpr, labelFont);
  if (!layer) {
    renderMinimap(ctx, scene, tf, viewportFootprint, colors, {
      dpr,
      labelFont,
      viewfinder: options.viewfinder,
    });
    return;
  }
  // A 1:1 copy of an identically drawn layer reproduces its pixels exactly.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(layer, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawViewfinder(ctx, viewportFootprint, tf, colors, options.viewfinder ?? 'idle');
}
